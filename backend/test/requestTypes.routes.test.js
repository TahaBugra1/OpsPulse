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

async function deleteUser(userId) {
  await pool.query('DELETE FROM users WHERE id = $1', [userId]);
}

let itAuthorityToken;
let leaveRequestTypeId; // HR, used as a throwaway to flip is_active off/on

test.before(async () => {
  const itLogin = await request(app)
    .post('/api/auth/login')
    .send({ email: 'it.authority@opspulse.com', password: 'sifre1234' });
  assert.equal(itLogin.status, 200, `IT authority login failed: ${JSON.stringify(itLogin.body)}`);
  itAuthorityToken = itLogin.body.token;

  const lrType = await pool.query("SELECT id FROM request_types WHERE name = 'Leave Request'");
  leaveRequestTypeId = lrType.rows[0].id;
});

test.after(async () => {
  await pool.end();
});

// AC7 (backend security): no Authorization header -> 401
test('GET /api/request-types - no Authorization header returns 401', async () => {
  const res = await request(app).get('/api/request-types');
  assert.equal(res.status, 401);
});

// AC8: any authenticated role (here: a throwaway EMPLOYEE, no role restriction) -> 200,
// array of {id, name, department_id} objects
test('GET /api/request-types - authenticated EMPLOYEE gets 200 with an array of active request types', async (t) => {
  const employee = await registerEmployee();
  t.after(async () => {
    await deleteUser(employee.id);
  });

  const res = await request(app)
    .get('/api/request-types')
    .set('Authorization', `Bearer ${employee.token}`);

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.ok(Array.isArray(res.body));
  assert.ok(res.body.length > 0);
  for (const rt of res.body) {
    assert.equal(typeof rt.id, 'string');
    assert.equal(typeof rt.name, 'string');
    assert.equal(typeof rt.department_id, 'string');
  }
});

// AC8: works equally for a DEPARTMENT_AUTHORITY token (no role check on this endpoint)
test('GET /api/request-types - authenticated DEPARTMENT_AUTHORITY also gets 200', async () => {
  const res = await request(app)
    .get('/api/request-types')
    .set('Authorization', `Bearer ${itAuthorityToken}`);

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.ok(Array.isArray(res.body));
});

// AC2: an is_active = false request type does NOT appear in the response
test('GET /api/request-types - an inactive request type is excluded from the response', async (t) => {
  t.after(async () => {
    await pool.query('UPDATE request_types SET is_active = true WHERE id = $1', [leaveRequestTypeId]);
  });
  await pool.query('UPDATE request_types SET is_active = false WHERE id = $1', [leaveRequestTypeId]);

  const res = await request(app)
    .get('/api/request-types')
    .set('Authorization', `Bearer ${itAuthorityToken}`);

  assert.equal(res.status, 200, JSON.stringify(res.body));
  const ids = res.body.map((rt) => rt.id);
  assert.ok(!ids.includes(leaveRequestTypeId));
});

// Nice-to-have: response is ordered by name ASC
test('GET /api/request-types - results are ordered by name ascending', async () => {
  const res = await request(app)
    .get('/api/request-types')
    .set('Authorization', `Bearer ${itAuthorityToken}`);

  assert.equal(res.status, 200, JSON.stringify(res.body));
  const names = res.body.map((rt) => rt.name);
  const sorted = [...names].sort((a, b) => a.localeCompare(b));
  assert.deepEqual(names, sorted);
});
