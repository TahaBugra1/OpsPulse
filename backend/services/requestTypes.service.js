const pool = require('./db');

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  throw err;
}

const REQUEST_TYPE_NAME_MAX_LENGTH = 150;

// Moved verbatim from requests.service.js — same query, same behavior, same
// signature. request_types is its own table with its own service, mirroring
// departments.service.js; requests.service.js should only own writes to the
// requests table itself (CLAUDE.md's centralization rule).
async function listRequestTypes() {
  let result;
  try {
    result = await pool.query(
      'SELECT id, name, department_id FROM request_types WHERE is_active = true ORDER BY name ASC'
    );
  } catch (dbErr) {
    fail(500, 'Talep türleri getirilemedi, lütfen tekrar deneyin');
  }
  return result.rows;
}

async function listAllRequestTypes(user) {
  if (user.role !== 'ADMIN') {
    fail(403, 'Bu işlem için yetkiniz yok');
  }
  let result;
  try {
    result = await pool.query(
      'SELECT id, name, department_id, is_active FROM request_types ORDER BY name ASC'
    );
  } catch (dbErr) {
    fail(500, 'Talep türleri getirilemedi, lütfen tekrar deneyin');
  }
  return result.rows;
}

async function createRequestType(body, user) {
  if (user.role !== 'ADMIN') {
    fail(403, 'Bu işlem için yetkiniz yok');
  }
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > REQUEST_TYPE_NAME_MAX_LENGTH) {
    fail(400, 'Talep türü adı zorunlu ve en fazla 150 karakter olabilir');
  }
  if (!body.department_id) {
    fail(400, 'Departman seçilmeli');
  }

  let existingName, dept;
  try {
    existingName = await pool.query('SELECT id FROM request_types WHERE name = $1', [name]);
    dept = await pool.query('SELECT id FROM departments WHERE id = $1', [body.department_id]);
  } catch (dbErr) {
    fail(500, 'Talep türü oluşturulamadı, lütfen tekrar deneyin');
  }
  if (existingName.rows.length > 0) {
    fail(409, 'Bu isim zaten kullanılıyor');
  }
  if (dept.rows.length === 0) {
    fail(400, 'Geçersiz departman');
  }

  let result;
  try {
    result = await pool.query(
      'INSERT INTO request_types (name, department_id) VALUES ($1, $2) RETURNING id, name, department_id, is_active',
      [name, body.department_id]
    );
  } catch (dbErr) {
    fail(500, 'Talep türü oluşturulamadı, lütfen tekrar deneyin');
  }
  return result.rows[0];
}

async function updateRequestType(id, body, user) {
  if (user.role !== 'ADMIN') {
    fail(403, 'Bu işlem için yetkiniz yok');
  }
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > REQUEST_TYPE_NAME_MAX_LENGTH) {
    fail(400, 'Talep türü adı zorunlu ve en fazla 150 karakter olabilir');
  }
  if (!body.department_id) {
    fail(400, 'Departman seçilmeli');
  }

  let existingName, dept;
  try {
    existingName = await pool.query('SELECT id FROM request_types WHERE name = $1 AND id != $2', [name, id]);
    dept = await pool.query('SELECT id FROM departments WHERE id = $1', [body.department_id]);
  } catch (dbErr) {
    fail(500, 'Talep türü güncellenemedi, lütfen tekrar deneyin');
  }
  if (existingName.rows.length > 0) {
    fail(409, 'Bu isim zaten kullanılıyor');
  }
  if (dept.rows.length === 0) {
    fail(400, 'Geçersiz departman');
  }

  let result;
  try {
    result = await pool.query(
      'UPDATE request_types SET name = $1, department_id = $2 WHERE id = $3 RETURNING id, name, department_id, is_active',
      [name, body.department_id, id]
    );
  } catch (dbErr) {
    fail(500, 'Talep türü güncellenemedi, lütfen tekrar deneyin');
  }
  if (result.rowCount === 0) {
    fail(404, 'Talep türü bulunamadı');
  }
  return result.rows[0];
}

async function deactivateRequestType(id, user) {
  if (user.role !== 'ADMIN') {
    fail(403, 'Bu işlem için yetkiniz yok');
  }
  let result;
  try {
    result = await pool.query(
      'UPDATE request_types SET is_active = false WHERE id = $1 RETURNING id, name, department_id, is_active',
      [id]
    );
  } catch (dbErr) {
    fail(500, 'Talep türü pasife alınamadı, lütfen tekrar deneyin');
  }
  if (result.rowCount === 0) {
    fail(404, 'Talep türü bulunamadı');
  }
  return result.rows[0];
}

async function activateRequestType(id, user) {
  if (user.role !== 'ADMIN') {
    fail(403, 'Bu işlem için yetkiniz yok');
  }
  let result;
  try {
    result = await pool.query(
      'UPDATE request_types SET is_active = true WHERE id = $1 RETURNING id, name, department_id, is_active',
      [id]
    );
  } catch (dbErr) {
    fail(500, 'Talep türü aktifleştirilemedi, lütfen tekrar deneyin');
  }
  if (result.rowCount === 0) {
    fail(404, 'Talep türü bulunamadı');
  }
  return result.rows[0];
}

module.exports = {
  listRequestTypes,
  listAllRequestTypes,
  createRequestType,
  updateRequestType,
  deactivateRequestType,
  activateRequestType,
};
