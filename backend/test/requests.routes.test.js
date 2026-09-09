const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const request = require('supertest');

const app = require('../server');
const pool = require('../services/db');

const ALLOWED_DOMAIN = process.env.ALLOWED_EMAIL_DOMAIN;
const SLA_HOURS = { HIGH: 4, MEDIUM: 24, LOW: 72 };

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
  await pool.query('DELETE FROM request_history WHERE request_id = $1', [requestId]);
  await pool.query('DELETE FROM requests WHERE id = $1', [requestId]);
}

async function deleteUser(userId) {
  await pool.query('DELETE FROM users WHERE id = $1', [userId]);
}

// Registers a single t.after hook (node:test runs hooks in FIFO/registration
// order, not LIFO) that deletes the given request ids (cascade) BEFORE the
// throwaway employee row itself, respecting the FK RESTRICT chain.
function registerCleanup(t, employee, requestIds) {
  t.after(async () => {
    for (const id of requestIds) {
      // eslint-disable-next-line no-await-in-loop
      await deleteRequestCascade(id);
    }
    await deleteUser(employee.id);
  });
}

// Creates a request directly via the API as the given employee token,
// for a given request type, optionally with a priority. Returns the body.
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

let itAuthorityToken;
let itAuthorityId;
let hrAuthorityToken;
let passwordResetTypeId; // IT
let leaveRequestTypeId; // HR
let itDepartmentId;

// Inserts a throwaway second DEPARTMENT_AUTHORITY in the IT department, reusing
// it.authority@opspulse.com's password_hash so plaintext 'sifre1234' still works,
// then logs in via supertest. Ported from realtime-queue.test.js's identical helper.
async function createSecondItAuthority() {
  const pwRow = await pool.query("SELECT password_hash FROM users WHERE email = 'it.authority@opspulse.com'");
  const email = `it-authority-2-${randomUUID()}@opspulse.com`;
  const insertRes = await pool.query(
    `INSERT INTO users (name, surname, email, password_hash, role, department_id)
     VALUES ($1, $2, $3, $4, 'DEPARTMENT_AUTHORITY', $5) RETURNING id`,
    ['Test', 'SecondItAuthority', email, pwRow.rows[0].password_hash, itDepartmentId]
  );
  const id = insertRes.rows[0].id;

  const loginRes = await request(app).post('/api/auth/login').send({ email, password: 'sifre1234' });
  assert.equal(loginRes.status, 200, `second IT authority login failed: ${JSON.stringify(loginRes.body)}`);

  return { id, email, token: loginRes.body.token };
}

test.before(async () => {
  const itLogin = await request(app)
    .post('/api/auth/login')
    .send({ email: 'it.authority@opspulse.com', password: 'sifre1234' });
  assert.equal(itLogin.status, 200, `IT authority login failed: ${JSON.stringify(itLogin.body)}`);
  itAuthorityToken = itLogin.body.token;
  itAuthorityId = itLogin.body.user.id;

  const hrLogin = await request(app)
    .post('/api/auth/login')
    .send({ email: 'hr.authority@opspulse.com', password: 'sifre1234' });
  assert.equal(hrLogin.status, 200, `HR authority login failed: ${JSON.stringify(hrLogin.body)}`);
  hrAuthorityToken = hrLogin.body.token;

  const prType = await pool.query("SELECT id, department_id FROM request_types WHERE name = 'Password Reset'");
  passwordResetTypeId = prType.rows[0].id;
  itDepartmentId = prType.rows[0].department_id;

  const lrType = await pool.query("SELECT id, department_id FROM request_types WHERE name = 'Leave Request'");
  leaveRequestTypeId = lrType.rows[0].id;
});

test.after(async () => {
  await pool.end();
});

// AC1: valid create -> 201, correct fields, department_id from request_type,
// sla_due_at = created_at + duration for priority (assert exact ms match).
test('POST /api/requests - valid creation returns 201 with server-derived department_id and exact sla_due_at', async (t) => {
  const employee = await registerEmployee();

  const typeRow = await pool.query('SELECT department_id FROM request_types WHERE id = $1', [passwordResetTypeId]);
  const expectedDepartmentId = typeRow.rows[0].department_id;

  // HIGH priority explicitly given
  const highRes = await createRequestAs(employee.token, passwordResetTypeId, 'HIGH');
  assert.equal(highRes.status, 201, JSON.stringify(highRes.body));

  // priority omitted -> defaults to MEDIUM
  const mediumRes = await createRequestAs(employee.token, passwordResetTypeId, undefined);
  assert.equal(mediumRes.status, 201, JSON.stringify(mediumRes.body));

  registerCleanup(t, employee, [highRes.body.id, mediumRes.body.id]);

  assert.equal(highRes.body.status, 'OPEN');
  assert.equal(highRes.body.assigned_to, null);
  assert.equal(highRes.body.department_id, expectedDepartmentId);
  assert.equal(highRes.body.priority, 'HIGH');

  const highCreatedAt = new Date(highRes.body.created_at).getTime();
  const highSlaDueAt = new Date(highRes.body.sla_due_at).getTime();
  assert.equal(highSlaDueAt, highCreatedAt + SLA_HOURS.HIGH * 60 * 60 * 1000);

  assert.equal(mediumRes.body.priority, 'MEDIUM');
  const mediumCreatedAt = new Date(mediumRes.body.created_at).getTime();
  const mediumSlaDueAt = new Date(mediumRes.body.sla_due_at).getTime();
  assert.equal(mediumSlaDueAt, mediumCreatedAt + SLA_HOURS.MEDIUM * 60 * 60 * 1000);
});

