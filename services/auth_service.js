const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./supabase_service');
const { ApiError } = require('../middleware/error_handler');

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;
const ACCESS_TTL = process.env.ACCESS_TOKEN_TTL || '15m';
const REFRESH_TTL_DAYS = Number(process.env.REFRESH_TOKEN_TTL_DAYS || 7);

// ---------- helpers ----------

function validateCredentials(login, password) {
  if (!login || typeof login !== 'string' || login.trim().length < 3) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Login is required and must be at least 3 characters');
  }
  if (!password || typeof password !== 'string' || password.length < 6) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Password is required and must be at least 6 characters');
  }
}

function signAccessToken(user) {
  return jwt.sign({ sub: user.id, login: user.login }, ACCESS_SECRET, { expiresIn: ACCESS_TTL });
}

// Creates a refresh token, stores it in DB and returns it.
async function issueRefreshToken(userId) {
  const token = jwt.sign({ sub: userId, jti: crypto.randomUUID() }, REFRESH_SECRET, {
    expiresIn: `${REFRESH_TTL_DAYS}d`,
  });
  const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await db.insert('refresh_tokens', { user_id: userId, token, expires_at: expiresAt });
  return token;
}

function sanitizeUser(user) {
  return { id: user.id, login: user.login, created_at: user.created_at };
}

// ---------- public API ----------

// POST /registration — creates user AND his personal draft ticket.
async function register(login, password) {
  validateCredentials(login, password);

  const existing = await db.selectOne('users', `login=eq.${encodeURIComponent(login.trim())}`);
  if (existing) {
    throw new ApiError(409, 'USER_ALREADY_EXISTS', 'User with this login already exists');
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await db.insert('users', { login: login.trim(), password_hash: passwordHash });

  // Pre-assigned draft ticket (one per user, hidden from ticket lists).
  const { createDraft } = require('./ticket_service');
  const draft = await createDraft(user.id);

  console.log(`User registered: ${user.login} (${user.id}), draft ${draft.id} created`);
  return { user: sanitizeUser(user), draft };
}

// POST /auth — login, returns token pair + user info with current draft.
async function login(login, password) {
  validateCredentials(login, password);

  const user = await db.selectOne('users', `login=eq.${encodeURIComponent(login.trim())}`);
  if (!user) {
    throw new ApiError(401, 'AUTH_INVALID_CREDENTIALS', 'Wrong login or password');
  }

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    throw new ApiError(401, 'AUTH_INVALID_CREDENTIALS', 'Wrong login or password');
  }

  const accessToken = signAccessToken(user);
  const refreshToken = await issueRefreshToken(user.id);

  const { getUserDraft } = require('./ticket_service');
  const draft = await getUserDraft(user.id);

  return { accessToken, refreshToken, user: { ...sanitizeUser(user), draft } };
}

// POST /auth/refresh — rotates refresh token (old one is deleted).
async function refresh(refreshToken) {
  if (!refreshToken) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'refreshToken is required');
  }

  let payload;
  try {
    payload = jwt.verify(refreshToken, REFRESH_SECRET);
  } catch {
    throw new ApiError(401, 'REFRESH_TOKEN_INVALID', 'Refresh token is invalid or expired');
  }

  const stored = await db.selectOne(
    'refresh_tokens',
    `token=eq.${encodeURIComponent(refreshToken)}`
  );
  if (!stored || new Date(stored.expires_at) < new Date()) {
    throw new ApiError(401, 'REFRESH_TOKEN_INVALID', 'Refresh token was revoked or expired');
  }

  // Rotate: delete old, issue new pair.
  await db.remove('refresh_tokens', `token=eq.${encodeURIComponent(refreshToken)}`);
  const user = await db.selectOne('users', `id=eq.${payload.sub}`);
  if (!user) {
    throw new ApiError(401, 'REFRESH_TOKEN_INVALID', 'User no longer exists');
  }

  return {
    accessToken: signAccessToken(user),
    refreshToken: await issueRefreshToken(user.id),
  };
}

// POST /logout — deletes the given refresh token (auto-removal on logout).
async function logout(userId, refreshToken) {
  if (!refreshToken) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'refreshToken is required');
  }
  const deleted = await db.remove(
    'refresh_tokens',
    `token=eq.${encodeURIComponent(refreshToken)}&user_id=eq.${userId}`
  );
  if (deleted.length === 0) {
    throw new ApiError(401, 'REFRESH_TOKEN_INVALID', 'Refresh token not found for this user');
  }
  console.log(`Refresh token removed on logout for user ${userId}`);
  return { message: 'Logged out successfully' };
}

// GET /auth/me — current user info + his draft.
async function me(userId) {
  const user = await db.selectOne('users', `id=eq.${userId}`);
  if (!user) throw new ApiError(404, 'USER_NOT_FOUND', 'User not found');
  const { getUserDraft } = require('./ticket_service');
  const draft = await getUserDraft(userId);
  return { ...sanitizeUser(user), draft };
}

function verifyAccessToken(token) {
  return jwt.verify(token, ACCESS_SECRET);
}

module.exports = { register, login, refresh, logout, me, verifyAccessToken };