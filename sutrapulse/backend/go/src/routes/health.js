import express from 'express';
import winston from 'winston';
import Redis from 'redis';
import { NexusSDK } from '@nexuspay/sdk';

const router = express.Router();
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.simple(),
  transports: [new winston.transports.Console()]
});

// Initialize connections
const redis = Redis.createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
  password: process.env.REDIS_PASSWORD
});

redis.on('error', (err) => logger.error('Redis Client Error', err));
redis.connect().catch(console.error);

/**
 * GET /health
 * Basic health check
 */
router.get('/', async (req, res) => {
  const startTime = Date.now();
  
  try {
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      responseTime: `${Date.now() - startTime}ms`
    };

    res.json(health);
  } catch (error) {
    logger.error('Health check failed:', error);
    res.status(500).json({
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /health/detailed
 * Comprehensive health check with dependencies
 */
router.get('/detailed', async (req, res) => {
  const startTime = Date.now();
  
  try {
    const checks = await Promise.allSettled([
      checkRedis(),
      checkNexusSDK(),
      checkMemory(),
      checkDiskSpace()
    ]);

    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      responseTime: `${Date.now() - startTime}ms`,
      checks: {
        redis: checks[0].status === 'fulfilled' ? checks[0].value : { status: 'error', error: checks[0].reason?.message },
        nexusSDK: checks[1].status === 'fulfilled' ? checks[1].value : { status: 'error', error: checks[1].reason?.message },
        memory: checks[2].status === 'fulfilled' ? checks[2].value : { status: 'error', error: checks[2].reason?.message },
        disk: checks[3].status === 'fulfilled' ? checks[3].value : { status: 'error', error: checks[3].reason?.message }
      }
    };

    // Determine overall status
    const hasErrors = Object.values(health.checks).some(check => check.status === 'error');
    if (hasErrors) {
      health.status = 'degraded';
    }

    const statusCode = health.status === 'healthy' ? 200 : 503;
    res.status(statusCode).json(health);

  } catch (error) {
    logger.error('Detailed health check failed:', error);
    res.status(500).json({
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString(),
      responseTime: `${Date.now() - startTime}ms`
    });
  }
});

/**
 * GET /health/live
 * Kubernetes liveness probe
 */
router.get('/live', (req, res) => {
  res.json({
    status: 'alive',
    timestamp: new Date().toISOString()
  });
});

/**
 * GET /health/ready
 * Kubernetes readiness probe
 */
router.get('/ready', async (req, res) => {
  try {
    // Check critical dependencies
    const redisReady = await checkRedis();
    
    if (redisReady.status === 'healthy') {
      res.json({
        status: 'ready',
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(503).json({
        status: 'not ready',
        reason: 'Redis connection failed',
        timestamp: new Date().toISOString()
      });
    }
  } catch (error) {
    res.status(503).json({
      status: 'not ready',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Helper functions
async function checkRedis() {
  try {
    await redis.ping();
    return {
      status: 'healthy',
      connected: redis.isReady,
      responseTime: '<5ms'
    };
  } catch (error) {
    return {
      status: 'error',
      connected: false,
      error: error.message
    };
  }
}

async function checkNexusSDK() {
  try {
    // Initialize SDK if not already done
    const nexusSDK = new NexusSDK({
      apiKey: process.env.NEXUS_API_KEY,
      environment: process.env.NEXUS_ENVIRONMENT || 'production',
      chains: ['ethereum', 'polygon', 'arbitrum', 'solana']
    });

    const health = await nexusSDK.healthCheck();
    return {
      status: 'healthy',
      api: health.status,
      version: health.sdk?.version,
      chains: ['ethereum', 'polygon', 'arbitrum', 'solana']
    };
  } catch (error) {
    return {
      status: 'error',
      error: error.message
    };
  }
}

function checkMemory() {
  const usage = process.memoryUsage();
  const totalMemory = usage.heapTotal + usage.external;
  const usedMemory = usage.heapUsed;
  const memoryPercent = (usedMemory / totalMemory) * 100;

  return {
    status: memoryPercent > 90 ? 'warning' : 'healthy',
    usage: {
      heapUsed: formatBytes(usage.heapUsed),
      heapTotal: formatBytes(usage.heapTotal),
      external: formatBytes(usage.external),
      rss: formatBytes(usage.rss)
    },
    percentage: `${memoryPercent.toFixed(2)}%`
  };
}

async function checkDiskSpace() {
  try {
    const fs = require('fs').promises;
    const stats = await fs.stat('.');
    
    return {
      status: 'healthy',
      available: 'Unknown', // Would need platform-specific implementation
      message: 'Disk space check not fully implemented'
    };
  } catch (error) {
    return {
      status: 'error',
      error: error.message
    };
  }
}

function formatBytes(bytes) {
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  if (bytes === 0) return '0 Bytes';
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
}

export default router; 