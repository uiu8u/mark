const admin = require('firebase-admin');

// 1. تهيئة جدار الإدارة (Admin SDK)
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

module.exports = async function handler(req, res) {
  // 🔒 طبقة حماية: للتأكد من أن نظام Vercel المجدول هو فقط من يستدعي هذا الرابط
  // (تمنع أي شخص خارجي من استدعاء الرابط وحذف البيانات يدوياً)
  const cronHeader = req.headers['x-vercel-cron'];
  if (process.env.NODE_ENV === 'production' && !cronHeader) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // حساب تاريخ قبل 30 يوماً من الآن
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // 🔍 البحث عن الطلبات القديمة
    // ⚠️ تنبيه هندسي: تأكدي أن اسم حقل التاريخ في مستند الطلب لديكِ هو 'timestamp' أو غيريه للاسم الفعلي (مثل createdAt)
    const snapshot = await db.collection('orders')
      .where('timestamp', '<', thirtyDaysAgo)
      .get();

    if (snapshot.empty) {
      return res.status(200).json({ message: 'لا توجد طلبات قديمة لحذفها حالياً.' });
    }

    // 🤝 حذف جماعي (Batch Delete) لتوفير العمليات وسرعة الأداء
    const batch = db.batch();
    snapshot.docs.forEach((doc) => {
      batch.delete(doc.ref);
    });

    await batch.commit();

    console.log(`[Cleanup] تم حذف ${snapshot.size} طلبات قديمة بنجاح.`);
    return res.status(200).json({ message: `تم حذف ${snapshot.size} طلبات مر عليها أكثر من 30 يوماً.` });

  } catch (error) {
    console.error('خطأ أثناء تنظيف البيانات:', error);
    return res.status(500).json({ error: error.message });
  }
};
