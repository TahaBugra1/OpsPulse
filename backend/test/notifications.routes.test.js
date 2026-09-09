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

async function deleteUser(userId) {
  await pool.query('DELETE FROM users WHERE id = $1', [userId]);
}

// Direct INSERT for precise control over read_at/user_id, mirroring
// requestTypes.routes.test.js's own convention of inserting rows directly
// via pool.query when a realistic end-to-end flow isn't needed.
async function insertNotification(userId, { requestId = null, type = 'REQUEST_ASSIGNED', message = 'Test notification', read = false } = {}) {
  const result = await pool.query(
    `INSERT INTO notifications (user_id, request_id, type, message, read_at)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [userId, requestId, type, message, read ? new Date() : null],
  );
  return result.rows[0].id;
}

async function deleteNotification(id) {
  await pool.query('DELETE FROM notifications WHERE id = $1', [id]);
}

test.after(async () => {
  await pool.end();
});

// ── AC7: authentication required ────────────────────────────────────────────

test('GET /api/notifications/unread-count - no Authorization header returns 401', async () => {
  const res = await request(app).get('/api/notifications/unread-count');
  assert.equal(res.status, 401);
});

test('GET /api/notifications - no Authorization header returns 401', async () => {
  const res = await request(app).get('/api/notifications');
  assert.equal(res.status, 401);
});

// ── AC1: unread count reflects this user's unread notifications ────────────

test('GET /api/notifications/unread-count - returns the count of unread notifications for the authenticated user', async (t) => {
  const employee = await registerEmployee();
  t.after(async () => {
    await deleteUser(employee.id);
  });

  const res = await request(app)
    .get('/api/notifications/unread-count')
    .set('Authorization', `Bearer ${employee.token}`);

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.count, 0);
});

// AC9: unread-count only counts THIS user's unread notifications (mix of
// unread for A, read for A, and unread for B).
test('GET /api/notifications/unread-count - only counts the authenticated user\'s own unread notifications', async (t) => {
  const userA = await registerEmployee('User', 'A');
  const userB = await registerEmployee('User', 'B');
  const notifIds = [];
  t.after(async () => {
    for (const id of notifIds) {
      // eslint-disable-next-line no-await-in-loop
      await deleteNotification(id);
    }
    await deleteUser(userA.id);
    await deleteUser(userB.id);
  });

  notifIds.push(await insertNotification(userA.id, { read: false }));
  notifIds.push(await insertNotification(userA.id, { read: false }));
  notifIds.push(await insertNotification(userA.id, { read: true }));
  notifIds.push(await insertNotification(userB.id, { read: false }));

  const res = await request(app)
    .get('/api/notifications/unread-count')
    .set('Authorization', `Bearer ${userA.token}`);

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.count, 2);
});

// ── AC8: GET /api/notifications is scoped to the authenticated user ────────

test('GET /api/notifications - only returns notifications belonging to the authenticated user', async (t) => {
  const userA = await registerEmployee('User', 'A');
  const userB = await registerEmployee('User', 'B');
  const notifIds = [];
  t.after(async () => {
    for (const id of notifIds) {
      // eslint-disable-next-line no-await-in-loop
      await deleteNotification(id);
    }
    await deleteUser(userA.id);
    await deleteUser(userB.id);
  });

  const notifAId = await insertNotification(userA.id, { message: 'For A' });
  const notifBId = await insertNotification(userB.id, { message: 'For B' });
  notifIds.push(notifAId, notifBId);

  const resA = await request(app)
    .get('/api/notifications')
    .set('Authorization', `Bearer ${userA.token}`);
  assert.equal(resA.status, 200, JSON.stringify(resA.body));
  assert.ok(Array.isArray(resA.body));
  const idsA = resA.body.map((n) => n.id);
  assert.ok(idsA.includes(notifAId));
  assert.ok(!idsA.includes(notifBId));

  const resB = await request(app)
    .get('/api/notifications')
    .set('Authorization', `Bearer ${userB.token}`);
  assert.equal(resB.status, 200, JSON.stringify(resB.body));
  const idsB = resB.body.map((n) => n.id);
  assert.ok(idsB.includes(notifBId));
  assert.ok(!idsB.includes(notifAId));
});

// ── AC5 / AC10: mark-all-as-read ────────────────────────────────────────────

test('PATCH /api/notifications/read-all - marks all of the authenticated user\'s unread notifications read but does not touch another user\'s', async (t) => {
  const userA = await registerEmployee('User', 'A');
  const userB = await registerEmployee('User', 'B');
  const notifIds = [];
  t.after(async () => {
    for (const id of notifIds) {
      // eslint-disable-next-line no-await-in-loop
      await deleteNotification(id);
    }
    await deleteUser(userA.id);
    await deleteUser(userB.id);
  });

  const notifA1 = await insertNotification(userA.id, { read: false });
  const notifA2 = await insertNotification(userA.id, { read: false });
  const notifB1 = await insertNotification(userB.id, { read: false });
  notifIds.push(notifA1, notifA2, notifB1);

  const res = await request(app)
    .patch('/api/notifications/read-all')
    .set('Authorization', `Bearer ${userA.token}`)
    .send();
  assert.equal(res.status, 200, JSON.stringify(res.body));

  const checkA = await pool.query('SELECT read_at FROM notifications WHERE id = ANY($1)', [[notifA1, notifA2]]);
  for (const row of checkA.rows) {
    assert.notEqual(row.read_at, null, 'expected user A\'s notifications to be marked read');
  }

  const checkB = await pool.query('SELECT read_at FROM notifications WHERE id = $1', [notifB1]);
  assert.equal(checkB.rows[0].read_at, null, 'user B\'s unread notification must be untouched');
});

// ── AC6: mark-one-as-read - identical 404 boundary for "not yours",
// "nonexistent", and "already read" ─────────────────────────────────────────

test('PATCH /api/notifications/:id/read - marking a notification belonging to another user returns 404', async (t) => {
  const owner = await registerEmployee('Owner', 'One');
  const other = await registerEmployee('Other', 'Two');
  t.after(async () => {
    await deleteUser(owner.id);
    await deleteUser(other.id);
  });

  const notifId = await insertNotification(owner.id, { read: false });
  t.after(async () => {
    await deleteNotification(notifId);
  });

  const res = await request(app)
    .patch(`/api/notifications/${notifId}/read`)
    .set('Authorization', `Bearer ${other.token}`)
    .send();

  assert.equal(res.status, 404, JSON.stringify(res.body));

  const check = await pool.query('SELECT read_at FROM notifications WHERE id = $1', [notifId]);
  assert.equal(check.rows[0].read_at, null, 'the notification must remain unread since it does not belong to the caller');
});

test('PATCH /api/notifications/:id/read - a nonexistent id returns the same 404', async (t) => {
  const employee = await registerEmployee();
  t.after(async () => {
    await deleteUser(employee.id);
  });

  const res = await request(app)
    .patch(`/api/notifications/${randomUUID()}/read`)
    .set('Authorization', `Bearer ${employee.token}`)
    .send();

  assert.equal(res.status, 404, JSON.stringify(res.body));
});

test('PATCH /api/notifications/:id/read - an already-read notification returns the same 404', async (t) => {
  const employee = await registerEmployee();
  t.after(async () => {
    await deleteUser(employee.id);
  });

  const notifId = await insertNotification(employee.id, { read: true });
  t.after(async () => {
    await deleteNotification(notifId);
  });

  const res = await request(app)
    .patch(`/api/notifications/${notifId}/read`)
    .set('Authorization', `Bearer ${employee.token}`)
    .send();

  assert.equal(res.status, 404, JSON.stringify(res.body));
});

test('PATCH /api/notifications/:id/read - marking one\'s own unread notification succeeds with 200 and sets read_at', async (t) => {
  const employee = await registerEmployee();
  t.after(async () => {
    await deleteUser(employee.id);
  });

  const notifId = await insertNotification(employee.id, { read: false });
  t.after(async () => {
    await deleteNotification(notifId);
  });

  const res = await request(app)
    .patch(`/api/notifications/${notifId}/read`)
    .set('Authorization', `Bearer ${employee.token}`)
    .send();

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.id, notifId);
  assert.notEqual(res.body.read_at, null);
});
