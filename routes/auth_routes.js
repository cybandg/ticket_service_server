const express = require('express');
const authService = require('../services/auth_service');
const { requireAuth } = require('../middleware/auth_middleware');

const router = express.Router();

// POST /registration  { login, password } -> 201 { user, draft }
router.post('/registration', async (req, res, next) => {
  try {
    const { login, password } = req.body || {};
    const result = await authService.register(login, password);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

// POST /auth  { login, password } -> 200 { accessToken, refreshToken, user: { ..., draft } }
router.post('/auth', async (req, res, next) => {
  try {
    const { login, password } = req.body || {};
    const result = await authService.login(login, password);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /auth/refresh  { refreshToken } -> 200 { accessToken, refreshToken }
router.post('/auth/refresh', async (req, res, next) => {
  try {
    const { refreshToken } = req.body || {};
    const result = await authService.refresh(refreshToken);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /logout  (Bearer) { refreshToken } -> 200 { message }
router.post('/logout', requireAuth, async (req, res, next) => {
  try {
    const { refreshToken } = req.body || {};
    const result = await authService.logout(req.user.id, refreshToken);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET /auth/me  (Bearer) -> 200 { id, login, created_at, draft }
router.get('/auth/me', requireAuth, async (req, res, next) => {
  try {
    res.json(await authService.me(req.user.id));
  } catch (err) {
    next(err);
  }
});

module.exports = router;   // <-- ЭТА СТРОКА ОБЯЗАТЕЛЬНА, без неё и падает app.use()