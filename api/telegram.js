const admin = require('firebase-admin');

// 1. تهيئة جدار الإدارة (Admin SDK) باستخدام المفاتيح التي زرعناها في Vercel
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            // هذا السطر يضمن قراءة التشفير بشكل صحيح
            privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        })
    });
}

const db = admin.firestore();

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

    // ==========================================
    // أ. وظيفة التوصيل: (من المتجر إلى تيليجرام)
    // ==========================================
    if (req.body.chat_id && !req.body.update_id) {
        try {
            const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(req.body)
            });
            const data = await response.json();
            return res.status(200).json(data);
        } catch (err) {
            return res.status(500).json({ error: err.message });
        }
    }

    // ==========================================
    // ب. الهندسة العكسية: (من تيليجرام إلى المتجر وقاعدة البيانات)
    // ==========================================
    if (req.body.message && req.body.message.text) {
        const text = req.body.message.text.trim();
        const chatId = req.body.message.chat.id;

        // المستشعر: يلتقط فقط الرسائل التي تبدأ بـ "تأكيد" أو "إلغاء"
        if (text.startsWith('تأكيد') || text.startsWith('إلغاء')) {
            const parts = text.split(' ');
            const action = parts[0]; // تأكيد أو إلغاء
            const orderId = parts[1]?.replace('#', ''); // تنظيف رقم الطلب من رمز #

            if (!orderId) return res.status(200).send('OK');

            try {
                // البحث عن الطلب في قاعدة البيانات
                const snapshot = await db.collection('orders').where('orderId', '==', orderId).get();
                
                if (snapshot.empty) {
                    await sendTelegramReply(chatId, `❌ لم أتمكن من العثور على الطلب: ${orderId}`, BOT_TOKEN);
                    return res.status(200).send('OK');
                }

                const orderDoc = snapshot.docs[0];
                const orderData = orderDoc.data();

                if (action === 'تأكيد') {
                    // تحديث الحالة فقط
                    await orderDoc.ref.update({ status: 'تم التأكيد' });
                    await sendTelegramReply(chatId, `✅ تم تأكيد الطلب: ${orderId}\n(الزبون سيراه "تم التأكيد" في الموقع)`, BOT_TOKEN);
                
                } else if (action === 'إلغاء') {
                    // التدمير العكسي (Rollback): تحديث الحالة + استرجاع المخزون
                    const batch = db.batch();
                    const items = orderData.items || [];

                    // البحث عن المنتجات وإرجاع الكميات لرفوف البقالة
                    for (const item of items) {
                        const productQuery = await db.collection('products').where('name', '==', item.name).get();
                        if (!productQuery.empty) {
                            const productRef = productQuery.docs[0].ref;
                            batch.update(productRef, { 
                                quantity: admin.firestore.FieldValue.increment(item.qty) 
                            });
                        }
                    }

                    batch.update(orderDoc.ref, { status: 'ملغي' });
                    await batch.commit();

                    await sendTelegramReply(chatId, `🛑 تم إلغاء الطلب: ${orderId}\n📦 تم إرجاع جميع الكميات إلى المخزون بنجاح.`, BOT_TOKEN);
                }
            } catch (error) {
                await sendTelegramReply(chatId, `⚠️ حدث خطأ في النظام: ${error.message}`, BOT_TOKEN);
            }
        }
    }

    // إرجاع 200 دائماً ليصمت تيليجرام ولا يكرر الإرسال
    return res.status(200).send('OK');
}

// دالة مساعدة لإرسال رد الآلة إليكِ في تيليجرام
async function sendTelegramReply(chatId, text, token) {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: text })
    });
}
