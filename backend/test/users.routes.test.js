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
  // Registration now requires a department_id: services/auth.service.js enforces
  // it at the application layer (deliberately not via a DB CHECK), so a body
  // without one is a correct 400. Resolved here rather than hardcoded so the
  // helper never assumes a department by name.
  const deptRes = await pool.query(
    'SELECT id FROM departments WHERE is_active = true ORDER BY name ASC LIMIT 1'
  );
  assert.ok(deptRes.rows[0], 'no active department found - run `npm run seed` first');
  const res = await request(app).post('/api/auth/register').send({
    name: 'Test',
    surname: 'Employee',
    email,
    password: 'sifre1234test',
    department_id: deptRes.rows[0].id,
  });
  assert.equal(res.status, 201, `employee registration failed: ${JSON.stringify(res.body)}`);
  return { id: res.body.user.id, email, token: res.body.token, department_id: res.body.user.department_id };
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
let hrAuthorityToken;
let adminId;
let adminToken;

test.before(async () => {
  // Seed DEPARTMENT_AUTHORITY - read-only in this file, never modified/deleted.
  // Logged in exactly once: POST /api/auth/login is rate limited to 5 attempts
  // per email per 15 minutes (routes/auth.routes.js).
  const itLogin = await request(app)
    .post('/api/auth/login')
    .send({ email: 'it.authority@opspulse.com', password: 'sifre1234' });
  assert.equal(itLogin.status, 200, `IT authority login failed: ${JSON.stringify(itLogin.body)}`);
  itAuthorityToken = itLogin.body.token;

  // Seed DEPARTMENT_AUTHORITY in a different department (HR) - read-only,
  // needed for the GET /api/users/team cross-department isolation tests.
  // Logged in exactly once here, for the same rate-limit reason as above.
  const hrLogin = await request(app)
    .post('/api/auth/login')
    .send({ email: 'hr.authority@opspulse.com', password: 'sifre1234' });
  assert.equal(hrLogin.status, 200, `HR authority login failed: ${JSON.stringify(hrLogin.body)}`);
  hrAuthorityToken = hrLogin.body.token;

  // Throwaway ADMIN, created directly via SQL (no API path can create one),
  // reusing the seeded IT authority's password_hash so the plaintext password
  // 'sifre1234' still works for login. See backend/test/analytics.test.js for
  // the origin of this pattern.
  const pwRow = await pool.query("SELECT password_hash FROM users WHERE email = 'it.authority@opspulse.com'");
  const adminEmail = `admin-${randomUUID()}@opspulse.com`;
  const adminInsert = await pool.query(
    `INSERT INTO users (name, surname, email, password_hash, role) VALUES ($1, $2, $3, $4, 'ADMIN') RETURNING id`,
    ['Test', 'Admin', adminEmail, pwRow.rows[0].password_hash]
  );
  adminId = adminInsert.rows[0].id;

  const adminLogin = await request(app).post('/api/auth/login').send({ email: adminEmail, password: 'sifre1234' });
  assert.equal(adminLogin.status, 200, `admin login failed: ${JSON.stringify(adminLogin.body)}`);
  adminToken = adminLogin.body.token;
});

test.after(async () => {
  await pool.query('DELETE FROM users WHERE id = $1', [adminId]);
  await pool.end();
});

// Helper: creates a throwaway DEPARTMENT_AUTHORITY via POST /api/users as the
// throwaway admin, using a valid active department. Returns the response.
async function postDeptAuthority(token, overrides = {}) {
  const deptRes = await pool.query('SELECT id FROM departments WHERE is_active = true LIMIT 1');
  const departmentId = deptRes.rows[0].id;
  return request(app)
    .post('/api/users')
    .set('Authorization', `Bearer ${token}`)
    .send({
      name: 'New',
      surname: 'Authority',
      email: validEmail(),
      password: 'sifre1234',
      department_id: departmentId,
      ...overrides,
    });
}

// AC1: GET /api/users/me returns exactly the 7 profile fields for the caller.
// A self-registered EMPLOYEE now always carries the department chosen at
// registration, so department_id/department_name are populated, not null.
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
  assert.equal(res.body.department_id, employee.department_id);
  assert.notEqual(res.body.department_id, null);
  assert.equal(typeof res.body.department_name, 'string');

  assert.equal(res.body.password_hash, undefined);
  assert.equal(res.body.google_id, undefined);
});

