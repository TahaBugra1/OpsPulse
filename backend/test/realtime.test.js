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

// Waits for a socket to emit 'join:request' and settle: resolves with
// undefined on a subsequent generic event window, but here we just wait a
// short grace period after emitting join, and separately watch for 'error'.
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

  const hrLogin = await request(app)
    .post('/api/auth/login')
    .send({ email: 'hr.authority@opspulse.com', password: 'sifre1234' });
  assert.equal(hrLogin.status, 200, `HR authority login failed: ${JSON.stringify(hrLogin.body)}`);
  hrAuthorityToken = hrLogin.body.token;

  const prType = await pool.query("SELECT id FROM request_types WHERE name = 'Password Reset'");
  passwordResetTypeId = prType.rows[0].id;

  const lrType = await pool.query("SELECT id FROM request_types WHERE name = 'Leave Request'");
  leaveRequestTypeId = lrType.rows[0].id;
});

test.after(async () => {
  await new Promise((resolve) => {
    httpServer.close(() => resolve());
  });
  await pool.end();
});

// AC1: valid JWT at handshake -> connection succeeds.
test('Socket.io handshake - valid JWT connects successfully', async (t) => {
  const employee = await registerEmployee();
  registerCleanup(t, employee, []);

  const socket = connectSocket(employee.token);
  t.after(() => socket.close());

  await assert.doesNotReject(waitForConnect(socket));
  assert.equal(socket.connected, true);
});

// AC2: invalid/garbage JWT at handshake -> connect_error fires, connect never fires.
test('Socket.io handshake - invalid JWT is rejected with connect_error', async (t) => {
  const socket = connectSocket('this-is-not-a-valid-jwt');
  t.after(() => socket.close());

  await assert.rejects(waitForConnect(socket));
  assert.equal(socket.connected, false);
});

// AC3/AC6: owner joins their own request's room, then a claim (assign) triggers
// 'request:updated' with ASSIGNED status + enriched fields (is_overdue, request_type_name).
test("join:request as owner + POST /assign -> joined socket receives 'request:updated' with enriched ASSIGNED payload", async (t) => {
  const employee = await registerEmployee();
  const created = await createRequestAs(employee.token, passwordResetTypeId, 'LOW');
  assert.equal(created.status, 201);
  registerCleanup(t, employee, [created.body.id]);

  const socket = connectSocket(employee.token);
  t.after(() => socket.close());
  await waitForConnect(socket);

  const errorPromise = waitForEvent(socket, 'error', 500);
  const updatePromise = waitForEvent(socket, 'request:updated', 3000);

  socket.emit('join:request', created.body.id);
  await sleep(150); // give the server time to process the join before triggering the change

  const start = Date.now();
  const assignRes = await request(app)
    .post(`/api/requests/${created.body.id}/assign`)
    .set('Authorization', `Bearer ${itAuthorityToken}`)
    .send();
  assert.equal(assignRes.status, 200, JSON.stringify(assignRes.body));

  const { result, SENTINEL } = await updatePromise;
  console.log(`request:updated latency: ${Date.now() - start}ms`); // AC10: informational only, no threshold assertion
  assert.notEqual(result, SENTINEL, 'expected request:updated event, got none');
  assert.equal(result.status, 'ASSIGNED');
  assert.ok('is_overdue' in result, 'expected enriched payload to include is_overdue');
  assert.ok('request_type_name' in result, 'expected enriched payload to include request_type_name');

  const { result: errResult, SENTINEL: errSentinel } = await errorPromise;
  assert.equal(errResult, errSentinel, 'expected no error event for an authorized join');
});

// AC7: PATCH priority -> joined socket receives 'request:updated' with the new priority.
test("join:request + PATCH /priority -> joined socket receives 'request:updated' with new priority", async (t) => {
  const employee = await registerEmployee();
  const created = await createRequestAs(employee.token, passwordResetTypeId, 'LOW');
  assert.equal(created.status, 201);
  registerCleanup(t, employee, [created.body.id]);

  const assignRes = await request(app)
    .post(`/api/requests/${created.body.id}/assign`)
    .set('Authorization', `Bearer ${itAuthorityToken}`)
    .send();
  assert.equal(assignRes.status, 200);

  const socket = connectSocket(employee.token);
  t.after(() => socket.close());
  await waitForConnect(socket);

  const updatePromise = waitForEvent(socket, 'request:updated', 3000);
  socket.emit('join:request', created.body.id);
  await sleep(150);

  const priorityRes = await request(app)
    .patch(`/api/requests/${created.body.id}/priority`)
    .set('Authorization', `Bearer ${itAuthorityToken}`)
    .send({ priority: 'HIGH' });
  assert.equal(priorityRes.status, 200, JSON.stringify(priorityRes.body));

  const { result, SENTINEL } = await updatePromise;
  assert.notEqual(result, SENTINEL, 'expected request:updated event, got none');
  assert.equal(result.priority, 'HIGH');
});

