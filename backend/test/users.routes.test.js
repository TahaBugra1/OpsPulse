const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const request = require('supertest');

const app = require('../server');
const pool = require('../services/db');

// process.env.ALLOWED_EMAIL_DOMAIN is populated once ../server (which loads
// dotenv) has been required above.
const ALLOWED_DOMAIN = process.env.ALLOWED_EMAIL_DOMAIN;

// The exact user-facing strings produced by services/validation.js consumers
// (services/users.service.js and services/auth.service.js).
const NAME_ERROR = 'Ad zorunlu ve en fazla 150 karakter olabilir';
const SURNAME_ERROR = 'Soyad en fazla 150 karakter olabilir';

// The 7 fields services/users.service.js#toProfile is contractually allowed to
// expose. password_hash / google_id must never be among them.
const PROFILE_KEYS = ['department_id', 'department_name', 'email', 'id', 'name', 'role', 'surname'];

function validEmail() {
  return `test-${randomUUID()}@${ALLOWED_DOMAIN}`;
}

// Registers a fresh throwaway EMPLOYEE and returns { id, email, token }.
async function registerEmployee() {
  const email = validEmail();
  const res = await request(app).post('/api/auth/register').send({
    name: 'Test',
    surname: 'Employee',
    email,
    password: 'sifre1234test',
  });
  assert.equal(res.status, 201, `employee registration failed: ${JSON.stringify(res.body)}`);
  return { id: res.body.user.id, email, token: res.body.token };
}

async function deleteUser(userId) {
  await pool.query('DELETE FROM users WHERE id = $1', [userId]);
}

// Reads the raw users row so assertions can look past the API's projection
// (e.g. confirm role/is_active/email really were not touched by a PATCH).
async function readUserRow(userId) {
  const res = await pool.query(
    'SELECT id, name, surname, email, role, is_active, department_id FROM users WHERE id = $1',
    [userId]
  );
  return res.rows[0];
}

function sortedKeys(obj) {
  return Object.keys(obj).sort();
}

let itAuthorityToken;

test.before(async () => {
  // Seed DEPARTMENT_AUTHORITY - read-only in this file, never modified/deleted.
  // Logged in exactly once: POST /api/auth/login is rate limited to 5 attempts
  // per email per 15 minutes (routes/auth.routes.js).
  const itLogin = await request(app)
    .post('/api/auth/login')
    .send({ email: 'it.authority@opspulse.com', password: 'sifre1234' });
  assert.equal(itLogin.status, 200, `IT authority login failed: ${JSON.stringify(itLogin.body)}`);
  itAuthorityToken = itLogin.body.token;
});

test.after(async () => {
  await pool.end();
});

// AC1: GET /api/users/me returns exactly the 7 profile fields for the caller.
// department_id/department_name are null for a fresh EMPLOYEE, which is also the
// LEFT JOIN regression guard - an INNER JOIN in PROFILE_SELECT would 404 here.
test('GET /api/users/me - returns exactly the 7 profile fields, never password_hash/google_id', async (t) => {
  const employee = await registerEmployee();
  t.after(() => deleteUser(employee.id));

  const res = await request(app)
    .get('/api/users/me')
    .set('Authorization', `Bearer ${employee.token}`);

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(sortedKeys(res.body), PROFILE_KEYS);

  assert.equal(res.body.id, employee.id);
  assert.equal(res.body.name, 'Test');
  assert.equal(res.body.surname, 'Employee');
  assert.equal(res.body.email, employee.email);
  assert.equal(res.body.role, 'EMPLOYEE');
  assert.equal(res.body.department_id, null);
  assert.equal(res.body.department_name, null);

  assert.equal(res.body.password_hash, undefined);
  assert.equal(res.body.google_id, undefined);
});

// AC1: the LEFT JOIN actually resolves a department name for a user who has one.
// Uses the seeded IT authority read-only (never modified, never deleted).
test('GET /api/users/me - DEPARTMENT_AUTHORITY sees their joined department_name', async () => {
  const res = await request(app)
    .get('/api/users/me')
    .set('Authorization', `Bearer ${itAuthorityToken}`);

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(sortedKeys(res.body), PROFILE_KEYS);
  assert.equal(res.body.email, 'it.authority@opspulse.com');
  assert.equal(res.body.role, 'DEPARTMENT_AUTHORITY');
  assert.notEqual(res.body.department_id, null);
  assert.equal(res.body.department_name, 'IT');
  assert.equal(res.body.password_hash, undefined);
  assert.equal(res.body.google_id, undefined);
});