// AC2: assign by correct-department authority on OPEN request -> 200, ASSIGNED, assigned_to set.
test('POST /api/requests/:id/assign - correct-department authority claims OPEN request', async (t) => {
  const employee = await registerEmployee();

  const created = await createRequestAs(employee.token, passwordResetTypeId, 'LOW');
  assert.equal(created.status, 201);
  registerCleanup(t, employee, [created.body.id]);

  const assignRes = await request(app)
    .post(`/api/requests/${created.body.id}/assign`)
    .set('Authorization', `Bearer ${itAuthorityToken}`)
    .send();

  assert.equal(assignRes.status, 200, JSON.stringify(assignRes.body));
  assert.equal(assignRes.body.status, 'ASSIGNED');
  assert.equal(assignRes.body.assigned_to, itAuthorityId);
});

// AC3: claiming an already-ASSIGNED request (second claim) -> 409.
test('POST /api/requests/:id/assign - claiming an already-assigned request returns 409', async (t) => {
  const employee = await registerEmployee();

  const created = await createRequestAs(employee.token, passwordResetTypeId, 'LOW');
  assert.equal(created.status, 201);
  registerCleanup(t, employee, [created.body.id]);

  const firstAssign = await request(app)
    .post(`/api/requests/${created.body.id}/assign`)
    .set('Authorization', `Bearer ${itAuthorityToken}`)
    .send();
  assert.equal(firstAssign.status, 200);

  const secondAssign = await request(app)
    .post(`/api/requests/${created.body.id}/assign`)
    .set('Authorization', `Bearer ${itAuthorityToken}`)
    .send();
  assert.equal(secondAssign.status, 409);
});

// AC4: claiming by a DEPARTMENT_AUTHORITY from a different department -> 403.
test('POST /api/requests/:id/assign - different-department authority is forbidden', async (t) => {
  const employee = await registerEmployee();

  const created = await createRequestAs(employee.token, passwordResetTypeId, 'LOW');
  assert.equal(created.status, 201);
  registerCleanup(t, employee, [created.body.id]);

  const assignRes = await request(app)
    .post(`/api/requests/${created.body.id}/assign`)
    .set('Authorization', `Bearer ${hrAuthorityToken}`)
    .send();

  assert.equal(assignRes.status, 403);
});

// AC5: PATCH status ASSIGNED -> IN_PROGRESS by assigned officer -> 200.
test('PATCH /api/requests/:id/status - assigned officer moves ASSIGNED to IN_PROGRESS', async (t) => {
  const employee = await registerEmployee();

  const created = await createRequestAs(employee.token, passwordResetTypeId, 'LOW');
  assert.equal(created.status, 201);
  registerCleanup(t, employee, [created.body.id]);

  const assignRes = await request(app)
    .post(`/api/requests/${created.body.id}/assign`)
    .set('Authorization', `Bearer ${itAuthorityToken}`)
    .send();
  assert.equal(assignRes.status, 200);

  const statusRes = await request(app)
    .patch(`/api/requests/${created.body.id}/status`)
    .set('Authorization', `Bearer ${itAuthorityToken}`)
    .send({ status: 'IN_PROGRESS' });

  assert.equal(statusRes.status, 200, JSON.stringify(statusRes.body));
  assert.equal(statusRes.body.status, 'IN_PROGRESS');
});

