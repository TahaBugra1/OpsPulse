const pool = require('./db');

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  throw err;
}

async function listDepartments(user) {
  if (user.role !== 'ADMIN') {
    fail(403, 'Bu işlem için yetkiniz yok');
  }
  let result;
  try {
    result = await pool.query('SELECT id, name FROM departments WHERE is_active = true ORDER BY name ASC');
  } catch (dbErr) {
    fail(500, 'Departmanlar getirilemedi, lütfen tekrar deneyin');
  }
  return result.rows;
}

module.exports = { listDepartments };
