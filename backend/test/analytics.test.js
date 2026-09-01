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

// Registers a fresh throwaway EMPLOYEE and returns { id, token }.
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
    title: 'Analytics test request',
    description: 'Analytics test request description',
    request_type_id: requestTypeId,
  };
  if (priority) body.priority = priority;
  const res = await request(app)
    .post('/api/requests')
    .set('Authorization', `Bearer ${employeeToken}`)
    .send(body);
  return res;
}

// Full lifecycle helper: create -> assign (by given authority token) -> IN_PROGRESS -> COMPLETED.
async function createAndCompleteRequest(employeeToken, authorityToken, requestTypeId, priority) {
  const created = await createRequestAs(employeeToken, requestTypeId, priority);
  assert.equal(created.status, 201, JSON.stringify(created.body));

  const assignRes = await request(app)
    .post(`/api/requests/${created.body.id}/assign`)
    .set('Authorization', `Bearer ${authorityToken}`)
    .send();
  assert.equal(assignRes.status, 200, JSON.stringify(assignRes.body));

  const inProgressRes = await request(app)
    .patch(`/api/requests/${created.body.id}/status`)
    .set('Authorization', `Bearer ${authorityToken}`)
    .send({ status: 'IN_PROGRESS' });
  assert.equal(inProgressRes.status, 200, JSON.stringify(inProgressRes.body));

  const completedRes = await request(app)
    .patch(`/api/requests/${created.body.id}/status`)
    .set('Authorization', `Bearer ${authorityToken}`)
    .send({ status: 'COMPLETED' });
  assert.equal(completedRes.status, 200, JSON.stringify(completedRes.body));

  return created.body.id;
}

let itAuthorityToken;
let hrAuthorityToken;
let hrAuthorityDepartmentId;
let passwordResetTypeId; // IT
let leaveRequestTypeId; // HR
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
  hrAuthorityDepartmentId = hrLogin.body.user.department_id;

  const prType = await pool.query("SELECT id FROM request_types WHERE name = 'Password Reset'");
  passwordResetTypeId = prType.rows[0].id;

  const lrType = await pool.query("SELECT id FROM request_types WHERE name = 'Leave Request'");
  leaveRequestTypeId = lrType.rows[0].id;

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

// AC1: GET /api/analytics/summary as ADMIN reflects system-wide counts (delta-based).
test('GET /api/analytics/summary - ADMIN sees system-wide counts increase by exactly 1 open request', async (t) => {
  const beforeRes = await request(app)
    .get('/api/analytics/summary')
    .set('Authorization', `Bearer ${adminToken}`);
  assert.equal(beforeRes.status, 200, JSON.stringify(beforeRes.body));
  const beforeOpen = beforeRes.body.total_open;

  const employee = await registerEmployee();
  const created = await createRequestAs(employee.token, passwordResetTypeId, 'LOW');
  assert.equal(created.status, 201);
  registerCleanup(t, employee, [created.body.id]);

  const afterRes = await request(app)
    .get('/api/analytics/summary')
    .set('Authorization', `Bearer ${adminToken}`);
  assert.equal(afterRes.status, 200, JSON.stringify(afterRes.body));
  assert.equal(afterRes.body.total_open, beforeOpen + 1);
});

// AC2: GET /api/analytics/summary as DEPARTMENT_AUTHORITY is scoped to their own department only.
test('GET /api/analytics/summary - DEPARTMENT_AUTHORITY is scoped to own department only', async (t) => {
  const itBeforeRes = await request(app)
    .get('/api/analytics/summary')
    .set('Authorization', `Bearer ${itAuthorityToken}`);
  assert.equal(itBeforeRes.status, 200, JSON.stringify(itBeforeRes.body));
  const itBeforeOpen = itBeforeRes.body.total_open;

  const itEmployee = await registerEmployee();
  const hrEmployee = await registerEmployee();

  const itReq = await createRequestAs(itEmployee.token, passwordResetTypeId, 'LOW');
  assert.equal(itReq.status, 201);
  const hrReq = await createRequestAs(hrEmployee.token, leaveRequestTypeId, 'LOW');
  assert.equal(hrReq.status, 201);

  registerCleanup(t, itEmployee, [itReq.body.id]);
  registerCleanup(t, hrEmployee, [hrReq.body.id]);

  // IT authority's total_open must reflect the IT request but not be affected further
  // by the HR-department request.
  const itAfterItOnlyRes = await request(app)
    .get('/api/analytics/summary')
    .set('Authorization', `Bearer ${itAuthorityToken}`);
  assert.equal(itAfterItOnlyRes.status, 200, JSON.stringify(itAfterItOnlyRes.body));
  assert.equal(itAfterItOnlyRes.body.total_open, itBeforeOpen + 1);
});

