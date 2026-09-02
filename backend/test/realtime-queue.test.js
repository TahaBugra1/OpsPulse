const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const request = require('supertest');
const { io: ioClient } = require('socket.io-client');

const app = require('../server');
const pool = require('../services/db');

const { httpServer } = app;

const ALLOWED_DOMAIN = process.env.ALLOWED_EMAIL_DOMAIN;

let serverPort;
let itAuthorityToken;
let hrAuthorityToken;
let passwordResetTypeId; // IT
let leaveRequestTypeId; // HR
let itDepartmentId;

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

// Inserts a throwaway second DEPARTMENT_AUTHORITY in the IT department, reusing
// it.authority@opspulse.com's password_hash so plaintext 'sifre1234' still works,
// then logs in via supertest. Mirrors the pattern used in analytics.test.js for
// the throwaway Finance authority.
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
// user rows themselves, respecting the FK RESTRICT chain.
function registerCleanup(t, users, requestIds) {
  t.after(async () => {
    for (const id of requestIds) {
      // eslint-disable-next-line no-await-in-loop
      await deleteRequestCascade(id);
    }
    for (const user of users) {
      // eslint-disable-next-line no-await-in-loop
      await deleteUser(user.id);
    }
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

// Opens a socket.io-client connection against the running httpServer with the
// given token in the handshake auth payload. Does NOT wait for connect.
function connectSocket(token) {
  return ioClient(`http://localhost:${serverPort}`, {
    auth: { token },
    reconnection: false,
    transports: ['websocket'],
  });
}

// Waits for a socket to fire 'connect', rejecting if it fires 'connect_error' first.
function waitForConnect(socket) {
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve());
    socket.once('connect_error', (err) => reject(err));
  });
}

// Races a single event against a timeout, resolving with a SENTINEL if the
// timeout wins (i.e. the event never fired).
function waitForEvent(socket, eventName, timeoutMs = 2000) {
  const SENTINEL = Symbol('no-event');
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(SENTINEL);
      }
    }, timeoutMs);
    socket.once(eventName, (payload) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(payload);
      }
    });
  }).then((result) => ({ result, SENTINEL }));
}

test.before(async () => {
  await new Promise((resolve) => {
    httpServer.listen(0, () => resolve());
  });
  serverPort = httpServer.address().port;

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

  const prType = await pool.query("SELECT id, department_id FROM request_types WHERE name = 'Password Reset'");
  passwordResetTypeId = prType.rows[0].id;
  itDepartmentId = prType.rows[0].department_id;

  const lrType = await pool.query("SELECT id FROM request_types WHERE name = 'Leave Request'");
  leaveRequestTypeId = lrType.rows[0].id;
});

test.after(async () => {
  await new Promise((resolve) => {
    httpServer.close(() => resolve());
  });
  await pool.end();
});

// AC1: a DEPARTMENT_AUTHORITY socket auto-joins its own department-queue:<department_id>
// room on connect, with NO explicit join event ever emitted for it. Proven indirectly by
// connecting and then receiving request:removedFromQueue when another authority in the
// same department claims a request.
test('DEPARTMENT_AUTHORITY socket auto-joins department-queue on connect (no join event) and receives request:removedFromQueue on claim', async (t) => {
  const employee = await registerEmployee();
  const created = await createRequestAs(employee.token, passwordResetTypeId, 'LOW');
  assert.equal(created.status, 201);

  const secondAuthority = await createSecondItAuthority();
  registerCleanup(t, [employee, secondAuthority], [created.body.id]);

  const observerSocket = connectSocket(itAuthorityToken);
  t.after(() => observerSocket.close());
  await waitForConnect(observerSocket);
  // Deliberately never emit any join event for this socket - department-queue
  // membership is automatic on connect.

  const removedPromise = waitForEvent(observerSocket, 'request:removedFromQueue', 3000);

  const claimRes = await request(app)
    .post(`/api/requests/${created.body.id}/assign`)
    .set('Authorization', `Bearer ${secondAuthority.token}`)
    .send();
  assert.equal(claimRes.status, 200, JSON.stringify(claimRes.body));

  const { result, SENTINEL } = await removedPromise;
  assert.notEqual(result, SENTINEL, 'expected request:removedFromQueue event without any join event');
  assert.deepEqual(result, { id: created.body.id });
});

