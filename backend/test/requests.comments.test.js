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

// AC1: creating EMPLOYEE posts a comment -> 201, persisted with correct content/author_id.
test('POST /api/requests/:id/comments - creating EMPLOYEE gets 201, comment persisted correctly', async (t) => {
  const employee = await registerEmployee();

  const created = await createRequestAs(employee.token, passwordResetTypeId, 'LOW');
  assert.equal(created.status, 201);
  registerCleanup(t, employee, [created.body.id]);

  const commentRes = await request(app)
    .post(`/api/requests/${created.body.id}/comments`)
    .set('Authorization', `Bearer ${employee.token}`)
    .send({ content: 'This is my comment.' });

  assert.equal(commentRes.status, 201, JSON.stringify(commentRes.body));
  assert.equal(commentRes.body.content, 'This is my comment.');
  assert.equal(commentRes.body.author_id, employee.id);

  const dbRow = await pool.query('SELECT * FROM request_comments WHERE id = $1', [commentRes.body.id]);
  assert.equal(dbRow.rows.length, 1);
  assert.equal(dbRow.rows[0].content, 'This is my comment.');
  assert.equal(dbRow.rows[0].author_id, employee.id);
});

// AC2: matching-department DEPARTMENT_AUTHORITY (assigned) posts a comment -> 201,
// AND a COMMENT_ADDED notification is created for the request's creator.
test('POST /api/requests/:id/comments - assigned matching-department authority gets 201, creator is notified', async (t) => {
  const employee = await registerEmployee();

  const created = await createRequestAs(employee.token, passwordResetTypeId, 'LOW');
  assert.equal(created.status, 201);
  registerCleanup(t, employee, [created.body.id]);

  const assignRes = await request(app)
    .post(`/api/requests/${created.body.id}/assign`)
    .set('Authorization', `Bearer ${itAuthorityToken}`)
    .send();
  assert.equal(assignRes.status, 200, JSON.stringify(assignRes.body));

  const commentRes = await request(app)
    .post(`/api/requests/${created.body.id}/comments`)
    .set('Authorization', `Bearer ${itAuthorityToken}`)
    .send({ content: 'Working on this now.' });

  assert.equal(commentRes.status, 201, JSON.stringify(commentRes.body));

  const notifRows = await pool.query(
    "SELECT * FROM notifications WHERE request_id = $1 AND type = 'COMMENT_ADDED'",
    [created.body.id]
  );
  assert.equal(notifRows.rows.length, 1);
  assert.equal(notifRows.rows[0].user_id, employee.id);
});

// AC2b: matching-department DEPARTMENT_AUTHORITY comments on a still-OPEN (unassigned)
// request -> 201, AND a COMMENT_ADDED notification is created for the request's creator.
test('POST /api/requests/:id/comments - matching-department authority on OPEN unassigned request gets 201, creator is notified', async (t) => {
  const employee = await registerEmployee();

  const created = await createRequestAs(employee.token, passwordResetTypeId, 'LOW');
  assert.equal(created.status, 201);
  registerCleanup(t, employee, [created.body.id]);

  const commentRes = await request(app)
    .post(`/api/requests/${created.body.id}/comments`)
    .set('Authorization', `Bearer ${itAuthorityToken}`)
    .send({ content: 'Looking into this, not yet assigned.' });

  assert.equal(commentRes.status, 201, JSON.stringify(commentRes.body));

  const notifRows = await pool.query(
    "SELECT * FROM notifications WHERE request_id = $1 AND type = 'COMMENT_ADDED'",
    [created.body.id]
  );
  assert.equal(notifRows.rows.length, 1);
  assert.equal(notifRows.rows[0].user_id, employee.id);
});

// AC3: unauthorized commenters get 403 - (a) a different EMPLOYEE, (b) a different-department authority.
test('POST /api/requests/:id/comments - unauthorized commenters get 403', async (t) => {
  const owner = await registerEmployee();
  const otherEmployee = await registerEmployee();

  const created = await createRequestAs(owner.token, passwordResetTypeId, 'LOW');
  assert.equal(created.status, 201);
  registerCleanup(t, owner, [created.body.id]);
  registerCleanup(t, otherEmployee, []);

  const otherEmployeeRes = await request(app)
    .post(`/api/requests/${created.body.id}/comments`)
    .set('Authorization', `Bearer ${otherEmployee.token}`)
    .send({ content: 'I should not be able to do this.' });
  assert.equal(otherEmployeeRes.status, 403);

  const wrongDeptAuthorityRes = await request(app)
    .post(`/api/requests/${created.body.id}/comments`)
    .set('Authorization', `Bearer ${hrAuthorityToken}`)
    .send({ content: 'Neither should I.' });
  assert.equal(wrongDeptAuthorityRes.status, 403);
});

