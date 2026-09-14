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

// Registration now requires a department_id (application-layer rule in
// services/auth.service.js, deliberately not a DB CHECK). Resolved from the
// database rather than hardcoded so no test assumes a department by name.
async function activeDepartment() {
  const res = await pool.query(
    'SELECT id, name FROM departments WHERE is_active = true ORDER BY name ASC LIMIT 1'
  );
  assert.ok(res.rows[0], 'no active department found - run `npm run seed` first');
  return res.rows[0];
}

test.after(async () => {
  await pool.end();
});

// AC1: valid register -> 201, correct shape, no password_hash, role EMPLOYEE,
// and the chosen department_id echoed back (it used to always be null here).
test('POST /api/auth/register - valid registration returns 201 with token and public user', async (t) => {
  const email = validEmail();
  t.after(() => deleteUserByEmail(email));
  const department = await activeDepartment();

  const res = await request(app).post('/api/auth/register').send({
    name: 'Ada',
    surname: 'Lovelace',
    email,
    password: 'supersecret1',
    department_id: department.id,
  });

  assert.equal(res.status, 201);
  assert.equal(typeof res.body.token, 'string');
  assert.ok(res.body.user);
  assert.equal(res.body.user.email, email);
  assert.equal(res.body.user.name, 'Ada');
  assert.equal(res.body.user.surname, 'Lovelace');
  assert.equal(res.body.user.role, 'EMPLOYEE');
  assert.equal(res.body.user.department_id, department.id);
  assert.equal(typeof res.body.user.id, 'string');
  assert.equal('password_hash' in res.body.user, false);
});

