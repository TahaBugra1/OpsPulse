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
  // 'sifre1234' still works for login.
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

// AC7: no Authorization header -> 401
test('GET /api/departments - no Authorization header returns 401', async () => {
  const res = await request(app).get('/api/departments');
  assert.equal(res.status, 401);
});

// AC1/AC6/AC8: ADMIN gets 200 with EVERY department (active and inactive),
// each {id, name, is_active} — the catalog page needs to see and reactivate
// inactive departments, so listDepartments() deliberately no longer filters
// by is_active nor omits the field.
test('GET /api/departments - ADMIN gets 200 with every department (active and inactive), each {id, name, is_active}', async (t) => {
  const inactiveDept = await pool.query(
    `INSERT INTO departments (name, is_active) VALUES ($1, false) RETURNING id`,
    [`Throwaway Inactive Dept ${randomUUID()}`]
  );
  const inactiveDeptId = inactiveDept.rows[0].id;
  t.after(async () => {
    await pool.query('DELETE FROM departments WHERE id = $1', [inactiveDeptId]);
  });

  const res = await request(app)
    .get('/api/departments')
    .set('Authorization', `Bearer ${adminToken}`);

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.ok(Array.isArray(res.body));
  assert.ok(res.body.length > 0);

  for (const dept of res.body) {
    assert.deepEqual(Object.keys(dept).sort(), ['id', 'is_active', 'name']);
    assert.equal(typeof dept.id, 'string');
    assert.equal(typeof dept.name, 'string');
    assert.equal(typeof dept.is_active, 'boolean');
  }

  const inactiveInResponse = res.body.find((d) => d.id === inactiveDeptId);
  assert.ok(inactiveInResponse, 'an inactive department must now be returned');
  assert.equal(inactiveInResponse.is_active, false);
});

// AC7: results are ordered by name ASC.
test('GET /api/departments - results are ordered by name ascending', async () => {
  const res = await request(app)
    .get('/api/departments')
    .set('Authorization', `Bearer ${adminToken}`);

  assert.equal(res.status, 200, JSON.stringify(res.body));
  const names = res.body.map((d) => d.name);
  const sorted = [...names].sort((a, b) => a.localeCompare(b));
  assert.deepEqual(names, sorted);
});

// AC7: non-ADMIN (EMPLOYEE and DEPARTMENT_AUTHORITY) both get 403.
test('GET /api/departments - EMPLOYEE and DEPARTMENT_AUTHORITY are both forbidden (403)', async (t) => {
  const employee = await registerEmployee();
  t.after(() => deleteUser(employee.id));

  const employeeRes = await request(app)
    .get('/api/departments')
    .set('Authorization', `Bearer ${employee.token}`);
  assert.equal(employeeRes.status, 403);
  assert.equal(employeeRes.body.message, 'Bu işlem için yetkiniz yok');

  const authorityRes = await request(app)
    .get('/api/departments')
    .set('Authorization', `Bearer ${itAuthorityToken}`);
  assert.equal(authorityRes.status, 403);
  assert.equal(authorityRes.body.message, 'Bu işlem için yetkiniz yok');
});

// ---------------------------------------------------------------------------
// POST /api/departments (AC1, AC3, AC10, and the 100-char/empty-name edges)
// ---------------------------------------------------------------------------

// AC1: ADMIN creates a department with a unique name -> 201, is_active=true.
test('POST /api/departments - ADMIN with a unique name gets 201 with {id, name, is_active: true}', async (t) => {
  const name = `Throwaway Dept ${randomUUID()}`;
  const res = await request(app)
    .post('/api/departments')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name });

  assert.equal(res.status, 201, JSON.stringify(res.body));
  t.after(async () => {
    await pool.query('DELETE FROM departments WHERE id = $1', [res.body.id]);
  });

  assert.equal(typeof res.body.id, 'string');
  assert.equal(res.body.name, name);
  assert.equal(res.body.is_active, true);
});

// AC3: EMPLOYEE and DEPARTMENT_AUTHORITY calling the write endpoint -> 403, nothing written.
test('POST /api/departments - EMPLOYEE and DEPARTMENT_AUTHORITY are both forbidden (403), nothing written', async (t) => {
  const employee = await registerEmployee();
  t.after(() => deleteUser(employee.id));

  const name = `Should Not Be Created ${randomUUID()}`;

  const employeeRes = await request(app)
    .post('/api/departments')
    .set('Authorization', `Bearer ${employee.token}`)
    .send({ name });
  assert.equal(employeeRes.status, 403);
  assert.equal(employeeRes.body.message, 'Bu işlem için yetkiniz yok');

  const authorityRes = await request(app)
    .post('/api/departments')
    .set('Authorization', `Bearer ${itAuthorityToken}`)
    .send({ name });
  assert.equal(authorityRes.status, 403);
  assert.equal(authorityRes.body.message, 'Bu işlem için yetkiniz yok');

  const check = await pool.query('SELECT id FROM departments WHERE name = $1', [name]);
  assert.equal(check.rows.length, 0, 'nothing should have been written');
});