// AC2: two DEPARTMENT_AUTHORITY sockets in the SAME department, both auto-joined to
// department-queue:<department_id> - when one claims an OPEN request, BOTH sockets
// (including the claimer's own) receive request:removedFromQueue with { id }.
test('claim (OPEN -> ASSIGNED) -> both same-department authority sockets receive request:removedFromQueue', async (t) => {
  const employee = await registerEmployee();
  const created = await createRequestAs(employee.token, passwordResetTypeId, 'LOW');
  assert.equal(created.status, 201);

  const secondAuthority = await createSecondItAuthority();
  registerCleanup(t, [employee, secondAuthority], [created.body.id]);

  const claimerSocket = connectSocket(secondAuthority.token);
  const otherSocket = connectSocket(itAuthorityToken);
  t.after(() => claimerSocket.close());
  t.after(() => otherSocket.close());
  await Promise.all([waitForConnect(claimerSocket), waitForConnect(otherSocket)]);

  const claimerPromise = waitForEvent(claimerSocket, 'request:removedFromQueue', 3000);
  const otherPromise = waitForEvent(otherSocket, 'request:removedFromQueue', 3000);

  const claimRes = await request(app)
    .post(`/api/requests/${created.body.id}/assign`)
    .set('Authorization', `Bearer ${secondAuthority.token}`)
    .send();
  assert.equal(claimRes.status, 200, JSON.stringify(claimRes.body));

  const [{ result: claimerResult, SENTINEL: claimerSentinel }, { result: otherResult, SENTINEL: otherSentinel }] =
    await Promise.all([claimerPromise, otherPromise]);

  assert.notEqual(claimerResult, claimerSentinel, 'the claimer own socket should have received request:removedFromQueue');
  assert.deepEqual(claimerResult, { id: created.body.id });
  assert.notEqual(otherResult, otherSentinel, 'the other same-department socket should have received request:removedFromQueue');
  assert.deepEqual(otherResult, { id: created.body.id });
});

// AC3: same two-socket setup, a fresh OPEN request rejected directly from OPEN
// (OPEN -> REJECTED) -> both sockets receive request:removedFromQueue with the correct id.
test('reject directly from OPEN (OPEN -> REJECTED) -> both same-department authority sockets receive request:removedFromQueue', async (t) => {
  const employee = await registerEmployee();
  const created = await createRequestAs(employee.token, passwordResetTypeId, 'LOW');
  assert.equal(created.status, 201);

  const secondAuthority = await createSecondItAuthority();
  registerCleanup(t, [employee, secondAuthority], [created.body.id]);

  const socketA = connectSocket(itAuthorityToken);
  const socketB = connectSocket(secondAuthority.token);
  t.after(() => socketA.close());
  t.after(() => socketB.close());
  await Promise.all([waitForConnect(socketA), waitForConnect(socketB)]);

  const promiseA = waitForEvent(socketA, 'request:removedFromQueue', 3000);
  const promiseB = waitForEvent(socketB, 'request:removedFromQueue', 3000);

  const rejectRes = await request(app)
    .patch(`/api/requests/${created.body.id}/status`)
    .set('Authorization', `Bearer ${itAuthorityToken}`)
    .send({ status: 'REJECTED', note: 'Rejected directly from OPEN.' });
  assert.equal(rejectRes.status, 200, JSON.stringify(rejectRes.body));

  const [{ result: resultA, SENTINEL: sentinelA }, { result: resultB, SENTINEL: sentinelB }] = await Promise.all([
    promiseA,
    promiseB,
  ]);

  assert.notEqual(resultA, sentinelA, 'socket A should have received request:removedFromQueue');
  assert.deepEqual(resultA, { id: created.body.id });
  assert.notEqual(resultB, sentinelB, 'socket B should have received request:removedFromQueue');
  assert.deepEqual(resultB, { id: created.body.id });
});