// AC2: PATCH with a valid name+surname updates both, returns the full updated
// profile in the same shape as GET, and the change is really persisted.
test('PATCH /api/users/me - updates name and surname, returns the GET-shaped profile, persists', async (t) => {
  const employee = await registerEmployee();
  t.after(() => deleteUser(employee.id));

  const patchRes = await request(app)
    .patch('/api/users/me')
    .set('Authorization', `Bearer ${employee.token}`)
    .send({ name: 'Yeni Ad', surname: 'Yeni Soyad' });

  assert.equal(patchRes.status, 200, JSON.stringify(patchRes.body));
  assert.deepEqual(sortedKeys(patchRes.body), PROFILE_KEYS);
  assert.equal(patchRes.body.name, 'Yeni Ad');
  assert.equal(patchRes.body.surname, 'Yeni Soyad');
  assert.equal(patchRes.body.id, employee.id);
  assert.equal(patchRes.body.email, employee.email);
  assert.equal(patchRes.body.role, 'EMPLOYEE');

  // PATCH response shape === GET response shape.
  const getRes = await request(app)
    .get('/api/users/me')
    .set('Authorization', `Bearer ${employee.token}`);
  assert.equal(getRes.status, 200);
  assert.deepEqual(sortedKeys(getRes.body), sortedKeys(patchRes.body));
  assert.deepEqual(getRes.body, patchRes.body);

  const row = await readUserRow(employee.id);
  assert.equal(row.name, 'Yeni Ad');
  assert.equal(row.surname, 'Yeni Soyad');
});

// AC2: values are trimmed before they are stored.
test('PATCH /api/users/me - trims surrounding whitespace on name and surname', async (t) => {
  const employee = await registerEmployee();
  t.after(() => deleteUser(employee.id));

  const res = await request(app)
    .patch('/api/users/me')
    .set('Authorization', `Bearer ${employee.token}`)
    .send({ name: '   Ada   ', surname: '  Lovelace  ' });

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.name, 'Ada');
  assert.equal(res.body.surname, 'Lovelace');

  const row = await readUserRow(employee.id);
  assert.equal(row.name, 'Ada');
  assert.equal(row.surname, 'Lovelace');
});

// AC3: the single most important security test in this file. A PATCH body
// carrying role/is_active/email/id must update ONLY name/surname - privilege
// escalation via mass assignment must be impossible.
test('PATCH /api/users/me - extra body fields (role, is_active, email, id) are silently ignored', async (t) => {
  const victim = await registerEmployee();
  const attacker = await registerEmployee();
  t.after(() => deleteUser(attacker.id));
  t.after(() => deleteUser(victim.id));

  const before = await readUserRow(attacker.id);

  const res = await request(app)
    .patch('/api/users/me')
    .set('Authorization', `Bearer ${attacker.token}`)
    .send({
      name: 'Escalated',
      surname: 'Attempt',
      role: 'ADMIN',
      is_active: false,
      email: victim.email,
      id: randomUUID(),
      department_id: randomUUID(),
      password_hash: 'injected',
      google_id: 'injected',
    });

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(sortedKeys(res.body), PROFILE_KEYS);
  assert.equal(res.body.role, 'EMPLOYEE');
  assert.equal(res.body.email, attacker.email);
  assert.equal(res.body.id, attacker.id);

  // Assert from the database, not just the response projection.
  const after = await readUserRow(attacker.id);
  assert.equal(after.name, 'Escalated');
  assert.equal(after.surname, 'Attempt');
  assert.equal(after.role, 'EMPLOYEE', 'role must not be escalated via the PATCH body');
  assert.equal(after.is_active, true, 'is_active must not be settable via the PATCH body');
  assert.equal(after.email, before.email, 'email must not be settable via the PATCH body');
  assert.equal(after.id, before.id);
  assert.equal(after.department_id, null, 'department_id must not be settable via the PATCH body');
});

// AC4: both endpoints act on req.user.id only. A body id belonging to user B is
// never honoured, and no /api/users/:id route exists at all.
test('PATCH /api/users/me - a body id belonging to another user cannot touch that user', async (t) => {
  const userA = await registerEmployee();
  const userB = await registerEmployee();
  t.after(() => deleteUser(userB.id));
  t.after(() => deleteUser(userA.id));

  const bBefore = await readUserRow(userB.id);

  const res = await request(app)
    .patch('/api/users/me')
    .set('Authorization', `Bearer ${userA.token}`)
    .send({ name: 'Hijack', surname: 'Attempt', id: userB.id, user_id: userB.id });

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.id, userA.id);

  // A's own row changed...
  const aAfter = await readUserRow(userA.id);
  assert.equal(aAfter.name, 'Hijack');
  assert.equal(aAfter.surname, 'Attempt');

  // ...and B's row is byte-for-byte untouched.
  const bAfter = await readUserRow(userB.id);
  assert.deepEqual(bAfter, bBefore, "user B's row must be completely untouched");
});