// AC10: duplicate name on create -> clean 409.
test('POST /api/departments - duplicate name gets a clean 409', async () => {
  const existing = await pool.query('SELECT name FROM departments LIMIT 1');
  assert.ok(existing.rows[0], 'no department found - run `npm run seed` first');

  const res = await request(app)
    .post('/api/departments')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: existing.rows[0].name });

  assert.equal(res.status, 409, JSON.stringify(res.body));
  assert.equal(res.body.message, 'Bu isim zaten kullanılıyor');
});

// Name length boundary: over 100 chars -> clean 400, not a raw DB error.
test('POST /api/departments - name over 100 chars gets a clean 400', async () => {
  const res = await request(app)
    .post('/api/departments')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: 'a'.repeat(101) });

  assert.equal(res.status, 400, JSON.stringify(res.body));
});

// Empty/whitespace-only name -> clean 400.
test('POST /api/departments - empty/whitespace-only name gets a clean 400', async () => {
  const emptyRes = await request(app)
    .post('/api/departments')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: '' });
  assert.equal(emptyRes.status, 400, JSON.stringify(emptyRes.body));

  const whitespaceRes = await request(app)
    .post('/api/departments')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: '   ' });
  assert.equal(whitespaceRes.status, 400, JSON.stringify(whitespaceRes.body));
});

// ---------------------------------------------------------------------------
// PATCH /api/departments/:id (AC4)
// ---------------------------------------------------------------------------

// AC4: ADMIN renames a department -> 200, name updated.
test('PATCH /api/departments/:id - ADMIN renames a department -> 200, name updated', async (t) => {
  const created = await pool.query(
    'INSERT INTO departments (name) VALUES ($1) RETURNING id',
    [`Throwaway Rename Source ${randomUUID()}`]
  );
  const deptId = created.rows[0].id;
  t.after(async () => {
    await pool.query('DELETE FROM departments WHERE id = $1', [deptId]);
  });

  const newName = `Renamed Dept ${randomUUID()}`;
  const res = await request(app)
    .patch(`/api/departments/${deptId}`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: newName });

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.name, newName);
});

// Nonexistent id -> 404.
test('PATCH /api/departments/:id - nonexistent id gets 404', async () => {
  const res = await request(app)
    .patch(`/api/departments/${randomUUID()}`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: `Ghost Dept ${randomUUID()}` });

  assert.equal(res.status, 404, JSON.stringify(res.body));
});

// Non-ADMIN -> 403.
test('PATCH /api/departments/:id - non-ADMIN gets 403', async (t) => {
  const employee = await registerEmployee();
  t.after(() => deleteUser(employee.id));

  const res = await request(app)
    .patch(`/api/departments/${randomUUID()}`)
    .set('Authorization', `Bearer ${employee.token}`)
    .send({ name: `Irrelevant ${randomUUID()}` });

  assert.equal(res.status, 403);
  assert.equal(res.body.message, 'Bu işlem için yetkiniz yok');
});

// ---------------------------------------------------------------------------
// PATCH /api/departments/:id/deactivate and /activate (AC6, AC8, AC9)
// ---------------------------------------------------------------------------

// AC6 (the single most important new test in this file): deactivating a
// department cascades to every request_type under it, in one transaction.
test('PATCH /api/departments/:id/deactivate - cascades to deactivate its request_types too', async (t) => {
  const deptRes = await pool.query(
    'INSERT INTO departments (name) VALUES ($1) RETURNING id',
    [`Throwaway Cascade Dept ${randomUUID()}`]
  );
  const deptId = deptRes.rows[0].id;
  const typeRes = await pool.query(
    'INSERT INTO request_types (name, department_id) VALUES ($1, $2) RETURNING id',
    [`Throwaway Cascade Type ${randomUUID()}`, deptId]
  );
  const typeId = typeRes.rows[0].id;
  t.after(async () => {
    await pool.query('DELETE FROM request_types WHERE id = $1', [typeId]);
    await pool.query('DELETE FROM departments WHERE id = $1', [deptId]);
  });

  const res = await request(app)
    .patch(`/api/departments/${deptId}/deactivate`)
    .set('Authorization', `Bearer ${adminToken}`);

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.is_active, false);

  const deptRow = await pool.query('SELECT is_active FROM departments WHERE id = $1', [deptId]);
  assert.equal(deptRow.rows[0].is_active, false);

  const typeRow = await pool.query('SELECT is_active FROM request_types WHERE id = $1', [typeId]);
  assert.equal(typeRow.rows[0].is_active, false, 'the request_type under the deactivated department must cascade too');
});