// AC8: POST comment -> joined socket receives 'request:commented' with content + author_name.
test("join:request + POST /comments -> joined socket receives 'request:commented' with content and author_name", async (t) => {
  const employee = await registerEmployee('Comment', 'Author');
  const created = await createRequestAs(employee.token, passwordResetTypeId, 'LOW');
  assert.equal(created.status, 201);
  registerCleanup(t, employee, [created.body.id]);

  const socket = connectSocket(employee.token);
  t.after(() => socket.close());
  await waitForConnect(socket);

  const commentedPromise = waitForEvent(socket, 'request:commented', 3000);
  socket.emit('join:request', created.body.id);
  await sleep(150);

  const commentRes = await request(app)
    .post(`/api/requests/${created.body.id}/comments`)
    .set('Authorization', `Bearer ${employee.token}`)
    .send({ content: 'Realtime comment content.' });
  assert.equal(commentRes.status, 201, JSON.stringify(commentRes.body));

  const { result, SENTINEL } = await commentedPromise;
  assert.notEqual(result, SENTINEL, 'expected request:commented event, got none');
  assert.equal(result.content, 'Realtime comment content.');
  assert.ok(typeof result.author_name === 'string' && result.author_name.length > 0, 'expected non-empty author_name');
});

// AC4: unauthorized join (different-department authority) -> 'error' event fires, and
// this socket receives no subsequent request:updated/request:commented events.
test("join:request - different-department authority is rejected with 'error', receives no subsequent events", async (t) => {
  const employee = await registerEmployee();
  const created = await createRequestAs(employee.token, passwordResetTypeId, 'LOW');
  assert.equal(created.status, 201);
  registerCleanup(t, employee, [created.body.id]);

  const socket = connectSocket(hrAuthorityToken); // HR authority, request belongs to IT
  t.after(() => socket.close());
  await waitForConnect(socket);

  const errorPromise = waitForEvent(socket, 'error', 2000);
  const updatePromise = waitForEvent(socket, 'request:updated', 1500);

  socket.emit('join:request', created.body.id);

  const { result: errResult, SENTINEL: errSentinel } = await errorPromise;
  assert.notEqual(errResult, errSentinel, 'expected an error event for unauthorized join');
  assert.ok(typeof errResult.message === 'string' && errResult.message.length > 0);

  // Trigger a change via a legitimately-authorized actor; the rejected socket must not receive it.
  const assignRes = await request(app)
    .post(`/api/requests/${created.body.id}/assign`)
    .set('Authorization', `Bearer ${itAuthorityToken}`)
    .send();
  assert.equal(assignRes.status, 200, JSON.stringify(assignRes.body));

  const { result, SENTINEL } = await updatePromise;
  assert.equal(result, SENTINEL, 'unauthorized socket must not receive request:updated');
});

// AC5: join for a nonexistent (but validly-formatted) request UUID -> 'error' event fires.
test("join:request - nonexistent request id yields an 'error' event", async (t) => {
  const employee = await registerEmployee();
  registerCleanup(t, employee, []);

  const socket = connectSocket(employee.token);
  t.after(() => socket.close());
  await waitForConnect(socket);

  const errorPromise = waitForEvent(socket, 'error', 2000);
  socket.emit('join:request', randomUUID());

  const { result, SENTINEL } = await errorPromise;
  assert.notEqual(result, SENTINEL, 'expected an error event for a nonexistent request id');
  assert.ok(typeof result.message === 'string' && result.message.length > 0);
});

// AC9: isolation - a second socket (same user, valid auth) that did NOT join the
// request's room receives no event when that request is updated. This is the
// primary proof that room-scoping isn't a global broadcast.
test('isolation - a socket that did not join the room receives no request:updated event', async (t) => {
  const employee = await registerEmployee();
  const created = await createRequestAs(employee.token, passwordResetTypeId, 'LOW');
  assert.equal(created.status, 201);
  registerCleanup(t, employee, [created.body.id]);

  const joinedSocket = connectSocket(employee.token);
  const bystanderSocket = connectSocket(employee.token); // same user, valid auth, no join
  t.after(() => joinedSocket.close());
  t.after(() => bystanderSocket.close());

  await Promise.all([waitForConnect(joinedSocket), waitForConnect(bystanderSocket)]);

  const joinedUpdatePromise = waitForEvent(joinedSocket, 'request:updated', 3000);
  const bystanderUpdatePromise = waitForEvent(bystanderSocket, 'request:updated', 1500);

  joinedSocket.emit('join:request', created.body.id);
  await sleep(150);

  const assignRes = await request(app)
    .post(`/api/requests/${created.body.id}/assign`)
    .set('Authorization', `Bearer ${itAuthorityToken}`)
    .send();
  assert.equal(assignRes.status, 200, JSON.stringify(assignRes.body));

  const [{ result: joinedResult, SENTINEL: joinedSentinel }, { result: bystanderResult, SENTINEL: bystanderSentinel }] =
    await Promise.all([joinedUpdatePromise, bystanderUpdatePromise]);

  assert.notEqual(joinedResult, joinedSentinel, 'the joined socket should have received the event');
  assert.equal(bystanderResult, bystanderSentinel, 'the non-joined socket must not receive the event (no global broadcast)');
});