// AC4: creator comments on a still-OPEN (unassigned) request -> 201, but NO notification created.
test('POST /api/requests/:id/comments - creator comments on OPEN unassigned request, no notification created', async (t) => {
  const employee = await registerEmployee();

  const created = await createRequestAs(employee.token, passwordResetTypeId, 'LOW');
  assert.equal(created.status, 201);
  registerCleanup(t, employee, [created.body.id]);

  const commentRes = await request(app)
    .post(`/api/requests/${created.body.id}/comments`)
    .set('Authorization', `Bearer ${employee.token}`)
    .send({ content: 'Anyone there?' });

  assert.equal(commentRes.status, 201, JSON.stringify(commentRes.body));

  const notifRows = await pool.query('SELECT * FROM notifications WHERE request_id = $1', [created.body.id]);
  assert.equal(notifRows.rows.length, 0);
});

// AC5: GET comments as someone with view access -> 200 array, chronological order, author_name present.
test('GET /api/requests/:id/comments - view-access actors get 200, chronological order, author_name populated', async (t) => {
  const employee = await registerEmployee('Chrono', 'Poster');

  const created = await createRequestAs(employee.token, passwordResetTypeId, 'LOW');
  assert.equal(created.status, 201);
  registerCleanup(t, employee, [created.body.id]);

  const firstComment = await request(app)
    .post(`/api/requests/${created.body.id}/comments`)
    .set('Authorization', `Bearer ${employee.token}`)
    .send({ content: 'First comment.' });
  assert.equal(firstComment.status, 201);

  await sleep(50);

  const secondComment = await request(app)
    .post(`/api/requests/${created.body.id}/comments`)
    .set('Authorization', `Bearer ${employee.token}`)
    .send({ content: 'Second comment.' });
  assert.equal(secondComment.status, 201);

  const listRes = await request(app)
    .get(`/api/requests/${created.body.id}/comments`)
    .set('Authorization', `Bearer ${employee.token}`);

  assert.equal(listRes.status, 200, JSON.stringify(listRes.body));
  assert.ok(Array.isArray(listRes.body));
  assert.equal(listRes.body.length, 2);
  assert.equal(listRes.body[0].id, firstComment.body.id);
  assert.equal(listRes.body[1].id, secondComment.body.id);
  assert.equal(listRes.body[0].author_name, 'Chrono Poster');
  assert.equal(listRes.body[1].author_name, 'Chrono Poster');
});

// AC6: GET comments without view access -> 403.
test('GET /api/requests/:id/comments - actor without view access gets 403', async (t) => {
  const owner = await registerEmployee();
  const otherEmployee = await registerEmployee();

  const created = await createRequestAs(owner.token, passwordResetTypeId, 'LOW');
  assert.equal(created.status, 201);
  registerCleanup(t, owner, [created.body.id]);
  registerCleanup(t, otherEmployee, []);

  const listRes = await request(app)
    .get(`/api/requests/${created.body.id}/comments`)
    .set('Authorization', `Bearer ${otherEmployee.token}`);

  assert.equal(listRes.status, 403);
});

// AC7: empty or whitespace-only content -> 400.
test('POST /api/requests/:id/comments - empty or whitespace-only content returns 400', async (t) => {
  const employee = await registerEmployee();

  const created = await createRequestAs(employee.token, passwordResetTypeId, 'LOW');
  assert.equal(created.status, 201);
  registerCleanup(t, employee, [created.body.id]);

  const emptyRes = await request(app)
    .post(`/api/requests/${created.body.id}/comments`)
    .set('Authorization', `Bearer ${employee.token}`)
    .send({ content: '' });
  assert.equal(emptyRes.status, 400);

  const whitespaceRes = await request(app)
    .post(`/api/requests/${created.body.id}/comments`)
    .set('Authorization', `Bearer ${employee.token}`)
    .send({ content: '    ' });
  assert.equal(whitespaceRes.status, 400);
});

// AC8: content longer than 2000 characters -> 400.
test('POST /api/requests/:id/comments - content longer than 2000 characters returns 400', async (t) => {
  const employee = await registerEmployee();

  const created = await createRequestAs(employee.token, passwordResetTypeId, 'LOW');
  assert.equal(created.status, 201);
  registerCleanup(t, employee, [created.body.id]);

  const tooLongRes = await request(app)
    .post(`/api/requests/${created.body.id}/comments`)
    .set('Authorization', `Bearer ${employee.token}`)
    .send({ content: 'a'.repeat(2001) });
  assert.equal(tooLongRes.status, 400);
});

