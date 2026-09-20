const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const jwt = require('jsonwebtoken');

// Load dotenv the same way server.js does, so process.env.JWT_SECRET is
// populated even though this file never requires ../server (no HTTP route
// mounts this middleware - it is exercised directly, in isolation).
require('dotenv').config();

const authMiddleware = require('../middleware/auth.middleware');
const pool = require('../services/db');

function makeRes() {
  const res = {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

test.after(async () => {
  await pool.end();
});

// AC7(a): missing/malformed Authorization header -> 401, next() not called
test('authMiddleware - missing Authorization header returns 401 and does not call next', async () => {
  const req = { headers: {} };
  const res = makeRes();
  let nextCalled = false;

  await authMiddleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(res.statusCode, 401);
  assert.equal(nextCalled, false);
});

test('authMiddleware - malformed Authorization header (no Bearer scheme) returns 401 and does not call next', async () => {
  const req = { headers: { authorization: 'Token abc.def.ghi' } };
  const res = makeRes();
  let nextCalled = false;

  await authMiddleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(res.statusCode, 401);
  assert.equal(nextCalled, false);
});

// AC7(b): invalid/garbage JWT -> 401, next() not called
test('authMiddleware - invalid/garbage JWT returns 401 and does not call next', async () => {
  const req = { headers: { authorization: 'Bearer not-a-real-jwt' } };
  const res = makeRes();
  let nextCalled = false;

  await authMiddleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(res.statusCode, 401);
  assert.equal(nextCalled, false);
});

// AC7(c) and AC7(d) need a real user row in the DB.
test('authMiddleware - valid JWT but inactive user returns 403 and does not call next', async (t) => {
  const email = `mw-inactive-${randomUUID()}@opspulse-test.local`;
  const inserted = await pool.query(
    `INSERT INTO users (name, surname, email, password_hash, role, is_active)
     VALUES ($1, $2, $3, $4, 'EMPLOYEE', false)
     RETURNING id, role, department_id`,
    ['MW', 'Inactive', email, 'dummy-hash']
  );
  const user = inserted.rows[0];
  t.after(() => pool.query('DELETE FROM users WHERE id = $1', [user.id]));

  const token = jwt.sign(
    { sub: user.id, role: user.role, department_id: user.department_id },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );

  const req = { headers: { authorization: `Bearer ${token}` } };
  const res = makeRes();
  let nextCalled = false;

  await authMiddleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(res.statusCode, 403);
  assert.equal(nextCalled, false);
});

test('authMiddleware - valid JWT and active user calls next() with req.user populated', async (t) => {
  const email = `mw-active-${randomUUID()}@opspulse-test.local`;
  const inserted = await pool.query(
    `INSERT INTO users (name, surname, email, password_hash, role, is_active)
     VALUES ($1, $2, $3, $4, 'EMPLOYEE', true)
     RETURNING id, role, department_id`,
    ['MW', 'Active', email, 'dummy-hash']
  );
  const user = inserted.rows[0];
  t.after(() => pool.query('DELETE FROM users WHERE id = $1', [user.id]));

  const token = jwt.sign(
    { sub: user.id, role: user.role, department_id: user.department_id },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );

  const req = { headers: { authorization: `Bearer ${token}` } };
  const res = makeRes();
  let nextCalled = false;

  await authMiddleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, null);
  assert.deepEqual(req.user, {
    id: user.id,
    role: user.role,
    department_id: user.department_id,
  });
});

// ---------------------------------------------------------------------------
// must_change_password: while the flag is on, only the exact
// PATCH /api/users + /me/password route passes; everything else is a 403 with
// code PASSWORD_CHANGE_REQUIRED.
// ---------------------------------------------------------------------------

const PASSWORD_CHANGE_REQUIRED_BODY = {
  status: 'error',
  message: 'Devam etmek için şifrenizi değiştirmeniz gerekiyor',
  code: 'PASSWORD_CHANGE_REQUIRED',
};

async function insertUser(t, { mustChangePassword }) {
  const email = `mw-flag-${randomUUID()}@opspulse-test.local`;
  const inserted = await pool.query(
    `INSERT INTO users (name, surname, email, password_hash, role, is_active, must_change_password)
     VALUES ($1, $2, $3, $4, 'EMPLOYEE', true, $5)
     RETURNING id, role, department_id`,
    ['MW', 'Flag', email, 'dummy-hash', mustChangePassword]
  );
  const user = inserted.rows[0];
  t.after(() => pool.query('DELETE FROM users WHERE id = $1', [user.id]));
  const token = jwt.sign(
    { sub: user.id, role: user.role, department_id: user.department_id },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
  return { user, token };
}

test('authMiddleware - flagged user on a normal route returns 403 PASSWORD_CHANGE_REQUIRED and does not call next', async (t) => {
  const { token } = await insertUser(t, { mustChangePassword: true });

  const req = { headers: { authorization: `Bearer ${token}` }, method: 'GET', baseUrl: '/api/users', path: '/me' };
  const res = makeRes();
  let nextCalled = false;

  await authMiddleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, PASSWORD_CHANGE_REQUIRED_BODY);
  assert.equal(nextCalled, false);
  assert.equal(req.user, undefined);
});

test('authMiddleware - flagged user on exactly PATCH /api/users/me/password calls next with the unchanged req.user shape', async (t) => {
  const { user, token } = await insertUser(t, { mustChangePassword: true });

  const req = {
    headers: { authorization: `Bearer ${token}` },
    method: 'PATCH',
    baseUrl: '/api/users',
    path: '/me/password',
  };
  const res = makeRes();
  let nextCalls = 0;

  await authMiddleware(req, res, () => {
    nextCalls += 1;
  });

  assert.equal(nextCalls, 1);
  assert.equal(res.statusCode, null);
  assert.deepEqual(req.user, {
    id: user.id,
    role: user.role,
    department_id: user.department_id,
  });
});

test('authMiddleware - near-miss routes for a flagged user are all blocked (exact match, fails closed)', async (t) => {
  const { token } = await insertUser(t, { mustChangePassword: true });

  const nearMisses = [
    { label: 'POST instead of PATCH', method: 'POST', baseUrl: '/api/users', path: '/me/password' },
    { label: 'trailing slash', method: 'PATCH', baseUrl: '/api/users', path: '/me/password/' },
    { label: 'different baseUrl', method: 'PATCH', baseUrl: '/api/requests', path: '/me/password' },
    { label: 'path prefix match', method: 'PATCH', baseUrl: '/api/users', path: '/me/passwordx' },
  ];

  for (const { label, method, baseUrl, path } of nearMisses) {
    const req = { headers: { authorization: `Bearer ${token}` }, method, baseUrl, path };
    const res = makeRes();
    let nextCalled = false;

    // eslint-disable-next-line no-await-in-loop
    await authMiddleware(req, res, () => {
      nextCalled = true;
    });

    assert.equal(res.statusCode, 403, label);
    assert.deepEqual(res.body, PASSWORD_CHANGE_REQUIRED_BODY, label);
    assert.equal(nextCalled, false, label);
  }
});

test('authMiddleware - an unflagged user passes even when req carries no method/baseUrl/path', async (t) => {
  const { user, token } = await insertUser(t, { mustChangePassword: false });

  const req = { headers: { authorization: `Bearer ${token}` } };
  const res = makeRes();
  let nextCalled = false;

  await authMiddleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, null);
  assert.deepEqual(req.user, { id: user.id, role: user.role, department_id: user.department_id });
});
