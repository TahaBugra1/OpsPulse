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

module.exports = { getMyProfile, updateMyProfile };