// AC1 (LEFT JOIN regression guard, previously covered by the fresh-EMPLOYEE
// case above): PROFILE_SELECT must still resolve a user whose department_id is
// NULL. An ADMIN legitimately has none, and so does a brand-new Google account
// before it reaches the completion screen - an INNER JOIN would 404 both.
test('GET /api/users/me - a user with a NULL department_id still resolves (LEFT JOIN, not INNER)', async () => {
  const res = await request(app)
    .get('/api/users/me')
    .set('Authorization', `Bearer ${adminToken}`);

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(sortedKeys(res.body), PROFILE_KEYS);
  assert.equal(res.body.role, 'ADMIN');
  assert.equal(res.body.department_id, null);
  assert.equal(res.body.department_name, null);
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
  assert.equal(
    after.department_id,
    before.department_id,
    'department_id must not be settable via the PATCH body'
  );
  assert.notEqual(after.department_id, null, 'fixture sanity: the attacker really has a department to overwrite');
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

// ---------------------------------------------------------------------------
// Admin-only user management: GET /api/users, POST /api/users,
// PATCH /api/users/:id/deactivate (artifacts/admin-user-management/atdd.md)
// ---------------------------------------------------------------------------

// AC1: GET /api/users as ADMIN returns ALL users (active AND inactive), with
// is_active/created_at present in each row.
test('GET /api/users - ADMIN gets every user, active and inactive, with is_active/created_at', async (t) => {
  const employee = await registerEmployee();
  t.after(() => deleteUser(employee.id));
  await pool.query('UPDATE users SET is_active = false WHERE id = $1', [employee.id]);

  const res = await request(app)
    .get('/api/users')
    .set('Authorization', `Bearer ${adminToken}`);

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.ok(Array.isArray(res.body));

  const row = res.body.find((u) => u.id === employee.id);
  assert.ok(row, 'the deactivated employee must still appear in the list');
  assert.equal(row.is_active, false);
  assert.equal(typeof row.created_at, 'string');

  const activeRow = res.body.find((u) => u.id === adminId);
  assert.ok(activeRow, 'active users must also appear');
  assert.equal(activeRow.is_active, true);
  assert.equal(typeof activeRow.created_at, 'string');
});

// AC2: GET /api/users as a non-ADMIN (EMPLOYEE and DEPARTMENT_AUTHORITY) -> 403.
test('GET /api/users - EMPLOYEE and DEPARTMENT_AUTHORITY are both forbidden (403)', async (t) => {
  const employee = await registerEmployee();
  t.after(() => deleteUser(employee.id));

  const employeeRes = await request(app)
    .get('/api/users')
    .set('Authorization', `Bearer ${employee.token}`);
  assert.equal(employeeRes.status, 403);
  assert.equal(employeeRes.body.message, 'Bu işlem için yetkiniz yok');

  const authorityRes = await request(app)
    .get('/api/users')
    .set('Authorization', `Bearer ${itAuthorityToken}`);
  assert.equal(authorityRes.status, 403);
  assert.equal(authorityRes.body.message, 'Bu işlem için yetkiniz yok');
});

// AC3: POST /api/users with valid data creates a DEPARTMENT_AUTHORITY, returns
// 201, is really persisted with a correctly-hashed password, and the new user
// can actually log in with the plaintext password used at creation.
test('POST /api/users - valid data creates a DEPARTMENT_AUTHORITY that is persisted and can log in', async (t) => {
  const deptRes = await pool.query('SELECT id, name FROM departments WHERE is_active = true LIMIT 1');
  const department = deptRes.rows[0];
  const email = validEmail();
  const password = 'sifre1234';

  const res = await request(app)
    .post('/api/users')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: 'Yeni', surname: 'Yetkili', email, password, department_id: department.id });

  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.role, 'DEPARTMENT_AUTHORITY');
  assert.equal(res.body.email, email);
  t.after(() => deleteUser(res.body.id));

  // Really persisted, with the exact requested department and a bcrypt hash
  // (never the plaintext password).
  const row = await pool.query(
    'SELECT id, role, department_id, password_hash FROM users WHERE id = $1',
    [res.body.id]
  );
  assert.equal(row.rows.length, 1);
  assert.equal(row.rows[0].role, 'DEPARTMENT_AUTHORITY');
  assert.equal(row.rows[0].department_id, department.id);
  assert.notEqual(row.rows[0].password_hash, password);
  assert.ok(row.rows[0].password_hash.startsWith('$2'), 'password must be bcrypt-hashed');

  // The new user can really log in with the plaintext password.
  const loginRes = await request(app)
    .post('/api/auth/login')
    .send({ email, password });
  assert.equal(loginRes.status, 200, JSON.stringify(loginRes.body));
  assert.equal(loginRes.body.user.id, res.body.id);
  assert.equal(loginRes.body.user.role, 'DEPARTMENT_AUTHORITY');
});