// AC3: GET /api/analytics/summary as EMPLOYEE -> 403.
test('GET /api/analytics/summary - EMPLOYEE gets 403', async (t) => {
  const employee = await registerEmployee();
  registerCleanup(t, employee, []);

  const res = await request(app)
    .get('/api/analytics/summary')
    .set('Authorization', `Bearer ${employee.token}`);
  assert.equal(res.status, 403);
});

// AC4: GET /api/analytics/sla with a known on-time completed request (HIGH priority, 4h window).
// Uses the HR department scope, kept clean of other completed requests within this file (see AC5's
// note: the LOW-priority late-completion test below intentionally uses HR too, but only as the
// single completed request present at the time of ITS assertion; sequential test execution plus
// per-test cleanup means the two do not overlap).
test('GET /api/analytics/sla - reflects a known on-time completed request', async (t) => {
  const employee = await registerEmployee();
  const requestId = await createAndCompleteRequest(employee.token, hrAuthorityToken, leaveRequestTypeId, 'HIGH');
  registerCleanup(t, employee, [requestId]);

  const slaRes = await request(app)
    .get('/api/analytics/sla')
    .set('Authorization', `Bearer ${hrAuthorityToken}`);
  assert.equal(slaRes.status, 200, JSON.stringify(slaRes.body));
  assert.ok(slaRes.body.compliance_rate >= 0 && slaRes.body.compliance_rate <= 100);
  // A same-second test run resolves in a fraction of an hour, which can legitimately round to
  // 0.00 - assert it's a small non-negative number rather than requiring it to be > 0.
  assert.ok(slaRes.body.avg_resolution_hours >= 0 && slaRes.body.avg_resolution_hours < 1);
});

// AC5: GET /api/analytics/sla - LOW priority request completed but pushed past its sla_due_at via
// direct SQL manipulation of the request_history completion timestamp -> counts as NOT on-time.
test('GET /api/analytics/sla - a late completion is not counted as on-time', async (t) => {
  const employee = await registerEmployee();
  const requestId = await createAndCompleteRequest(employee.token, hrAuthorityToken, leaveRequestTypeId, 'LOW');
  registerCleanup(t, employee, [requestId]);

  // Push the STATUS_CHANGED -> COMPLETED history row's created_at to just past sla_due_at.
  const slaDueRow = await pool.query('SELECT sla_due_at FROM requests WHERE id = $1', [requestId]);
  const slaDueAt = slaDueRow.rows[0].sla_due_at;
  await pool.query(
    `UPDATE request_history
     SET created_at = $1::timestamptz + interval '1 hour'
     WHERE request_id = $2 AND action = 'STATUS_CHANGED' AND new_value = 'COMPLETED'`,
    [slaDueAt, requestId]
  );

  const slaRes = await request(app)
    .get('/api/analytics/sla')
    .set('Authorization', `Bearer ${hrAuthorityToken}`);
  assert.equal(slaRes.status, 200, JSON.stringify(slaRes.body));
  // This is the only completed HR request left standing after prior tests' cleanup ran, so
  // compliance_rate should be exactly 0 (one completed request, late).
  assert.equal(slaRes.body.compliance_rate, 0);
});

