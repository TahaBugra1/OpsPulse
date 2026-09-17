const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const request = require('supertest');

const app = require('../server');
const pool = require('../services/db');

const ALLOWED_DOMAIN = process.env.ALLOWED_EMAIL_DOMAIN;

function validEmail() {
  return `test-${randomUUID()}@${ALLOWED_DOMAIN}`;
}

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

let itAuthorityToken;
let adminId;
let adminToken;

test.before(async () => {
  const itLogin = await request(app)
    .post('/api/auth/login')
    .send({ email: 'it.authority@opspulse.com', password: 'sifre1234' });
  assert.equal(itLogin.status, 200, `IT authority login failed: ${JSON.stringify(itLogin.body)}`);
  itAuthorityToken = itLogin.body.token;

  // Throwaway ADMIN, created directly via SQL (no API path can create one),
  // reusing the seeded IT authority's password_hash so the plaintext password
  // 'sifre1234' still works for login. Same pattern as departments.routes.test.js.
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

// AC7 (backend security): no Authorization header -> 401
test('GET /api/request-types - no Authorization header returns 401', async () => {
  const res = await request(app).get('/api/request-types');
  assert.equal(res.status, 401);
});

// AC8: any authenticated role (here: a throwaway EMPLOYEE, no role restriction) -> 200,
// array of {id, name, department_id} objects
test('GET /api/request-types - authenticated EMPLOYEE gets 200 with an array of active request types', async (t) => {
  const employee = await registerEmployee();
  t.after(async () => {
    await deleteUser(employee.id);
  });

  const res = await request(app)
    .get('/api/request-types')
    .set('Authorization', `Bearer ${employee.token}`);

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.ok(Array.isArray(res.body));
  assert.ok(res.body.length > 0);
  for (const rt of res.body) {
    assert.equal(typeof rt.id, 'string');
    assert.equal(typeof rt.name, 'string');
    assert.equal(typeof rt.department_id, 'string');
  }
});

// AC8: works equally for a DEPARTMENT_AUTHORITY token (no role check on this endpoint)
test('GET /api/request-types - authenticated DEPARTMENT_AUTHORITY also gets 200', async () => {
  const res = await request(app)
    .get('/api/request-types')
    .set('Authorization', `Bearer ${itAuthorityToken}`);

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.ok(Array.isArray(res.body));
});

// AC2: an is_active = false request type does NOT appear in the response
test('GET /api/request-types - an inactive request type is excluded from the response', async (t) => {
  const dept = await pool.query('SELECT id FROM departments LIMIT 1');
  const insertResult = await pool.query(
    `INSERT INTO request_types (name, department_id, is_active)
     VALUES ($1, $2, false)
     RETURNING id`,
    [`Throwaway Inactive Type ${randomUUID()}`, dept.rows[0].id],
  );
  const inactiveTypeId = insertResult.rows[0].id;
  t.after(async () => {
    await pool.query('DELETE FROM request_types WHERE id = $1', [inactiveTypeId]);
  });

  const res = await request(app)
    .get('/api/request-types')
    .set('Authorization', `Bearer ${itAuthorityToken}`);

  assert.equal(res.status, 200, JSON.stringify(res.body));
  const ids = res.body.map((rt) => rt.id);
  assert.ok(!ids.includes(inactiveTypeId));
});

// Nice-to-have: response is ordered by name ASC
test('GET /api/request-types - results are ordered by name ascending', async () => {
  const res = await request(app)
    .get('/api/request-types')
    .set('Authorization', `Bearer ${itAuthorityToken}`);

  assert.equal(res.status, 200, JSON.stringify(res.body));
  const names = res.body.map((rt) => rt.name);
  const sorted = [...names].sort((a, b) => a.localeCompare(b));
  assert.deepEqual(names, sorted);
});

// ---------------------------------------------------------------------------
// GET /api/request-types/all (ADMIN-only, includes is_active + inactive rows)
// ---------------------------------------------------------------------------

// AC12 (contrast case): unlike plain GET /, the /all listing DOES include an
// inactive request type, and each item carries is_active.
test('GET /api/request-types/all - ADMIN gets 200 with {id, name, department_id, is_active}, including inactive rows', async (t) => {
  const dept = await pool.query('SELECT id FROM departments LIMIT 1');
  const insertResult = await pool.query(
    `INSERT INTO request_types (name, department_id, is_active) VALUES ($1, $2, false) RETURNING id`,
    [`Throwaway All-Listing Inactive Type ${randomUUID()}`, dept.rows[0].id],
  );
  const inactiveTypeId = insertResult.rows[0].id;
  t.after(async () => {
    await pool.query('DELETE FROM request_types WHERE id = $1', [inactiveTypeId]);
  });

  const res = await request(app)
    .get('/api/request-types/all')
    .set('Authorization', `Bearer ${adminToken}`);

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.ok(Array.isArray(res.body));
  assert.ok(res.body.length > 0);

  for (const rt of res.body) {
    assert.deepEqual(Object.keys(rt).sort(), ['department_id', 'id', 'is_active', 'name']);
  }

  const inactiveInResponse = res.body.find((rt) => rt.id === inactiveTypeId);
  assert.ok(inactiveInResponse, 'an inactive request type must appear in /all');
  assert.equal(inactiveInResponse.is_active, false);
});

// AC3: EMPLOYEE and DEPARTMENT_AUTHORITY -> both 403.
test('GET /api/request-types/all - EMPLOYEE and DEPARTMENT_AUTHORITY are both forbidden (403)', async (t) => {
  const employee = await registerEmployee();
  t.after(() => deleteUser(employee.id));

  const employeeRes = await request(app)
    .get('/api/request-types/all')
    .set('Authorization', `Bearer ${employee.token}`);
  assert.equal(employeeRes.status, 403);
  assert.equal(employeeRes.body.message, 'Bu işlem için yetkiniz yok');

  const authorityRes = await request(app)
    .get('/api/request-types/all')
    .set('Authorization', `Bearer ${itAuthorityToken}`);
  assert.equal(authorityRes.status, 403);
  assert.equal(authorityRes.body.message, 'Bu işlem için yetkiniz yok');
});

// ---------------------------------------------------------------------------
// POST /api/request-types (AC2, AC3, AC10, AC11, and the 150-char edge)
// ---------------------------------------------------------------------------

// AC2: ADMIN creates a request type with name+department_id -> 201,
// is_active=true, and it appears in the (unchanged) GET /api/request-types.
test('POST /api/request-types - ADMIN with a unique name + valid department_id gets 201 and appears in GET /', async (t) => {
  const dept = await pool.query('SELECT id FROM departments WHERE is_active = true LIMIT 1');
  assert.ok(dept.rows[0], 'no active department found - run `npm run seed` first');

  const name = `Throwaway Type ${randomUUID()}`;
  const res = await request(app)
    .post('/api/request-types')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name, department_id: dept.rows[0].id });

  assert.equal(res.status, 201, JSON.stringify(res.body));
  t.after(async () => {
    await pool.query('DELETE FROM request_types WHERE id = $1', [res.body.id]);
  });

  assert.equal(res.body.name, name);
  assert.equal(res.body.department_id, dept.rows[0].id);
  assert.equal(res.body.is_active, true);

  const listRes = await request(app)
    .get('/api/request-types')
    .set('Authorization', `Bearer ${itAuthorityToken}`);
  assert.equal(listRes.status, 200);
  assert.ok(listRes.body.some((rt) => rt.id === res.body.id), 'the new active request type must appear in GET /');
});

