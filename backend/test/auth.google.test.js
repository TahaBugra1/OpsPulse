const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const jwt = require('jsonwebtoken');

// ../server must be required first: it loads dotenv (DATABASE_URL,
// ALLOWED_EMAIL_DOMAIN, etc.) before ../services/db constructs its Pool.
require('../server');

const { loginWithGoogle } = require('../services/auth.service');
const pool = require('../services/db');

const ALLOWED_DOMAIN = process.env.ALLOWED_EMAIL_DOMAIN;

function allowedEmail() {
  return `google-test-${randomUUID()}@${ALLOWED_DOMAIN}`;
}

function disallowedEmail() {
  return `google-test-${randomUUID()}@not-allowed-domain.com`;
}

function fakeVerifyFor(claims) {
  return async () => claims;
}

async function deleteUserByEmail(email) {
  await pool.query('DELETE FROM users WHERE email = $1', [email]);
}

test.after(async () => {
  await pool.end();
});

// AC1: brand-new user via Google, allowed domain -> EMPLOYEE, google_id set,
// password_hash null, surname reflects family_name (present and omitted cases)
test('loginWithGoogle - new user with allowed domain creates EMPLOYEE with google_id and no password_hash', async (t) => {
  const email = allowedEmail();
  t.after(() => deleteUserByEmail(email));

  const claims = {
    email,
    given_name: 'Ada',
    family_name: 'Lovelace',
    sub: `google-sub-${randomUUID()}`,
  };

  const result = await loginWithGoogle({ id_token: 'fake' }, fakeVerifyFor(claims));

  assert.equal(typeof result.token, 'string');
  assert.ok(result.user);
  assert.equal(result.user.email, email);
  assert.equal(result.user.role, 'EMPLOYEE');
  assert.equal(result.user.surname, 'Lovelace');
  assert.equal('password_hash' in result.user, false);

  const dbRow = await pool.query(
    'SELECT password_hash, google_id, role FROM users WHERE email = $1',
    [email]
  );
  assert.equal(dbRow.rows.length, 1);
  assert.equal(dbRow.rows[0].password_hash, null);
  assert.equal(dbRow.rows[0].google_id, claims.sub);
  assert.equal(dbRow.rows[0].role, 'EMPLOYEE');
});

// AC1 (edge case): family_name omitted -> surname must end up null, not throw
test('loginWithGoogle - new user with omitted family_name results in null surname', async (t) => {
  const email = allowedEmail();
  t.after(() => deleteUserByEmail(email));

  const claims = {
    email,
    given_name: 'Cher',
    family_name: undefined,
    sub: `google-sub-${randomUUID()}`,
  };

  const result = await loginWithGoogle({ id_token: 'fake' }, fakeVerifyFor(claims));

  assert.equal(result.user.surname, null);

  const dbRow = await pool.query('SELECT surname FROM users WHERE email = $1', [email]);
  assert.equal(dbRow.rows[0].surname, null);
});

// AC2: existing user, same email -> same id returned, no duplicate row,
// role/department_id unchanged
test('loginWithGoogle - existing user email links account instead of creating a duplicate', async (t) => {
  const email = allowedEmail();
  t.after(() => deleteUserByEmail(email));

  const firstClaims = {
    email,
    given_name: 'Grace',
    family_name: 'Hopper',
    sub: `google-sub-${randomUUID()}`,
  };
  const first = await loginWithGoogle({ id_token: 'fake' }, fakeVerifyFor(firstClaims));

  const secondClaims = {
    email,
    given_name: 'Grace',
    family_name: 'Hopper',
    sub: `google-sub-${randomUUID()}`,
  };
  const second = await loginWithGoogle({ id_token: 'fake' }, fakeVerifyFor(secondClaims));

  assert.equal(second.user.id, first.user.id);
  assert.equal(second.user.role, first.user.role);
  assert.equal(second.user.department_id, first.user.department_id);

  const countRes = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  assert.equal(countRes.rows.length, 1);
});

// AC3: brand-new user, disallowed domain -> 400, no row inserted
test('loginWithGoogle - new user with disallowed domain rejects with 400 and inserts no row', async () => {
  const email = disallowedEmail();

  const claims = {
    email,
    given_name: 'Bad',
    family_name: 'Domain',
    sub: `google-sub-${randomUUID()}`,
  };

  await assert.rejects(
    () => loginWithGoogle({ id_token: 'fake' }, fakeVerifyFor(claims)),
    (err) => {
      assert.equal(err.status, 400);
      return true;
    }
  );

  const check = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  assert.equal(check.rows.length, 0);
});

// AC4: verifyFn throws (invalid/expired Google token) -> 401
test('loginWithGoogle - verifyFn throwing rejects with 401', async () => {
  const failingVerify = async () => {
    throw new Error('invalid token signature');
  };

  await assert.rejects(
    () => loginWithGoogle({ id_token: 'bad' }, failingVerify),
    (err) => {
      assert.equal(err.status, 401);
      return true;
    }
  );
});

// AC5: existing user with is_active=false -> 403
test('loginWithGoogle - inactive existing user rejects with 403', async (t) => {
  const email = allowedEmail();
  t.after(() => deleteUserByEmail(email));

  const claims = {
    email,
    given_name: 'Once',
    family_name: 'Active',
    sub: `google-sub-${randomUUID()}`,
  };
  const created = await loginWithGoogle({ id_token: 'fake' }, fakeVerifyFor(claims));

  await pool.query('UPDATE users SET is_active = false WHERE id = $1', [created.user.id]);

  await assert.rejects(
    () => loginWithGoogle({ id_token: 'fake' }, fakeVerifyFor(claims)),
    (err) => {
      assert.equal(err.status, 403);
      return true;
    }
  );
});

// AC6: rememberMe true -> ~7d token, rememberMe omitted -> ~1h token
test('loginWithGoogle - rememberMe true issues a ~7 day token, omitted issues a ~1 hour token', async (t) => {
  const email = allowedEmail();
  t.after(() => deleteUserByEmail(email));

  const claims = {
    email,
    given_name: 'Remember',
    family_name: 'Me',
    sub: `google-sub-${randomUUID()}`,
  };

  const rememberResult = await loginWithGoogle(
    { id_token: 'fake', rememberMe: true },
    fakeVerifyFor(claims)
  );
  const rememberPayload = jwt.decode(rememberResult.token);
  const rememberDelta = rememberPayload.exp - rememberPayload.iat;
  assert.ok(
    Math.abs(rememberDelta - 7 * 24 * 3600) <= 5,
    `expected ~7d token lifetime, got ${rememberDelta}s`
  );

  const defaultResult = await loginWithGoogle({ id_token: 'fake' }, fakeVerifyFor(claims));
  const defaultPayload = jwt.decode(defaultResult.token);
  const defaultDelta = defaultPayload.exp - defaultPayload.iat;
  assert.ok(defaultDelta <= 3600, `expected <=1h token lifetime, got ${defaultDelta}s`);
});

// AC7: successful login (new user and linking) never returns password_hash
test('loginWithGoogle - result.user never includes password_hash, for new user and linked user', async (t) => {
  const email = allowedEmail();
  t.after(() => deleteUserByEmail(email));

  const claims = {
    email,
    given_name: 'NoHash',
    family_name: 'User',
    sub: `google-sub-${randomUUID()}`,
  };

  const created = await loginWithGoogle({ id_token: 'fake' }, fakeVerifyFor(claims));
  assert.equal(created.user.password_hash, undefined);

  const linked = await loginWithGoogle({ id_token: 'fake' }, fakeVerifyFor(claims));
  assert.equal(linked.user.password_hash, undefined);
});
