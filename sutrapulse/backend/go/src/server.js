import dotenv from 'dotenv';
dotenv.config();

// Debug: Check if API key is loaded
console.log('🔍 Debug: NEXUS_API_KEY loaded:', process.env.NEXUS_API_KEY ? 'YES' : 'NO');
console.log('🔍 Debug: API Key preview:', process.env.NEXUS_API_KEY ? process.env.NEXUS_API_KEY.substring(0, 10) + '...' : 'NOT FOUND');

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import winston from 'winston';
import rateLimit from 'express-rate-limit';

// Import route handlers
import walletRoutes from './routes/wallet.js';
import aiRoutes from './routes/ai.js';
import identityRoutes from './routes/identity.js';
import authRoutes from './routes/auth.js';
import storageRoutes from './routes/storage.js';
import healthRoutes from './routes/health.js';

// Import middleware
import { authMiddleware } from './middleware/auth.js';
import { errorHandler } from './middleware/errorHandler.js';
import { requestLogger } from './middleware/requestLogger.js';

// Configure logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ]
});

const app = express();
const PORT = process.env.PORT || 8080;

// Security middleware
app.use(helmet());

// CORS configuration
const corsOptions = {
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
  credentials: true
};
app.use(cors(corsOptions));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 1000,
  message: {
    error: 'Too many requests from this IP, please try again later.',
    retryAfter: '15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false
});
app.use('/api', limiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve static files from public directory
app.use(express.static('public'));

// Request logging
app.use(requestLogger);

// Health check (no auth required)
app.use('/health', healthRoutes);

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/wallet', authMiddleware, walletRoutes);
app.use('/api/ai', authMiddleware, aiRoutes);
app.use('/api/identity', authMiddleware, identityRoutes);
app.use('/api/storage', authMiddleware, storageRoutes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'SutraPulse Backend API',
    version: '1.0.0',
    status: 'running',
    features: [
      'Account Abstraction (EVM + SVM)',
      'AI Transaction Assistant',
      'ENS Identity Management',
      'OAuth Integration',
      'IPFS Storage',
      'ZKP Verification'
    ],
    documentation: '/api/docs'
  });
});

// API documentation endpoint
app.get('/api/docs', (req, res) => {
  res.json({
    endpoints: {
      wallet: {
        'POST /api/wallet/create': 'Create cross-chain wallet with ENS',
        'GET /api/wallet/:socialId': 'Get wallet information',
        'POST /api/wallet/execute': 'Execute transaction',
        'GET /api/wallet/status/:txHash': 'Get transaction status'
      },
      ai: {
        'POST /api/ai/query': 'Submit text query to AI agent',
        'POST /api/ai/validate': 'Validate transaction safety',
        'POST /api/ai/assist': 'Get transaction assistance'
      },
      identity: {
        'POST /api/identity/register': 'Register ENS identity',
        'GET /api/identity/resolve/:ens': 'Resolve ENS to addresses',
        'POST /api/identity/link': 'Link OAuth account to ENS'
      },
      auth: {
        'POST /api/auth/google': 'Google OAuth login',
        'POST /api/auth/x': 'X (Twitter) OAuth login',
        'POST /api/auth/refresh': 'Refresh JWT token'
      },
      storage: {
        'POST /api/storage/save': 'Save encrypted data to IPFS',
        'GET /api/storage/retrieve/:cid': 'Retrieve data from IPFS'
      }
    }
  });
});

// Error handling middleware (must be last)
app.use(errorHandler);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    path: req.originalUrl,
    method: req.method
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  server.close(() => {
    logger.info('Process terminated');
    process.exit(0);
  });
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

const server = app.listen(PORT, () => {
  logger.info(`🚀 SutraPulse Backend Server running on port ${PORT}`);
  logger.info(`🌐 Environment: ${process.env.NODE_ENV}`);
  logger.info(`🔗 NexusSDK Environment: ${process.env.NEXUS_ENVIRONMENT}`);
  logger.info(`📚 API Documentation: http://localhost:${PORT}/api/docs`);
});

export default app; 