const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('./db');
const { verifyGoogleToken } = require('./googleAuth');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  throw err;
}

function toPublicUser(row) {
  return {
    id: row.id,
    name: row.name,
    surname: row.surname,
    email: row.email,
    role: row.role,
    department_id: row.department_id,
  };
}

function signToken(user, expiresIn) {
  return jwt.sign(
    { sub: user.id, role: user.role, department_id: user.department_id },
    process.env.JWT_SECRET,
    { expiresIn }
  );
}

function emailDomain(email) {
  return email.slice(email.indexOf('@') + 1).toLowerCase();
}

async function register({ name, surname, email, password }) {
  if (!EMAIL_RE.test(email || '')) {
    fail(400, 'Geçersiz email formatı');
  }

  if (emailDomain(email) !== (process.env.ALLOWED_EMAIL_DOMAIN || '').toLowerCase()) {
    fail(400, 'Bu email domaini ile kayıt olunamaz');
  }

  let existing;
  try {
    existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  } catch (dbErr) {
    fail(500, 'Kayıt oluşturulamadı, lütfen tekrar deneyin');
  }
  if (existing.rows.length > 0) {
    fail(409, 'Bu email zaten kayıtlı');
  }

  if (!password || password.length < 8) {
    fail(400, 'Şifre en az 8 karakter olmalı');
  }

  const passwordHash = await bcrypt.hash(password, 10);

  let result;
  try {
    result = await pool.query(
      `INSERT INTO users (name, surname, email, password_hash, role)
       VALUES ($1, $2, $3, $4, 'EMPLOYEE')
       RETURNING id, name, surname, email, role, department_id`,
      [name, surname || null, email, passwordHash]
    );
  } catch (dbErr) {
    if (dbErr.code === '23505') {
      fail(409, 'Bu email zaten kayıtlı');
    }
    fail(500, 'Kayıt oluşturulamadı, lütfen tekrar deneyin');
  }

  const user = toPublicUser(result.rows[0]);
  const token = signToken(user, '1h');
  return { token, user };
}

async function login({ email, password, rememberMe }) {
  let result;
  try {
    result = await pool.query(
      'SELECT id, name, surname, email, password_hash, role, department_id, is_active FROM users WHERE email = $1',
      [email]
    );
  } catch (dbErr) {
    fail(500, 'Giriş yapılamadı, lütfen tekrar deneyin');
  }
  const row = result.rows[0];

  if (!row || !row.password_hash) {
    fail(401, 'Email veya şifre hatalı');
  }

  const match = await bcrypt.compare(password || '', row.password_hash);
  if (!match) {
    fail(401, 'Email veya şifre hatalı');
  }

  if (!row.is_active) {
    fail(403, 'Hesap aktif değil');
  }

  const user = toPublicUser(row);
  const token = signToken(user, rememberMe === true ? '7d' : '1h');
  return { token, user };
}

async function loginWithGoogle({ id_token, rememberMe }, verifyFn = verifyGoogleToken) {
  let claims;
  try {
    claims = await verifyFn(id_token);
  } catch (verifyErr) {
    fail(401, 'Geçersiz Google kimlik doğrulaması');
  }

  let result;
  try {
    result = await pool.query(
      'SELECT id, name, surname, email, role, department_id, is_active FROM users WHERE email = $1',
      [claims.email]
    );
  } catch (dbErr) {
    fail(500, 'Giriş yapılamadı, lütfen tekrar deneyin');
  }
  const row = result.rows[0];

  let user;
  if (!row) {
    if (emailDomain(claims.email) !== (process.env.ALLOWED_EMAIL_DOMAIN || '').toLowerCase()) {
      fail(400, 'Bu email domaini ile kayıt olunamaz');
    }

    let insertResult;
    try {
      insertResult = await pool.query(
        `INSERT INTO users (name, surname, email, google_id, role)
         VALUES ($1, $2, $3, $4, 'EMPLOYEE')
         RETURNING id, name, surname, email, role, department_id`,
        [claims.given_name, claims.family_name || null, claims.email, claims.sub]
      );
    } catch (dbErr) {
      if (dbErr.code === '23505') {
        fail(409, 'Bu email zaten kayıtlı');
      }
      fail(500, 'Giriş yapılamadı, lütfen tekrar deneyin');
    }
    user = toPublicUser(insertResult.rows[0]);
  } else {
    if (!row.is_active) {
      fail(403, 'Hesap aktif değil');
    }

    try {
      await pool.query('UPDATE users SET google_id = $1 WHERE id = $2', [claims.sub, row.id]);
    } catch (dbErr) {
      fail(500, 'Giriş yapılamadı, lütfen tekrar deneyin');
    }
    user = toPublicUser(row);
  }

  const token = signToken(user, rememberMe === true ? '7d' : '1h');
  return { token, user };
}

module.exports = { register, login, loginWithGoogle };