// AC9: deactivating a department/request type with in-flight requests still succeeds.
test('PATCH /api/departments/:id/deactivate - succeeds even with in-flight (OPEN) requests under it', async (t) => {
  const deptRes = await pool.query(
    'INSERT INTO departments (name) VALUES ($1) RETURNING id',
    [`Throwaway InFlight Dept ${randomUUID()}`]
  );
  const deptId = deptRes.rows[0].id;
  const typeRes = await pool.query(
    'INSERT INTO request_types (name, department_id) VALUES ($1, $2) RETURNING id',
    [`Throwaway InFlight Type ${randomUUID()}`, deptId]
  );
  const typeId = typeRes.rows[0].id;

  const employee = await registerEmployee();
  const openRequest = await pool.query(
    `INSERT INTO requests (title, description, request_type_id, department_id, created_by, priority, status, sla_due_at)
     VALUES ($1, $2, $3, $4, $5, 'MEDIUM', 'OPEN', now() + interval '24 hours')
     RETURNING id`,
    ['Throwaway open request', 'in-flight while department is deactivated', typeId, deptId, employee.id]
  );
  const requestId = openRequest.rows[0].id;

  t.after(async () => {
    await pool.query('DELETE FROM requests WHERE id = $1', [requestId]);
    await deleteUser(employee.id);
    await pool.query('DELETE FROM request_types WHERE id = $1', [typeId]);
    await pool.query('DELETE FROM departments WHERE id = $1', [deptId]);
  });

  const res = await request(app)
    .patch(`/api/departments/${deptId}/deactivate`)
    .set('Authorization', `Bearer ${adminToken}`);

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.is_active, false);
});

// Nonexistent id -> 404.
test('PATCH /api/departments/:id/deactivate - nonexistent id gets 404', async () => {
  const res = await request(app)
    .patch(`/api/departments/${randomUUID()}/deactivate`)
    .set('Authorization', `Bearer ${adminToken}`);

  assert.equal(res.status, 404, JSON.stringify(res.body));
});

// Non-ADMIN -> 403.
test('PATCH /api/departments/:id/deactivate - non-ADMIN gets 403', async (t) => {
  const employee = await registerEmployee();
  t.after(() => deleteUser(employee.id));

  const res = await request(app)
    .patch(`/api/departments/${randomUUID()}/deactivate`)
    .set('Authorization', `Bearer ${employee.token}`);

  assert.equal(res.status, 403);
  assert.equal(res.body.message, 'Bu işlem için yetkiniz yok');
});

// AC8: activating a department does NOT reactivate its request types.
test('PATCH /api/departments/:id/activate - reactivates the department but NOT its already-cascaded request_type', async (t) => {
  const deptRes = await pool.query(
    'INSERT INTO departments (name) VALUES ($1) RETURNING id',
    [`Throwaway Reactivate Dept ${randomUUID()}`]
  );
  const deptId = deptRes.rows[0].id;
  const typeRes = await pool.query(
    'INSERT INTO request_types (name, department_id) VALUES ($1, $2) RETURNING id',
    [`Throwaway Reactivate Type ${randomUUID()}`, deptId]
  );
  const typeId = typeRes.rows[0].id;
  t.after(async () => {
    await pool.query('DELETE FROM request_types WHERE id = $1', [typeId]);
    await pool.query('DELETE FROM departments WHERE id = $1', [deptId]);
  });

  const deactivateRes = await request(app)
    .patch(`/api/departments/${deptId}/deactivate`)
    .set('Authorization', `Bearer ${adminToken}`);
  assert.equal(deactivateRes.status, 200, JSON.stringify(deactivateRes.body));

  const activateRes = await request(app)
    .patch(`/api/departments/${deptId}/activate`)
    .set('Authorization', `Bearer ${adminToken}`);

  assert.equal(activateRes.status, 200, JSON.stringify(activateRes.body));
  assert.equal(activateRes.body.is_active, true);

  const typeRow = await pool.query('SELECT is_active FROM request_types WHERE id = $1', [typeId]);
  assert.equal(typeRow.rows[0].is_active, false, 'activate must NOT cascade to request_types');
});

// Nonexistent id -> 404.
test('PATCH /api/departments/:id/activate - nonexistent id gets 404', async () => {
  const res = await request(app)
    .patch(`/api/departments/${randomUUID()}/activate`)
    .set('Authorization', `Bearer ${adminToken}`);

  assert.equal(res.status, 404, JSON.stringify(res.body));
});

// Non-ADMIN -> 403.
test('PATCH /api/departments/:id/activate - non-ADMIN gets 403', async (t) => {
  const employee = await registerEmployee();
  t.after(() => deleteUser(employee.id));

  const res = await request(app)
    .patch(`/api/departments/${randomUUID()}/activate`)
    .set('Authorization', `Bearer ${employee.token}`);

  assert.equal(res.status, 403);
  assert.equal(res.body.message, 'Bu işlem için yetkiniz yok');
});
