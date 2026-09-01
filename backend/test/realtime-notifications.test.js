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
let passwordResetTypeId; // IT

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
// employee rows themselves, respecting the FK RESTRICT chain.
function registerCleanup(t, employees, requestIds) {
  t.after(async () => {
    for (const id of requestIds) {
      // eslint-disable-next-line no-await-in-loop
      await deleteRequestCascade(id);
    }
    for (const employee of employees) {
      // eslint-disable-next-line no-await-in-loop
      await deleteUser(employee.id);
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

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
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

  const prType = await pool.query("SELECT id FROM request_types WHERE name = 'Password Reset'");
  passwordResetTypeId = prType.rows[0].id;
});

test.after(async () => {
  await new Promise((resolve) => {
    httpServer.close(() => resolve());
  });
  await pool.end();
});

// AC1: connecting a socket with a valid JWT auto-joins its own user:<id> room
// with NO explicit client-side join event (unlike request:<id> rooms). Proven
// indirectly: connect, never emit any join event, then trigger a
// notification-creating action (claim) and confirm the event still arrives.
test('socket auto-joins its own user:<id> room on connect (no join event needed) and receives notification:created on claim', async (t) => {
  const employee = await registerEmployee();
  const created = await createRequestAs(employee.token, passwordResetTypeId, 'LOW');
  assert.equal(created.status, 201);
  registerCleanup(t, [employee], [created.body.id]);

  const socket = connectSocket(employee.token);
  t.after(() => socket.close());
  await waitForConnect(socket);
  // Deliberately never emit any join event for this socket.

  const notifPromise = waitForEvent(socket, 'notification:created', 3000);

  const assignRes = await request(app)
    .post(`/api/requests/${created.body.id}/assign`)
    .set('Authorization', `Bearer ${itAuthorityToken}`)
    .send();
  assert.equal(assignRes.status, 200, JSON.stringify(assignRes.body));

  const { result, SENTINEL } = await notifPromise;
  assert.notEqual(result, SENTINEL, 'expected notification:created event without any join event');
});

// AC2: claiming a request creates a REQUEST_ASSIGNED notification for the
// creator, delivered with the full notification row shape.
test('claim -> creator receives notification:created with full REQUEST_ASSIGNED row', async (t) => {
  const employee = await registerEmployee();
  const created = await createRequestAs(employee.token, passwordResetTypeId, 'LOW');
  assert.equal(created.status, 201);
  registerCleanup(t, [employee], [created.body.id]);

  const socket = connectSocket(employee.token);
  t.after(() => socket.close());
  await waitForConnect(socket);

  const notifPromise = waitForEvent(socket, 'notification:created', 3000);

  const assignRes = await request(app)
    .post(`/api/requests/${created.body.id}/assign`)
    .set('Authorization', `Bearer ${itAuthorityToken}`)
    .send();
  assert.equal(assignRes.status, 200, JSON.stringify(assignRes.body));

  const { result, SENTINEL } = await notifPromise;
  assert.notEqual(result, SENTINEL, 'expected notification:created event, got none');
  assert.equal(result.type, 'REQUEST_ASSIGNED');
  assert.equal(result.user_id, employee.id);
  assert.equal(result.request_id, created.body.id);
  assert.ok(typeof result.message === 'string' && result.message.length > 0, 'expected non-empty message');
  assert.equal(result.read_at, null);
  assert.ok(result.created_at, 'expected created_at to be present');
});

// AC3: status -> COMPLETED creates a REQUEST_COMPLETED notification for the creator.
test('status change to COMPLETED -> creator receives notification:created with type REQUEST_COMPLETED', async (t) => {
  const employee = await registerEmployee();
  const created = await createRequestAs(employee.token, passwordResetTypeId, 'LOW');
  assert.equal(created.status, 201);
  registerCleanup(t, [employee], [created.body.id]);

  const assignRes = await request(app)
    .post(`/api/requests/${created.body.id}/assign`)
    .set('Authorization', `Bearer ${itAuthorityToken}`)
    .send();
  assert.equal(assignRes.status, 200);

  const inProgressRes = await request(app)
    .patch(`/api/requests/${created.body.id}/status`)
    .set('Authorization', `Bearer ${itAuthorityToken}`)
    .send({ status: 'IN_PROGRESS' });
  assert.equal(inProgressRes.status, 200, JSON.stringify(inProgressRes.body));

  const socket = connectSocket(employee.token);
  t.after(() => socket.close());
  await waitForConnect(socket);

  const notifPromise = waitForEvent(socket, 'notification:created', 3000);

  const completedRes = await request(app)
    .patch(`/api/requests/${created.body.id}/status`)
    .set('Authorization', `Bearer ${itAuthorityToken}`)
    .send({ status: 'COMPLETED' });
  assert.equal(completedRes.status, 200, JSON.stringify(completedRes.body));

  const { result, SENTINEL } = await notifPromise;
  assert.notEqual(result, SENTINEL, 'expected notification:created event, got none');
  assert.equal(result.type, 'REQUEST_COMPLETED');
  assert.equal(result.user_id, employee.id);
});

// AC3: status -> REJECTED creates a REQUEST_REJECTED notification for the creator.
test('status change to REJECTED -> creator receives notification:created with type REQUEST_REJECTED', async (t) => {
  const employee = await registerEmployee();
  const created = await createRequestAs(employee.token, passwordResetTypeId, 'LOW');
  assert.equal(created.status, 201);
  registerCleanup(t, [employee], [created.body.id]);

  const assignRes = await request(app)
    .post(`/api/requests/${created.body.id}/assign`)
    .set('Authorization', `Bearer ${itAuthorityToken}`)
    .send();
  assert.equal(assignRes.status, 200);

  const socket = connectSocket(employee.token);
  t.after(() => socket.close());
  await waitForConnect(socket);

  const notifPromise = waitForEvent(socket, 'notification:created', 3000);

  const rejectedRes = await request(app)
    .patch(`/api/requests/${created.body.id}/status`)
    .set('Authorization', `Bearer ${itAuthorityToken}`)
    .send({ status: 'REJECTED', note: 'Not enough information provided.' });
  assert.equal(rejectedRes.status, 200, JSON.stringify(rejectedRes.body));

  const { result, SENTINEL } = await notifPromise;
  assert.notEqual(result, SENTINEL, 'expected notification:created event, got none');
  assert.equal(result.type, 'REQUEST_REJECTED');
  assert.equal(result.user_id, employee.id);
});

// AC3 edge case: a status transition that does NOT create a notification
// (ASSIGNED -> IN_PROGRESS) must NOT emit notification:created to anyone.
// Proves the `if (notificationRow)` guard is actually load-bearing.
test('status change ASSIGNED -> IN_PROGRESS does NOT emit notification:created', async (t) => {
  const employee = await registerEmployee();
  const created = await createRequestAs(employee.token, passwordResetTypeId, 'LOW');
  assert.equal(created.status, 201);
  registerCleanup(t, [employee], [created.body.id]);

  const assignRes = await request(app)
    .post(`/api/requests/${created.body.id}/assign`)
    .set('Authorization', `Bearer ${itAuthorityToken}`)
    .send();
  assert.equal(assignRes.status, 200);

  const socket = connectSocket(employee.token);
  t.after(() => socket.close());
  await waitForConnect(socket);

  const notifPromise = waitForEvent(socket, 'notification:created', 1500);

  const inProgressRes = await request(app)
    .patch(`/api/requests/${created.body.id}/status`)
    .set('Authorization', `Bearer ${itAuthorityToken}`)
    .send({ status: 'IN_PROGRESS' });
  assert.equal(inProgressRes.status, 200, JSON.stringify(inProgressRes.body));

  const { result, SENTINEL } = await notifPromise;
  assert.equal(result, SENTINEL, 'ASSIGNED -> IN_PROGRESS must not emit notification:created');
});

// AC4: a comment with a valid recipient (author is the assignee, recipient is
// the creator) fires notification:created with type COMMENT_ADDED for the recipient.
test('comment with a valid recipient -> recipient receives notification:created with type COMMENT_ADDED', async (t) => {
  const employee = await registerEmployee();
  const created = await createRequestAs(employee.token, passwordResetTypeId, 'LOW');
  assert.equal(created.status, 201);
  registerCleanup(t, [employee], [created.body.id]);

  const assignRes = await request(app)
    .post(`/api/requests/${created.body.id}/assign`)
    .set('Authorization', `Bearer ${itAuthorityToken}`)
    .send();
  assert.equal(assignRes.status, 200);

  const socket = connectSocket(employee.token);
  t.after(() => socket.close());
  await waitForConnect(socket);

  const notifPromise = waitForEvent(socket, 'notification:created', 3000);

  const commentRes = await request(app)
    .post(`/api/requests/${created.body.id}/comments`)
    .set('Authorization', `Bearer ${itAuthorityToken}`)
    .send({ content: 'Working on this now.' });
  assert.equal(commentRes.status, 201, JSON.stringify(commentRes.body));

  const { result, SENTINEL } = await notifPromise;
  assert.notEqual(result, SENTINEL, 'expected notification:created event, got none');
  assert.equal(result.type, 'COMMENT_ADDED');
  assert.equal(result.user_id, employee.id);
  assert.equal(result.request_id, created.body.id);
});

// AC5: a user with two simultaneously connected sockets (e.g. 2 tabs) both
// receive notification:created when a notification is created for them.
test('a user with two connected sockets - both receive notification:created', async (t) => {
  const employee = await registerEmployee();
  const created = await createRequestAs(employee.token, passwordResetTypeId, 'LOW');
  assert.equal(created.status, 201);
  registerCleanup(t, [employee], [created.body.id]);

  const socketA = connectSocket(employee.token);
  const socketB = connectSocket(employee.token);
  t.after(() => socketA.close());
  t.after(() => socketB.close());
  await Promise.all([waitForConnect(socketA), waitForConnect(socketB)]);

  const notifPromiseA = waitForEvent(socketA, 'notification:created', 3000);
  const notifPromiseB = waitForEvent(socketB, 'notification:created', 3000);

  const assignRes = await request(app)
    .post(`/api/requests/${created.body.id}/assign`)
    .set('Authorization', `Bearer ${itAuthorityToken}`)
    .send();
  assert.equal(assignRes.status, 200, JSON.stringify(assignRes.body));

  const [{ result: resultA, SENTINEL: sentinelA }, { result: resultB, SENTINEL: sentinelB }] = await Promise.all([
    notifPromiseA,
    notifPromiseB,
  ]);

  assert.notEqual(resultA, sentinelA, 'socket A should have received notification:created');
  assert.notEqual(resultB, sentinelB, 'socket B should have received notification:created');
  assert.equal(resultA.type, 'REQUEST_ASSIGNED');
  assert.equal(resultB.type, 'REQUEST_ASSIGNED');
});

// AC6: when the target user has no connected socket at all, the REST call
// still succeeds normally - the notification/emit path never blocks the request.
test('notification-creating action succeeds normally when the target user has no connected socket', async (t) => {
  const employee = await registerEmployee();
  const created = await createRequestAs(employee.token, passwordResetTypeId, 'LOW');
  assert.equal(created.status, 201);
  registerCleanup(t, [employee], [created.body.id]);

  // No socket is ever opened for `employee` (the notification recipient).
  const assignRes = await request(app)
    .post(`/api/requests/${created.body.id}/assign`)
    .set('Authorization', `Bearer ${itAuthorityToken}`)
    .send();
  assert.equal(assignRes.status, 200, JSON.stringify(assignRes.body));
  assert.equal(assignRes.body.status, 'ASSIGNED');
});

// AC8 (Medium, isolation): a bystander user's socket must receive nothing
// when a notification is created for a different user.
test('isolation - a bystander socket receives no notification:created for another user', async (t) => {
  const employee = await registerEmployee('Owner', 'One');
  const bystander = await registerEmployee('Bystander', 'Two');
  const created = await createRequestAs(employee.token, passwordResetTypeId, 'LOW');
  assert.equal(created.status, 201);
  registerCleanup(t, [employee, bystander], [created.body.id]);

  const ownerSocket = connectSocket(employee.token);
  const bystanderSocket = connectSocket(bystander.token);
  t.after(() => ownerSocket.close());
  t.after(() => bystanderSocket.close());
  await Promise.all([waitForConnect(ownerSocket), waitForConnect(bystanderSocket)]);

  const ownerNotifPromise = waitForEvent(ownerSocket, 'notification:created', 3000);
  const bystanderNotifPromise = waitForEvent(bystanderSocket, 'notification:created', 1500);

  const assignRes = await request(app)
    .post(`/api/requests/${created.body.id}/assign`)
    .set('Authorization', `Bearer ${itAuthorityToken}`)
    .send();
  assert.equal(assignRes.status, 200, JSON.stringify(assignRes.body));

  const [{ result: ownerResult, SENTINEL: ownerSentinel }, { result: bystanderResult, SENTINEL: bystanderSentinel }] =
    await Promise.all([ownerNotifPromise, bystanderNotifPromise]);

  assert.notEqual(ownerResult, ownerSentinel, 'the request owner should have received the notification');
  assert.equal(bystanderResult, bystanderSentinel, 'a bystander user must not receive another user\'s notification (no global broadcast)');
});
