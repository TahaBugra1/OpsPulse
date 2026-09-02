const jwt = require('jsonwebtoken');
const pool = require('../services/db');
const { setIo } = require('./emitter');
const { getRequestById } = require('../services/requests.service');

function attachSockets(io) {
  setIo(io);

  io.use(async (socket, next) => {
    const token = socket.handshake.auth && socket.handshake.auth.token;
    if (!token) {
      return next(new Error('Yetkilendirme eksik'));
    }

    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      return next(new Error('Geçersiz veya süresi dolmuş token'));
    }

    let result;
    try {
      result = await pool.query('SELECT id, role, department_id, is_active FROM users WHERE id = $1', [payload.sub]);
    } catch (dbErr) {
      return next(new Error('Bir hata oluştu'));
    }
    const row = result.rows[0];

    if (!row || !row.is_active) {
      return next(new Error('Hesap aktif değil'));
    }

    socket.user = { id: row.id, role: row.role, department_id: row.department_id };
    next();
  });

  io.on('connection', (socket) => {
    socket.join(`user:${socket.user.id}`);
    if (socket.user.role === 'DEPARTMENT_AUTHORITY') {
      socket.join(`department-queue:${socket.user.department_id}`);
    }

    socket.on('join:request', async (requestId) => {
      try {
        await getRequestById(requestId, socket.user);
        socket.join(`request:${requestId}`);
      } catch (err) {
        socket.emit('error', { message: err.message });
      }
    });
  });
}

module.exports = attachSockets;