// AC6a: backwards transition IN_PROGRESS -> ASSIGNED -> 400.
test('PATCH /api/requests/:id/status - backwards transition IN_PROGRESS to ASSIGNED returns 400', async (t) => {
  const employee = await registerEmployee();

  const created = await createRequestAs(employee.token, passwordResetTypeId, 'LOW');
  assert.equal(created.status, 201);
  registerCleanup(t, employee, [created.body.id]);

  await request(app)
    .post(`/api/requests/${created.body.id}/assign`)
    .set('Authorization', `Bearer ${itAuthorityToken}`)
    .send();

  const toInProgress = await request(app)
    .patch(`/api/requests/${created.body.id}/status`)
    .set('Authorization', `Bearer ${itAuthorityToken}`)
    .send({ status: 'IN_PROGRESS' });
  assert.equal(toInProgress.status, 200);

  const backwards = await request(app)
    .patch(`/api/requests/${created.body.id}/status`)
    .set('Authorization', `Bearer ${itAuthorityToken}`)
    .send({ status: 'ASSIGNED' });

  assert.equal(backwards.status, 400);
});

// AC6b: any transition attempt on an already-COMPLETED request -> 400 (no reopen).
test('PATCH /api/requests/:id/status - transition attempt on a COMPLETED request returns 400', async (t) => {
  const employee = await registerEmployee();

  const created = await createRequestAs(employee.token, passwordResetTypeId, 'LOW');
  assert.equal(created.status, 201);
  registerCleanup(t, employee, [created.body.id]);

  await request(app)
    .post(`/api/requests/${created.body.id}/assign`)
    .set('Authorization', `Bearer ${itAuthorityToken}`)
    .send();

  await request(app)
    .patch(`/api/requests/${created.body.id}/status`)
    .set('Authorization', `Bearer ${itAuthorityToken}`)
    .send({ status: 'IN_PROGRESS' });

  const completeRes = await request(app)
    .patch(`/api/requests/${created.body.id}/status`)
    .set('Authorization', `Bearer ${itAuthorityToken}`)
    .send({ status: 'COMPLETED' });
  assert.equal(completeRes.status, 200);

  const reopenAttempt = await request(app)
    .patch(`/api/requests/${created.body.id}/status`)
    .set('Authorization', `Bearer ${itAuthorityToken}`)
    .send({ status: 'IN_PROGRESS' });

  assert.equal(reopenAttempt.status, 400);
});

// AC7: PATCH status REJECTED with no/empty note -> 400.
test('PATCH /api/requests/:id/status - rejecting without a note returns 400', async (t) => {
  const employee = await registerEmployee();

  const created = await createRequestAs(employee.token, passwordResetTypeId, 'LOW');
  assert.equal(created.status, 201);
  registerCleanup(t, employee, [created.body.id]);

  const noNoteRes = await request(app)
    .patch(`/api/requests/${created.body.id}/status`)
    .set('Authorization', `Bearer ${itAuthorityToken}`)
    .send({ status: 'REJECTED' });
  assert.equal(noNoteRes.status, 400);

  const emptyNoteRes = await request(app)
    .patch(`/api/requests/${created.body.id}/status`)
    .set('Authorization', `Bearer ${itAuthorityToken}`)
    .send({ status: 'REJECTED', note: '   ' });
  assert.equal(emptyNoteRes.status, 400);
});

// AC8: rejecting ASSIGNED/IN_PROGRESS by someone other than the assigned officer -> 403.
// Also: OPEN -> REJECTED succeeds when called by ANY matching-department authority -> 200.
test('PATCH /api/requests/:id/status - rejection authorization: non-assignee forbidden, any matching-department authority can reject OPEN', async (t) => {
  const employee = await registerEmployee();

  // OPEN -> REJECTED by matching-department authority succeeds.
  const openReq = await createRequestAs(employee.token, passwordResetTypeId, 'LOW');
  assert.equal(openReq.status, 201);

  // OPEN -> REJECTED by a DIFFERENT department's authority is forbidden.
  const openReq2 = await createRequestAs(employee.token, passwordResetTypeId, 'LOW');
  assert.equal(openReq2.status, 201);

  // ASSIGNED -> REJECTED by someone other than the assigned officer is forbidden
  // (here: the other seeded authority, from a different department).
  const assignedReq = await createRequestAs(employee.token, passwordResetTypeId, 'LOW');
  assert.equal(assignedReq.status, 201);

  registerCleanup(t, employee, [openReq.body.id, openReq2.body.id, assignedReq.body.id]);

  const openRejectRes = await request(app)
    .patch(`/api/requests/${openReq.body.id}/status`)
    .set('Authorization', `Bearer ${itAuthorityToken}`)
    .send({ status: 'REJECTED', note: 'Not needed anymore' });
  assert.equal(openRejectRes.status, 200, JSON.stringify(openRejectRes.body));
  assert.equal(openRejectRes.body.status, 'REJECTED');

  const wrongDeptRejectRes = await request(app)
    .patch(`/api/requests/${openReq2.body.id}/status`)
    .set('Authorization', `Bearer ${hrAuthorityToken}`)
    .send({ status: 'REJECTED', note: 'Not my department' });
  assert.equal(wrongDeptRejectRes.status, 403);

  const assignRes = await request(app)
    .post(`/api/requests/${assignedReq.body.id}/assign`)
    .set('Authorization', `Bearer ${itAuthorityToken}`)
    .send();
  assert.equal(assignRes.status, 200);

  const nonAssigneeRejectRes = await request(app)
    .patch(`/api/requests/${assignedReq.body.id}/status`)
    .set('Authorization', `Bearer ${hrAuthorityToken}`)
    .send({ status: 'REJECTED', note: 'Not my request' });
  assert.equal(nonAssigneeRejectRes.status, 403);
});