// AC9: comment on a request that has reached a terminal status (COMPLETED or REJECTED) -> still 201.
test('POST /api/requests/:id/comments - commenting on terminal-status requests still succeeds', async (t) => {
  const employee = await registerEmployee();

  const completedReq = await createRequestAs(employee.token, passwordResetTypeId, 'LOW');
  assert.equal(completedReq.status, 201);
  const rejectedReq = await createRequestAs(employee.token, passwordResetTypeId, 'LOW');
  assert.equal(rejectedReq.status, 201);
  registerCleanup(t, employee, [completedReq.body.id, rejectedReq.body.id]);

  await request(app)
    .post(`/api/requests/${completedReq.body.id}/assign`)
    .set('Authorization', `Bearer ${itAuthorityToken}`)
    .send();
  await request(app)
    .patch(`/api/requests/${completedReq.body.id}/status`)
    .set('Authorization', `Bearer ${itAuthorityToken}`)
    .send({ status: 'IN_PROGRESS' });
  const completeRes = await request(app)
    .patch(`/api/requests/${completedReq.body.id}/status`)
    .set('Authorization', `Bearer ${itAuthorityToken}`)
    .send({ status: 'COMPLETED' });
  assert.equal(completeRes.status, 200, JSON.stringify(completeRes.body));

  const commentOnCompletedRes = await request(app)
    .post(`/api/requests/${completedReq.body.id}/comments`)
    .set('Authorization', `Bearer ${employee.token}`)
    .send({ content: 'Thanks for the help.' });
  assert.equal(commentOnCompletedRes.status, 201, JSON.stringify(commentOnCompletedRes.body));

  const rejectRes = await request(app)
    .patch(`/api/requests/${rejectedReq.body.id}/status`)
    .set('Authorization', `Bearer ${itAuthorityToken}`)
    .send({ status: 'REJECTED', note: 'Not applicable' });
  assert.equal(rejectRes.status, 200, JSON.stringify(rejectRes.body));

  const commentOnRejectedRes = await request(app)
    .post(`/api/requests/${rejectedReq.body.id}/comments`)
    .set('Authorization', `Bearer ${employee.token}`)
    .send({ content: 'Understood, thanks.' });
  assert.equal(commentOnRejectedRes.status, 201, JSON.stringify(commentOnRejectedRes.body));
});

// AC10: POST/GET comments on a nonexistent request id -> 404.
test('POST and GET /api/requests/:id/comments - nonexistent request id returns 404', async (t) => {
  const employee = await registerEmployee();
  registerCleanup(t, employee, []);

  const nonexistentId = randomUUID();

  const postRes = await request(app)
    .post(`/api/requests/${nonexistentId}/comments`)
    .set('Authorization', `Bearer ${employee.token}`)
    .send({ content: 'Hello?' });
  assert.equal(postRes.status, 404);

  const getRes = await request(app)
    .get(`/api/requests/${nonexistentId}/comments`)
    .set('Authorization', `Bearer ${employee.token}`);
  assert.equal(getRes.status, 404);
});

// AC11: ADMIN attempting to POST a comment -> 403, even though ADMIN has view access;
// ADMIN can GET the comments list -> 200 for the same request.
test('POST /api/requests/:id/comments - ADMIN gets 403; GET /api/requests/:id/comments - ADMIN gets 200', async (t) => {
  const employee = await registerEmployee();

  const created = await createRequestAs(employee.token, passwordResetTypeId, 'LOW');
  assert.equal(created.status, 201);
  registerCleanup(t, employee, [created.body.id]);

  const adminPostRes = await request(app)
    .post(`/api/requests/${created.body.id}/comments`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ content: 'Admin trying to comment.' });
  assert.equal(adminPostRes.status, 403);

  const adminGetRes = await request(app)
    .get(`/api/requests/${created.body.id}/comments`)
    .set('Authorization', `Bearer ${adminToken}`);
  assert.equal(adminGetRes.status, 200, JSON.stringify(adminGetRes.body));
  assert.ok(Array.isArray(adminGetRes.body));
});

// AC12: SKIPPED - DB-outage/transaction-rollback simulation for the comment+notification
// transaction is impractical to simulate reliably against a real local Postgres instance,
// same reasoning as the prior tasks' skipped ACs (auth's AC9, request-service's AC12).