// AC4 (THE MOST IMPORTANT TEST IN THIS TASK): a body that additionally
// includes role: 'ADMIN' (or any other role) is completely ignored - the
// created user is still DEPARTMENT_AUTHORITY in the database.
test('POST /api/users - a role field in the body (e.g. role: ADMIN) is ignored, never escalates privilege', async (t) => {
  const attemptedRoles = ['ADMIN', 'EMPLOYEE', 'DEPARTMENT_AUTHORITY', 'SUPERADMIN', 'admin'];

  for (const attemptedRole of attemptedRoles) {
    // eslint-disable-next-line no-await-in-loop
    const res = await postDeptAuthority(adminToken, { role: attemptedRole });
    assert.equal(res.status, 201, `${attemptedRole}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.role, 'DEPARTMENT_AUTHORITY', `response role escalated via body.role=${attemptedRole}`);
    t.after(() => deleteUser(res.body.id));

    // Assert from the database, not just the response projection.
    // eslint-disable-next-line no-await-in-loop
    const row = await pool.query('SELECT role FROM users WHERE id = $1', [res.body.id]);
    assert.equal(
      row.rows[0].role,
      'DEPARTMENT_AUTHORITY',
      `DB role must remain DEPARTMENT_AUTHORITY despite body.role=${attemptedRole}`
    );
  }
});

// AC5: PATCH /api/users/:id/deactivate as ADMIN on another user's id sets
// is_active = false (verified via DB read), returns 200, and the row still
// exists (never deleted).
test('PATCH /api/users/:id/deactivate - ADMIN deactivates another user, row persists with is_active=false', async (t) => {
  const employee = await registerEmployee();
  t.after(() => deleteUser(employee.id));

  const res = await request(app)
    .patch(`/api/users/${employee.id}/deactivate`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send();

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.is_active, false);

  const row = await pool.query('SELECT id, is_active FROM users WHERE id = $1', [employee.id]);
  assert.equal(row.rows.length, 1, 'the user row must still exist - never deleted');
  assert.equal(row.rows[0].is_active, false);
});

// AC6: PATCH /api/users/:id/deactivate where :id equals the calling ADMIN's
// own id returns 400 and does NOT deactivate them.
test('PATCH /api/users/:id/deactivate - an admin cannot deactivate themselves', async () => {
  const res = await request(app)
    .patch(`/api/users/${adminId}/deactivate`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send();

  assert.equal(res.status, 400, JSON.stringify(res.body));
  assert.equal(res.body.message, 'Kendi hesabınızı pasife alamazsınız');

  const row = await pool.query('SELECT is_active FROM users WHERE id = $1', [adminId]);
  assert.equal(row.rows[0].is_active, true, 'the admin must still be active');
});

// AC2 corollary: POST and PATCH deactivate are equally admin-gated (403 for
// non-ADMIN), matching the GET /api/users role check.
test('POST /api/users and PATCH /api/users/:id/deactivate - non-ADMIN callers get 403', async (t) => {
  const employee = await registerEmployee();
  const target = await registerEmployee();
  t.after(() => deleteUser(target.id));
  t.after(() => deleteUser(employee.id));

  const postRes = await postDeptAuthority(employee.token);
  assert.equal(postRes.status, 403);
  assert.equal(postRes.body.message, 'Bu işlem için yetkiniz yok');

  const patchRes = await request(app)
    .patch(`/api/users/${target.id}/deactivate`)
    .set('Authorization', `Bearer ${itAuthorityToken}`)
    .send();
  assert.equal(patchRes.status, 403);
  assert.equal(patchRes.body.message, 'Bu işlem için yetkiniz yok');

  const row = await pool.query('SELECT is_active FROM users WHERE id = $1', [target.id]);
  assert.equal(row.rows[0].is_active, true, 'a forbidden PATCH must not deactivate the target');
});

// AC8: validation edge cases each return 4xx with a clear message and create
// no row.
test('POST /api/users - duplicate email returns 409 and creates no additional row', async (t) => {
  const first = await postDeptAuthority(adminToken);
  assert.equal(first.status, 201, JSON.stringify(first.body));
  t.after(() => deleteUser(first.body.id));

  const dupe = await postDeptAuthority(adminToken, { email: first.body.email });
  assert.equal(dupe.status, 409, JSON.stringify(dupe.body));
  assert.equal(dupe.body.message, 'Bu email zaten kayıtlı');

  const count = await pool.query('SELECT COUNT(*)::int AS n FROM users WHERE email = $1', [first.body.email]);
  assert.equal(count.rows[0].n, 1, 'no second row may be created for the same email');
});

test('POST /api/users - wrong email domain returns 400 and creates no row', async () => {
  const email = `test-${randomUUID()}@not-the-allowed-domain.example`;
  const res = await postDeptAuthority(adminToken, { email });

  assert.equal(res.status, 400, JSON.stringify(res.body));
  assert.equal(res.body.message, 'Bu email domaini ile kullanıcı oluşturulamaz');

  const check = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  assert.equal(check.rows.length, 0);
});

test('POST /api/users - password under 8 chars returns 400 and creates no row', async () => {
  const email = validEmail();
  const res = await postDeptAuthority(adminToken, { email, password: 'short1' });

  assert.equal(res.status, 400, JSON.stringify(res.body));
  assert.equal(res.body.message, 'Şifre en az 8 karakter olmalı');

  const check = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  assert.equal(check.rows.length, 0);
});

test('POST /api/users - missing department_id returns 400 and creates no row', async () => {
  const email = validEmail();
  const res = await request(app)
    .post('/api/users')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: 'No', surname: 'Department', email, password: 'sifre1234' });

  assert.equal(res.status, 400, JSON.stringify(res.body));
  assert.equal(res.body.message, 'Departman seçilmeli');

  const check = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  assert.equal(check.rows.length, 0);
});

test('POST /api/users - nonexistent department_id returns 400 and creates no row', async () => {
  const email = validEmail();
  const res = await postDeptAuthority(adminToken, { email, department_id: randomUUID() });

  assert.equal(res.status, 400, JSON.stringify(res.body));
  assert.equal(res.body.message, 'Geçersiz departman');

  const check = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  assert.equal(check.rows.length, 0);
});

test('POST /api/users - inactive department_id returns 400 and creates no row', async (t) => {
  const inactiveDept = await pool.query(
    `INSERT INTO departments (name, is_active) VALUES ($1, false) RETURNING id`,
    [`Throwaway Inactive Dept ${randomUUID()}`]
  );
  const inactiveDeptId = inactiveDept.rows[0].id;
  t.after(async () => {
    await pool.query('DELETE FROM departments WHERE id = $1', [inactiveDeptId]);
  });

  const email = validEmail();
  const res = await postDeptAuthority(adminToken, { email, department_id: inactiveDeptId });

  assert.equal(res.status, 400, JSON.stringify(res.body));
  assert.equal(res.body.message, 'Geçersiz departman');

  const check = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  assert.equal(check.rows.length, 0);
});

test('POST /api/users - missing name returns 400 and creates no row', async () => {
  const email = validEmail();
  const deptRes = await pool.query('SELECT id FROM departments WHERE is_active = true LIMIT 1');
  const res = await request(app)
    .post('/api/users')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ surname: 'NoName', email, password: 'sifre1234', department_id: deptRes.rows[0].id });

  assert.equal(res.status, 400, JSON.stringify(res.body));
  assert.equal(res.body.message, NAME_ERROR);

  const check = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  assert.equal(check.rows.length, 0);
});

// ---------------------------------------------------------------------------
// PATCH /api/users/me/department — the forced "Departmanınızı Seçin" completion
// step for accounts created without a department (Google OAuth still inserts
// department_id = NULL).
// ---------------------------------------------------------------------------

// Creates an EMPLOYEE with department_id = NULL, mirroring what
// services/auth.service.js#loginWithGoogle inserts for a first-time Google
// user, and logs it in so the PATCH can be exercised over HTTP. Inserted via
// SQL because no API path can create a departmentless EMPLOYEE any more.
async function createDepartmentlessEmployee() {
  const pwRow = await pool.query("SELECT password_hash FROM users WHERE email = 'it.authority@opspulse.com'");
  const email = validEmail();
  const insert = await pool.query(
    `INSERT INTO users (name, surname, email, password_hash, google_id, role)
     VALUES ($1, $2, $3, $4, $5, 'EMPLOYEE') RETURNING id, department_id`,
    ['Google', 'Employee', email, pwRow.rows[0].password_hash, `google-sub-${randomUUID()}`]
  );
  assert.equal(insert.rows[0].department_id, null, 'fixture must start with no department');

  const login = await request(app).post('/api/auth/login').send({ email, password: 'sifre1234' });
  assert.equal(login.status, 200, `departmentless employee login failed: ${JSON.stringify(login.body)}`);
  return { id: insert.rows[0].id, email, token: login.body.token };
}

async function activeDepartment() {
  const res = await pool.query('SELECT id, name FROM departments WHERE is_active = true ORDER BY name ASC LIMIT 1');
  assert.ok(res.rows[0], 'no active department found - run `npm run seed` first');
  return res.rows[0];
}

// AC4: choosing a valid department on the completion screen saves it and hands
// back the normal profile shape, so the frontend can put the user back into the
// regular app flow.
test('PATCH /api/users/me/department - a valid active department is saved and the profile is returned', async (t) => {
  const employee = await createDepartmentlessEmployee();
  t.after(() => deleteUser(employee.id));
  const department = await activeDepartment();

  const res = await request(app)
    .patch('/api/users/me/department')
    .set('Authorization', `Bearer ${employee.token}`)
    .send({ department_id: department.id });

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(sortedKeys(res.body), PROFILE_KEYS);
  assert.equal(res.body.id, employee.id);
  assert.equal(res.body.role, 'EMPLOYEE');
  assert.equal(res.body.department_id, department.id);
  assert.equal(res.body.department_name, department.name);
  assert.equal(res.body.password_hash, undefined);

  // Really persisted, not just projected.
  const row = await readUserRow(employee.id);
  assert.equal(row.department_id, department.id);
  assert.equal(row.role, 'EMPLOYEE', 'completing a department must never change the role');
});

// AC4 / AC5: the endpoint sits behind authMiddleware - no token, no completion.
test('PATCH /api/users/me/department - requires authentication (401 without a token)', async () => {
  const department = await activeDepartment();

  const noHeader = await request(app)
    .patch('/api/users/me/department')
    .send({ department_id: department.id });
  assert.equal(noHeader.status, 401, JSON.stringify(noHeader.body));

  const badScheme = await request(app)
    .patch('/api/users/me/department')
    .set('Authorization', 'Basic not-a-bearer-token')
    .send({ department_id: department.id });
  assert.equal(badScheme.status, 401, JSON.stringify(badScheme.body));

  const garbageToken = await request(app)
    .patch('/api/users/me/department')
    .set('Authorization', 'Bearer not-a-real-jwt')
    .send({ department_id: department.id });
  assert.equal(garbageToken.status, 401, JSON.stringify(garbageToken.body));
});

// Security boundary: completeDepartment() always writes WHERE id = user.id from
// the token. A body carrying another user's id must not touch that user.
test('PATCH /api/users/me/department - only ever updates the caller own row, never a body-supplied id', async (t) => {
  const attacker = await createDepartmentlessEmployee();
  const victim = await createDepartmentlessEmployee();
  t.after(() => deleteUser(victim.id));
  t.after(() => deleteUser(attacker.id));

  const victimBefore = await readUserRow(victim.id);
  const department = await activeDepartment();

  const res = await request(app)
    .patch('/api/users/me/department')
    .set('Authorization', `Bearer ${attacker.token}`)
    .send({ department_id: department.id, id: victim.id, user_id: victim.id });

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.id, attacker.id);

  const attackerAfter = await readUserRow(attacker.id);
  assert.equal(attackerAfter.department_id, department.id);

  const victimAfter = await readUserRow(victim.id);
  assert.deepEqual(victimAfter, victimBefore, "the victim's row must be completely untouched");
  assert.equal(victimAfter.department_id, null);
});

// AC6 / edge case: missing department_id -> the exact controlled 400, never a 500.
test('PATCH /api/users/me/department - missing department_id returns 400 and writes nothing', async (t) => {
  const employee = await createDepartmentlessEmployee();
  t.after(() => deleteUser(employee.id));

  const invalidBodies = [{}, { department_id: '' }, { department_id: null }];

  for (const body of invalidBodies) {
    // eslint-disable-next-line no-await-in-loop
    const res = await request(app)
      .patch('/api/users/me/department')
      .set('Authorization', `Bearer ${employee.token}`)
      .send(body);

    assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(body)}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.status, 'error');
    assert.equal(res.body.message, 'Departman seçilmeli');

    // eslint-disable-next-line no-await-in-loop
    const row = await readUserRow(employee.id);
    assert.equal(row.department_id, null, 'a rejected completion must not write anything');
  }
});

// Edge case: well-formed but unknown UUID -> 400, not 500, and nothing written.
test('PATCH /api/users/me/department - nonexistent department_id returns 400 and writes nothing', async (t) => {
  const employee = await createDepartmentlessEmployee();
  t.after(() => deleteUser(employee.id));

  const res = await request(app)
    .patch('/api/users/me/department')
    .set('Authorization', `Bearer ${employee.token}`)
    .send({ department_id: randomUUID() });

  assert.equal(res.status, 400, JSON.stringify(res.body));
  assert.equal(res.body.message, 'Geçersiz departman');

  const row = await readUserRow(employee.id);
  assert.equal(row.department_id, null);
});

// AC6 / edge case: an inactive department is not selectable - the completion
// screen only ever lists active ones, and the backend independently enforces it.
test('PATCH /api/users/me/department - inactive department_id returns 400 and writes nothing', async (t) => {
  const employee = await createDepartmentlessEmployee();
  const inactiveDept = await pool.query(
    `INSERT INTO departments (name, is_active) VALUES ($1, false) RETURNING id`,
    [`Throwaway Inactive Dept ${randomUUID()}`]
  );
  const inactiveDeptId = inactiveDept.rows[0].id;
  t.after(async () => {
    await pool.query('DELETE FROM departments WHERE id = $1', [inactiveDeptId]);
  });
  t.after(() => deleteUser(employee.id));

  const res = await request(app)
    .patch('/api/users/me/department')
    .set('Authorization', `Bearer ${employee.token}`)
    .send({ department_id: inactiveDeptId });

  assert.equal(res.status, 400, JSON.stringify(res.body));
  assert.equal(res.body.message, 'Geçersiz departman');

  const row = await readUserRow(employee.id);
  assert.equal(row.department_id, null);
});

// AC6 / edge case: a malformed non-UUID must be caught as Postgres error 22P02
// and translated to a clean 400 - a raw invalid-input-syntax 500 is a bug.
test('PATCH /api/users/me/department - malformed non-UUID department_id returns 400, never 500', async (t) => {
  const employee = await createDepartmentlessEmployee();
  t.after(() => deleteUser(employee.id));

  for (const malformed of ['abc', 'not-a-uuid', '123', "' OR 1=1 --"]) {
    // eslint-disable-next-line no-await-in-loop
    const res = await request(app)
      .patch('/api/users/me/department')
      .set('Authorization', `Bearer ${employee.token}`)
      .send({ department_id: malformed });

    assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(malformed)}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.message, 'Geçersiz departman');

    // eslint-disable-next-line no-await-in-loop
    const row = await readUserRow(employee.id);
    assert.equal(row.department_id, null);
  }
});

// AC5: a user who already has a department can still call the endpoint (it is
// not the security boundary), but the completion screen is never forced on them -
// that is ProtectedRoute's job. What matters here is that the role/scope of an
// already-complete user is untouched by the call.
test('PATCH /api/users/me/department - an already-complete EMPLOYEE can change department without a role change', async (t) => {
  const employee = await registerEmployee();
  t.after(() => deleteUser(employee.id));

  const other = await pool.query(
    'SELECT id, name FROM departments WHERE is_active = true AND id <> $1 ORDER BY name ASC LIMIT 1',
    [employee.department_id]
  );
  assert.ok(other.rows[0], 'need a second active department - run `npm run seed` first');

  const res = await request(app)
    .patch('/api/users/me/department')
    .set('Authorization', `Bearer ${employee.token}`)
    .send({ department_id: other.rows[0].id });

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.department_id, other.rows[0].id);
  assert.equal(res.body.department_name, other.rows[0].name);
  assert.equal(res.body.role, 'EMPLOYEE');

  const row = await readUserRow(employee.id);
  assert.equal(row.role, 'EMPLOYEE');
  assert.equal(row.department_id, other.rows[0].id);
});

// Security: department_id is functional authorization scope for a
// DEPARTMENT_AUTHORITY (it drives claim-eligibility), not self-service
// metadata like it is for EMPLOYEE. Only ADMIN's user-management screen may
// set it. Reuses the module-scoped itAuthorityToken (never logs in again -
// see test.before's rate-limit note).
test('PATCH /api/users/me/department - a DEPARTMENT_AUTHORITY cannot change their own department', async () => {
  const department = await activeDepartment();

  const before = await pool.query("SELECT department_id FROM users WHERE email = 'it.authority@opspulse.com'");

  const res = await request(app)
    .patch('/api/users/me/department')
    .set('Authorization', `Bearer ${itAuthorityToken}`)
    .send({ department_id: department.id });

  assert.equal(res.status, 403, JSON.stringify(res.body));
  assert.equal(res.body.message, 'Bu işlem için yetkiniz yok');

  const after = await pool.query("SELECT department_id FROM users WHERE email = 'it.authority@opspulse.com'");
  assert.equal(after.rows[0].department_id, before.rows[0].department_id);
});

// ---------------------------------------------------------------------------
// GET /api/users/team — DEPARTMENT_AUTHORITY's own-department EMPLOYEE list
// (artifacts/department-team-view/atdd.md)
// ---------------------------------------------------------------------------

// Resolves a user's department_id directly from the DB rather than hardcoding
// a department name/id, so fixtures below always target IT/HR's *real* ids.
async function departmentIdOf(email) {
  const res = await pool.query('SELECT department_id FROM users WHERE email = $1', [email]);
  assert.ok(res.rows[0] && res.rows[0].department_id, `no department_id found for ${email}`);
  return res.rows[0].department_id;
}

// Creates a throwaway EMPLOYEE directly in a specific department via raw SQL -
// needed because registerEmployee() always lands in the alphabetically-first
// active department, not necessarily IT/HR. Mirrors createDepartmentlessEmployee's
// raw-SQL fixture style above; password_hash is borrowed from the seeded IT
// authority purely to satisfy the password_hash-or-google_id CHECK constraint -
// these rows are never logged into.
async function createEmployeeInDepartment(departmentId, { isActive = true } = {}) {
  const pwRow = await pool.query("SELECT password_hash FROM users WHERE email = 'it.authority@opspulse.com'");
  const email = validEmail();
  const insert = await pool.query(
    `INSERT INTO users (name, surname, email, password_hash, role, department_id, is_active)
     VALUES ($1, $2, $3, $4, 'EMPLOYEE', $5, $6)
     RETURNING id, name, surname, email, is_active, department_id`,
    ['Team', 'Member', email, pwRow.rows[0].password_hash, departmentId, isActive]
  );
  return insert.rows[0];
}

// AC1: happy path - a DEPARTMENT_AUTHORITY sees an EMPLOYEE from their own
// department, and no row anywhere in the response ever exposes
// password_hash/google_id.
test('GET /api/users/team - DEPARTMENT_AUTHORITY sees an EMPLOYEE from their own department', async (t) => {
  const itDepartmentId = await departmentIdOf('it.authority@opspulse.com');
  const employee = await createEmployeeInDepartment(itDepartmentId);
  t.after(() => deleteUser(employee.id));

  const res = await request(app)
    .get('/api/users/team')
    .set('Authorization', `Bearer ${itAuthorityToken}`);

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.ok(Array.isArray(res.body));

  const row = res.body.find((u) => u.id === employee.id);
  assert.ok(row, 'the IT employee fixture must appear in the IT authority team list');
  assert.equal(row.name, employee.name);
  assert.equal(row.surname, employee.surname);
  assert.equal(row.email, employee.email);
  assert.equal(row.is_active, true);

  for (const teamRow of res.body) {
    assert.equal(teamRow.password_hash, undefined, 'password_hash must never appear in the team list');
    assert.equal(teamRow.google_id, undefined, 'google_id must never appear in the team list');
  }
});

// AC2 (the important one): cross-department isolation - each authority's list
// contains only their own department's fixture employee, never the other's.
test('GET /api/users/team - cross-department isolation: IT and HR lists never leak into each other', async (t) => {
  const itDepartmentId = await departmentIdOf('it.authority@opspulse.com');
  const hrDepartmentId = await departmentIdOf('hr.authority@opspulse.com');
  assert.notEqual(itDepartmentId, hrDepartmentId, 'fixture sanity: IT and HR must be different departments');

  const itEmployee = await createEmployeeInDepartment(itDepartmentId);
  const hrEmployee = await createEmployeeInDepartment(hrDepartmentId);
  t.after(() => deleteUser(hrEmployee.id));
  t.after(() => deleteUser(itEmployee.id));

  const itRes = await request(app)
    .get('/api/users/team')
    .set('Authorization', `Bearer ${itAuthorityToken}`);
  assert.equal(itRes.status, 200, JSON.stringify(itRes.body));
  assert.ok(
    itRes.body.some((u) => u.id === itEmployee.id),
    'IT authority must see the IT employee'
  );
  assert.ok(
    !itRes.body.some((u) => u.id === hrEmployee.id),
    'IT authority must never see the HR employee'
  );

  const hrRes = await request(app)
    .get('/api/users/team')
    .set('Authorization', `Bearer ${hrAuthorityToken}`);
  assert.equal(hrRes.status, 200, JSON.stringify(hrRes.body));
  assert.ok(
    hrRes.body.some((u) => u.id === hrEmployee.id),
    'HR authority must see the HR employee'
  );
  assert.ok(
    !hrRes.body.some((u) => u.id === itEmployee.id),
    'HR authority must never see the IT employee'
  );
});

// AC2: a client-supplied department_id query param has zero effect - the
// endpoint is scoped exclusively by the authenticated caller's own
// department_id, never by request input.
test('GET /api/users/team - a department_id query parameter is ignored, scope stays the caller own department', async (t) => {
  const itDepartmentId = await departmentIdOf('it.authority@opspulse.com');
  const hrDepartmentId = await departmentIdOf('hr.authority@opspulse.com');
  const hrEmployee = await createEmployeeInDepartment(hrDepartmentId);
  t.after(() => deleteUser(hrEmployee.id));

  const res = await request(app)
    .get('/api/users/team')
    .query({ department_id: hrDepartmentId })
    .set('Authorization', `Bearer ${itAuthorityToken}`);

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.ok(
    !res.body.some((u) => u.id === hrEmployee.id),
    'a department_id query param must never widen/redirect the scope to another department'
  );

  // Every returned row genuinely belongs to IT, independently proving the
  // param had no effect (not just that this one HR fixture was absent).
  const rowIds = res.body.map((u) => u.id);
  if (rowIds.length > 0) {
    const dbCheck = await pool.query('SELECT id FROM users WHERE id = ANY($1) AND department_id = $2', [
      rowIds,
      itDepartmentId,
    ]);
    assert.equal(dbCheck.rows.length, rowIds.length, 'every returned row must really belong to IT');
  }
});

// AC3: EMPLOYEE is forbidden - this endpoint is DEPARTMENT_AUTHORITY-only.
test('GET /api/users/team - EMPLOYEE is forbidden (403)', async (t) => {
  const employee = await registerEmployee();
  t.after(() => deleteUser(employee.id));

  const res = await request(app)
    .get('/api/users/team')
    .set('Authorization', `Bearer ${employee.token}`);

  assert.equal(res.status, 403, JSON.stringify(res.body));
  assert.equal(res.body.message, 'Bu işlem için yetkiniz yok');
});

// AC3: ADMIN is forbidden too - ADMIN already has GET /api/users for a
// system-wide view; this endpoint has no department of its own to scope by.
test('GET /api/users/team - ADMIN is forbidden (403)', async () => {
  const res = await request(app)
    .get('/api/users/team')
    .set('Authorization', `Bearer ${adminToken}`);

  assert.equal(res.status, 403, JSON.stringify(res.body));
  assert.equal(res.body.message, 'Bu işlem için yetkiniz yok');
});

// No token -> 401, matching this file's existing convention for other
// /api/users routes sitting behind authMiddleware.
test('GET /api/users/team - missing token returns 401', async () => {
  const res = await request(app).get('/api/users/team');
  assert.equal(res.status, 401, JSON.stringify(res.body));
});

// AC5: an inactive EMPLOYEE stays in the list, tagged is_active: false - never
// silently filtered out.
test('GET /api/users/team - an inactive EMPLOYEE is included, not filtered out', async (t) => {
  const itDepartmentId = await departmentIdOf('it.authority@opspulse.com');
  const inactiveEmployee = await createEmployeeInDepartment(itDepartmentId, { isActive: false });
  t.after(() => deleteUser(inactiveEmployee.id));

  const res = await request(app)
    .get('/api/users/team')
    .set('Authorization', `Bearer ${itAuthorityToken}`);

  assert.equal(res.status, 200, JSON.stringify(res.body));
  const row = res.body.find((u) => u.id === inactiveEmployee.id);
  assert.ok(row, 'an inactive employee must still be present in the team list');
  assert.equal(row.is_active, false);
});

// AC1 corollary: only role EMPLOYEE is listed - a DEPARTMENT_AUTHORITY (even
// the caller themself) never appears in their own team list.
test('GET /api/users/team - the calling DEPARTMENT_AUTHORITY own row never appears in the list', async () => {
  const itAuthorityRow = await pool.query("SELECT id FROM users WHERE email = 'it.authority@opspulse.com'");
  const itAuthorityId = itAuthorityRow.rows[0].id;

  const res = await request(app)
    .get('/api/users/team')
    .set('Authorization', `Bearer ${itAuthorityToken}`);

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.ok(
    !res.body.some((u) => u.id === itAuthorityId),
    'a DEPARTMENT_AUTHORITY must never see their own row (or any other non-EMPLOYEE role) in the team list'
  );
});