// AC9: PATCH priority by assigned officer on ASSIGNED/IN_PROGRESS -> 200, sla_due_at
// recomputed from ORIGINAL created_at (assert stability across two priority changes).
test('PATCH /api/requests/:id/priority - assigned officer changes priority, sla_due_at anchored to original created_at', async (t) => {
  const employee = await registerEmployee();

  const created = await createRequestAs(employee.token, passwordResetTypeId, 'LOW');
  assert.equal(created.status, 201);
  registerCleanup(t, employee, [created.body.id]);

  const originalCreatedAt = new Date(created.body.created_at).getTime();

  const assignRes = await request(app)
    .post(`/api/requests/${created.body.id}/assign`)
    .set('Authorization', `Bearer ${itAuthorityToken}`)
    .send();
  assert.equal(assignRes.status, 200);

  const firstPriorityRes = await request(app)
    .patch(`/api/requests/${created.body.id}/priority`)
    .set('Authorization', `Bearer ${itAuthorityToken}`)
    .send({ priority: 'HIGH' });
  assert.equal(firstPriorityRes.status, 200, JSON.stringify(firstPriorityRes.body));
  assert.equal(firstPriorityRes.body.priority, 'HIGH');
  assert.equal(
    new Date(firstPriorityRes.body.sla_due_at).getTime(),
    originalCreatedAt + SLA_HOURS.HIGH * 60 * 60 * 1000
  );

  // Move to IN_PROGRESS, then change priority again - anchor must still be original created_at.
  const toInProgress = await request(app)
    .patch(`/api/requests/${created.body.id}/status`)
    .set('Authorization', `Bearer ${itAuthorityToken}`)
    .send({ status: 'IN_PROGRESS' });
  assert.equal(toInProgress.status, 200);

  const secondPriorityRes = await request(app)
    .patch(`/api/requests/${created.body.id}/priority`)
    .set('Authorization', `Bearer ${itAuthorityToken}`)
    .send({ priority: 'MEDIUM' });
  assert.equal(secondPriorityRes.status, 200, JSON.stringify(secondPriorityRes.body));
  assert.equal(secondPriorityRes.body.priority, 'MEDIUM');
  assert.equal(
    new Date(secondPriorityRes.body.sla_due_at).getTime(),
    originalCreatedAt + SLA_HOURS.MEDIUM * 60 * 60 * 1000
  );
  assert.equal(new Date(secondPriorityRes.body.created_at).getTime(), originalCreatedAt);
});

// AC10: changing priority on an OPEN (unassigned) request -> 403.
test('PATCH /api/requests/:id/priority - changing priority on an OPEN request returns 403', async (t) => {
  const employee = await registerEmployee();

  const created = await createRequestAs(employee.token, passwordResetTypeId, 'LOW');
  assert.equal(created.status, 201);
  registerCleanup(t, employee, [created.body.id]);

  const priorityRes = await request(app)
    .patch(`/api/requests/${created.body.id}/priority`)
    .set('Authorization', `Bearer ${itAuthorityToken}`)
    .send({ priority: 'HIGH' });

  assert.equal(priorityRes.status, 403);
});

// Regression: changing priority on a COMPLETED (terminal) request -> 403,
// even for the original assigned officer.
test('PATCH /api/requests/:id/priority - changing priority on a COMPLETED request is forbidden (regression)', async (t) => {
  const employee = await registerEmployee();

  const created = await createRequestAs(employee.token, passwordResetTypeId, 'LOW');
  assert.equal(created.status, 201);
  registerCleanup(t, employee, [created.body.id]);

  await request(app)
    .post(`/api/requests/${created.body.id}/assign`)
    .set('Authorization', `Bearer ${itAuthorityToken}`)
    .send();

  await request(app)
    .patch(`/api/requests/${created.body.id}/status`)
    .set('Authorization', `Bearer ${itAuthorityToken}`)
    .send({ status: 'IN_PROGRESS' });

  const completeRes = await request(app)
    .patch(`/api/requests/${created.body.id}/status`)
    .set('Authorization', `Bearer ${itAuthorityToken}`)
    .send({ status: 'COMPLETED' });
  assert.equal(completeRes.status, 200);

  const priorityRes = await request(app)
    .patch(`/api/requests/${created.body.id}/priority`)
    .set('Authorization', `Bearer ${itAuthorityToken}`)
    .send({ priority: 'HIGH' });

  assert.equal(priorityRes.status, 403);
});