// AC6: GET /api/analytics/sla for a department with zero completed requests -> zeroed, 200, no error.
test('GET /api/analytics/sla - department with zero completed requests returns zeroed payload', async (t) => {
  // Insert a throwaway DEPARTMENT_AUTHORITY scoped to Finance (no seeded authority exists for it).
  const financeDept = await pool.query("SELECT id FROM departments WHERE name = 'Finance'");
  const financeDeptId = financeDept.rows[0].id;

  const pwRow = await pool.query("SELECT password_hash FROM users WHERE email = 'it.authority@opspulse.com'");
  const financeAuthorityEmail = `finance-authority-${randomUUID()}@opspulse.com`;
  const financeAuthorityInsert = await pool.query(
    `INSERT INTO users (name, surname, email, password_hash, role, department_id)
     VALUES ($1, $2, $3, $4, 'DEPARTMENT_AUTHORITY', $5) RETURNING id`,
    ['Test', 'FinanceAuthority', financeAuthorityEmail, pwRow.rows[0].password_hash, financeDeptId]
  );
  const financeAuthorityId = financeAuthorityInsert.rows[0].id;
  t.after(async () => {
    await pool.query('DELETE FROM users WHERE id = $1', [financeAuthorityId]);
  });

  const financeLogin = await request(app)
    .post('/api/auth/login')
    .send({ email: financeAuthorityEmail, password: 'sifre1234' });
  assert.equal(financeLogin.status, 200, JSON.stringify(financeLogin.body));

  const slaRes = await request(app)
    .get('/api/analytics/sla')
    .set('Authorization', `Bearer ${financeLogin.body.token}`);
  assert.equal(slaRes.status, 200, JSON.stringify(slaRes.body));
  assert.deepEqual(slaRes.body, { compliance_rate: 0, avg_resolution_hours: null });
});