// AC4: there is no :id-parameterised route to attack in the first place.
test('GET/PATCH /api/users/:id - no such route exists (404), only /me', async (t) => {
  const userA = await registerEmployee();
  const userB = await registerEmployee();
  t.after(() => deleteUser(userB.id));
  t.after(() => deleteUser(userA.id));

  const getOther = await request(app)
    .get(`/api/users/${userB.id}`)
    .set('Authorization', `Bearer ${userA.token}`);
  assert.equal(getOther.status, 404);

  const patchOther = await request(app)
    .patch(`/api/users/${userB.id}`)
    .set('Authorization', `Bearer ${userA.token}`)
    .send({ name: 'Hijack' });
  assert.equal(patchOther.status, 404);

  // B is still intact after both attempts.
  const bAfter = await readUserRow(userB.id);
  assert.equal(bAfter.name, 'Test');
  assert.equal(bAfter.surname, 'Employee');
});

// AC5: missing / empty / whitespace-only name -> 400 with the exact Turkish
// message, and nothing is written.
test('PATCH /api/users/me - missing, empty or whitespace-only name returns 400 and writes nothing', async (t) => {
  const employee = await registerEmployee();
  t.after(() => deleteUser(employee.id));

  const invalidBodies = [
    { surname: 'OnlySurname' }, // name missing entirely
    { name: '', surname: 'Empty' },
    { name: '   ', surname: 'Whitespace' },
    { name: '\t\n ', surname: 'Tabs' },
    { name: 123, surname: 'NotAString' },
    { name: null, surname: 'Null' },
  ];

  for (const body of invalidBodies) {
    // eslint-disable-next-line no-await-in-loop
    const res = await request(app)
      .patch('/api/users/me')
      .set('Authorization', `Bearer ${employee.token}`)
      .send(body);

    assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(body)}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.status, 'error');
    assert.equal(res.body.message, NAME_ERROR);

    // Nothing was written - the row still holds the registration values.
    // eslint-disable-next-line no-await-in-loop
    const row = await readUserRow(employee.id);
    assert.equal(row.name, 'Test');
    assert.equal(row.surname, 'Employee');
  }
});

// AC6: over-length name/surname are rejected by the service with a clean 400 -
// no raw VARCHAR(150) constraint violation is allowed to reach the client.
test('PATCH /api/users/me - name or surname over 150 chars returns a clean 400, never a DB error', async (t) => {
  const employee = await registerEmployee();
  t.after(() => deleteUser(employee.id));

  const longName = await request(app)
    .patch('/api/users/me')
    .set('Authorization', `Bearer ${employee.token}`)
    .send({ name: 'a'.repeat(151), surname: 'Ok' });
  assert.equal(longName.status, 400, JSON.stringify(longName.body));
  assert.equal(longName.body.message, NAME_ERROR);

  const longSurname = await request(app)
    .patch('/api/users/me')
    .set('Authorization', `Bearer ${employee.token}`)
    .send({ name: 'Ok', surname: 'b'.repeat(151) });
  assert.equal(longSurname.status, 400, JSON.stringify(longSurname.body));
  assert.equal(longSurname.body.message, SURNAME_ERROR);

  // Both rejections must be pure - the registration values are still intact.
  const row = await readUserRow(employee.id);
  assert.equal(row.name, 'Test', 'no partial write may happen on a rejected PATCH');
  assert.equal(row.surname, 'Employee');
});

// AC6: the 150-char boundary is inclusive (guards against an off-by-one that
// would make the API stricter than the VARCHAR(150) column).
test('PATCH /api/users/me - exactly 150 chars is accepted for both name and surname', async (t) => {
  const employee = await registerEmployee();
  t.after(() => deleteUser(employee.id));

  const maxName = 'a'.repeat(150);
  const maxSurname = 'b'.repeat(150);

  const res = await request(app)
    .patch('/api/users/me')
    .set('Authorization', `Bearer ${employee.token}`)
    .send({ name: maxName, surname: maxSurname });

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.name, maxName);
  assert.equal(res.body.surname, maxSurname);

  const row = await readUserRow(employee.id);
  assert.equal(row.name, maxName);
  assert.equal(row.surname, maxSurname);
});