// AC11: creation with nonexistent request_type_id -> 404; existing-but-inactive -> 400
// (temporarily flip is_active off for this test only, restore in t.after()).
test('POST /api/requests - nonexistent request_type_id returns 404, inactive one returns 400', async (t) => {
  const employee = await registerEmployee();
  registerCleanup(t, employee, []);

  const nonexistentRes = await createRequestAs(employee.token, randomUUID(), 'LOW');
  assert.equal(nonexistentRes.status, 404);

  t.after(async () => {
    await pool.query('UPDATE request_types SET is_active = true WHERE id = $1', [leaveRequestTypeId]);
  });
  await pool.query('UPDATE request_types SET is_active = false WHERE id = $1', [leaveRequestTypeId]);

  const inactiveRes = await createRequestAs(employee.token, leaveRequestTypeId, 'LOW');
  assert.equal(inactiveRes.status, 400);
});

// ---------------------------------------------------------------------
// GET /api/requests?assigned_to_me=true — assigned-to-me filter
// ---------------------------------------------------------------------

// AC1: a DEPARTMENT_AUTHORITY with requests in several statuses (some claimed
// by them, some not) - assigned_to_me=true returns only their own
// ASSIGNED/IN_PROGRESS requests, excluding their own COMPLETED/REJECTED ones
// and excluding a still-OPEN request they haven't claimed.
test('GET /api/requests?assigned_to_me=true - returns only the caller\'s own ASSIGNED/IN_PROGRESS requests', async (t) => {
  const employee = await registerEmployee();

  const openReq = await createRequestAs(employee.token, passwordResetTypeId, 'LOW');
  const assignedReq = await createRequestAs(employee.token, passwordResetTypeId, 'LOW');
  const inProgressReq = await createRequestAs(employee.token, passwordResetTypeId, 'LOW');
  const completedReq = await createRequestAs(employee.token, passwordResetTypeId, 'LOW');
  const rejectedReq = await createRequestAs(employee.token, passwordResetTypeId, 'LOW');
  assert.equal(openReq.status, 201);
  assert.equal(assignedReq.status, 201);
  assert.equal(inProgressReq.status, 201);
  assert.equal(completedReq.status, 201);
  assert.equal(rejectedReq.status, 201);

  registerCleanup(t, employee, [
    openReq.body.id,
    assignedReq.body.id,
    inProgressReq.body.id,
    completedReq.body.id,
    rejectedReq.body.id,
  ]);

  // Claim all four non-OPEN ones as itAuthority.
  for (const req of [assignedReq, inProgressReq, completedReq, rejectedReq]) {
    // eslint-disable-next-line no-await-in-loop
    const assignRes = await request(app)
      .post(`/api/requests/${req.body.id}/assign`)
      .set('Authorization', `Bearer ${itAuthorityToken}`)
      .send();
    assert.equal(assignRes.status, 200);
  }

  const toInProgress = await request(app)
    .patch(`/api/requests/${inProgressReq.body.id}/status`)
    .set('Authorization', `Bearer ${itAuthorityToken}`)
    .send({ status: 'IN_PROGRESS' });
  assert.equal(toInProgress.status, 200);

  await request(app)
    .patch(`/api/requests/${completedReq.body.id}/status`)
    .set('Authorization', `Bearer ${itAuthorityToken}`)
    .send({ status: 'IN_PROGRESS' });
  const toCompleted = await request(app)
    .patch(`/api/requests/${completedReq.body.id}/status`)
    .set('Authorization', `Bearer ${itAuthorityToken}`)
    .send({ status: 'COMPLETED' });
  assert.equal(toCompleted.status, 200);

  const toRejected = await request(app)
    .patch(`/api/requests/${rejectedReq.body.id}/status`)
    .set('Authorization', `Bearer ${itAuthorityToken}`)
    .send({ status: 'REJECTED', note: 'Not needed' });
  assert.equal(toRejected.status, 200);

  const res = await request(app)
    .get('/api/requests?assigned_to_me=true')
    .set('Authorization', `Bearer ${itAuthorityToken}`)
    .send();
  assert.equal(res.status, 200, JSON.stringify(res.body));

  const ids = res.body.map((r) => r.id);
  assert.ok(ids.includes(assignedReq.body.id), 'ASSIGNED request should be included');
  assert.ok(ids.includes(inProgressReq.body.id), 'IN_PROGRESS request should be included');
  assert.ok(!ids.includes(openReq.body.id), 'OPEN (unclaimed) request should be excluded');
  assert.ok(!ids.includes(completedReq.body.id), 'COMPLETED request should be excluded');
  assert.ok(!ids.includes(rejectedReq.body.id), 'REJECTED request should be excluded');
});

