import { StatusCodes } from 'http-status-codes';

export const errorHandler = (err, req, res, next) => {
  console.error('Error:', err);

  // Default error
  let statusCode = err.statusCode || StatusCodes.INTERNAL_SERVER_ERROR;
  let message = err.message || 'Internal Server Error';

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    statusCode = StatusCodes.BAD_REQUEST;
    try {
      message = Object.values(err.errors).map(e => e.message).join(', ');
    } catch {}
  }

  // Mongoose duplicate key error
  if (err.code === 11000) {
    statusCode = StatusCodes.CONFLICT;
    message = 'Duplicate record found';
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    statusCode = StatusCodes.UNAUTHORIZED;
    message = 'Invalid token';
  }

  // Cast error (invalid ObjectId)
  if (err.name === 'CastError') {
    statusCode = StatusCodes.BAD_REQUEST;
    message = 'Invalid ID format';
  }

  // Ensure CORS headers on all error responses (browser otherwise blocks and shows generic CORS error)
  try {
    const origin = req.headers.origin;
    if (origin) {
      if (!res.getHeader('Access-Control-Allow-Origin')) {
        res.setHeader('Access-Control-Allow-Origin', origin);
      }
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      const vary = res.getHeader('Vary');
      if (!vary) res.setHeader('Vary', 'Origin');
      else if (!String(vary).includes('Origin')) res.setHeader('Vary', vary + ', Origin');
    } else {
      // Non-browser / health-check calls: allow any
      if (!res.getHeader('Access-Control-Allow-Origin')) {
        res.setHeader('Access-Control-Allow-Origin', '*');
      }
    }
    // Common headers browsers may allow on error payloads
    if (!res.getHeader('Access-Control-Allow-Headers')) {
      res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Accept-Language, Authorization, X-Client-Type, X-Client-Platform, X-Refresh-Token');
    }
    if (!res.getHeader('Access-Control-Allow-Methods')) {
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    }
  } catch {}

  // Final JSON error response
  res.status(statusCode).json({
    success: false,
    message,
    detail: err.detail,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
};