// AC7: an absent / empty / whitespace-only surname is stored as SQL NULL,
// never as an empty string.
test('PATCH /api/users/me - absent, empty or whitespace-only surname is stored as SQL NULL', async (t) => {
  const employee = await registerEmployee();
  t.after(() => deleteUser(employee.id));

  const cases = [
    { label: 'surname absent', body: { name: 'NoSurname' } },
    { label: 'surname empty string', body: { name: 'EmptySurname', surname: '' } },
    { label: 'surname whitespace only', body: { name: 'WsSurname', surname: '   ' } },
    { label: 'surname explicit null', body: { name: 'NullSurname', surname: null } },
  ];

  for (const { label, body } of cases) {
    // Seed a non-null surname first so a no-op would be caught.
    // eslint-disable-next-line no-await-in-loop
    const seed = await request(app)
      .patch('/api/users/me')
      .set('Authorization', `Bearer ${employee.token}`)
      .send({ name: 'Seed', surname: 'NotNull' });
    assert.equal(seed.status, 200);
    assert.equal(seed.body.surname, 'NotNull');

    // eslint-disable-next-line no-await-in-loop
    const res = await request(app)
      .patch('/api/users/me')
      .set('Authorization', `Bearer ${employee.token}`)
      .send(body);

    assert.equal(res.status, 200, `${label}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.surname, null, `${label}: response surname must be null`);

    // eslint-disable-next-line no-await-in-loop
    const row = await readUserRow(employee.id);
    assert.equal(row.surname, null, `${label}: stored surname must be SQL NULL, not ''`);
    assert.notEqual(row.surname, '', `${label}: stored surname must not be an empty string`);
  }
});

// AC8: the shared validation rule also closes the pre-existing registration gap.
test('POST /api/auth/register - missing, empty or whitespace-only name returns 400 and creates no user', async () => {
  const invalidNames = [
    { label: 'name missing', body: {} },
    { label: 'name empty', body: { name: '' } },
    { label: 'name whitespace only', body: { name: '   ' } },
    { label: 'name tabs/newlines', body: { name: '\t\n ' } },
    { label: 'name over 150 chars', body: { name: 'a'.repeat(151) } },
  ];

  for (const { label, body } of invalidNames) {
    const email = validEmail();

    // eslint-disable-next-line no-await-in-loop
    const res = await request(app).post('/api/auth/register').send({
      surname: 'Employee',
      email,
      password: 'sifre1234test',
      ...body,
    });

    assert.equal(res.status, 400, `${label}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.status, 'error');
    assert.equal(res.body.message, NAME_ERROR, label);

    // No row may be left behind.
    // eslint-disable-next-line no-await-in-loop
    const check = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    assert.equal(check.rows.length, 0, `${label}: no user row may be created`);
  }
});

// AC9: the new routes really do sit behind authMiddleware - no token and a
// garbage token are both 401.
test('GET/PATCH /api/users/me - missing or invalid token returns 401', async () => {
  const noHeaderGet = await request(app).get('/api/users/me');
  assert.equal(noHeaderGet.status, 401);
  assert.equal(noHeaderGet.body.message, 'Yetkilendirme başlığı eksik');

  const noHeaderPatch = await request(app).patch('/api/users/me').send({ name: 'X' });
  assert.equal(noHeaderPatch.status, 401);
  assert.equal(noHeaderPatch.body.message, 'Yetkilendirme başlığı eksik');

  const badTokenGet = await request(app)
    .get('/api/users/me')
    .set('Authorization', 'Bearer garbage');
  assert.equal(badTokenGet.status, 401);
  assert.equal(badTokenGet.body.message, 'Geçersiz veya süresi dolmuş token');

  const badTokenPatch = await request(app)
    .patch('/api/users/me')
    .set('Authorization', 'Bearer garbage')
    .send({ name: 'X' });
  assert.equal(badTokenPatch.status, 401);
  assert.equal(badTokenPatch.body.message, 'Geçersiz veya süresi dolmuş token');
});

// AC9: a deactivated account is rejected with 403 even though its JWT is still
// cryptographically valid (is_active is re-read from the DB on every request).
test('GET/PATCH /api/users/me - a deactivated account returns 403 despite a still-valid token', async (t) => {
  const employee = await registerEmployee();
  t.after(() => deleteUser(employee.id));

  // Sanity check: the token works while the account is active.
  const beforeRes = await request(app)
    .get('/api/users/me')
    .set('Authorization', `Bearer ${employee.token}`);
  assert.equal(beforeRes.status, 200);

  await pool.query('UPDATE users SET is_active = false WHERE id = $1', [employee.id]);

  const getRes = await request(app)
    .get('/api/users/me')
    .set('Authorization', `Bearer ${employee.token}`);
  assert.equal(getRes.status, 403);
  assert.equal(getRes.body.message, 'Hesap aktif değil');

  const patchRes = await request(app)
    .patch('/api/users/me')
    .set('Authorization', `Bearer ${employee.token}`)
    .send({ name: 'ShouldNotApply' });
  assert.equal(patchRes.status, 403);
  assert.equal(patchRes.body.message, 'Hesap aktif değil');

  // The rejected PATCH wrote nothing.
  const row = await readUserRow(employee.id);
  assert.equal(row.name, 'Test');
});