// AC2: THE MOST IMPORTANT TEST — two DEPARTMENT_AUTHORITY users in the SAME
// department: assigned_to_me=true for A never returns anything claimed by B,
// and vice versa. Also proves there is no client-supplied way (user_id /
// assigned_to query params) to see someone else's assigned requests - only
// the authenticated caller's own id is ever used.
test('GET /api/requests?assigned_to_me=true - isolates two same-department authorities from each other, with no client-supplied override', async (t) => {
  const employee = await registerEmployee();
  const secondAuthority = await createSecondItAuthority();

  const reqForA = await createRequestAs(employee.token, passwordResetTypeId, 'LOW');
  const reqForB = await createRequestAs(employee.token, passwordResetTypeId, 'LOW');
  assert.equal(reqForA.status, 201);
  assert.equal(reqForB.status, 201);
  // Requests (and their assigned_to references) must be deleted BEFORE the
  // throwaway second authority user row, respecting the FK RESTRICT chain -
  // node:test runs t.after hooks in FIFO/registration order, so registerCleanup
  // (which deletes requests, then the throwaway employee) must be registered
  // first, and the second authority's own deletion after it.
  registerCleanup(t, employee, [reqForA.body.id, reqForB.body.id]);
  t.after(async () => {
    await pool.query('DELETE FROM users WHERE id = $1', [secondAuthority.id]);
  });

  const assignA = await request(app)
    .post(`/api/requests/${reqForA.body.id}/assign`)
    .set('Authorization', `Bearer ${itAuthorityToken}`)
    .send();
  assert.equal(assignA.status, 200);

  const assignB = await request(app)
    .post(`/api/requests/${reqForB.body.id}/assign`)
    .set('Authorization', `Bearer ${secondAuthority.token}`)
    .send();
  assert.equal(assignB.status, 200);

  const resA = await request(app)
    .get('/api/requests?assigned_to_me=true')
    .set('Authorization', `Bearer ${itAuthorityToken}`)
    .send();
  assert.equal(resA.status, 200, JSON.stringify(resA.body));
  const idsA = resA.body.map((r) => r.id);
  assert.ok(idsA.includes(reqForA.body.id), "A's assigned_to_me should include A's own claimed request");
  assert.ok(!idsA.includes(reqForB.body.id), "A's assigned_to_me must never include B's claimed request");

  const resB = await request(app)
    .get('/api/requests?assigned_to_me=true')
    .set('Authorization', `Bearer ${secondAuthority.token}`)
    .send();
  assert.equal(resB.status, 200, JSON.stringify(resB.body));
  const idsB = resB.body.map((r) => r.id);
  assert.ok(idsB.includes(reqForB.body.id), "B's assigned_to_me should include B's own claimed request");
  assert.ok(!idsB.includes(reqForA.body.id), "B's assigned_to_me must never include A's claimed request");

  // No way to specify whose requests to see other than "the authenticated
  // caller" - user_id/assigned_to query params do nothing; A still only sees
  // its own claimed request even when trying to ask for B's.
  const spoofAttempt = await request(app)
    .get(`/api/requests?assigned_to_me=true&user_id=${secondAuthority.id}&assigned_to=${secondAuthority.id}`)
    .set('Authorization', `Bearer ${itAuthorityToken}`)
    .send();
  assert.equal(spoofAttempt.status, 200, JSON.stringify(spoofAttempt.body));
  const spoofIds = spoofAttempt.body.map((r) => r.id);
  assert.ok(spoofIds.includes(reqForA.body.id), 'unrecognized query params must not change the result');
  assert.ok(!spoofIds.includes(reqForB.body.id), 'user_id/assigned_to params must have no effect - B\'s request stays excluded');
});

