const crypto = require('crypto');
const bcrypt = require('bcrypt');
const pool = require('./db');
const { normalizeName, normalizeSurname } = require('./validation');

const PROFILE_SELECT = `SELECT u.id, u.name, u.surname, u.email, u.role, u.department_id, d.name AS department_name,
     (u.password_hash IS NOT NULL) AS has_password
   FROM users u
   LEFT JOIN departments d ON d.id = u.department_id
   WHERE u.id = $1`;

const PROFILE_UPDATE = `WITH updated AS (
    UPDATE users SET name = $1, surname = $2 WHERE id = $3
    RETURNING id, name, surname, email, role, department_id, (password_hash IS NOT NULL) AS has_password
  )
  SELECT u.id, u.name, u.surname, u.email, u.role, u.department_id, d.name AS department_name, u.has_password
  FROM updated u
  LEFT JOIN departments d ON d.id = u.department_id`;

const PROFILE_DEPARTMENT_UPDATE = `WITH updated AS (
    UPDATE users SET department_id = $1 WHERE id = $2
    RETURNING id, name, surname, email, role, department_id, (password_hash IS NOT NULL) AS has_password
  )
  SELECT u.id, u.name, u.surname, u.email, u.role, u.department_id, d.name AS department_name, u.has_password
  FROM updated u
  LEFT JOIN departments d ON d.id = u.department_id`;

// Excludes look-alike characters (0 O 1 l I).
const TEMP_PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  throw err;
}

