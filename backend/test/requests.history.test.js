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

// Registers a fresh throwaway EMPLOYEE and returns { id, token, email }.
async function registerEmployee(name = 'Test', surname = 'Employee') {
  const email = validEmail();
  const res = await request(app).post('/api/auth/register').send({
    name,
    surname,
    email,
    password: 'sifre1234test',
  });
  assert.equal(res.status, 201, `employee registration failed: ${JSON.stringify(res.body)}`);
  return { id: res.body.user.id, email, token: res.body.token };
}

async function deleteRequestCascade(requestId) {
  await pool.query('DELETE FROM notifications WHERE request_id = $1', [requestId]);
  await pool.query('DELETE FROM request_comments WHERE request_id = $1', [requestId]);
  await pool.query('DELETE FROM request_history WHERE request_id = $1', [requestId]);
  await pool.query('DELETE FROM requests WHERE id = $1', [requestId]);
}

async function deleteUser(userId) {
  await pool.query('DELETE FROM users WHERE id = $1', [userId]);
}

// Registers a single t.after hook (node:test runs hooks in FIFO/registration
// order) that deletes the given request ids (cascade) BEFORE the throwaway
// employee row itself, respecting the FK RESTRICT chain.
function registerCleanup(t, employee, requestIds) {
  t.after(async () => {
    for (const id of requestIds) {
      // eslint-disable-next-line no-await-in-loop
      await deleteRequestCascade(id);
    }
    await deleteUser(employee.id);
  });
}