// AC3: EMPLOYEE and ADMIN sending assigned_to_me=true doesn't break their
// existing scoping. EMPLOYEE still only sees own (created_by) requests
// (trivially empty for assigned_to_me, since employees are never assignees).
// ADMIN's unrestricted view still works with the added, always-empty-in-
// practice assigned_to condition (ADMIN never has assigned_to = their id).
test('GET /api/requests?assigned_to_me=true - EMPLOYEE and ADMIN scoping is unaffected', async (t) => {
  const employee = await registerEmployee();

  const created = await createRequestAs(employee.token, passwordResetTypeId, 'LOW');
  assert.equal(created.status, 201);
  registerCleanup(t, employee, [created.body.id]);

  const assignRes = await request(app)
    .post(`/api/requests/${created.body.id}/assign`)
    .set('Authorization', `Bearer ${itAuthorityToken}`)
    .send();
  assert.equal(assignRes.status, 200);

  // EMPLOYEE: assigned_to_me=true still scoped by created_by = self, so the
  // now-ASSIGNED request they created (but did not claim, being an employee)
  // is excluded - the result is empty.
  const employeeRes = await request(app)
    .get('/api/requests?assigned_to_me=true')
    .set('Authorization', `Bearer ${employee.token}`)
    .send();
  assert.equal(employeeRes.status, 200, JSON.stringify(employeeRes.body));
  assert.deepEqual(employeeRes.body, []);

  // Sanity: without assigned_to_me, the employee still sees their own request
  // normally (existing created_by scoping unaffected by this feature).
  const employeeUnfiltered = await request(app)
    .get('/api/requests')
    .set('Authorization', `Bearer ${employee.token}`)
    .send();
  assert.equal(employeeUnfiltered.status, 200);
  assert.ok(employeeUnfiltered.body.some((r) => r.id === created.body.id));

  // ADMIN: assigned_to_me=true is meaningless for ADMIN (never the assignee
  // of anything), so the ADMIN sees no requests through it, but the ADMIN's
  // unfiltered, unrestricted view still returns the request normally.
  // Insert a throwaway ADMIN directly via SQL (no API path can create one),
  // reusing the seeded IT authority's password_hash so the plaintext
  // password 'sifre1234' still works for login (see requests.read.test.js
  // for the identical convention).
  const pwRow = await pool.query("SELECT password_hash FROM users WHERE email = 'it.authority@opspulse.com'");
  const adminEmail = `admin-${randomUUID()}@opspulse.com`;
  const adminInsert = await pool.query(
    `INSERT INTO users (name, surname, email, password_hash, role) VALUES ($1, $2, $3, $4, 'ADMIN') RETURNING id`,
    ['Test', 'Admin', adminEmail, pwRow.rows[0].password_hash]
  );
  t.after(async () => {
    await pool.query('DELETE FROM users WHERE id = $1', [adminInsert.rows[0].id]);
  });

  const adminLogin = await request(app).post('/api/auth/login').send({ email: adminEmail, password: 'sifre1234' });
  assert.equal(adminLogin.status, 200, `admin login failed: ${JSON.stringify(adminLogin.body)}`);
  const adminToken = adminLogin.body.token;

  const adminAssignedToMeRes = await request(app)
    .get('/api/requests?assigned_to_me=true')
    .set('Authorization', `Bearer ${adminToken}`)
    .send();
  assert.equal(adminAssignedToMeRes.status, 200, JSON.stringify(adminAssignedToMeRes.body));
  assert.ok(!adminAssignedToMeRes.body.some((r) => r.id === created.body.id));

  const adminUnfilteredRes = await request(app)
    .get('/api/requests')
    .set('Authorization', `Bearer ${adminToken}`)
    .send();
  assert.equal(adminUnfilteredRes.status, 200);
  assert.ok(adminUnfilteredRes.body.some((r) => r.id === created.body.id));
});

// AC4: assigned_to_me=true's hardcoded status restriction always wins over a
// separately-sent status param - sending assigned_to_me=true&status=COMPLETED
// must NOT return a COMPLETED request, only ASSIGNED/IN_PROGRESS ones.
test('GET /api/requests?assigned_to_me=true&status=COMPLETED - assigned_to_me status restriction overrides the status param', async (t) => {
  const employee = await registerEmployee();

  const assignedReq = await createRequestAs(employee.token, passwordResetTypeId, 'LOW');
  const completedReq = await createRequestAs(employee.token, passwordResetTypeId, 'LOW');
  assert.equal(assignedReq.status, 201);
  assert.equal(completedReq.status, 201);
  registerCleanup(t, employee, [assignedReq.body.id, completedReq.body.id]);

  const assignA = await request(app)
    .post(`/api/requests/${assignedReq.body.id}/assign`)
    .set('Authorization', `Bearer ${itAuthorityToken}`)
    .send();
  assert.equal(assignA.status, 200);

  await request(app)
    .post(`/api/requests/${completedReq.body.id}/assign`)
    .set('Authorization', `Bearer ${itAuthorityToken}`)
    .send();
  await request(app)
    .patch(`/api/requests/${completedReq.body.id}/status`)
    .set('Authorization', `Bearer ${itAuthorityToken}`)
    .send({ status: 'IN_PROGRESS' });
  const toCompleted = await request(app)
    .patch(`/api/requests/${completedReq.body.id}/status`)
    .set('Authorization', `Bearer ${itAuthorityToken}`)
    .send({ status: 'COMPLETED' });
  assert.equal(toCompleted.status, 200);

  const res = await request(app)
    .get('/api/requests?assigned_to_me=true&status=COMPLETED')
    .set('Authorization', `Bearer ${itAuthorityToken}`)
    .send();
  assert.equal(res.status, 200, JSON.stringify(res.body));

  const ids = res.body.map((r) => r.id);
  assert.ok(!ids.includes(completedReq.body.id), 'COMPLETED request must NOT be returned - assigned_to_me wins over status');
  assert.ok(ids.includes(assignedReq.body.id), 'the ASSIGNED request should still be returned');
});