// AC3: non-ADMIN -> 403.
test('POST /api/request-types - EMPLOYEE and DEPARTMENT_AUTHORITY are both forbidden (403)', async (t) => {
  const employee = await registerEmployee();
  t.after(() => deleteUser(employee.id));
  const dept = await pool.query('SELECT id FROM departments LIMIT 1');

  const employeeRes = await request(app)
    .post('/api/request-types')
    .set('Authorization', `Bearer ${employee.token}`)
    .send({ name: `Should Not Be Created ${randomUUID()}`, department_id: dept.rows[0].id });
  assert.equal(employeeRes.status, 403);
  assert.equal(employeeRes.body.message, 'Bu işlem için yetkiniz yok');

  const authorityRes = await request(app)
    .post('/api/request-types')
    .set('Authorization', `Bearer ${itAuthorityToken}`)
    .send({ name: `Should Not Be Created ${randomUUID()}`, department_id: dept.rows[0].id });
  assert.equal(authorityRes.status, 403);
  assert.equal(authorityRes.body.message, 'Bu işlem için yetkiniz yok');
});

// AC10: duplicate name -> clean 409.
test('POST /api/request-types - duplicate name gets a clean 409', async () => {
  const existing = await pool.query('SELECT name, department_id FROM request_types LIMIT 1');
  assert.ok(existing.rows[0], 'no request type found - run `npm run seed` first');

  const res = await request(app)
    .post('/api/request-types')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: existing.rows[0].name, department_id: existing.rows[0].department_id });

  assert.equal(res.status, 409, JSON.stringify(res.body));
  assert.equal(res.body.message, 'Bu isim zaten kullanılıyor');
});

