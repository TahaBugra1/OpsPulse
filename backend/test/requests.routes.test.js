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