function generateTemporaryPassword() {
  let password = '';
  for (let i = 0; i < 12; i++) {
    password += TEMP_PASSWORD_ALPHABET[crypto.randomInt(TEMP_PASSWORD_ALPHABET.length)];
  }
  return password;
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
    has_password: row.has_password,
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

// Google-created accounts start with a NULL department; this is the one path
// that fills it in, always scoped to the authenticated user's own id.
// EMPLOYEE-only: for DEPARTMENT_AUTHORITY, department_id is a functional
// authorization scope, not self-service metadata — it's set only via the
// Admin-only user-management screen.
async function completeDepartment(body, user) {
  if (user.role !== 'EMPLOYEE') {
    fail(403, 'Bu işlem için yetkiniz yok');
  }

  if (!body.department_id) {
    fail(400, 'Departman seçilmeli');
  }

  let dept;
  try {
    dept = await pool.query('SELECT id FROM departments WHERE id = $1 AND is_active = true', [body.department_id]);
  } catch (dbErr) {
    if (dbErr.code === '22P02') {
      fail(400, 'Geçersiz departman');
    }
    fail(500, 'Departman kaydedilemedi, lütfen tekrar deneyin');
  }
  if (dept.rows.length === 0) {
    fail(400, 'Geçersiz departman');
  }

  let result;
  try {
    result = await pool.query(PROFILE_DEPARTMENT_UPDATE, [body.department_id, user.id]);
  } catch (dbErr) {
    fail(500, 'Departman kaydedilemedi, lütfen tekrar deneyin');
  }

  return toProfile(result.rows[0]);
}

// Always scoped to the authenticated user's own id. Wrong current password is
// 400, never 401 — the frontend logs out on 401.
async function changeMyPassword(body, user) {
  if (typeof body.new_password !== 'string' || body.new_password.length < 8) {
    fail(400, 'Şifre en az 8 karakter olmalı');
  }

  let existing;
  try {
    existing = await pool.query('SELECT password_hash FROM users WHERE id = $1', [user.id]);
  } catch (dbErr) {
    fail(500, 'Şifre değiştirilemedi, lütfen tekrar deneyin');
  }
  const row = existing.rows[0];

  if (!row.password_hash) {
    fail(400, 'Bu hesap sadece Google ile giriş yapıyor, şifre değiştirilemez');
  }

  const match = await bcrypt.compare(
    typeof body.current_password === 'string' ? body.current_password : '',
    row.password_hash
  );
  if (!match) {
    fail(400, 'Mevcut şifre hatalı');
  }

  if (body.new_password === body.current_password) {
    fail(400, 'Yeni şifre mevcut şifreyle aynı olamaz');
  }

  const passwordHash = await bcrypt.hash(body.new_password, 10);

  // Compare-and-swap on the verified hash: an ADMIN reset landing between the
  // read above and this write must not be silently overwritten.
  let result;
  try {
    result = await pool.query(
      `UPDATE users SET password_hash = $1, must_change_password = false
       WHERE id = $2 AND password_hash = $3
       RETURNING id, name, surname, email, role, department_id, must_change_password`,
      [passwordHash, user.id, row.password_hash]
    );
  } catch (dbErr) {
    fail(500, 'Şifre değiştirilemedi, lütfen tekrar deneyin');
  }
  if (result.rowCount === 0) {
    fail(409, 'Şifre bu sırada değişti, lütfen tekrar deneyin');
  }

  return result.rows[0];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const USER_LIST_SELECT = `SELECT u.id, u.name, u.surname, u.email, u.role, u.department_id,
    d.name AS department_name, u.is_active, u.created_at, (u.password_hash IS NOT NULL) AS has_password
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

async function listMyTeam(user) {
  if (user.role !== 'DEPARTMENT_AUTHORITY') {
    fail(403, 'Bu işlem için yetkiniz yok');
  }
  let result;
  try {
    result = await pool.query(
      `SELECT id, name, surname, email, is_active FROM users WHERE role = 'EMPLOYEE' AND department_id = $1 ORDER BY name ASC`,
      [user.department_id]
    );
  } catch (dbErr) {
    fail(500, 'Ekip listesi getirilemedi, lütfen tekrar deneyin');
  }
  return result.rows;
}

// ADMIN creation stays seed-only. The password is always backend-generated;
// a client-supplied password is never read.
async function createUser(body, user) {
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

  if (body.role !== 'EMPLOYEE' && body.role !== 'DEPARTMENT_AUTHORITY') {
    fail(400, 'Geçersiz rol');
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

  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await bcrypt.hash(temporaryPassword, 10);

  let result;
  try {
    result = await pool.query(
      `INSERT INTO users (name, surname, email, password_hash, role, department_id, must_change_password)
       VALUES ($1, $2, $3, $4, $5, $6, true)
       RETURNING id, name, surname, email, role, department_id`,
      [normalizedName.value, normalizedSurname.value, email, passwordHash, body.role, body.department_id]
    );
  } catch (dbErr) {
    fail(500, 'Kullanıcı oluşturulamadı, lütfen tekrar deneyin');
  }

  return { ...result.rows[0], temporary_password: temporaryPassword };
}

async function resetUserPassword(targetId, user) {
  if (user.role !== 'ADMIN') {
    fail(403, 'Bu işlem için yetkiniz yok');
  }
  if (targetId === user.id) {
    fail(400, 'Kendi şifrenizi sıfırlayamazsınız');
  }

  let existing;
  try {
    existing = await pool.query('SELECT id, role, is_active, password_hash FROM users WHERE id = $1', [targetId]);
  } catch (dbErr) {
    if (dbErr.code === '22P02') {
      fail(404, 'Kullanıcı bulunamadı');
    }
    fail(500, 'Şifre sıfırlanamadı, lütfen tekrar deneyin');
  }
  const target = existing.rows[0];

  if (!target) {
    fail(404, 'Kullanıcı bulunamadı');
  }
  if (target.role === 'ADMIN') {
    fail(403, 'Bu işlem için yetkiniz yok');
  }
  if (!target.is_active) {
    fail(400, 'Pasif kullanıcının şifresi sıfırlanamaz');
  }
  if (!target.password_hash) {
    fail(400, 'Bu hesap sadece Google ile giriş yapıyor, şifre sıfırlanamaz');
  }

  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await bcrypt.hash(temporaryPassword, 10);

  try {
    await pool.query(
      'UPDATE users SET password_hash = $1, must_change_password = true WHERE id = $2',
      [passwordHash, targetId]
    );
  } catch (dbErr) {
    fail(500, 'Şifre sıfırlanamadı, lütfen tekrar deneyin');
  }

  return { temporary_password: temporaryPassword };
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

module.exports = {
  getMyProfile,
  updateMyProfile,
  completeDepartment,
  changeMyPassword,
  listUsers,
  listMyTeam,
  createUser,
  resetUserPassword,
  deactivateUser,
};
