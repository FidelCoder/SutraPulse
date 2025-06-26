import winston from 'winston';
import { v4 as uuidv4 } from 'uuid';

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/access.log' }),
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ]
});

/**
 * Request logging middleware
 * Logs all incoming requests with timing and response status
 */
function requestLogger(req, res, next) {
  const startTime = Date.now();
  const requestId = uuidv4();
  
  // Attach request ID to request object
  req.id = requestId;
  
  // Add request ID to response headers
  res.set('X-Request-ID', requestId);

  // Get client info
  const clientIp = req.ip || req.connection.remoteAddress || 'unknown';
  const userAgent = req.get('User-Agent') || 'unknown';
  const referer = req.get('Referer') || 'unknown';
  
  // Log request start
  const requestInfo = {
    requestId,
    method: req.method,
    url: req.originalUrl,
    path: req.path,
    query: req.query,
    ip: clientIp,
    userAgent,
    referer,
    timestamp: new Date().toISOString(),
    userId: req.user?.id || 'anonymous',
    ensName: req.user?.ensName || null
  };

  // Don't log sensitive data
  if (req.body && Object.keys(req.body).length > 0) {
    const sanitizedBody = sanitizeBody(req.body);
    if (Object.keys(sanitizedBody).length > 0) {
      requestInfo.body = sanitizedBody;
    }
  }

  logger.info('Request started', requestInfo);

  // Override res.end to log response
  const originalEnd = res.end;
  res.end = function(...args) {
    const endTime = Date.now();
    const duration = endTime - startTime;

    // Log response
    const responseInfo = {
      requestId,
      method: req.method,
      url: req.originalUrl,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      contentLength: res.get('Content-Length') || 0,
      timestamp: new Date().toISOString(),
      userId: req.user?.id || 'anonymous'
    };

    // Determine log level based on status code
    if (res.statusCode >= 500) {
      logger.error('Request completed with server error', responseInfo);
    } else if (res.statusCode >= 400) {
      logger.warn('Request completed with client error', responseInfo);
    } else {
      logger.info('Request completed successfully', responseInfo);
    }

    // Call original end function
    originalEnd.apply(this, args);
  };

  next();
}

/**
 * Sanitize request body to remove sensitive information
 */
function sanitizeBody(body) {
  const sensitiveFields = [
    'password',
    'token',
    'secret',
    'key',
    'private',
    'auth',
    'credential',
    'apiKey',
    'privateKey',
    'accessToken',
    'refreshToken'
  ];

  const sanitized = { ...body };

  // Recursively sanitize object
  function sanitizeObject(obj) {
    if (typeof obj !== 'object' || obj === null) {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map(sanitizeObject);
    }

    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      const lowerKey = key.toLowerCase();
      const isSensitive = sensitiveFields.some(field => lowerKey.includes(field));
      
      if (isSensitive) {
        result[key] = '[REDACTED]';
      } else if (typeof value === 'object') {
        result[key] = sanitizeObject(value);
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  return sanitizeObject(sanitized);
}

/**
 * Enhanced request logger with performance metrics
 */
function detailedRequestLogger(req, res, next) {
  const startTime = process.hrtime.bigint();
  const requestId = uuidv4();
  
  req.id = requestId;
  res.set('X-Request-ID', requestId);

  // Memory usage at request start
  const memoryBefore = process.memoryUsage();

  // Override res.end to capture more metrics
  const originalEnd = res.end;
  res.end = function(...args) {
    const endTime = process.hrtime.bigint();
    const duration = Number(endTime - startTime) / 1000000; // Convert to milliseconds
    const memoryAfter = process.memoryUsage();

    const metrics = {
      requestId,
      method: req.method,
      url: req.originalUrl,
      statusCode: res.statusCode,
      duration: `${duration.toFixed(2)}ms`,
      memory: {
        heapUsedDelta: formatBytes(memoryAfter.heapUsed - memoryBefore.heapUsed),
        heapTotal: formatBytes(memoryAfter.heapTotal),
        external: formatBytes(memoryAfter.external)
      },
      contentLength: res.get('Content-Length') || 0,
      timestamp: new Date().toISOString(),
      userId: req.user?.id || 'anonymous'
    };

    logger.info('Request metrics', metrics);
    originalEnd.apply(this, args);
  };

  next();
}

/**
 * Format bytes to human readable string
 */
function formatBytes(bytes) {
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  if (bytes === 0) return '0 Bytes';
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Security-focused request logger
 * Logs potential security events
 */
function securityLogger(req, res, next) {
  const securityEvents = [];

  // Check for suspicious patterns
  const suspiciousPatterns = [
    /script|javascript|eval|expression/i,
    /union|select|insert|update|delete|drop/i,
    /\.\.|\/\.\.|\\\.\./, // Path traversal
    /<script|<iframe|<object/i, // XSS attempts
    /\{.*\}|\[.*\]/, // Potential JSON injection in URL
  ];

  const urlToCheck = req.originalUrl + JSON.stringify(req.body || {});
  suspiciousPatterns.forEach((pattern, index) => {
    if (pattern.test(urlToCheck)) {
      securityEvents.push(`Suspicious pattern ${index + 1} detected`);
    }
  });

  // Check for unusual headers
  const suspiciousHeaders = ['x-forwarded-for', 'x-real-ip', 'x-original-url'];
  suspiciousHeaders.forEach(header => {
    if (req.get(header)) {
      securityEvents.push(`Header ${header} present`);
    }
  });

  // Log security events
  if (securityEvents.length > 0) {
    logger.warn('Security event detected', {
      requestId: req.id,
      events: securityEvents,
      method: req.method,
      url: req.originalUrl,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      timestamp: new Date().toISOString()
    });
  }

  next();
}

export {
  requestLogger,
  detailedRequestLogger,
  securityLogger,
  sanitizeBody
}; 