// AC11: nonexistent department_id -> clean 400 "Geçersiz departman".
test('POST /api/request-types - nonexistent department_id gets a clean 400 "Geçersiz departman"', async () => {
  const res = await request(app)
    .post('/api/request-types')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: `Orphan Type ${randomUUID()}`, department_id: randomUUID() });

  assert.equal(res.status, 400, JSON.stringify(res.body));
  assert.equal(res.body.message, 'Geçersiz departman');
});

// Missing department_id -> clean 400.
test('POST /api/request-types - missing department_id gets a clean 400', async () => {
  const res = await request(app)
    .post('/api/request-types')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: `No Department ${randomUUID()}` });

  assert.equal(res.status, 400, JSON.stringify(res.body));
});

// Name length boundary: over 150 chars -> clean 400.
test('POST /api/request-types - name over 150 chars gets a clean 400', async () => {
  const dept = await pool.query('SELECT id FROM departments LIMIT 1');
  const res = await request(app)
    .post('/api/request-types')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: 'a'.repeat(151), department_id: dept.rows[0].id });

  assert.equal(res.status, 400, JSON.stringify(res.body));
});

// ---------------------------------------------------------------------------
// PATCH /api/request-types/:id (AC5)
// ---------------------------------------------------------------------------

// AC5: ADMIN renames and reassigns department on a throwaway row -> 200.
test('PATCH /api/request-types/:id - ADMIN renames and reassigns department -> 200', async (t) => {
  const depts = await pool.query('SELECT id FROM departments WHERE is_active = true ORDER BY name ASC LIMIT 2');
  assert.ok(depts.rows.length >= 2, 'need at least 2 active departments - run `npm run seed` first');

  const created = await pool.query(
    'INSERT INTO request_types (name, department_id) VALUES ($1, $2) RETURNING id',
    [`Throwaway Rename Source Type ${randomUUID()}`, depts.rows[0].id]
  );
  const typeId = created.rows[0].id;
  t.after(async () => {
    await pool.query('DELETE FROM request_types WHERE id = $1', [typeId]);
  });

  const newName = `Renamed Type ${randomUUID()}`;
  const res = await request(app)
    .patch(`/api/request-types/${typeId}`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: newName, department_id: depts.rows[1].id });

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.name, newName);
  assert.equal(res.body.department_id, depts.rows[1].id);
});

// Nonexistent id -> 404.
test('PATCH /api/request-types/:id - nonexistent id gets 404', async () => {
  const dept = await pool.query('SELECT id FROM departments LIMIT 1');
  const res = await request(app)
    .patch(`/api/request-types/${randomUUID()}`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: `Ghost Type ${randomUUID()}`, department_id: dept.rows[0].id });

  assert.equal(res.status, 404, JSON.stringify(res.body));
});

// Non-ADMIN -> 403.
test('PATCH /api/request-types/:id - non-ADMIN gets 403', async (t) => {
  const employee = await registerEmployee();
  t.after(() => deleteUser(employee.id));
  const dept = await pool.query('SELECT id FROM departments LIMIT 1');

  const res = await request(app)
    .patch(`/api/request-types/${randomUUID()}`)
    .set('Authorization', `Bearer ${employee.token}`)
    .send({ name: `Irrelevant ${randomUUID()}`, department_id: dept.rows[0].id });

  assert.equal(res.status, 403);
  assert.equal(res.body.message, 'Bu işlem için yetkiniz yok');
});

// ---------------------------------------------------------------------------
// PATCH /api/request-types/:id/deactivate and /activate (AC7, AC8, AC9)
// ---------------------------------------------------------------------------

// AC7: deactivating one request type changes only that row — a sibling
// request type in the SAME department stays active (no cross-row effect).
test('PATCH /api/request-types/:id/deactivate - deactivates only that row, a sibling in the same department stays active', async (t) => {
  const dept = await pool.query('SELECT id FROM departments WHERE is_active = true LIMIT 1');
  const target = await pool.query(
    'INSERT INTO request_types (name, department_id) VALUES ($1, $2) RETURNING id',
    [`Throwaway Deactivate Target ${randomUUID()}`, dept.rows[0].id]
  );
  const sibling = await pool.query(
    'INSERT INTO request_types (name, department_id) VALUES ($1, $2) RETURNING id',
    [`Throwaway Deactivate Sibling ${randomUUID()}`, dept.rows[0].id]
  );
  const targetId = target.rows[0].id;
  const siblingId = sibling.rows[0].id;
  t.after(async () => {
    await pool.query('DELETE FROM request_types WHERE id = $1', [targetId]);
    await pool.query('DELETE FROM request_types WHERE id = $1', [siblingId]);
  });

  const res = await request(app)
    .patch(`/api/request-types/${targetId}/deactivate`)
    .set('Authorization', `Bearer ${adminToken}`);

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.is_active, false);

  const siblingRow = await pool.query('SELECT is_active FROM request_types WHERE id = $1', [siblingId]);
  assert.equal(siblingRow.rows[0].is_active, true, 'the sibling request type must be unaffected');
});

