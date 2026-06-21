const admin = require('firebase-admin');

// 1. تهيئة جدار الإدارة
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
  // 🔒 تحديث الحماية: استخدام معيار Vercel الجديد (CRON_SECRET)
  const authHeader = req.headers['authorization'];
  
  // التحقق من أن الطلب قادم فعلياً من نظام Vercel المجدول
  if (
      authHeader !== `Bearer ${process.env.CRON_SECRET}` && 
      !req.headers['x-vercel-cron']
  ) {
      console.warn('⚠️ محاولة وصول غير مصرح بها لملف التنظيف');
      return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // حساب تاريخ قبل 30 يوماً من الآن
    const now = new Date();

    const snapshot = await db.collection('orders')
    .where('expireAt', '<', now)
    .get();

    if (snapshot.empty) {
      return res.status(200).json({ message: 'لا توجد طلبات قديمة لحذفها حالياً.' });
    }

    // 🤝 حذف جماعي (Batch Delete)
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