// AC5: assigned_to_me=true combined with request_type_id and/or priority ANDs
// all conditions together.
test('GET /api/requests?assigned_to_me=true - combines with request_type_id and priority via AND', async (t) => {
  const employee = await registerEmployee();

  const matchingReq = await createRequestAs(employee.token, passwordResetTypeId, 'HIGH');
  const wrongPriorityReq = await createRequestAs(employee.token, passwordResetTypeId, 'LOW');
  assert.equal(matchingReq.status, 201);
  assert.equal(wrongPriorityReq.status, 201);
  registerCleanup(t, employee, [matchingReq.body.id, wrongPriorityReq.body.id]);

  const assignMatching = await request(app)
    .post(`/api/requests/${matchingReq.body.id}/assign`)
    .set('Authorization', `Bearer ${itAuthorityToken}`)
    .send();
  assert.equal(assignMatching.status, 200);

  const assignWrongPriority = await request(app)
    .post(`/api/requests/${wrongPriorityReq.body.id}/assign`)
    .set('Authorization', `Bearer ${itAuthorityToken}`)
    .send();
  assert.equal(assignWrongPriority.status, 200);

  // request_type_id combined - both requests share passwordResetTypeId, so
  // both should be returned.
  const byTypeRes = await request(app)
    .get(`/api/requests?assigned_to_me=true&request_type_id=${passwordResetTypeId}`)
    .set('Authorization', `Bearer ${itAuthorityToken}`)
    .send();
  assert.equal(byTypeRes.status, 200, JSON.stringify(byTypeRes.body));
  const byTypeIds = byTypeRes.body.map((r) => r.id);
  assert.ok(byTypeIds.includes(matchingReq.body.id));
  assert.ok(byTypeIds.includes(wrongPriorityReq.body.id));

  // priority=HIGH combined - only matchingReq (HIGH) should be returned, not
  // wrongPriorityReq (LOW).
  const byPriorityRes = await request(app)
    .get('/api/requests?assigned_to_me=true&priority=HIGH')
    .set('Authorization', `Bearer ${itAuthorityToken}`)
    .send();
  assert.equal(byPriorityRes.status, 200, JSON.stringify(byPriorityRes.body));
  const byPriorityIds = byPriorityRes.body.map((r) => r.id);
  assert.ok(byPriorityIds.includes(matchingReq.body.id), 'HIGH priority request should be included');
  assert.ok(!byPriorityIds.includes(wrongPriorityReq.body.id), 'LOW priority request should be excluded by the AND');

  // Combined request_type_id + priority together.
  const combinedRes = await request(app)
    .get(`/api/requests?assigned_to_me=true&request_type_id=${passwordResetTypeId}&priority=HIGH`)
    .set('Authorization', `Bearer ${itAuthorityToken}`)
    .send();
  assert.equal(combinedRes.status, 200, JSON.stringify(combinedRes.body));
  const combinedIds = combinedRes.body.map((r) => r.id);
  assert.ok(combinedIds.includes(matchingReq.body.id));
  assert.ok(!combinedIds.includes(wrongPriorityReq.body.id));

  // A non-matching request_type_id (HR's Leave Request type) excludes both,
  // since both requests are of the IT Password Reset type.
  const nonMatchingTypeRes = await request(app)
    .get(`/api/requests?assigned_to_me=true&request_type_id=${leaveRequestTypeId}`)
    .set('Authorization', `Bearer ${itAuthorityToken}`)
    .send();
  assert.equal(nonMatchingTypeRes.status, 200, JSON.stringify(nonMatchingTypeRes.body));
  const nonMatchingTypeIds = nonMatchingTypeRes.body.map((r) => r.id);
  assert.ok(!nonMatchingTypeIds.includes(matchingReq.body.id));
  assert.ok(!nonMatchingTypeIds.includes(wrongPriorityReq.body.id));
});
