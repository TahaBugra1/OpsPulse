const pool = require('./db');

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  throw err;
}

const DEPARTMENT_NAME_MAX_LENGTH = 100;

async function listDepartments(user) {
  if (user.role !== 'ADMIN') {
    fail(403, 'Bu işlem için yetkiniz yok');
  }
  let result;
  try {
    result = await pool.query('SELECT id, name, is_active FROM departments ORDER BY name ASC');
  } catch (dbErr) {
    fail(500, 'Departmanlar getirilemedi, lütfen tekrar deneyin');
  }
  return result.rows;
}

// Unauthenticated counterpart of listDepartments: the public register form
// needs the department list before any account or token exists.
async function listActiveDepartments() {
  let result;
  try {
    result = await pool.query('SELECT id, name FROM departments WHERE is_active = true ORDER BY name ASC');
  } catch (dbErr) {
    fail(500, 'Departmanlar getirilemedi, lütfen tekrar deneyin');
  }
  return result.rows;
}

async function createDepartment(body, user) {
  if (user.role !== 'ADMIN') {
    fail(403, 'Bu işlem için yetkiniz yok');
  }
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > DEPARTMENT_NAME_MAX_LENGTH) {
    fail(400, 'Departman adı zorunlu ve en fazla 100 karakter olabilir');
  }

  let existing;
  try {
    existing = await pool.query('SELECT id FROM departments WHERE name = $1', [name]);
  } catch (dbErr) {
    fail(500, 'Departman oluşturulamadı, lütfen tekrar deneyin');
  }
  if (existing.rows.length > 0) {
    fail(409, 'Bu isim zaten kullanılıyor');
  }

  let result;
  try {
    result = await pool.query(
      'INSERT INTO departments (name) VALUES ($1) RETURNING id, name, is_active',
      [name]
    );
  } catch (dbErr) {
    fail(500, 'Departman oluşturulamadı, lütfen tekrar deneyin');
  }
  return result.rows[0];
}

async function updateDepartment(id, body, user) {
  if (user.role !== 'ADMIN') {
    fail(403, 'Bu işlem için yetkiniz yok');
  }
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > DEPARTMENT_NAME_MAX_LENGTH) {
    fail(400, 'Departman adı zorunlu ve en fazla 100 karakter olabilir');
  }

  let existing;
  try {
    existing = await pool.query('SELECT id FROM departments WHERE name = $1 AND id != $2', [name, id]);
  } catch (dbErr) {
    fail(500, 'Departman güncellenemedi, lütfen tekrar deneyin');
  }
  if (existing.rows.length > 0) {
    fail(409, 'Bu isim zaten kullanılıyor');
  }

  let result;
  try {
    result = await pool.query(
      'UPDATE departments SET name = $1 WHERE id = $2 RETURNING id, name, is_active',
      [name, id]
    );
  } catch (dbErr) {
    fail(500, 'Departman güncellenemedi, lütfen tekrar deneyin');
  }
  if (result.rowCount === 0) {
    fail(404, 'Departman bulunamadı');
  }
  return result.rows[0];
}

// Cascades to every request_type under this department in ONE transaction —
// a department cannot end up inactive while its own request types stay
// active (or vice versa mid-failure). Mirrors requests.service.js's
// withTransaction shape (BEGIN -> work -> COMMIT, ROLLBACK + rethrow on any
// error), inlined here since this is departments.service.js's only
// multi-statement write.
async function deactivateDepartment(id, user) {
  if (user.role !== 'ADMIN') {
    fail(403, 'Bu işlem için yetkiniz yok');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const deptResult = await client.query(
      'UPDATE departments SET is_active = false WHERE id = $1 RETURNING id, name, is_active',
      [id]
    );
    if (deptResult.rowCount === 0) {
      fail(404, 'Departman bulunamadı');
    }

    await client.query('UPDATE request_types SET is_active = false WHERE department_id = $1', [id]);

    await client.query('COMMIT');
    return deptResult.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.status) throw err;
    fail(500, 'Departman pasife alınamadı, lütfen tekrar deneyin');
  } finally {
    client.release();
  }
}

// Deliberately NOT cascading: activating a department does not auto-activate
// its request types (an explicit product decision, see atdd.md Assumptions —
// asymmetric with deactivate, which does cascade). Each request type must be
// activated individually.
async function activateDepartment(id, user) {
  if (user.role !== 'ADMIN') {
    fail(403, 'Bu işlem için yetkiniz yok');
  }
  let result;
  try {
    result = await pool.query(
      'UPDATE departments SET is_active = true WHERE id = $1 RETURNING id, name, is_active',
      [id]
    );
  } catch (dbErr) {
    fail(500, 'Departman aktifleştirilemedi, lütfen tekrar deneyin');
  }
  if (result.rowCount === 0) {
    fail(404, 'Departman bulunamadı');
  }
  return result.rows[0];
}

module.exports = {
  listDepartments,
  listActiveDepartments,
  createDepartment,
  updateDepartment,
  deactivateDepartment,
  activateDepartment,
};
