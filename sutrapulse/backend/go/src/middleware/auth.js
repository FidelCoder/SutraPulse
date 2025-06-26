import jwt from 'jsonwebtoken';
import winston from 'winston';

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.simple(),
  transports: [new winston.transports.Console()]
});

/**
 * Authentication middleware
 * Validates JWT tokens and attaches user info to request
 */
function authMiddleware(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
      return res.status(401).json({
        error: 'Authorization header required',
        code: 'MISSING_AUTH_HEADER'
      });
    }

    const token = authHeader.startsWith('Bearer ') 
      ? authHeader.slice(7) 
      : authHeader;

    if (!token) {
      return res.status(401).json({
        error: 'Token required',
        code: 'MISSING_TOKEN'
      });
    }

    // Verify JWT token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Attach user info to request
    req.user = {
      id: decoded.id,
      ensName: decoded.ensName,
      socialId: decoded.socialId,
      socialType: decoded.socialType,
      walletAddresses: decoded.walletAddresses,
      permissions: decoded.permissions || [],
      iat: decoded.iat,
      exp: decoded.exp
    };

    // Check if token is expired
    if (decoded.exp && Date.now() >= decoded.exp * 1000) {
      return res.status(401).json({
        error: 'Token expired',
        code: 'TOKEN_EXPIRED',
        expiredAt: new Date(decoded.exp * 1000).toISOString()
      });
    }

    logger.info(`Authenticated user: ${req.user.ensName || req.user.socialId}`);
    next();

  } catch (error) {
    logger.error('Authentication failed:', error.message);
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        error: 'Invalid token',
        code: 'INVALID_TOKEN'
      });
    }
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        error: 'Token expired',
        code: 'TOKEN_EXPIRED',
        expiredAt: error.expiredAt
      });
    }

    return res.status(500).json({
      error: 'Authentication error',
      message: error.message,
      code: 'AUTH_ERROR'
    });
  }
}

/**
 * Optional authentication middleware
 * Allows requests without tokens but attaches user info if token present
 */
function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader) {
    req.user = null;
    return next();
  }

  try {
    authMiddleware(req, res, next);
  } catch (error) {
    // Continue without authentication
    req.user = null;
    next();
  }
}

/**
 * Permission-based middleware
 * Requires specific permissions
 */
function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'Authentication required',
        code: 'AUTH_REQUIRED'
      });
    }

    if (!req.user.permissions.includes(permission)) {
      return res.status(403).json({
        error: 'Insufficient permissions',
        required: permission,
        code: 'INSUFFICIENT_PERMISSIONS'
      });
    }

    next();
  };
}

export {
  authMiddleware,
  optionalAuth,
  requirePermission
}; 