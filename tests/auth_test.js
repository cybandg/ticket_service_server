const { test, describe } = require('node:test');
const assert = require('node:assert');

const BASE_URL = process.env.BASE_URL || 'http://localhost:5678';
const LOGIN = `auth_tester_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
const PASSWORD = 'password123';

async function api(path, { method = 'GET', body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* 204 etc */ }
  return { status: res.status, json };
}

describe('Auth API', () => {
  let accessToken = null;
  let refreshToken = null;
  let userId = null;

  test('registration creates user and pre-assigned draft', async () => {
    const { status, json } = await api('/registration', { method: 'POST', body: { login: LOGIN, password: PASSWORD } });
    assert.strictEqual(status, 201);
    assert.ok(json.user.id, 'user id must exist');
    assert.strictEqual(json.user.login, LOGIN);
    assert.strictEqual(json.draft.status, 'draft');
    assert.ok(json.draft.id, 'draft uuid must exist');
    userId = json.user.id;
  });

  test('duplicate registration returns 409 USER_ALREADY_EXISTS', async () => {
    const { status, json } = await api('/registration', { method: 'POST', body: { login: LOGIN, password: PASSWORD } });
    assert.strictEqual(status, 409);
    assert.strictEqual(json.error.code, 'USER_ALREADY_EXISTS');
  });

  test('registration with short password returns 400 VALIDATION_ERROR', async () => {
    const { status, json } = await api('/registration', { method: 'POST', body: { login: `x_${Date.now()}`, password: '123' } });
    assert.strictEqual(status, 400);
    assert.strictEqual(json.error.code, 'VALIDATION_ERROR');
  });

  test('login returns token pair and user with draft', async () => {
    const { status, json } = await api('/auth', { method: 'POST', body: { login: LOGIN, password: PASSWORD } });
    assert.strictEqual(status, 200);
    assert.ok(json.accessToken && json.refreshToken, 'tokens must exist');
    assert.strictEqual(json.user.id, userId);
    assert.strictEqual(json.user.draft.status, 'draft');
    accessToken = json.accessToken;
    refreshToken = json.refreshToken;
  });

  test('login with wrong password returns 401', async () => {
    const { status, json } = await api('/auth', { method: 'POST', body: { login: LOGIN, password: 'wrong_password' } });
    assert.strictEqual(status, 401);
    assert.strictEqual(json.error.code, 'AUTH_INVALID_CREDENTIALS');
  });

  test('login with unknown user returns 401', async () => {
    const { status, json } = await api('/auth', { method: 'POST', body: { login: 'no_such_user_xyz', password: PASSWORD } });
    assert.strictEqual(status, 401);
    assert.strictEqual(json.error.code, 'AUTH_INVALID_CREDENTIALS');
  });

  test('protected route without token returns 401 AUTH_TOKEN_MISSING', async () => {
    const { status, json } = await api('/auth/me');
    assert.strictEqual(status, 401);
    assert.strictEqual(json.error.code, 'AUTH_TOKEN_MISSING');
  });

  test('protected route with garbage token returns 401 AUTH_TOKEN_INVALID', async () => {
    const { status, json } = await api('/auth/me', { token: 'not.a.jwt' });
    assert.strictEqual(status, 401);
    assert.strictEqual(json.error.code, 'AUTH_TOKEN_INVALID');
  });

  test('/auth/me returns user info with draft', async () => {
    const { status, json } = await api('/auth/me', { token: accessToken });
    assert.strictEqual(status, 200);
    assert.strictEqual(json.id, userId);
    assert.strictEqual(json.draft.status, 'draft');
  });

  test('refresh rotates token pair', async () => {
    const { status, json } = await api('/auth/refresh', { method: 'POST', body: { refreshToken } });
    assert.strictEqual(status, 200);
    assert.ok(json.accessToken && json.refreshToken);
    assert.notStrictEqual(json.refreshToken, refreshToken, 'refresh token must be rotated');
    accessToken = json.accessToken;
    refreshToken = json.refreshToken;
  });

  test('logout deletes refresh token, old one stops working', async () => {
    const { status } = await api('/logout', { method: 'POST', body: { refreshToken }, token: accessToken });
    assert.strictEqual(status, 200);

    const after = await api('/auth/refresh', { method: 'POST', body: { refreshToken } });
    assert.strictEqual(after.status, 401);
    assert.strictEqual(after.json.error.code, 'REFRESH_TOKEN_INVALID');
  });
});