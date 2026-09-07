const bcrypt = require('bcrypt');
const pool = require('./db');
const { normalizeName, normalizeSurname } = require('./validation');

const PROFILE_SELECT = `SELECT u.id, u.name, u.surname, u.email, u.role, u.department_id, d.name AS department_name
   FROM users u
   LEFT JOIN departments d ON d.id = u.department_id
   WHERE u.id = $1`;

const PROFILE_UPDATE = `WITH updated AS (
    UPDATE users SET name = $1, surname = $2 WHERE id = $3
    RETURNING id, name, surname, email, role, department_id
  )
  SELECT u.id, u.name, u.surname, u.email, u.role, u.department_id, d.name AS department_name
  FROM updated u
  LEFT JOIN departments d ON d.id = u.department_id`;

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  throw err;
}

function toProfile(row) {
  return {
    id: row.id,
    name: row.name,
    surname: row.surname,
    email: row.email,
    role: row.role,
    department_id: row.department_id,
    department_name: row.department_name,
  };
}

async function getMyProfile(user) {
  let result;
  try {
    result = await pool.query(PROFILE_SELECT, [user.id]);
  } catch (dbErr) {
    fail(500, 'Profil getirilemedi, lütfen tekrar deneyin');
  }

  const row = result.rows[0];
  if (!row) {
    fail(404, 'Kullanıcı bulunamadı');
  }

  return toProfile(row);
}

async function updateMyProfile(body, user) {
  const normalizedName = normalizeName(body.name);
  if (!normalizedName.ok) {
    fail(400, 'Ad zorunlu ve en fazla 150 karakter olabilir');
  }

  const normalizedSurname = normalizeSurname(body.surname);
  if (!normalizedSurname.ok) {
    fail(400, normalizedSurname.reason === 'invalid_type'
      ? 'Soyad geçersiz'
      : 'Soyad en fazla 150 karakter olabilir');
  }

  let result;
  try {
    result = await pool.query(PROFILE_UPDATE, [
      normalizedName.value,
      normalizedSurname.value,
      user.id,
    ]);
  } catch (dbErr) {
    fail(500, 'Profil güncellenemedi, lütfen tekrar deneyin');
  }

  return toProfile(result.rows[0]);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const USER_LIST_SELECT = `SELECT u.id, u.name, u.surname, u.email, u.role, u.department_id,
    d.name AS department_name, u.is_active, u.created_at
  FROM users u
  LEFT JOIN departments d ON d.id = u.department_id
  ORDER BY u.created_at DESC`;

async function listUsers(user) {
  if (user.role !== 'ADMIN') {
    fail(403, 'Bu işlem için yetkiniz yok');
  }
  let result;
  try {
    result = await pool.query(USER_LIST_SELECT);
  } catch (dbErr) {
    fail(500, 'Kullanıcılar getirilemedi, lütfen tekrar deneyin');
  }
  return result.rows;
}

async function createDepartmentAuthority(body, user) {
  if (user.role !== 'ADMIN') {
    fail(403, 'Bu işlem için yetkiniz yok');
  }

  const email = body.email;
  if (!EMAIL_RE.test(email || '')) {
    fail(400, 'Geçersiz email formatı');
  }
  const domain = (email.split('@')[1] || '').toLowerCase();
  if (domain !== (process.env.ALLOWED_EMAIL_DOMAIN || '').toLowerCase()) {
    fail(400, 'Bu email domaini ile kullanıcı oluşturulamaz');
  }

  const normalizedName = normalizeName(body.name);
  if (!normalizedName.ok) {
    fail(400, 'Ad zorunlu ve en fazla 150 karakter olabilir');
  }
  const normalizedSurname = normalizeSurname(body.surname);
  if (!normalizedSurname.ok) {
    fail(400, normalizedSurname.reason === 'invalid_type' ? 'Soyad geçersiz' : 'Soyad en fazla 150 karakter olabilir');
  }

  if (!body.password || body.password.length < 8) {
    fail(400, 'Şifre en az 8 karakter olmalı');
  }

  if (!body.department_id) {
    fail(400, 'Departman seçilmeli');
  }

  let existingEmail, dept;
  try {
    existingEmail = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    dept = await pool.query('SELECT id FROM departments WHERE id = $1 AND is_active = true', [body.department_id]);
  } catch (dbErr) {
    fail(500, 'Kullanıcı oluşturulamadı, lütfen tekrar deneyin');
  }
  if (existingEmail.rows.length > 0) {
    fail(409, 'Bu email zaten kayıtlı');
  }
  if (dept.rows.length === 0) {
    fail(400, 'Geçersiz departman');
  }

  const passwordHash = await bcrypt.hash(body.password, 10);

  let result;
  try {
    result = await pool.query(
      `INSERT INTO users (name, surname, email, password_hash, role, department_id)
       VALUES ($1, $2, $3, $4, 'DEPARTMENT_AUTHORITY', $5)
       RETURNING id, name, surname, email, role, department_id`,
      [normalizedName.value, normalizedSurname.value, email, passwordHash, body.department_id]
    );
  } catch (dbErr) {
    fail(500, 'Kullanıcı oluşturulamadı, lütfen tekrar deneyin');
  }

  return result.rows[0];
}

async function deactivateUser(targetId, user) {
  if (user.role !== 'ADMIN') {
    fail(403, 'Bu işlem için yetkiniz yok');
  }
  if (targetId === user.id) {
    fail(400, 'Kendi hesabınızı pasife alamazsınız');
  }

  let result;
  try {
    result = await pool.query(
      'UPDATE users SET is_active = false WHERE id = $1 RETURNING id, is_active',
      [targetId]
    );
  } catch (dbErr) {
    fail(500, 'Kullanıcı pasife alınamadı, lütfen tekrar deneyin');
  }
  if (result.rowCount === 0) {
    fail(404, 'Kullanıcı bulunamadı');
  }
  return result.rows[0];
}

module.exports = { getMyProfile, updateMyProfile, listUsers, createDepartmentAuthority, deactivateUser };
