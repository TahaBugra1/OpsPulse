const jwt = require('jsonwebtoken');
const pool = require('../services/db');

async function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ status: 'error', message: 'Yetkilendirme başlığı eksik' });
  }

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ status: 'error', message: 'Geçersiz veya süresi dolmuş token' });
  }

  let result;
  try {
    result = await pool.query('SELECT id, role, department_id, is_active FROM users WHERE id = $1', [payload.sub]);
  } catch (dbErr) {
    return res.status(500).json({ status: 'error', message: 'Bir hata oluştu' });
  }
  const row = result.rows[0];

  if (!row || !row.is_active) {
    return res.status(403).json({ status: 'error', message: 'Hesap aktif değil' });
  }

  req.user = { id: row.id, role: row.role, department_id: row.department_id };
  next();
}

module.exports = authMiddleware;
