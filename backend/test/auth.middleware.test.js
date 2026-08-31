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