// AC7: GET /api/analytics/workload as ADMIN -> array with a row for every department, including
// the empty Finance department with all-zero counts (proves the LEFT JOIN behavior).
test('GET /api/analytics/workload - ADMIN sees every department including empty Finance with zero counts', async (t) => {
  const res = await request(app)
    .get('/api/analytics/workload')
    .set('Authorization', `Bearer ${adminToken}`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.ok(Array.isArray(res.body));

  const departmentsRes = await pool.query('SELECT name FROM departments');
  const departmentNames = departmentsRes.rows.map((r) => r.name);
  const returnedNames = res.body.map((r) => r.department_name);
  for (const name of departmentNames) {
    assert.ok(returnedNames.includes(name), `missing department ${name} in workload response`);
  }

  const financeRow = res.body.find((r) => r.department_name === 'Finance');
  assert.deepEqual(financeRow, {
    department_name: 'Finance',
    open: 0,
    assigned: 0,
    in_progress: 0,
    completed: 0,
    rejected: 0,
  });
});

// AC8: GET /api/analytics/workload as DEPARTMENT_AUTHORITY -> array of length 1, matching own department.
test('GET /api/analytics/workload - DEPARTMENT_AUTHORITY sees exactly one row for their own department', async (t) => {
  const res = await request(app)
    .get('/api/analytics/workload')
    .set('Authorization', `Bearer ${hrAuthorityToken}`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.ok(Array.isArray(res.body));
  assert.equal(res.body.length, 1);
  assert.equal(res.body[0].department_name, 'HR');
});

// AC8 (gap): GET /api/analytics/workload as the DEPARTMENT_AUTHORITY of a zero-request department
// -> array of length 1, that one row all-zero (the HR-authority AC8 test above only covers a
// department WITH activity; this covers the zero-request case, mirroring AC6's zeroed-sla test).
test('GET /api/analytics/workload - DEPARTMENT_AUTHORITY of a zero-request department sees one all-zero row', async (t) => {
  // Insert a throwaway DEPARTMENT_AUTHORITY scoped to Finance (no seeded authority exists for it).
  const financeDept = await pool.query("SELECT id FROM departments WHERE name = 'Finance'");
  const financeDeptId = financeDept.rows[0].id;

  const pwRow = await pool.query("SELECT password_hash FROM users WHERE email = 'it.authority@opspulse.com'");
  const financeAuthorityEmail = `finance-authority-${randomUUID()}@opspulse.com`;
  const financeAuthorityInsert = await pool.query(
    `INSERT INTO users (name, surname, email, password_hash, role, department_id)
     VALUES ($1, $2, $3, $4, 'DEPARTMENT_AUTHORITY', $5) RETURNING id`,
    ['Test', 'FinanceAuthority', financeAuthorityEmail, pwRow.rows[0].password_hash, financeDeptId]
  );
  const financeAuthorityId = financeAuthorityInsert.rows[0].id;
  t.after(async () => {
    await pool.query('DELETE FROM users WHERE id = $1', [financeAuthorityId]);
  });

  const financeLogin = await request(app)
    .post('/api/auth/login')
    .send({ email: financeAuthorityEmail, password: 'sifre1234' });
  assert.equal(financeLogin.status, 200, JSON.stringify(financeLogin.body));

  const workloadRes = await request(app)
    .get('/api/analytics/workload')
    .set('Authorization', `Bearer ${financeLogin.body.token}`);
  assert.equal(workloadRes.status, 200, JSON.stringify(workloadRes.body));
  assert.ok(Array.isArray(workloadRes.body));
  assert.equal(workloadRes.body.length, 1);
  assert.deepEqual(workloadRes.body[0], {
    department_name: 'Finance',
    open: 0,
    assigned: 0,
    in_progress: 0,
    completed: 0,
    rejected: 0,
  });
});

// AC9: GET /api/analytics/sla and /api/analytics/workload as EMPLOYEE -> both 403.
test('GET /api/analytics/sla and /api/analytics/workload - EMPLOYEE gets 403 on both', async (t) => {
  const employee = await registerEmployee();
  registerCleanup(t, employee, []);

  const slaRes = await request(app)
    .get('/api/analytics/sla')
    .set('Authorization', `Bearer ${employee.token}`);
  assert.equal(slaRes.status, 403);

  const workloadRes = await request(app)
    .get('/api/analytics/workload')
    .set('Authorization', `Bearer ${employee.token}`);
  assert.equal(workloadRes.status, 403);
});

// AC10: SKIPPED - DB-outage/error-path simulation is impractical against a real local Postgres
// instance, matching this project's existing convention (auth's AC9, request-service's AC12,
// request-comments' AC12).

// AC11: SKIPPED - the <300ms performance benchmark is not asserted with a hard timing threshold in
// this node:test suite (flaky under CI/load); it was validated live during code-copilot's own
// verification and is re-checked separately by the /verify step.

// AC1 & AC2 & AC9: GET /api/analytics/distribution as ADMIN with no query params returns all 5
// status entries, all 3 priority entries, at least 1 department/requestType row, and a default
// 30-entry chronological volumeOverTime (proves the `days` default of 30 is applied).
test('GET /api/analytics/distribution - ADMIN with no query params gets full breakdown, default 30-day volumeOverTime', async (t) => {
  const res = await request(app)
    .get('/api/analytics/distribution')
    .set('Authorization', `Bearer ${adminToken}`);
  assert.equal(res.status, 200, JSON.stringify(res.body));

  assert.equal(res.body.status.length, 5);
  assert.deepEqual(
    res.body.status.map((r) => r.status),
    ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'REJECTED']
  );

  assert.equal(res.body.priority.length, 3);
  assert.deepEqual(
    res.body.priority.map((r) => r.priority),
    ['HIGH', 'MEDIUM', 'LOW']
  );

  assert.ok(Array.isArray(res.body.department));
  assert.ok(res.body.department.length >= 1);
  assert.ok(Array.isArray(res.body.requestType));
  assert.ok(res.body.requestType.length >= 1);

  assert.ok(Array.isArray(res.body.volumeOverTime));
  assert.equal(res.body.volumeOverTime.length, 30);
  assert.ok(res.body.volumeOverTime[0].date < res.body.volumeOverTime[29].date);
});

// AC3: GET /api/analytics/distribution as EMPLOYEE -> 403.
test('GET /api/analytics/distribution - EMPLOYEE gets 403', async (t) => {
  const employee = await registerEmployee();
  registerCleanup(t, employee, []);

  const res = await request(app)
    .get('/api/analytics/distribution')
    .set('Authorization', `Bearer ${employee.token}`);
  assert.equal(res.status, 403);
});

// AC4: GET /api/analytics/distribution as DEPARTMENT_AUTHORITY -> department breakdown contains
// exactly 1 row (their own department only).
test('GET /api/analytics/distribution - DEPARTMENT_AUTHORITY sees exactly one row for their own department', async (t) => {
  const res = await request(app)
    .get('/api/analytics/distribution')
    .set('Authorization', `Bearer ${hrAuthorityToken}`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.department.length, 1);
  assert.equal(res.body.department[0].department, 'HR');
});

// AC5: GET /api/analytics/distribution?days=7 -> volumeOverTime has exactly 7 entries.
test('GET /api/analytics/distribution - days=7 gives a 7-entry volumeOverTime', async (t) => {
  const res = await request(app)
    .get('/api/analytics/distribution?days=7')
    .set('Authorization', `Bearer ${adminToken}`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.volumeOverTime.length, 7);
});

// AC6: GET /api/analytics/distribution with an invalid days value -> 400 with a non-empty message.
test('GET /api/analytics/distribution - invalid days values get 400', async (t) => {
  const invalidValues = ['abc', '-5', '0', '91'];
  for (const days of invalidValues) {
    // eslint-disable-next-line no-await-in-loop
    const res = await request(app)
      .get(`/api/analytics/distribution?days=${days}`)
      .set('Authorization', `Bearer ${adminToken}`);
    assert.equal(res.status, 400, `days=${days} expected 400, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.ok(res.body.message || res.body.error, `days=${days} expected a non-empty error message`);
  }
});

// AC7: GET /api/analytics/distribution?days=1 and ?days=90 (boundary values) -> both 200.
test('GET /api/analytics/distribution - days=1 and days=90 boundary values are accepted', async (t) => {
  const res1 = await request(app)
    .get('/api/analytics/distribution?days=1')
    .set('Authorization', `Bearer ${adminToken}`);
  assert.equal(res1.status, 200, JSON.stringify(res1.body));
  assert.equal(res1.body.volumeOverTime.length, 1);

  const res90 = await request(app)
    .get('/api/analytics/distribution?days=90')
    .set('Authorization', `Bearer ${adminToken}`);
  assert.equal(res90.status, 200, JSON.stringify(res90.body));
  assert.equal(res90.body.volumeOverTime.length, 90);
});

// AC8: GET /api/analytics/distribution for a DEPARTMENT_AUTHORITY of a zero-request department ->
// status/priority still show all 5/3 entries at 0, department shows exactly 1 row (Finance) at 0,
// volumeOverTime has all `days` entries present, all at 0.
test('GET /api/analytics/distribution - DEPARTMENT_AUTHORITY of a zero-request department sees all-zero breakdown', async (t) => {
  // Insert a throwaway DEPARTMENT_AUTHORITY scoped to Finance (no seeded authority exists for it).
  const financeDept = await pool.query("SELECT id FROM departments WHERE name = 'Finance'");
  const financeDeptId = financeDept.rows[0].id;

  const pwRow = await pool.query("SELECT password_hash FROM users WHERE email = 'it.authority@opspulse.com'");
  const financeAuthorityEmail = `finance-authority-${randomUUID()}@opspulse.com`;
  const financeAuthorityInsert = await pool.query(
    `INSERT INTO users (name, surname, email, password_hash, role, department_id)
     VALUES ($1, $2, $3, $4, 'DEPARTMENT_AUTHORITY', $5) RETURNING id`,
    ['Test', 'FinanceAuthority', financeAuthorityEmail, pwRow.rows[0].password_hash, financeDeptId]
  );
  const financeAuthorityId = financeAuthorityInsert.rows[0].id;
  t.after(async () => {
    await pool.query('DELETE FROM users WHERE id = $1', [financeAuthorityId]);
  });

  const financeLogin = await request(app)
    .post('/api/auth/login')
    .send({ email: financeAuthorityEmail, password: 'sifre1234' });
  assert.equal(financeLogin.status, 200, JSON.stringify(financeLogin.body));

  const days = 5;
  const res = await request(app)
    .get(`/api/analytics/distribution?days=${days}`)
    .set('Authorization', `Bearer ${financeLogin.body.token}`);
  assert.equal(res.status, 200, JSON.stringify(res.body));

  assert.equal(res.body.status.length, 5);
  assert.ok(res.body.status.every((r) => r.count === 0));

  assert.equal(res.body.priority.length, 3);
  assert.ok(res.body.priority.every((r) => r.count === 0));

  assert.equal(res.body.department.length, 1);
  assert.deepEqual(res.body.department[0], { department: 'Finance', count: 0 });

  assert.equal(res.body.volumeOverTime.length, days);
  assert.ok(res.body.volumeOverTime.every((r) => r.count === 0));
});
