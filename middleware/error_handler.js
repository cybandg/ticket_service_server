// Central error type + express error handler.
// Every error is returned as: { "error": { "code": "...", "message": "..." } }

class ApiError extends Error {
    constructor(status, code, message) {
      super(message);
      this.status = status;
      this.code = code;
    }
  }
  
  function notFoundHandler(req, res) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.path} not found` } });
  }
  
  // eslint-disable-next-line no-unused-vars
  function errorHandler(err, req, res, next) {
    if (err instanceof ApiError) {
      return res.status(err.status).json({ error: { code: err.code, message: err.message } });
    }
    // Body-parser / unexpected errors
    console.error('Unhandled error:', err);
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
  }
  
  module.exports = { ApiError, notFoundHandler, errorHandler };