async function createRequestAs(employeeToken, requestTypeId, priority) {
  const body = {
    title: 'Test request',
    description: 'Test request description',
    request_type_id: requestTypeId,
  };
  if (priority) body.priority = priority;
  const res = await request(app)
    .post('/api/requests')
    .set('Authorization', `Bearer ${employeeToken}`)
    .send(body);
  return res;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

let itAuthorityToken;
let hrAuthorityToken;
let passwordResetTypeId; // IT
let adminId;
let adminToken;

test.before(async () => {
  const itLogin = await request(app)
    .post('/api/auth/login')
    .send({ email: 'it.authority@opspulse.com', password: 'sifre1234' });
  assert.equal(itLogin.status, 200, `IT authority login failed: ${JSON.stringify(itLogin.body)}`);
  itAuthorityToken = itLogin.body.token;

  const hrLogin = await request(app)
    .post('/api/auth/login')
    .send({ email: 'hr.authority@opspulse.com', password: 'sifre1234' });
  assert.equal(hrLogin.status, 200, `HR authority login failed: ${JSON.stringify(hrLogin.body)}`);
  hrAuthorityToken = hrLogin.body.token;

  const prType = await pool.query("SELECT id FROM request_types WHERE name = 'Password Reset'");
  passwordResetTypeId = prType.rows[0].id;

  // Insert a throwaway ADMIN directly via SQL (no API path can create one),
  // reusing the seeded IT authority's password_hash so the plaintext
  // password 'sifre1234' still works for login.
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

// AC1: full lifecycle -> exactly 4 history entries, chronological ascending,
// correct action/old_value/new_value/actor_name for each.
test('GET /api/requests/:id/history - full lifecycle produces 4 chronological entries with correct fields', async (t) => {
  const employee = await registerEmployee('Chrono', 'Actor');

  const created = await createRequestAs(employee.token, passwordResetTypeId, 'LOW');
  assert.equal(created.status, 201, JSON.stringify(created.body));
  registerCleanup(t, employee, [created.body.id]);

  await sleep(20);
  const assignRes = await request(app)
    .post(`/api/requests/${created.body.id}/assign`)
    .set('Authorization', `Bearer ${itAuthorityToken}`)
    .send();
  assert.equal(assignRes.status, 200, JSON.stringify(assignRes.body));

  await sleep(20);
  const startRes = await request(app)
    .patch(`/api/requests/${created.body.id}/status`)
    .set('Authorization', `Bearer ${itAuthorityToken}`)
    .send({ status: 'IN_PROGRESS' });
  assert.equal(startRes.status, 200, JSON.stringify(startRes.body));

  await sleep(20);
  const priorityRes = await request(app)
    .patch(`/api/requests/${created.body.id}/priority`)
    .set('Authorization', `Bearer ${itAuthorityToken}`)
    .send({ priority: 'HIGH' });
  assert.equal(priorityRes.status, 200, JSON.stringify(priorityRes.body));

  const historyRes = await request(app)
    .get(`/api/requests/${created.body.id}/history`)
    .set('Authorization', `Bearer ${employee.token}`);

  assert.equal(historyRes.status, 200, JSON.stringify(historyRes.body));
  assert.ok(Array.isArray(historyRes.body));
  assert.equal(historyRes.body.length, 4);

  const [createdEntry, assignedEntry, inProgressEntry, priorityEntry] = historyRes.body;

  assert.equal(createdEntry.action, 'CREATED');
  assert.equal(createdEntry.actor_name, 'Chrono Actor');

  assert.equal(assignedEntry.action, 'STATUS_CHANGED');
  assert.equal(assignedEntry.old_value, 'OPEN');
  assert.equal(assignedEntry.new_value, 'ASSIGNED');

  assert.equal(inProgressEntry.action, 'STATUS_CHANGED');
  assert.equal(inProgressEntry.old_value, 'ASSIGNED');
  assert.equal(inProgressEntry.new_value, 'IN_PROGRESS');

  assert.equal(priorityEntry.action, 'PRIORITY_CHANGED');
  assert.equal(priorityEntry.old_value, 'LOW');
  assert.equal(priorityEntry.new_value, 'HIGH');

  // Chronological ascending order.
  const timestamps = historyRes.body.map((row) => new Date(row.created_at).getTime());
  const sorted = [...timestamps].sort((a, b) => a - b);
  assert.deepEqual(timestamps, sorted);
});

// AC1b: a REJECTED transition's history entry includes the note.
test('GET /api/requests/:id/history - REJECTED status change entry includes the note', async (t) => {
  const employee = await registerEmployee();

  const created = await createRequestAs(employee.token, passwordResetTypeId, 'LOW');
  assert.equal(created.status, 201);
  registerCleanup(t, employee, [created.body.id]);

  const rejectRes = await request(app)
    .patch(`/api/requests/${created.body.id}/status`)
    .set('Authorization', `Bearer ${itAuthorityToken}`)
    .send({ status: 'REJECTED', note: 'Stok yok' });
  assert.equal(rejectRes.status, 200, JSON.stringify(rejectRes.body));

  const historyRes = await request(app)
    .get(`/api/requests/${created.body.id}/history`)
    .set('Authorization', `Bearer ${employee.token}`);

  assert.equal(historyRes.status, 200);
  const rejectEntry = historyRes.body.find((row) => row.new_value === 'REJECTED');
  assert.ok(rejectEntry, 'expected a REJECTED history entry');
  assert.equal(rejectEntry.note, 'Stok yok');
});

// AC2a: matching-department DEPARTMENT_AUTHORITY (even unassigned/OPEN) gets 200.
test('GET /api/requests/:id/history - matching-department authority on OPEN unassigned request gets 200', async (t) => {
  const employee = await registerEmployee();

  const created = await createRequestAs(employee.token, passwordResetTypeId, 'LOW');
  assert.equal(created.status, 201);
  registerCleanup(t, employee, [created.body.id]);

  const historyRes = await request(app)
    .get(`/api/requests/${created.body.id}/history`)
    .set('Authorization', `Bearer ${itAuthorityToken}`);

  assert.equal(historyRes.status, 200, JSON.stringify(historyRes.body));
  assert.ok(Array.isArray(historyRes.body));
  assert.equal(historyRes.body.length, 1);
  assert.equal(historyRes.body[0].action, 'CREATED');
});

// AC2b: unrelated EMPLOYEE and wrong-department DEPARTMENT_AUTHORITY both get 403.
test('GET /api/requests/:id/history - unauthorized viewers get 403', async (t) => {
  const owner = await registerEmployee();
  const otherEmployee = await registerEmployee();

  const created = await createRequestAs(owner.token, passwordResetTypeId, 'LOW');
  assert.equal(created.status, 201);
  registerCleanup(t, owner, [created.body.id]);
  registerCleanup(t, otherEmployee, []);

  const otherEmployeeRes = await request(app)
    .get(`/api/requests/${created.body.id}/history`)
    .set('Authorization', `Bearer ${otherEmployee.token}`);
  assert.equal(otherEmployeeRes.status, 403);

  const wrongDeptAuthorityRes = await request(app)
    .get(`/api/requests/${created.body.id}/history`)
    .set('Authorization', `Bearer ${hrAuthorityToken}`);
  assert.equal(wrongDeptAuthorityRes.status, 403);
});

// AC2c: ADMIN gets 200 (view-access bypass, same as comments' AC11).
test('GET /api/requests/:id/history - ADMIN gets 200', async (t) => {
  const employee = await registerEmployee();

  const created = await createRequestAs(employee.token, passwordResetTypeId, 'LOW');
  assert.equal(created.status, 201);
  registerCleanup(t, employee, [created.body.id]);

  const adminRes = await request(app)
    .get(`/api/requests/${created.body.id}/history`)
    .set('Authorization', `Bearer ${adminToken}`);

  assert.equal(adminRes.status, 200, JSON.stringify(adminRes.body));
  assert.ok(Array.isArray(adminRes.body));
});

// AC2d: nonexistent request id -> 404.
test('GET /api/requests/:id/history - nonexistent request id returns 404', async (t) => {
  const employee = await registerEmployee();
  registerCleanup(t, employee, []);

  const nonexistentId = randomUUID();

  const historyRes = await request(app)
    .get(`/api/requests/${nonexistentId}/history`)
    .set('Authorization', `Bearer ${employee.token}`);
  assert.equal(historyRes.status, 404);
});
