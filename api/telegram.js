// api/telegram.js
export default async function handler(req, res) {
    // استقبال الطلبات من نوع POST فقط لحماية السيرفر
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { chat_id, text } = req.body;
    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN; // هنا يتم جلب المفتاح السري بأمان من بيئة Vercel

    try {
        const telegramResponse = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(req.body)
        });
        
        const data = await telegramResponse.json();
        return res.status(200).json(data);
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}
