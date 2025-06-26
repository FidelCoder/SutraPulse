import winston from 'winston';

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.Console()
  ]
});

/**
 * Global error handler middleware
 * Must be used last in the middleware chain
 */
function errorHandler(err, req, res, next) {
  // Default error values
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Internal Server Error';
  let code = err.code || 'INTERNAL_ERROR';
  let details = err.details || null;

  // Log the error
  logger.error('Error occurred:', {
    error: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    userId: req.user?.id || 'anonymous',
    timestamp: new Date().toISOString()
  });

  // Handle specific error types
  if (err.name === 'ValidationError') {
    statusCode = 400;
    message = 'Validation failed';
    code = 'VALIDATION_ERROR';
    details = err.details;
  } else if (err.name === 'UnauthorizedError' || err.name === 'JsonWebTokenError') {
    statusCode = 401;
    message = 'Unauthorized';
    code = 'UNAUTHORIZED';
  } else if (err.name === 'ForbiddenError') {
    statusCode = 403;
    message = 'Forbidden';
    code = 'FORBIDDEN';
  } else if (err.name === 'NotFoundError') {
    statusCode = 404;
    message = 'Resource not found';
    code = 'NOT_FOUND';
  } else if (err.name === 'ConflictError') {
    statusCode = 409;
    message = 'Conflict';
    code = 'CONFLICT';
  } else if (err.name === 'RateLimitError') {
    statusCode = 429;
    message = 'Too many requests';
    code = 'RATE_LIMIT_EXCEEDED';
  }

  // Nexus SDK specific errors
  if (err.message && err.message.includes('NexusSDK')) {
    statusCode = 503;
    code = 'NEXUS_SDK_ERROR';
    message = 'Wallet service temporarily unavailable';
  }

  // Redis connection errors
  if (err.message && err.message.includes('Redis')) {
    statusCode = 503;
    code = 'CACHE_ERROR';
    message = 'Cache service temporarily unavailable';
  }

  // Network/timeout errors
  if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
    statusCode = 503;
    code = 'SERVICE_UNAVAILABLE';
    message = 'External service temporarily unavailable';
  }

  // Don't expose internal errors in production
  if (process.env.NODE_ENV === 'production' && statusCode === 500) {
    message = 'Something went wrong. Please try again later.';
    details = null;
  }

  // Error response format
  const errorResponse = {
    success: false,
    error: {
      message,
      code,
      statusCode,
      timestamp: new Date().toISOString(),
      requestId: req.id || 'unknown'
    }
  };

  // Add details if available
  if (details) {
    errorResponse.error.details = details;
  }

  // Add stack trace in development
  if (process.env.NODE_ENV === 'development') {
    errorResponse.error.stack = err.stack;
  }

  res.status(statusCode).json(errorResponse);
}

/**
 * Handle 404 errors for undefined routes
 */
function notFoundHandler(req, res) {
  logger.warn('404 Not Found:', {
    url: req.url,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });

  res.status(404).json({
    success: false,
    error: {
      message: 'Route not found',
      code: 'ROUTE_NOT_FOUND',
      statusCode: 404,
      path: req.originalUrl,
      method: req.method,
      timestamp: new Date().toISOString()
    }
  });
}

/**
 * Async error wrapper
 * Wraps async route handlers to catch errors automatically
 */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Custom error classes
 */
class ValidationError extends Error {
  constructor(message, details = null) {
    super(message);
    this.name = 'ValidationError';
    this.statusCode = 400;
    this.code = 'VALIDATION_ERROR';
    this.details = details;
  }
}

class NotFoundError extends Error {
  constructor(message = 'Resource not found') {
    super(message);
    this.name = 'NotFoundError';
    this.statusCode = 404;
    this.code = 'NOT_FOUND';
  }
}

class UnauthorizedError extends Error {
  constructor(message = 'Unauthorized') {
    super(message);
    this.name = 'UnauthorizedError';
    this.statusCode = 401;
    this.code = 'UNAUTHORIZED';
  }
}

class ForbiddenError extends Error {
  constructor(message = 'Forbidden') {
    super(message);
    this.name = 'ForbiddenError';
    this.statusCode = 403;
    this.code = 'FORBIDDEN';
  }
}

class ConflictError extends Error {
  constructor(message = 'Conflict') {
    super(message);
    this.name = 'ConflictError';
    this.statusCode = 409;
    this.code = 'CONFLICT';
  }
}

class RateLimitError extends Error {
  constructor(message = 'Rate limit exceeded') {
    super(message);
    this.name = 'RateLimitError';
    this.statusCode = 429;
    this.code = 'RATE_LIMIT_EXCEEDED';
  }
}

export {
  errorHandler,
  notFoundHandler,
  asyncHandler,
  ValidationError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  ConflictError,
  RateLimitError
}; 