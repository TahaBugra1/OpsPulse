const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const request = require('supertest');

const app = require('../server');
const pool = require('../services/db');

// process.env.ALLOWED_EMAIL_DOMAIN is populated once ../server (which loads
// dotenv) has been required above.
const ALLOWED_DOMAIN = process.env.ALLOWED_EMAIL_DOMAIN;

function validEmail() {
  return `test-${randomUUID()}@${ALLOWED_DOMAIN}`;
}

async function deleteUserByEmail(email) {
  await pool.query('DELETE FROM users WHERE email = $1', [email]);
}

test.after(async () => {
  await pool.end();
});

// AC1: valid register -> 201, correct shape, no password_hash, role EMPLOYEE
test('POST /api/auth/register - valid registration returns 201 with token and public user', async (t) => {
  const email = validEmail();
  t.after(() => deleteUserByEmail(email));

  const res = await request(app).post('/api/auth/register').send({
    name: 'Ada',
    surname: 'Lovelace',
    email,
    password: 'supersecret1',
  });

  assert.equal(res.status, 201);
  assert.equal(typeof res.body.token, 'string');
  assert.ok(res.body.user);
  assert.equal(res.body.user.email, email);
  assert.equal(res.body.user.name, 'Ada');
  assert.equal(res.body.user.surname, 'Lovelace');
  assert.equal(res.body.user.role, 'EMPLOYEE');
  assert.equal(res.body.user.department_id, null);
  assert.equal(typeof res.body.user.id, 'string');
  assert.equal('password_hash' in res.body.user, false);
});

// AC2: valid login -> 200; rememberMe controls JWT exp (~7d vs ~1h)
test('POST /api/auth/login - rememberMe true issues a ~7 day token, false/omitted issues a ~1 hour token', async (t) => {
  const email = validEmail();
  const password = 'supersecret1';
  t.after(() => deleteUserByEmail(email));

  const registerRes = await request(app).post('/api/auth/register').send({
    name: 'Grace',
    surname: 'Hopper',
    email,
    password,
  });
  assert.equal(registerRes.status, 201);

  const rememberRes = await request(app).post('/api/auth/login').send({
    email,
    password,
    rememberMe: true,
  });
  assert.equal(rememberRes.status, 200);
  assert.ok(rememberRes.body.token);
  assert.ok(rememberRes.body.user);

  const rememberPayload = jwt.decode(rememberRes.body.token);
  const rememberDelta = rememberPayload.exp - rememberPayload.iat;
  assert.ok(
    Math.abs(rememberDelta - 7 * 24 * 3600) <= 5,
    `expected ~7d token lifetime, got ${rememberDelta}s`
  );

  const noRememberRes = await request(app).post('/api/auth/login').send({
    email,
    password,
  });
  assert.equal(noRememberRes.status, 200);
  const noRememberPayload = jwt.decode(noRememberRes.body.token);
  const noRememberDelta = noRememberPayload.exp - noRememberPayload.iat;
  assert.ok(
    Math.abs(noRememberDelta - 3600) <= 5,
    `expected ~1h token lifetime, got ${noRememberDelta}s`
  );

  const falseRememberRes = await request(app).post('/api/auth/login').send({
    email,
    password,
    rememberMe: false,
  });
  assert.equal(falseRememberRes.status, 200);
  const falseRememberPayload = jwt.decode(falseRememberRes.body.token);
  const falseRememberDelta = falseRememberPayload.exp - falseRememberPayload.iat;
  assert.ok(
    Math.abs(falseRememberDelta - 3600) <= 5,
    `expected ~1h token lifetime, got ${falseRememberDelta}s`
  );
});

// AC3: login with is_active=false (correct password) -> 403, no token
test('POST /api/auth/login - inactive user with correct password returns 403 and no token', async (t) => {
  const email = validEmail();
  const password = 'supersecret1';
  const passwordHash = await bcrypt.hash(password, 10);
  t.after(() => deleteUserByEmail(email));

  await pool.query(
    `INSERT INTO users (name, surname, email, password_hash, role, is_active)
     VALUES ($1, $2, $3, $4, 'EMPLOYEE', false)`,
    ['Inactive', 'User', email, passwordHash]
  );

  const res = await request(app).post('/api/auth/login').send({ email, password });

  assert.equal(res.status, 403);
  assert.equal(res.body.token, undefined);
});

// AC4: register with already-registered email -> 409
test('POST /api/auth/register - duplicate email returns 409 with a message', async (t) => {
  const email = validEmail();
  t.after(() => deleteUserByEmail(email));

  const first = await request(app).post('/api/auth/register').send({
    name: 'First',
    surname: 'User',
    email,
    password: 'supersecret1',
  });
  assert.equal(first.status, 201);

  const second = await request(app).post('/api/auth/register').send({
    name: 'Second',
    surname: 'User',
    email,
    password: 'anotherpass1',
  });

  assert.equal(second.status, 409);
  assert.equal(typeof second.body.message, 'string');
  assert.ok(second.body.message.length > 0);
});

// AC5: register with a non-allowed domain -> 400, no row inserted
test('POST /api/auth/register - disallowed email domain returns 400 and inserts no row', async () => {
  const email = `test-${randomUUID()}@not-allowed-domain.example`;

  const res = await request(app).post('/api/auth/register').send({
    name: 'Bad',
    surname: 'Domain',
    email,
    password: 'supersecret1',
  });

  assert.equal(res.status, 400);
  assert.equal(typeof res.body.message, 'string');

  const check = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  assert.equal(check.rows.length, 0);
});

// AC6: login rate limiter - 6th sequential request for the same email is 429
test('POST /api/auth/login - 6th sequential login attempt for the same email returns 429', async () => {
  const email = `ratelimit-${randomUUID()}@${ALLOWED_DOMAIN}`;

  let lastRes;
  for (let i = 0; i < 6; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    lastRes = await request(app).post('/api/auth/login').send({
      email,
      password: 'whatever-not-a-real-password',
    });
  }

  assert.equal(lastRes.status, 429);
});

// AC8: register with a password under 8 characters -> 400
test('POST /api/auth/register - password shorter than 8 characters returns 400 with a message', async () => {
  const email = validEmail();

  const res = await request(app).post('/api/auth/register').send({
    name: 'Short',
    surname: 'Password',
    email,
    password: 'short1',
  });

  assert.equal(res.status, 400);
  assert.equal(typeof res.body.message, 'string');
  assert.ok(res.body.message.length > 0);

  const check = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  assert.equal(check.rows.length, 0);
});
