// Vercel serverless: chuyển dữ liệu form sang Google Apps Script (ghi vào Google Sheet)
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ ok: false });
  const url = process.env.GOOGLE_SCRIPT_URL;
  if (!url) return res.status(503).json({ ok: false, error: 'GOOGLE_SCRIPT_URL chưa được cấu hình' });
  const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  if (b.website) return res.status(200).json({ ok: true }); // honeypot chống spam
  const clean = (v, n) => String(v || '').slice(0, n);
  const payload = { name: clean(b.name, 120), phone: clean(b.phone, 20), email: clean(b.email, 120), interest: clean(b.interest, 120), message: clean(b.message, 2000) };
  if (!payload.name || !payload.phone) return res.status(400).json({ ok: false });
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), redirect: 'follow' });
    if (!r.ok) throw new Error('upstream ' + r.status);
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(502).json({ ok: false });
  }
};
