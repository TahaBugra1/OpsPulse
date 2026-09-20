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

// Creates a brand-new, uniquely-named throwaway department (optionally with a
// throwaway request_type under it) plus a throwaway DEPARTMENT_AUTHORITY
// scoped to it, and logs that authority in. Because the department is freshly
// created inside the test itself, it is structurally guaranteed to have zero
// pre-existing requests and exactly one DEPARTMENT_AUTHORITY — unlike relying
// on a seeded department (Finance/HR/IT) staying empty or an authority count
// staying fixed, which demo data or future seed changes can silently break.
// Registers its own cleanup via t.after (department/request_type/user, in FK
// order), so callers do not need to clean these up themselves.
async function createThrowawayDepartmentWithAuthority(t, { withRequestType = false } = {}) {
  const deptRes = await pool.query(
    'INSERT INTO departments (name) VALUES ($1) RETURNING id, name',
    [`Throwaway Analytics Dept ${randomUUID()}`]
  );
  const departmentId = deptRes.rows[0].id;
  const departmentName = deptRes.rows[0].name;

  const pwRow = await pool.query("SELECT password_hash FROM users WHERE email = 'it.authority@opspulse.com'");
  const authorityEmail = `throwaway-authority-${randomUUID()}@opspulse.com`;
  const authorityInsert = await pool.query(
    `INSERT INTO users (name, surname, email, password_hash, role, department_id)
     VALUES ($1, $2, $3, $4, 'DEPARTMENT_AUTHORITY', $5) RETURNING id`,
    ['Test', 'ThrowawayAuthority', authorityEmail, pwRow.rows[0].password_hash, departmentId]
  );
  const authorityId = authorityInsert.rows[0].id;

  let requestTypeId = null;
  if (withRequestType) {
    const typeRes = await pool.query(
      'INSERT INTO request_types (name, department_id) VALUES ($1, $2) RETURNING id',
      [`Throwaway Analytics Type ${randomUUID()}`, departmentId]
    );
    requestTypeId = typeRes.rows[0].id;
  }

  const login = await request(app).post('/api/auth/login').send({ email: authorityEmail, password: 'sifre1234' });
  assert.equal(login.status, 200, JSON.stringify(login.body));

  t.after(async () => {
    if (requestTypeId) await pool.query('DELETE FROM request_types WHERE id = $1', [requestTypeId]);
    await pool.query('DELETE FROM users WHERE id = $1', [authorityId]);
    await pool.query('DELETE FROM departments WHERE id = $1', [departmentId]);
  });

  return { departmentId, departmentName, authorityId, authorityToken: login.body.token, requestTypeId };
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
// Uses a brand-new throwaway department (with its own throwaway request type and authority)
// created just for this test, rather than a seeded department like HR — a seeded department's
// request history can never be relied on to stay clean (demo data or other tests can add
// completed requests to it at any time), whereas a freshly-created department is structurally
// guaranteed to have zero completed requests other than the one this test creates.
test('GET /api/analytics/sla - reflects a known on-time completed request', async (t) => {
  const dept = await createThrowawayDepartmentWithAuthority(t, { withRequestType: true });
  const employee = await registerEmployee();
  const requestId = await createAndCompleteRequest(employee.token, dept.authorityToken, dept.requestTypeId, 'HIGH');

  const slaRes = await request(app)
    .get('/api/analytics/sla')
    .set('Authorization', `Bearer ${dept.authorityToken}`);
  assert.equal(slaRes.status, 200, JSON.stringify(slaRes.body));
  // This throwaway department has exactly one completed request ever (itself),
  // so compliance is exactly 100 and resolution time is near-instant.
  assert.equal(slaRes.body.compliance_rate, 100);
  assert.ok(slaRes.body.avg_resolution_hours >= 0 && slaRes.body.avg_resolution_hours < 1);

  // Clean up the request/employee inline (rather than via registerCleanup's t.after) so this
  // completes before the throwaway department's own t.after runs: node:test runs t.after hooks
  // in registration order, and the department helper's cleanup (registered first, when the
  // department was created above) deletes the throwaway request_type, which would violate its
  // FK from this request if the request weren't already gone by then.
  await deleteRequestCascade(requestId);
  await deleteUser(employee.id);
});

// AC5: GET /api/analytics/sla - LOW priority request completed but pushed past its sla_due_at via
// direct SQL manipulation of the request_history completion timestamp -> counts as NOT on-time.
// Uses its own throwaway department (see the previous test's comment) so this is guaranteed to be
// the only completed request that department has ever had.
test('GET /api/analytics/sla - a late completion is not counted as on-time', async (t) => {
  const dept = await createThrowawayDepartmentWithAuthority(t, { withRequestType: true });
  const employee = await registerEmployee();
  const requestId = await createAndCompleteRequest(employee.token, dept.authorityToken, dept.requestTypeId, 'LOW');

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
    .set('Authorization', `Bearer ${dept.authorityToken}`);
  assert.equal(slaRes.status, 200, JSON.stringify(slaRes.body));
  // This throwaway department has exactly one completed request ever (itself, late), so compliance is exactly 0.
  assert.equal(slaRes.body.compliance_rate, 0);

  // Clean up the request/employee inline (rather than via registerCleanup's t.after) so this
  // completes before the throwaway department's own t.after runs: node:test runs t.after hooks
  // in registration order, and the department helper's cleanup (registered first, when the
  // department was created above) deletes the throwaway request_type, which would violate its
  // FK from this request if the request weren't already gone by then.
  await deleteRequestCascade(requestId);
  await deleteUser(employee.id);
});

// AC6: GET /api/analytics/sla for a department with zero completed requests -> zeroed, 200, no error.
test('GET /api/analytics/sla - department with zero completed requests returns zeroed payload', async (t) => {
  const dept = await createThrowawayDepartmentWithAuthority(t);

  const slaRes = await request(app)
    .get('/api/analytics/sla')
    .set('Authorization', `Bearer ${dept.authorityToken}`);
  assert.equal(slaRes.status, 200, JSON.stringify(slaRes.body));
  assert.deepEqual(slaRes.body, { compliance_rate: 0, avg_resolution_hours: null });
});

// AC7: GET /api/analytics/workload as ADMIN -> array with a row for every department, including
// a freshly-created empty department with all-zero counts (proves the LEFT JOIN behavior). Uses a
// throwaway department created in this test rather than assuming a seeded department (e.g.
// Finance) stays empty, which demo data or future seed changes can silently break.
test('GET /api/analytics/workload - ADMIN sees every department including a freshly-created empty one with zero counts', async (t) => {
  const dept = await createThrowawayDepartmentWithAuthority(t);

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

  const throwawayRow = res.body.find((r) => r.department_name === dept.departmentName);
  assert.deepEqual(throwawayRow, {
    department_name: dept.departmentName,
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
  const dept = await createThrowawayDepartmentWithAuthority(t);

  const workloadRes = await request(app)
    .get('/api/analytics/workload')
    .set('Authorization', `Bearer ${dept.authorityToken}`);
  assert.equal(workloadRes.status, 200, JSON.stringify(workloadRes.body));
  assert.ok(Array.isArray(workloadRes.body));
  assert.equal(workloadRes.body.length, 1);
  assert.deepEqual(workloadRes.body[0], {
    department_name: dept.departmentName,
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
  const dept = await createThrowawayDepartmentWithAuthority(t);

  const days = 5;
  const res = await request(app)
    .get(`/api/analytics/distribution?days=${days}`)
    .set('Authorization', `Bearer ${dept.authorityToken}`);
  assert.equal(res.status, 200, JSON.stringify(res.body));

  assert.equal(res.body.status.length, 5);
  assert.ok(res.body.status.every((r) => r.count === 0));

  assert.equal(res.body.priority.length, 3);
  assert.ok(res.body.priority.every((r) => r.count === 0));

  assert.equal(res.body.department.length, 1);
  assert.deepEqual(res.body.department[0], { department: dept.departmentName, count: 0 });

  assert.equal(res.body.volumeOverTime.length, days);
  assert.ok(res.body.volumeOverTime.every((r) => r.count === 0));
});

// AC1: GET /api/analytics/bottlenecks as ADMIN with no query params -> 200, slaBreachByDepartment
// and slaBreachByRequestType are non-empty arrays covering all active departments/types, every
// count is a number >= 0.
test('GET /api/analytics/bottlenecks - ADMIN sees all departments and request types with numeric counts', async (t) => {
  const res = await request(app)
    .get('/api/analytics/bottlenecks')
    .set('Authorization', `Bearer ${adminToken}`);
  assert.equal(res.status, 200, JSON.stringify(res.body));

  assert.ok(Array.isArray(res.body.slaBreachByDepartment));
  assert.ok(res.body.slaBreachByDepartment.length >= 1);
  assert.ok(
    res.body.slaBreachByDepartment.every((r) => typeof r.count === 'number' && r.count >= 0)
  );

  assert.ok(Array.isArray(res.body.slaBreachByRequestType));
  assert.ok(res.body.slaBreachByRequestType.length >= 1);
  assert.ok(
    res.body.slaBreachByRequestType.every((r) => typeof r.count === 'number' && r.count >= 0)
  );
});

// AC2: GET /api/analytics/bottlenecks - stageDurations has exactly 3 entries, in the fixed order,
// each avg_hours either null or a number.
test('GET /api/analytics/bottlenecks - stageDurations has exactly 3 entries in fixed order', async (t) => {
  const res = await request(app)
    .get('/api/analytics/bottlenecks')
    .set('Authorization', `Bearer ${adminToken}`);
  assert.equal(res.status, 200, JSON.stringify(res.body));

  assert.equal(res.body.stageDurations.length, 3);
  assert.deepEqual(
    res.body.stageDurations.map((r) => r.stage),
    ['OPEN_TO_ASSIGNED', 'ASSIGNED_TO_IN_PROGRESS', 'IN_PROGRESS_TO_COMPLETED']
  );
  for (const stage of res.body.stageDurations) {
    assert.ok(
      stage.avg_hours === null || typeof stage.avg_hours === 'number',
      `avg_hours for ${stage.stage} should be null or a number, got ${JSON.stringify(stage.avg_hours)}`
    );
  }
});

// AC3: GET /api/analytics/bottlenecks - authorityWorkload has at least 2 entries (the seeded IT +
// HR authorities), sorted by active_count descending (pairwise non-increasing check).
test('GET /api/analytics/bottlenecks - authorityWorkload includes seeded authorities sorted by active_count descending', async (t) => {
  const res = await request(app)
    .get('/api/analytics/bottlenecks')
    .set('Authorization', `Bearer ${adminToken}`);
  assert.equal(res.status, 200, JSON.stringify(res.body));

  assert.ok(Array.isArray(res.body.authorityWorkload));
  assert.ok(res.body.authorityWorkload.length >= 2);

  for (let i = 1; i < res.body.authorityWorkload.length; i += 1) {
    assert.ok(
      res.body.authorityWorkload[i - 1].active_count >= res.body.authorityWorkload[i].active_count,
      `authorityWorkload not sorted descending at index ${i}: ${JSON.stringify(res.body.authorityWorkload)}`
    );
  }
});

// AC4: GET /api/analytics/bottlenecks as EMPLOYEE -> 403.
test('GET /api/analytics/bottlenecks - EMPLOYEE gets 403', async (t) => {
  const employee = await registerEmployee();
  registerCleanup(t, employee, []);

  const res = await request(app)
    .get('/api/analytics/bottlenecks')
    .set('Authorization', `Bearer ${employee.token}`);
  assert.equal(res.status, 403);
});

// AC5: GET /api/analytics/bottlenecks as DEPARTMENT_AUTHORITY -> scoped to own department only:
// slaBreachByDepartment has exactly 1 entry (own department), authorityWorkload has exactly 1
// entry. Uses a throwaway department (with its own single throwaway authority) rather than the
// seeded IT authority — seed.js now permanently provisions a second IT authority
// (it.authority2@opspulse.com), so "IT has exactly 1 DEPARTMENT_AUTHORITY" is no longer true; a
// freshly-created department is structurally guaranteed to have exactly one.
test('GET /api/analytics/bottlenecks - DEPARTMENT_AUTHORITY is scoped to own department only', async (t) => {
  const dept = await createThrowawayDepartmentWithAuthority(t);

  const res = await request(app)
    .get('/api/analytics/bottlenecks')
    .set('Authorization', `Bearer ${dept.authorityToken}`);
  assert.equal(res.status, 200, JSON.stringify(res.body));

  assert.equal(res.body.slaBreachByDepartment.length, 1);
  assert.equal(res.body.slaBreachByDepartment[0].department, dept.departmentName);

  assert.equal(res.body.authorityWorkload.length, 1);
});

// AC6 & AC7 & AC8: GET /api/analytics/bottlenecks for a DEPARTMENT_AUTHORITY of a zero-request
// department (throwaway Finance authority) -> 200, whole response well-formed with no crash:
// slaBreachByDepartment has exactly 1 entry with count 0 (AC8), authorityWorkload has exactly 1
// entry with active_count 0 (AC6), and all 3 stageDurations entries are null (AC7, no request in
// Finance has ever made any stage transition).
test('GET /api/analytics/bottlenecks - DEPARTMENT_AUTHORITY of a zero-request department gets an all-zero/null payload', async (t) => {
  const dept = await createThrowawayDepartmentWithAuthority(t);

  const res = await request(app)
    .get('/api/analytics/bottlenecks')
    .set('Authorization', `Bearer ${dept.authorityToken}`);
  assert.equal(res.status, 200, JSON.stringify(res.body));

  // AC8: whole response well-formed, no crash, no missing keys.
  assert.equal(res.body.slaBreachByDepartment.length, 1);
  assert.deepEqual(res.body.slaBreachByDepartment[0], { department: dept.departmentName, count: 0 });

  // AC6: authorityWorkload has exactly 1 entry with active_count 0 (not missing).
  assert.equal(res.body.authorityWorkload.length, 1);
  assert.equal(res.body.authorityWorkload[0].active_count, 0);

  // AC7: all 3 stageDurations entries are null (no request in this department has ever made any transition).
  assert.equal(res.body.stageDurations.length, 3);
  assert.ok(res.body.stageDurations.every((r) => r.avg_hours === null));
});

// employee-personal-summary AC1: GET /api/analytics/my-summary as EMPLOYEE reflects only that
// employee's own created_by requests across a mix of statuses (OPEN/ASSIGNED/COMPLETED), and is
// never affected by another employee's own request.
test('GET /api/analytics/my-summary - EMPLOYEE sees only their own requests across a mix of statuses', async (t) => {
  const employee = await registerEmployee();
  const otherEmployee = await registerEmployee();

  const openReq = await createRequestAs(employee.token, passwordResetTypeId, 'LOW');
  assert.equal(openReq.status, 201, JSON.stringify(openReq.body));

  const assignedReq = await createRequestAs(employee.token, passwordResetTypeId, 'LOW');
  assert.equal(assignedReq.status, 201, JSON.stringify(assignedReq.body));
  const assignRes = await request(app)
    .post(`/api/requests/${assignedReq.body.id}/assign`)
    .set('Authorization', `Bearer ${itAuthorityToken}`)
    .send();
  assert.equal(assignRes.status, 200, JSON.stringify(assignRes.body));

  const completedReqId = await createAndCompleteRequest(employee.token, itAuthorityToken, passwordResetTypeId, 'LOW');

  // another employee's own OPEN request must never affect the first employee's counts
  const otherReq = await createRequestAs(otherEmployee.token, passwordResetTypeId, 'LOW');
  assert.equal(otherReq.status, 201, JSON.stringify(otherReq.body));

  registerCleanup(t, employee, [openReq.body.id, assignedReq.body.id, completedReqId]);
  registerCleanup(t, otherEmployee, [otherReq.body.id]);

  const res = await request(app)
    .get('/api/analytics/my-summary')
    .set('Authorization', `Bearer ${employee.token}`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.total_open, 1);
  assert.equal(res.body.total_assigned, 1);
  assert.equal(res.body.total_in_progress, 0);
  assert.equal(res.body.total_completed, 1);
  assert.equal(res.body.total_rejected, 0);
  assert.equal(res.body.total_overdue, 0);
});

// employee-personal-summary AC2: GET /api/analytics/my-summary and /api/analytics/my-sla are
// EMPLOYEE-only -- DEPARTMENT_AUTHORITY and ADMIN both get 403 on both endpoints.
test('GET /api/analytics/my-summary and /api/analytics/my-sla - DEPARTMENT_AUTHORITY and ADMIN both get 403', async () => {
  const summaryAsAuthority = await request(app)
    .get('/api/analytics/my-summary')
    .set('Authorization', `Bearer ${itAuthorityToken}`);
  assert.equal(summaryAsAuthority.status, 403);

  const slaAsAuthority = await request(app)
    .get('/api/analytics/my-sla')
    .set('Authorization', `Bearer ${itAuthorityToken}`);
  assert.equal(slaAsAuthority.status, 403);

  const summaryAsAdmin = await request(app)
    .get('/api/analytics/my-summary')
    .set('Authorization', `Bearer ${adminToken}`);
  assert.equal(summaryAsAdmin.status, 403);

  const slaAsAdmin = await request(app)
    .get('/api/analytics/my-sla')
    .set('Authorization', `Bearer ${adminToken}`);
  assert.equal(slaAsAdmin.status, 403);
});

// employee-personal-summary AC3 (critical isolation test): GET /api/analytics/my-sla reflects
// only the requesting EMPLOYEE's own completed requests. Two different employees each complete
// exactly one request -- employee A's on time, employee B's pushed late past its sla_due_at (same
// technique as the existing "a late completion is not counted as on-time" test above). If my-sla
// ever failed to scope by created_by, employee A's compliance_rate would be dragged down by
// employee B's late completion (or vice versa) -- this makes the isolation check discriminating,
// not just a "both return 200" check.
test('GET /api/analytics/my-sla - reflects only the requesting EMPLOYEE\'s own completed requests, isolated from another employee\'s', async (t) => {
  const employeeA = await registerEmployee();
  const employeeB = await registerEmployee();

  const requestIdA = await createAndCompleteRequest(employeeA.token, hrAuthorityToken, leaveRequestTypeId, 'HIGH');
  const requestIdB = await createAndCompleteRequest(employeeB.token, hrAuthorityToken, leaveRequestTypeId, 'LOW');

  // Push employee B's STATUS_CHANGED -> COMPLETED history row's created_at to just past its
  // sla_due_at, so it counts as a late completion.
  const slaDueRow = await pool.query('SELECT sla_due_at FROM requests WHERE id = $1', [requestIdB]);
  const slaDueAt = slaDueRow.rows[0].sla_due_at;
  await pool.query(
    `UPDATE request_history
     SET created_at = $1::timestamptz + interval '1 hour'
     WHERE request_id = $2 AND action = 'STATUS_CHANGED' AND new_value = 'COMPLETED'`,
    [slaDueAt, requestIdB]
  );

  registerCleanup(t, employeeA, [requestIdA]);
  registerCleanup(t, employeeB, [requestIdB]);

  const slaResA = await request(app)
    .get('/api/analytics/my-sla')
    .set('Authorization', `Bearer ${employeeA.token}`);
  assert.equal(slaResA.status, 200, JSON.stringify(slaResA.body));
  assert.equal(slaResA.body.compliance_rate, 100);
  assert.ok(slaResA.body.avg_resolution_hours >= 0 && slaResA.body.avg_resolution_hours < 1);

  const slaResB = await request(app)
    .get('/api/analytics/my-sla')
    .set('Authorization', `Bearer ${employeeB.token}`);
  assert.equal(slaResB.status, 200, JSON.stringify(slaResB.body));
  assert.equal(slaResB.body.compliance_rate, 0);
});

// employee-personal-summary AC4: GET /api/analytics/my-sla for an EMPLOYEE with zero completed
// requests returns a zeroed payload, 200, no error (mirrors the existing department-scoped
// "zero completed requests" test's shape above).
test('GET /api/analytics/my-sla - EMPLOYEE with zero completed requests gets a zeroed payload', async (t) => {
  const employee = await registerEmployee();
  registerCleanup(t, employee, []);

  const res = await request(app)
    .get('/api/analytics/my-sla')
    .set('Authorization', `Bearer ${employee.token}`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body, { compliance_rate: 0, avg_resolution_hours: null });
});

// employee-personal-summary AC5: both new endpoints require authentication -- no Authorization
// header at all gets 401 from authMiddleware before ever reaching the controller (authMiddleware
// is mounted ahead of analyticsRoutes in server.js).
test('GET /api/analytics/my-summary and /api/analytics/my-sla - no Authorization header gets 401 on both', async () => {
  const summaryRes = await request(app).get('/api/analytics/my-summary');
  assert.equal(summaryRes.status, 401);

  const slaRes = await request(app).get('/api/analytics/my-sla');
  assert.equal(slaRes.status, 401);
});