// AC4: a DEPARTMENT_AUTHORITY socket connected to Department A's queue (IT) receives
// NOTHING when a claim/reject happens on a request in Department B (HR) - no global
// broadcast across department-queue rooms.
test('isolation - IT authority socket receives no request:removedFromQueue for an HR department claim', async (t) => {
  const employee = await registerEmployee();
  const created = await createRequestAs(employee.token, leaveRequestTypeId, 'LOW');
  assert.equal(created.status, 201);
  registerCleanup(t, [employee], [created.body.id]);

  const itSocket = connectSocket(itAuthorityToken);
  t.after(() => itSocket.close());
  await waitForConnect(itSocket);

  const removedPromise = waitForEvent(itSocket, 'request:removedFromQueue', 1500);

  const claimRes = await request(app)
    .post(`/api/requests/${created.body.id}/assign`)
    .set('Authorization', `Bearer ${hrAuthorityToken}`)
    .send();
  assert.equal(claimRes.status, 200, JSON.stringify(claimRes.body));

  const { result, SENTINEL } = await removedPromise;
  assert.equal(result, SENTINEL, 'IT authority socket must not receive request:removedFromQueue for an HR department claim');
});

// AC6: a transition that is NOT an OPEN-origin claim/reject (ASSIGNED -> IN_PROGRESS)
// must NOT emit request:removedFromQueue - proves the guard is genuinely conditional.
test('status change ASSIGNED -> IN_PROGRESS does NOT emit request:removedFromQueue', async (t) => {
  const employee = await registerEmployee();
  const created = await createRequestAs(employee.token, passwordResetTypeId, 'LOW');
  assert.equal(created.status, 201);
  registerCleanup(t, [employee], [created.body.id]);

  const assignRes = await request(app)
    .post(`/api/requests/${created.body.id}/assign`)
    .set('Authorization', `Bearer ${itAuthorityToken}`)
    .send();
  assert.equal(assignRes.status, 200, JSON.stringify(assignRes.body));

  const socket = connectSocket(itAuthorityToken);
  t.after(() => socket.close());
  await waitForConnect(socket);

  const removedPromise = waitForEvent(socket, 'request:removedFromQueue', 1500);

  const inProgressRes = await request(app)
    .patch(`/api/requests/${created.body.id}/status`)
    .set('Authorization', `Bearer ${itAuthorityToken}`)
    .send({ status: 'IN_PROGRESS' });
  assert.equal(inProgressRes.status, 200, JSON.stringify(inProgressRes.body));

  const { result, SENTINEL } = await removedPromise;
  assert.equal(result, SENTINEL, 'ASSIGNED -> IN_PROGRESS must not emit request:removedFromQueue');
});

// AC7 (combined with AC1's negative half): an EMPLOYEE socket never joins any
// department-queue:* room, so it never receives request:removedFromQueue for a
// claim/reject happening anywhere - structural isolation proof.
test('isolation - EMPLOYEE socket never receives request:removedFromQueue for a claim', async (t) => {
  const employee = await registerEmployee();
  const created = await createRequestAs(employee.token, passwordResetTypeId, 'LOW');
  assert.equal(created.status, 201);
  registerCleanup(t, [employee], [created.body.id]);

  const employeeSocket = connectSocket(employee.token);
  t.after(() => employeeSocket.close());
  await waitForConnect(employeeSocket);

  const removedPromise = waitForEvent(employeeSocket, 'request:removedFromQueue', 1500);

  const assignRes = await request(app)
    .post(`/api/requests/${created.body.id}/assign`)
    .set('Authorization', `Bearer ${itAuthorityToken}`)
    .send();
  assert.equal(assignRes.status, 200, JSON.stringify(assignRes.body));

  const { result, SENTINEL } = await removedPromise;
  assert.equal(result, SENTINEL, 'EMPLOYEE socket must never receive request:removedFromQueue');
});