// AC2: valid login -> 200; rememberMe controls JWT exp (~7d vs ~1h)
test('POST /api/auth/login - rememberMe true issues a ~7 day token, false/omitted issues a ~1 hour token', async (t) => {
  const email = validEmail();
  const password = 'supersecret1';
  t.after(() => deleteUserByEmail(email));
  const department = await activeDepartment();

  const registerRes = await request(app).post('/api/auth/register').send({
    name: 'Grace',
    surname: 'Hopper',
    email,
    password,
    department_id: department.id,
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
  const department = await activeDepartment();

  const first = await request(app).post('/api/auth/register').send({
    name: 'First',
    surname: 'User',
    email,
    password: 'supersecret1',
    department_id: department.id,
  });
  assert.equal(first.status, 201);

  const second = await request(app).post('/api/auth/register').send({
    name: 'Second',
    surname: 'User',
    email,
    password: 'anotherpass1',
    department_id: department.id,
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

// login with a malformed email -> 400, same guard as register, never reaches the DB
test('POST /api/auth/login - malformed email returns 400 with a message', async () => {
  const res = await request(app).post('/api/auth/login').send({
    email: 'not-an-email',
    password: 'whatever-not-a-real-password',
  });

  assert.equal(res.status, 400);
  assert.equal(typeof res.body.message, 'string');
  assert.ok(res.body.message.length > 0);
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

// ---------------------------------------------------------------------------
// department_id is now mandatory for self-registration (application layer, not
// a DB CHECK), and GET /api/auth/departments is the public list that feeds the
// register form before any account exists.
// ---------------------------------------------------------------------------

async function registerWith(body) {
  return request(app).post('/api/auth/register').send(body);
}

function baseRegisterBody(email) {
  return { name: 'Dept', surname: 'Tester', email, password: 'supersecret1' };
}

async function assertNoUser(email) {
  const check = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  assert.equal(check.rows.length, 0, 'no user row may be created by a rejected registration');
}

// AC1: the happy path really lands in the database - an EMPLOYEE row carrying
// exactly the department that was chosen.
test('POST /api/auth/register - the chosen department is persisted on the users row as an EMPLOYEE', async (t) => {
  const email = validEmail();
  t.after(() => deleteUserByEmail(email));
  const department = await activeDepartment();

  const res = await registerWith({ ...baseRegisterBody(email), department_id: department.id });
  assert.equal(res.status, 201, JSON.stringify(res.body));

  const row = await pool.query(
    'SELECT role, department_id, google_id FROM users WHERE email = $1',
    [email]
  );
  assert.equal(row.rows.length, 1);
  assert.equal(row.rows[0].role, 'EMPLOYEE');
  assert.equal(row.rows[0].department_id, department.id);
  assert.equal(row.rows[0].google_id, null);
});

// AC2: no department -> 400 with the exact message, and no account is created.
test('POST /api/auth/register - missing department_id returns 400 and creates no account', async () => {
  for (const departmentBody of [{}, { department_id: '' }, { department_id: null }]) {
    const email = validEmail();
    // eslint-disable-next-line no-await-in-loop
    const res = await registerWith({ ...baseRegisterBody(email), ...departmentBody });

    assert.equal(
      res.status,
      400,
      `expected 400 for ${JSON.stringify(departmentBody)}: ${JSON.stringify(res.body)}`
    );
    assert.equal(res.body.status, 'error');
    assert.equal(res.body.message, 'Departman seçilmeli');
    // eslint-disable-next-line no-await-in-loop
    await assertNoUser(email);
  }
});

// Edge case: a well-formed but unknown department UUID -> 400, no account.
test('POST /api/auth/register - nonexistent department_id returns 400 and creates no account', async () => {
  const email = validEmail();

  const res = await registerWith({ ...baseRegisterBody(email), department_id: randomUUID() });

  assert.equal(res.status, 400, JSON.stringify(res.body));
  assert.equal(res.body.message, 'Geçersiz departman');
  await assertNoUser(email);
});

// AC6 / edge case: an inactive department is never selectable, even though its
// id is perfectly valid - the register form only ever lists active ones.
test('POST /api/auth/register - inactive department_id returns 400 and creates no account', async (t) => {
  const inactiveDept = await pool.query(
    `INSERT INTO departments (name, is_active) VALUES ($1, false) RETURNING id`,
    [`Throwaway Inactive Dept ${randomUUID()}`]
  );
  const inactiveDeptId = inactiveDept.rows[0].id;
  t.after(async () => {
    await pool.query('DELETE FROM departments WHERE id = $1', [inactiveDeptId]);
  });

  const email = validEmail();
  const res = await registerWith({ ...baseRegisterBody(email), department_id: inactiveDeptId });

  assert.equal(res.status, 400, JSON.stringify(res.body));
  assert.equal(res.body.message, 'Geçersiz departman');
  await assertNoUser(email);
});

// Edge case, and the one that matters most on an UNAUTHENTICATED public
// endpoint: a malformed non-UUID makes Postgres raise 22P02, which must be
// translated to a clean 400 - leaking a raw invalid-input-syntax 500 is a bug.
test('POST /api/auth/register - malformed non-UUID department_id returns 400, never 500', async () => {
  for (const malformed of ['abc', 'not-a-uuid', '123', "' OR 1=1 --"]) {
    const email = validEmail();
    // eslint-disable-next-line no-await-in-loop
    const res = await registerWith({ ...baseRegisterBody(email), department_id: malformed });

    assert.equal(
      res.status,
      400,
      `expected 400 for ${JSON.stringify(malformed)}, got ${res.status}: ${JSON.stringify(res.body)}`
    );
    assert.notEqual(res.status, 500);
    assert.equal(res.body.message, 'Geçersiz departman');
    // eslint-disable-next-line no-await-in-loop
    await assertNoUser(email);
  }
});

// Edge case: password_hash must never appear anywhere in the register response,
// not in `user` and not at the top level either.
test('POST /api/auth/register - the response never contains password_hash', async (t) => {
  const email = validEmail();
  t.after(() => deleteUserByEmail(email));
  const department = await activeDepartment();

  const res = await registerWith({ ...baseRegisterBody(email), department_id: department.id });

  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.deepEqual(Object.keys(res.body).sort(), ['token', 'user']);
  assert.deepEqual(
    Object.keys(res.body.user).sort(),
    ['department_id', 'email', 'id', 'name', 'role', 'surname']
  );
  assert.equal(res.body.user.password_hash, undefined);
  assert.equal(res.body.password_hash, undefined);
  assert.equal(JSON.stringify(res.body).includes('password_hash'), false);
});

// AC1 (ordering guard): the department check runs AFTER the duplicate-email and
// password checks, so those keep winning even when no department is supplied.
// Documented deliberately - a reordering would silently change these responses.
test('POST /api/auth/register - duplicate email and short password still win over the department check', async (t) => {
  const email = validEmail();
  t.after(() => deleteUserByEmail(email));
  const department = await activeDepartment();

  const first = await registerWith({ ...baseRegisterBody(email), department_id: department.id });
  assert.equal(first.status, 201, JSON.stringify(first.body));

  // Duplicate email, no department at all -> 409, not the department 400.
  const duplicate = await registerWith({ ...baseRegisterBody(email) });
  assert.equal(duplicate.status, 409, JSON.stringify(duplicate.body));
  assert.equal(duplicate.body.message, 'Bu email zaten kayıtlı');

  // Short password, no department at all -> the password 400, not the department one.
  const shortPassword = await registerWith({
    ...baseRegisterBody(validEmail()),
    password: 'short1',
  });
  assert.equal(shortPassword.status, 400, JSON.stringify(shortPassword.body));
  assert.equal(shortPassword.body.message, 'Şifre en az 8 karakter olmalı');
});

// AC1 / edge case: the endpoint is public on purpose - the register form needs
// the list before any account or token exists.
test('GET /api/auth/departments - works with no Authorization header at all', async () => {
  const res = await request(app).get('/api/auth/departments');

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.ok(Array.isArray(res.body));
  assert.ok(res.body.length > 0, 'seeded departments expected - run `npm run seed` first');
  for (const row of res.body) {
    assert.deepEqual(Object.keys(row).sort(), ['id', 'name']);
    assert.equal(typeof row.id, 'string');
    assert.equal(typeof row.name, 'string');
  }
});

// Edge case: inactive departments must never reach the public register form.
test('GET /api/auth/departments - returns only active departments', async (t) => {
  const inactiveName = `Throwaway Inactive Dept ${randomUUID()}`;
  const inactiveDept = await pool.query(
    `INSERT INTO departments (name, is_active) VALUES ($1, false) RETURNING id`,
    [inactiveName]
  );
  const inactiveDeptId = inactiveDept.rows[0].id;
  t.after(async () => {
    await pool.query('DELETE FROM departments WHERE id = $1', [inactiveDeptId]);
  });

  const res = await request(app).get('/api/auth/departments');

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.some((d) => d.id === inactiveDeptId), false);
  assert.equal(res.body.some((d) => d.name === inactiveName), false);

  const expected = await pool.query('SELECT id FROM departments WHERE is_active = true');
  assert.equal(res.body.length, expected.rows.length);
});

// Edge case: the list is name-sorted so the register dropdown is stable.
test('GET /api/auth/departments - is sorted by name ascending', async (t) => {
  // A deliberately last-by-name active department, so the ordering assertion has
  // something to actually order rather than relying only on the seeded rows.
  const zName = `zzz-sort-probe-${randomUUID()}`;
  const probe = await pool.query(
    `INSERT INTO departments (name, is_active) VALUES ($1, true) RETURNING id`,
    [zName]
  );
  t.after(async () => {
    await pool.query('DELETE FROM departments WHERE id = $1', [probe.rows[0].id]);
  });

  const res = await request(app).get('/api/auth/departments');

  assert.equal(res.status, 200, JSON.stringify(res.body));
  const names = res.body.map((d) => d.name);
  assert.equal(names[names.length - 1], zName);

  const sorted = await pool.query(
    'SELECT name FROM departments WHERE is_active = true ORDER BY name ASC'
  );
  assert.deepEqual(names, sorted.rows.map((r) => r.name));
});

// AC6 (backend half): with zero active departments the public list is a clean
// empty 200 (the signal both frontend pages block on) and registration is a
// controlled 400 - never a 500, and never an account without a department.
test('GET /api/auth/departments + register - zero active departments is a controlled empty list and a 400, never a 500', async (t) => {
  const active = await pool.query('SELECT id FROM departments WHERE is_active = true');
  const activeIds = active.rows.map((r) => r.id);
  assert.ok(activeIds.length > 0, 'seeded departments expected - run `npm run seed` first');

  async function restore() {
    await pool.query('UPDATE departments SET is_active = true WHERE id = ANY($1::uuid[])', [activeIds]);
  }
  // Belt and braces: t.after still runs if an assertion below throws, and the
  // finally block covers the rest. The seeded departments must never be left off.
  t.after(restore);

  const email = validEmail();
  t.after(() => deleteUserByEmail(email));

  try {
    await pool.query('UPDATE departments SET is_active = false WHERE id = ANY($1::uuid[])', [activeIds]);

    const listRes = await request(app).get('/api/auth/departments');
    assert.equal(listRes.status, 200, JSON.stringify(listRes.body));
    assert.deepEqual(listRes.body, []);

    // Every previously valid department id is now unusable, with the controlled
    // message rather than a constraint violation or a 500.
    const registerRes = await registerWith({ ...baseRegisterBody(email), department_id: activeIds[0] });
    assert.equal(registerRes.status, 400, JSON.stringify(registerRes.body));
    assert.equal(registerRes.body.message, 'Geçersiz departman');
    await assertNoUser(email);
  } finally {
    await restore();
  }

  // The world really is back the way we found it.
  const after = await pool.query('SELECT id FROM departments WHERE is_active = true');
  assert.equal(after.rows.length, activeIds.length);
});
