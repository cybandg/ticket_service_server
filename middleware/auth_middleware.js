const authService = require('../services/auth_service');
const { ApiError } = require('./error_handler');

// Verifies "Authorization: Bearer <accessToken>" and attaches req.user = { id, login }
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return next(new ApiError(401, 'AUTH_TOKEN_MISSING', 'Authorization Bearer token is required'));
  }

  try {
    const payload = authService.verifyAccessToken(token);
    req.user = { id: payload.sub, login: payload.login };
    return next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return next(new ApiError(401, 'AUTH_TOKEN_EXPIRED', 'Access token expired, use refresh token'));
    }
    return next(new ApiError(401, 'AUTH_TOKEN_INVALID', 'Access token is invalid'));
  }
}

module.exports = { requireAuth };