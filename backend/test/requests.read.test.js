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

// Like createRequestAs, but allows a custom title/description for the
// search-filter (?q=) tests below, which need to control matching text.
async function createCustomRequestAs(employeeToken, requestTypeId, priority, title, description) {
  const body = {
    title,
    description,
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
let adminId;
let adminToken;

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

// AC1: EMPLOYEE list -> only own requests; another employee's request must not appear.
test('GET /api/requests - EMPLOYEE sees only their own requests', async (t) => {
  const employeeA = await registerEmployee();
  const employeeB = await registerEmployee();

  const reqA = await createRequestAs(employeeA.token, passwordResetTypeId, 'LOW');
  assert.equal(reqA.status, 201);
  const reqB = await createRequestAs(employeeB.token, passwordResetTypeId, 'LOW');
  assert.equal(reqB.status, 201);

  registerCleanup(t, employeeA, [reqA.body.id]);
  registerCleanup(t, employeeB, [reqB.body.id]);

  const listRes = await request(app)
    .get('/api/requests')
    .set('Authorization', `Bearer ${employeeA.token}`);

  assert.equal(listRes.status, 200, JSON.stringify(listRes.body));
  const ids = listRes.body.map((r) => r.id);
  assert.ok(ids.includes(reqA.body.id));
  assert.ok(!ids.includes(reqB.body.id));
});

// AC2: DEPARTMENT_AUTHORITY list -> all rows in that department including an
// unassigned OPEN one; a different-department authority does NOT see it.
test('GET /api/requests - DEPARTMENT_AUTHORITY sees all requests in their department, including unassigned OPEN ones', async (t) => {
  const employee = await registerEmployee();

  const openReq = await createRequestAs(employee.token, passwordResetTypeId, 'LOW');
  assert.equal(openReq.status, 201);
  registerCleanup(t, employee, [openReq.body.id]);

  const itListRes = await request(app)
    .get('/api/requests')
    .set('Authorization', `Bearer ${itAuthorityToken}`);
  assert.equal(itListRes.status, 200, JSON.stringify(itListRes.body));
  const itIds = itListRes.body.map((r) => r.id);
  assert.ok(itIds.includes(openReq.body.id));
  const seenRow = itListRes.body.find((r) => r.id === openReq.body.id);
  assert.equal(seenRow.status, 'OPEN');
  assert.equal(seenRow.assigned_to, null);

  const hrListRes = await request(app)
    .get('/api/requests')
    .set('Authorization', `Bearer ${hrAuthorityToken}`);
  assert.equal(hrListRes.status, 200, JSON.stringify(hrListRes.body));
  const hrIds = hrListRes.body.map((r) => r.id);
  assert.ok(!hrIds.includes(openReq.body.id));
});

// AC3: ADMIN sees requests regardless of creator/department (from two different departments/creators).
test('GET /api/requests - ADMIN sees requests across different departments and creators', async (t) => {
  const employeeIt = await registerEmployee();
  const employeeHr = await registerEmployee();

  const itReq = await createRequestAs(employeeIt.token, passwordResetTypeId, 'LOW');
  assert.equal(itReq.status, 201);
  const hrReq = await createRequestAs(employeeHr.token, leaveRequestTypeId, 'LOW');
  assert.equal(hrReq.status, 201);

  registerCleanup(t, employeeIt, [itReq.body.id]);
  registerCleanup(t, employeeHr, [hrReq.body.id]);

  const adminListRes = await request(app)
    .get('/api/requests')
    .set('Authorization', `Bearer ${adminToken}`);

  assert.equal(adminListRes.status, 200, JSON.stringify(adminListRes.body));
  const ids = adminListRes.body.map((r) => r.id);
  assert.ok(ids.includes(itReq.body.id));
  assert.ok(ids.includes(hrReq.body.id));
});

// AC4: ?status=OPEN narrows results within caller's scope; invalid status -> 400.
test('GET /api/requests?status= - narrows results within scope, invalid status returns 400', async (t) => {
  const employee = await registerEmployee();

  const openReq = await createRequestAs(employee.token, passwordResetTypeId, 'LOW');
  assert.equal(openReq.status, 201);

  const rejectRes = await request(app)
    .patch(`/api/requests/${openReq.body.id}/status`)
    .set('Authorization', `Bearer ${itAuthorityToken}`)
    .send({ status: 'REJECTED', note: 'test rejection for filtering' });
  assert.equal(rejectRes.status, 200, JSON.stringify(rejectRes.body));

  const secondReq = await createRequestAs(employee.token, passwordResetTypeId, 'LOW');
  assert.equal(secondReq.status, 201);
  registerCleanup(t, employee, [openReq.body.id, secondReq.body.id]);

  const rejectedListRes = await request(app)
    .get('/api/requests?status=REJECTED')
    .set('Authorization', `Bearer ${employee.token}`);
  assert.equal(rejectedListRes.status, 200, JSON.stringify(rejectedListRes.body));
  const rejectedIds = rejectedListRes.body.map((r) => r.id);
  assert.ok(rejectedIds.includes(openReq.body.id));
  assert.ok(!rejectedIds.includes(secondReq.body.id));

  const invalidStatusRes = await request(app)
    .get('/api/requests?status=NOT_A_REAL_STATUS')
    .set('Authorization', `Bearer ${employee.token}`);
  assert.equal(invalidStatusRes.status, 400);
});

// AC5: creating EMPLOYEE fetches their own request by id -> 200 with full body.
test('GET /api/requests/:id - creating EMPLOYEE gets 200 with full body', async (t) => {
  const employee = await registerEmployee();

  const created = await createRequestAs(employee.token, passwordResetTypeId, 'LOW');
  assert.equal(created.status, 201);
  registerCleanup(t, employee, [created.body.id]);

  const getRes = await request(app)
    .get(`/api/requests/${created.body.id}`)
    .set('Authorization', `Bearer ${employee.token}`);

  assert.equal(getRes.status, 200, JSON.stringify(getRes.body));
  assert.equal(getRes.body.id, created.body.id);
  assert.equal(getRes.body.title, 'Test request');
});

// AC6: DEPARTMENT_AUTHORITY of the matching department gets 200 for an unassigned request.
test('GET /api/requests/:id - matching-department authority gets 200 for an unassigned request', async (t) => {
  const employee = await registerEmployee();

  const created = await createRequestAs(employee.token, passwordResetTypeId, 'LOW');
  assert.equal(created.status, 201);
  registerCleanup(t, employee, [created.body.id]);

  const getRes = await request(app)
    .get(`/api/requests/${created.body.id}`)
    .set('Authorization', `Bearer ${itAuthorityToken}`);

  assert.equal(getRes.status, 200, JSON.stringify(getRes.body));
  assert.equal(getRes.body.id, created.body.id);
});

// AC7: ADMIN gets 200 for a request created by someone else.
test('GET /api/requests/:id - ADMIN gets 200 for a request created by someone else', async (t) => {
  const employee = await registerEmployee();

  const created = await createRequestAs(employee.token, passwordResetTypeId, 'LOW');
  assert.equal(created.status, 201);
  registerCleanup(t, employee, [created.body.id]);

  const getRes = await request(app)
    .get(`/api/requests/${created.body.id}`)
    .set('Authorization', `Bearer ${adminToken}`);

  assert.equal(getRes.status, 200, JSON.stringify(getRes.body));
  assert.equal(getRes.body.id, created.body.id);
});

// AC8: unauthorized actors get 403 - (a) a different EMPLOYEE, (b) a different-department authority.
test('GET /api/requests/:id - unauthorized actors get 403', async (t) => {
  const owner = await registerEmployee();
  const otherEmployee = await registerEmployee();

  const created = await createRequestAs(owner.token, passwordResetTypeId, 'LOW');
  assert.equal(created.status, 201);
  registerCleanup(t, owner, [created.body.id]);
  registerCleanup(t, otherEmployee, []);

  const otherEmployeeRes = await request(app)
    .get(`/api/requests/${created.body.id}`)
    .set('Authorization', `Bearer ${otherEmployee.token}`);
  assert.equal(otherEmployeeRes.status, 403);

  const wrongDeptAuthorityRes = await request(app)
    .get(`/api/requests/${created.body.id}`)
    .set('Authorization', `Bearer ${hrAuthorityToken}`);
  assert.equal(wrongDeptAuthorityRes.status, 403);
});

// AC9: nonexistent (but validly-formatted) UUID -> 404.
test('GET /api/requests/:id - nonexistent UUID returns 404', async (t) => {
  const employee = await registerEmployee();
  registerCleanup(t, employee, []);

  const getRes = await request(app)
    .get(`/api/requests/${randomUUID()}`)
    .set('Authorization', `Bearer ${employee.token}`);

  assert.equal(getRes.status, 404);
});

// AC10: is_overdue is true for a still-open request whose sla_due_at was pushed into the
// past, and false once the request reaches a terminal state, even though sla_due_at
// is still in the past.
test('GET /api/requests/:id and list - is_overdue reflects SLA breach only while non-terminal', async (t) => {
  const employee = await registerEmployee();

  const created = await createRequestAs(employee.token, passwordResetTypeId, 'LOW');
  assert.equal(created.status, 201);
  registerCleanup(t, employee, [created.body.id]);

  await pool.query("UPDATE requests SET sla_due_at = now() - interval '1 hour' WHERE id = $1", [created.body.id]);

  const overdueGetRes = await request(app)
    .get(`/api/requests/${created.body.id}`)
    .set('Authorization', `Bearer ${employee.token}`);
  assert.equal(overdueGetRes.status, 200);
  assert.equal(overdueGetRes.body.is_overdue, true);

  const overdueListRes = await request(app)
    .get('/api/requests')
    .set('Authorization', `Bearer ${employee.token}`);
  assert.equal(overdueListRes.status, 200);
  const listedRow = overdueListRes.body.find((r) => r.id === created.body.id);
  assert.equal(listedRow.is_overdue, true);

  // Reject (a terminal transition) while sla_due_at is still in the past.
  const rejectRes = await request(app)
    .patch(`/api/requests/${created.body.id}/status`)
    .set('Authorization', `Bearer ${itAuthorityToken}`)
    .send({ status: 'REJECTED', note: 'closing for overdue test' });
  assert.equal(rejectRes.status, 200, JSON.stringify(rejectRes.body));

  const afterGetRes = await request(app)
    .get(`/api/requests/${created.body.id}`)
    .set('Authorization', `Bearer ${employee.token}`);
  assert.equal(afterGetRes.status, 200);
  assert.equal(afterGetRes.body.is_overdue, false);
});

// AC11: joined fields (request_type_name, department_name, created_by_name) are present and
// correct on a freshly created request; assigned_to_name is null before claiming and becomes
// the claiming officer's "Name Surname" string after a successful claim.
test('GET /api/requests/:id - joined display fields are correct, assigned_to_name populates after claim', async (t) => {
  const employee = await registerEmployee();

  const created = await createRequestAs(employee.token, passwordResetTypeId, 'LOW');
  assert.equal(created.status, 201);
  registerCleanup(t, employee, [created.body.id]);

  const beforeClaimRes = await request(app)
    .get(`/api/requests/${created.body.id}`)
    .set('Authorization', `Bearer ${employee.token}`);
  assert.equal(beforeClaimRes.status, 200);
  assert.equal(beforeClaimRes.body.request_type_name, 'Password Reset');
  assert.equal(beforeClaimRes.body.department_name, 'IT');
  assert.equal(beforeClaimRes.body.created_by_name, 'Test Employee');
  assert.equal(beforeClaimRes.body.assigned_to_name, null);

  const assignRes = await request(app)
    .post(`/api/requests/${created.body.id}/assign`)
    .set('Authorization', `Bearer ${itAuthorityToken}`)
    .send();
  assert.equal(assignRes.status, 200, JSON.stringify(assignRes.body));

  const itAuthorityRow = await pool.query('SELECT name, surname FROM users WHERE id = $1', [itAuthorityId]);
  const expectedAssignedToName = `${itAuthorityRow.rows[0].name} ${itAuthorityRow.rows[0].surname || ''}`.trim();

  const afterClaimRes = await request(app)
    .get(`/api/requests/${created.body.id}`)
    .set('Authorization', `Bearer ${employee.token}`);
  assert.equal(afterClaimRes.status, 200);
  assert.equal(afterClaimRes.body.assigned_to_name, expectedAssignedToName);
});

// ---------------------------------------------------------------------------
// Queue search/filter (?q=, ?request_type_id=, ?priority=) — queue-search-filter task
// ---------------------------------------------------------------------------

// AC1: q does a case-insensitive ILIKE match against title OR description;
// non-matching requests are excluded. Covers a match via title, a match via
// description only, and a non-matching row (all as one flow since they share
// the same fixture set and this mirrors the file's existing per-scenario style).
test('GET /api/requests?q= - case-insensitive match on title or description, excludes non-matching', async (t) => {
  const employee = await registerEmployee();

  const titleMatch = await createCustomRequestAs(
    employee.token,
    passwordResetTypeId,
    'LOW',
    'Printer is broken',
    'Cannot print documents',
  );
  assert.equal(titleMatch.status, 201, JSON.stringify(titleMatch.body));

  const descriptionMatch = await createCustomRequestAs(
    employee.token,
    passwordResetTypeId,
    'LOW',
    'Office equipment issue',
    'The office PRINTER is jammed again',
  );
  assert.equal(descriptionMatch.status, 201, JSON.stringify(descriptionMatch.body));

  const noMatch = await createCustomRequestAs(
    employee.token,
    passwordResetTypeId,
    'LOW',
    'Password reset needed',
    'Forgot my login password',
  );
  assert.equal(noMatch.status, 201, JSON.stringify(noMatch.body));

  registerCleanup(t, employee, [titleMatch.body.id, descriptionMatch.body.id, noMatch.body.id]);

  // Lowercase query against a mixed-case "PRINTER" substring in the fixtures
  // exercises case-insensitivity in both directions.
  const res = await request(app)
    .get('/api/requests?q=printer')
    .set('Authorization', `Bearer ${employee.token}`);

  assert.equal(res.status, 200, JSON.stringify(res.body));
  const ids = res.body.map((r) => r.id);
  assert.ok(ids.includes(titleMatch.body.id));
  assert.ok(ids.includes(descriptionMatch.body.id));
  assert.ok(!ids.includes(noMatch.body.id));
});

// AC2: request_type_id filters to exactly that type.
test('GET /api/requests?request_type_id= - filters to exactly the given request type', async (t) => {
  const employee = await registerEmployee();

  const passwordReq = await createRequestAs(employee.token, passwordResetTypeId, 'LOW');
  assert.equal(passwordReq.status, 201);
  const leaveReq = await createRequestAs(employee.token, leaveRequestTypeId, 'LOW');
  assert.equal(leaveReq.status, 201);

  registerCleanup(t, employee, [passwordReq.body.id, leaveReq.body.id]);

  const res = await request(app)
    .get(`/api/requests?request_type_id=${passwordResetTypeId}`)
    .set('Authorization', `Bearer ${employee.token}`);

  assert.equal(res.status, 200, JSON.stringify(res.body));
  const ids = res.body.map((r) => r.id);
  assert.ok(ids.includes(passwordReq.body.id));
  assert.ok(!ids.includes(leaveReq.body.id));
});

// AC3: priority filters to exactly that priority.
test('GET /api/requests?priority= - filters to exactly the given priority', async (t) => {
  const employee = await registerEmployee();

  const highReq = await createRequestAs(employee.token, passwordResetTypeId, 'HIGH');
  assert.equal(highReq.status, 201);
  const lowReq = await createRequestAs(employee.token, passwordResetTypeId, 'LOW');
  assert.equal(lowReq.status, 201);

  registerCleanup(t, employee, [highReq.body.id, lowReq.body.id]);

  const res = await request(app)
    .get('/api/requests?priority=HIGH')
    .set('Authorization', `Bearer ${employee.token}`);

  assert.equal(res.status, 200, JSON.stringify(res.body));
  const ids = res.body.map((r) => r.id);
  assert.ok(ids.includes(highReq.body.id));
  assert.ok(!ids.includes(lowReq.body.id));
});

// AC4: all three filters combine with AND (not OR), on top of (never replacing)
// role/department scoping. Also the authorization-boundary case: a filter
// combination that would match a request in a DIFFERENT department must never
// leak it to an authority scoped to another department.
test('GET /api/requests - q, request_type_id and priority combine with AND, and never bypass department scoping', async (t) => {
  const employee = await registerEmployee();

  // Matches ALL three filters below.
  const fullMatch = await createCustomRequestAs(
    employee.token,
    passwordResetTypeId,
    'HIGH',
    'Boundary Widget Alpha',
    'needs urgent attention',
  );
  assert.equal(fullMatch.status, 201, JSON.stringify(fullMatch.body));

  // Matches q + request_type_id but NOT priority -> must be excluded by the AND.
  const partialMatch = await createCustomRequestAs(
    employee.token,
    passwordResetTypeId,
    'LOW',
    'Boundary Widget Beta',
    'not urgent at all',
  );
  assert.equal(partialMatch.status, 201, JSON.stringify(partialMatch.body));

  registerCleanup(t, employee, [fullMatch.body.id, partialMatch.body.id]);

  const combinedRes = await request(app)
    .get(`/api/requests?q=Boundary%20Widget&request_type_id=${passwordResetTypeId}&priority=HIGH`)
    .set('Authorization', `Bearer ${itAuthorityToken}`);

  assert.equal(combinedRes.status, 200, JSON.stringify(combinedRes.body));
  const combinedIds = combinedRes.body.map((r) => r.id);
  assert.ok(combinedIds.includes(fullMatch.body.id));
  assert.ok(!combinedIds.includes(partialMatch.body.id));

  // Authorization boundary: the same q+priority combination matches
  // fullMatch's title/priority exactly, but fullMatch lives in the IT
  // department. An HR authority's filtered query must return nothing for it
  // — role/department scoping is applied before (and is never bypassed by)
  // the q/priority filters.
  const hrBoundaryRes = await request(app)
    .get('/api/requests?q=Boundary%20Widget&priority=HIGH')
    .set('Authorization', `Bearer ${hrAuthorityToken}`);

  assert.equal(hrBoundaryRes.status, 200, JSON.stringify(hrBoundaryRes.body));
  const hrBoundaryIds = hrBoundaryRes.body.map((r) => r.id);
  assert.ok(!hrBoundaryIds.includes(fullMatch.body.id));
});

// AC5: invalid priority -> 400; malformed-UUID request_type_id -> 400;
// well-formed-but-nonexistent request_type_id -> 200 with an empty array
// (deliberately not a 400 — resolved during planning).
test('GET /api/requests - invalid filter values are rejected, well-formed-but-unknown request_type_id returns empty', async (t) => {
  const employee = await registerEmployee();
  registerCleanup(t, employee, []);

  const invalidPriorityRes = await request(app)
    .get('/api/requests?priority=URGENT')
    .set('Authorization', `Bearer ${employee.token}`);
  assert.equal(invalidPriorityRes.status, 400);

  const malformedTypeIdRes = await request(app)
    .get('/api/requests?request_type_id=not-a-uuid')
    .set('Authorization', `Bearer ${employee.token}`);
  assert.equal(malformedTypeIdRes.status, 400);

  const unknownTypeIdRes = await request(app)
    .get(`/api/requests?request_type_id=${randomUUID()}`)
    .set('Authorization', `Bearer ${employee.token}`);
  assert.equal(unknownTypeIdRes.status, 200, JSON.stringify(unknownTypeIdRes.body));
  assert.deepEqual(unknownTypeIdRes.body, []);
});

// ---------------------------------------------------------------------------
// Queue date-range filter + saved filters (backend half) — queue-date-range-saved-filters task
// ---------------------------------------------------------------------------

// AC1 [Critical]: date_from/date_to filters to created_at within the range, INCLUSIVE
// on both ends. Five fixtures are backdated via direct SQL (createRequestAs always
// creates with created_at = now(), so this is the only way to control creation date):
// one strictly before the range, one exactly on date_from, one strictly inside, one
// exactly on date_to, and one strictly after — the boundary rows prove inclusivity,
// the before/after rows prove exclusion.
test('GET /api/requests?date_from=&date_to= - filters to created_at within the inclusive range', async (t) => {
  const employee = await registerEmployee();

  const before = await createRequestAs(employee.token, passwordResetTypeId, 'LOW');
  const fromBoundary = await createRequestAs(employee.token, passwordResetTypeId, 'LOW');
  const middle = await createRequestAs(employee.token, passwordResetTypeId, 'LOW');
  const toBoundary = await createRequestAs(employee.token, passwordResetTypeId, 'LOW');
  const after = await createRequestAs(employee.token, passwordResetTypeId, 'LOW');
  for (const res of [before, fromBoundary, middle, toBoundary, after]) {
    assert.equal(res.status, 201, JSON.stringify(res.body));
  }

  registerCleanup(t, employee, [
    before.body.id,
    fromBoundary.body.id,
    middle.body.id,
    toBoundary.body.id,
    after.body.id,
  ]);

  await pool.query('UPDATE requests SET created_at = $1::timestamptz WHERE id = $2', [
    '2019-12-25T12:00:00Z',
    before.body.id,
  ]);
  await pool.query('UPDATE requests SET created_at = $1::timestamptz WHERE id = $2', [
    '2020-01-01T12:00:00Z',
    fromBoundary.body.id,
  ]);
  await pool.query('UPDATE requests SET created_at = $1::timestamptz WHERE id = $2', [
    '2020-01-05T12:00:00Z',
    middle.body.id,
  ]);
  await pool.query('UPDATE requests SET created_at = $1::timestamptz WHERE id = $2', [
    '2020-01-10T12:00:00Z',
    toBoundary.body.id,
  ]);
  await pool.query('UPDATE requests SET created_at = $1::timestamptz WHERE id = $2', [
    '2020-01-15T12:00:00Z',
    after.body.id,
  ]);

  const res = await request(app)
    .get('/api/requests?date_from=2020-01-01&date_to=2020-01-10')
    .set('Authorization', `Bearer ${employee.token}`);

  assert.equal(res.status, 200, JSON.stringify(res.body));
  const ids = res.body.map((r) => r.id);
  assert.ok(!ids.includes(before.body.id));
  assert.ok(ids.includes(fromBoundary.body.id));
  assert.ok(ids.includes(middle.body.id));
  assert.ok(ids.includes(toBoundary.body.id));
  assert.ok(!ids.includes(after.body.id));
});

// AC4 [High]: malformed date_from/date_to (fails DATE_REGEX) -> 400 'Geçersiz tarih değeri';
// well-formed date_from > date_to -> 400 'Geçersiz tarih aralığı'.
test('GET /api/requests - invalid date filter values are rejected', async (t) => {
  const employee = await registerEmployee();
  registerCleanup(t, employee, []);

  const malformedDateRes = await request(app)
    .get('/api/requests?date_from=not-a-date')
    .set('Authorization', `Bearer ${employee.token}`);
  assert.equal(malformedDateRes.status, 400);
  assert.equal(malformedDateRes.body.message, 'Geçersiz tarih değeri');

  const malformedDateToRes = await request(app)
    .get('/api/requests?date_from=2020-01-01&date_to=15-01-2020')
    .set('Authorization', `Bearer ${employee.token}`);
  assert.equal(malformedDateToRes.status, 400);
  assert.equal(malformedDateToRes.body.message, 'Geçersiz tarih değeri');

  const invalidRangeRes = await request(app)
    .get('/api/requests?date_from=2020-01-10&date_to=2020-01-01')
    .set('Authorization', `Bearer ${employee.token}`);
  assert.equal(invalidRangeRes.status, 400);
  assert.equal(invalidRangeRes.body.message, 'Geçersiz tarih aralığı');
});
