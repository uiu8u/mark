// api/telegram.js
// ⚠️ ملف CommonJS بالكامل عمداً (require + module.exports) — لا تخلطيه أبداً بصيغة
// "import / export default"، فهذا المزيج هو ما كان يُسقط الدالة بالكامل (راجعي تقرير الفحص).

const admin = require('firebase-admin');

// ── 1. تهيئة Admin SDK (مرة واحدة فقط، يُعاد استخدامها بين الاستدعاءات الباردة/الدافئة) ──
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    }),
  });
}

const db = admin.firestore();

// ── 2. متغيرات أمان إجبارية ──────────────────────────────────────────────
// TELEGRAM_CHAT_ID: رقم محادثتك أنتِ فقط (الأدمن). أي أمر يصل من رقم آخر يُتجاهل.
// TELEGRAM_WEBHOOK_SECRET: سلسلة عشوائية تضعينها بنفسك (مثال: openssl rand -hex 24)
//   ثم تُسجَّل مع تيليجرام عبر setWebhook?...&secret_token=... (انظري ملاحظات الإعداد أسفل الملف).
const ADMIN_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

  // ════════════════════════════════════════════════════════════════════
  // أ. مسار الإرسال: من المتجر (الواجهة الأمامية) إلى تيليجرام
  //    لا حاجة للتحقق من secret_token هنا لأن الطلب صادر من خادمنا نفسه
  //    (المتصفح يستدعي /api/telegram على نفس النطاق، وليس تيليجرام).
  // ════════════════════════════════════════════════════════════════════
  if (req.body && req.body.chat_id && !req.body.update_id) {
    try {
      const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body),
      });
      const data = await response.json();
      return res.status(200).json(data);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // ب. مسار الـ Webhook: من تيليجرام إلى المتجر
  //    🔒 طبقة حماية 1: التحقق من secret_token (يثبت أن الطلب من تيليجرام فعلاً
  //    وليس شخصاً يحاكي POST مباشرة لنفس الـ endpoint من متصفحه)
  // ════════════════════════════════════════════════════════════════════
  const incomingSecret = req.headers['x-telegram-bot-api-secret-token'];
  console.log("كلمة السر في Vercel هي:", WEBHOOK_SECRET);
console.log("كلمة السر القادمة من تيليجرام هي:", incomingSecret);
  if (WEBHOOK_SECRET && incomingSecret !== WEBHOOK_SECRET) {
    console.warn('⚠️ Webhook secret mismatch — تم رفض الطلب');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.body && req.body.message && req.body.message.text) {
    const text = req.body.message.text.trim();
    const chatId = req.body.message.chat.id;

    // 🔒 طبقة حماية 2: التحقق أن المُرسل هو الأدمن فقط (دفاع متعدد الطبقات).
    // أي شخص آخر يكتب "تأكيد #..." أو "إلغاء #..." يُتجاهل تماماً وبصمت.
    if (ADMIN_CHAT_ID && String(chatId) !== String(ADMIN_CHAT_ID)) {
      console.warn(`⚠️ أمر من رقم غير مصرّح: ${chatId}`);
      return res.status(200).send('OK'); // 200 صامت حتى لا يُعيد تيليجرام المحاولة
    }

    if (text.startsWith('تأكيد') || text.startsWith('إلغاء')) {
      const parts = text.split(' ');
      const action = parts[0];
      const orderId = parts[1]?.replace('#', '').trim();

      if (!orderId) return res.status(200).send('OK');

      try {
        const snapshot = await db.collection('orders').where('orderId', '==', orderId).get();

        if (snapshot.empty) {
          await sendTelegramReply(chatId, `❌ لم أتمكن من العثور على الطلب: ${orderId}`, BOT_TOKEN);
          return res.status(200).send('OK');
        }

        const orderDoc = snapshot.docs[0];
        const orderData = orderDoc.data();

        // منع تنفيذ نفس الأمر مرتين على طلب أُغلق مسبقاً (تأكيد/إلغاء متكرر)
        if (orderData.status === 'تم التأكيد' && action === 'تأكيد') {
          await sendTelegramReply(chatId, `ℹ️ الطلب ${orderId} مؤكَّد بالفعل.`, BOT_TOKEN);
          return res.status(200).send('OK');
        }
        if (orderData.status === 'ملغي') {
          await sendTelegramReply(chatId, `ℹ️ الطلب ${orderId} مُلغى بالفعل — لا يمكن تكرار الإلغاء (لتفادي إرجاع المخزون مرتين).`, BOT_TOKEN);
          return res.status(200).send('OK');
        }

        if (action === 'تأكيد') {
          await orderDoc.ref.update({ status: 'تم التأكيد' });
          await sendTelegramReply(chatId, `✅ تم تأكيد الطلب: ${orderId}`, BOT_TOKEN);

        } else if (action === 'إلغاء') {
          const batch = db.batch();
          const items = orderData.items || [];

          for (const item of items) {
            // ✅ نفضّل البحث بمعرّف المنتج (id) المباشر — أسرع وأدق ولا يتأثر
            // بتغيير اسم المنتج لاحقاً. نسقط على البحث بالاسم فقط للطلبات
            // القديمة التي حُفظت قبل إضافة حقل id (توافق رجعي).
            if (item.id) {
              const productRef = db.collection('products').doc(item.id);
              batch.update(productRef, {
                quantity: admin.firestore.FieldValue.increment(item.qty),
              });
            } else if (item.name) {
              const productQuery = await db.collection('products').where('name', '==', item.name).get();
              if (!productQuery.empty) {
                batch.update(productQuery.docs[0].ref, {
                  quantity: admin.firestore.FieldValue.increment(item.qty),
                });
              }
            }
          }

          batch.update(orderDoc.ref, { status: 'ملغي' });
          await batch.commit();

          await sendTelegramReply(chatId, `🛑 تم إلغاء الطلب: ${orderId}\n📦 تم إرجاع الكميات إلى المخزون.`, BOT_TOKEN);
        }
      } catch (error) {
        console.error('Webhook processing error:', error);
        await sendTelegramReply(chatId, `⚠️ حدث خطأ في النظام: ${error.message}`, BOT_TOKEN);
      }
    }
  }

  return res.status(200).send('OK');
};

async function sendTelegramReply(chatId, text, token) {
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

// ════════════════════════════════════════════════════════════════════════
// 📌 خطوة إعداد إجبارية (مرة واحدة فقط) لتفعيل secret_token:
// نفّذي هذا الطلب مرة واحدة من المتصفح أو Postman بعد نشر المشروع على Vercel:
//
// https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://YOUR-DOMAIN/api/telegram&secret_token=YOUR_SECRET
//
// ثم ضيفي نفس YOUR_SECRET كمتغير بيئة باسم TELEGRAM_WEBHOOK_SECRET في Vercel.
// ════════════════════════════════════════════════════════════════════════