// AC9: deactivating a request type with an in-flight (OPEN) request under it still succeeds.
test('PATCH /api/request-types/:id/deactivate - succeeds even with an in-flight (OPEN) request under it', async (t) => {
  const dept = await pool.query('SELECT id FROM departments WHERE is_active = true LIMIT 1');
  const typeRes = await pool.query(
    'INSERT INTO request_types (name, department_id) VALUES ($1, $2) RETURNING id',
    [`Throwaway InFlight Type Solo ${randomUUID()}`, dept.rows[0].id]
  );
  const typeId = typeRes.rows[0].id;
  const employee = await registerEmployee();
  const openRequest = await pool.query(
    `INSERT INTO requests (title, description, request_type_id, department_id, created_by, priority, status, sla_due_at)
     VALUES ($1, $2, $3, $4, $5, 'MEDIUM', 'OPEN', now() + interval '24 hours')
     RETURNING id`,
    ['Throwaway open request', 'in-flight while request type is deactivated', typeId, dept.rows[0].id, employee.id]
  );
  const requestId = openRequest.rows[0].id;

  t.after(async () => {
    await pool.query('DELETE FROM requests WHERE id = $1', [requestId]);
    await deleteUser(employee.id);
    await pool.query('DELETE FROM request_types WHERE id = $1', [typeId]);
  });

  const res = await request(app)
    .patch(`/api/request-types/${typeId}/deactivate`)
    .set('Authorization', `Bearer ${adminToken}`);

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.is_active, false);
});

// Non-ADMIN -> 403.
test('PATCH /api/request-types/:id/deactivate - non-ADMIN gets 403', async (t) => {
  const employee = await registerEmployee();
  t.after(() => deleteUser(employee.id));

  const res = await request(app)
    .patch(`/api/request-types/${randomUUID()}/deactivate`)
    .set('Authorization', `Bearer ${employee.token}`);

  assert.equal(res.status, 403);
  assert.equal(res.body.message, 'Bu işlem için yetkiniz yok');
});

// Nonexistent id -> 404.
test('PATCH /api/request-types/:id/deactivate - nonexistent id gets 404', async () => {
  const res = await request(app)
    .patch(`/api/request-types/${randomUUID()}/deactivate`)
    .set('Authorization', `Bearer ${adminToken}`);

  assert.equal(res.status, 404, JSON.stringify(res.body));
});

// AC8: activating a request type -> is_active=true.
test('PATCH /api/request-types/:id/activate - reactivates a deactivated request type', async (t) => {
  const dept = await pool.query('SELECT id FROM departments WHERE is_active = true LIMIT 1');
  const typeRes = await pool.query(
    'INSERT INTO request_types (name, department_id, is_active) VALUES ($1, $2, false) RETURNING id',
    [`Throwaway Reactivate Type Solo ${randomUUID()}`, dept.rows[0].id]
  );
  const typeId = typeRes.rows[0].id;
  t.after(async () => {
    await pool.query('DELETE FROM request_types WHERE id = $1', [typeId]);
  });

  const res = await request(app)
    .patch(`/api/request-types/${typeId}/activate`)
    .set('Authorization', `Bearer ${adminToken}`);

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.is_active, true);
});

// Non-ADMIN -> 403.
test('PATCH /api/request-types/:id/activate - non-ADMIN gets 403', async (t) => {
  const employee = await registerEmployee();
  t.after(() => deleteUser(employee.id));

  const res = await request(app)
    .patch(`/api/request-types/${randomUUID()}/activate`)
    .set('Authorization', `Bearer ${employee.token}`);

  assert.equal(res.status, 403);
  assert.equal(res.body.message, 'Bu işlem için yetkiniz yok');
});

// Nonexistent id -> 404.
test('PATCH /api/request-types/:id/activate - nonexistent id gets 404', async () => {
  const res = await request(app)
    .patch(`/api/request-types/${randomUUID()}/activate`)
    .set('Authorization', `Bearer ${adminToken}`);

  assert.equal(res.status, 404, JSON.stringify(res.body));
});
