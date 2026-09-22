const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

// ../server must be required first: it loads dotenv (DATABASE_URL, etc.)
// before ../services/db constructs its Pool.
const app = require('../server');

// registerLimiter (routes/auth.routes.js) is IP-keyed (unlike loginLimiter's
// email key) and runs before the controller's validation, so deliberately
// invalid bodies still count toward the limit without creating any real user
// rows. This lives in its own file (not auth.routes.test.js) specifically
// because node --test isolates rate-limiter in-memory state per file/process
// - auth.routes.test.js makes far more than 5 register calls across its own
// unrelated tests, which would trip this IP-based limiter if run in the same
// process.
test('POST /api/auth/register - 6th sequential request from the same IP returns 429', async () => {
  let lastRes;
  for (let i = 0; i < 6; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    lastRes = await request(app).post('/api/auth/register').send({});
  }

  assert.equal(lastRes.status, 429);
});
