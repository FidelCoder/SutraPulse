import express from 'express';
import jwt from 'jsonwebtoken';
import Joi from 'joi';
import winston from 'winston';
import axios from 'axios';

const router = express.Router();
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.simple(),
  transports: [new winston.transports.Console()]
});

// Custom NexusSDK client for auth routes
class AuthNexusSDK {
  constructor() {
    this.apiKey = process.env.NEXUS_API_KEY;
    this.baseURL = 'https://backend-amber-zeta-94.vercel.app';
    
    // Debug: Check API key in auth routes
    console.log('🔍 AuthNexusSDK Debug: API Key loaded:', this.apiKey ? 'YES' : 'NO');
    console.log('🔍 AuthNexusSDK Debug: API Key preview:', this.apiKey ? this.apiKey.substring(0, 10) + '...' : 'NOT FOUND');
    
    if (!this.apiKey) {
      throw new Error('NEXUS_API_KEY environment variable is required');
    }
    
    this.client = axios.create({
      baseURL: this.baseURL,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey
      }
    });
  }

  async createWallet(data) {
    try {
      const response = await this.client.post('/api/wallets', data);
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.error || error.message);
    }
  }

  async deployWallet(data) {
    try {
      const response = await this.client.post('/api/wallets/deploy', data);
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.error || error.message);
    }
  }
}

// Validation schemas
const oneClickAccountSchema = Joi.object({
  email: Joi.string().email().required(),
  name: Joi.string().min(2).max(50).required(),
  ensName: Joi.string().pattern(/^[a-zA-Z0-9-]+\.eth$/).optional(),
  chains: Joi.array().items(Joi.string().valid('ethereum', 'polygon', 'arbitrum', 'base', 'optimism', 'solana')).default(['ethereum', 'polygon', 'solana']),
  socialProvider: Joi.string().valid('google', 'x', 'manual').default('manual'),
  socialId: Joi.string().optional(),
  preferences: Joi.object({
    defaultChain: Joi.string().valid('ethereum', 'polygon', 'arbitrum', 'base', 'optimism', 'solana').default('ethereum'),
    paymasterEnabled: Joi.boolean().default(true),
    notificationsEnabled: Joi.boolean().default(true)
  }).default({})
});

/**
 * POST /api/auth/create-account
 * One-click account creation with automatic wallet setup
 */
router.post('/create-account', async (req, res) => {
  try {
    const { error, value } = oneClickAccountSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.details[0].message,
        code: 'VALIDATION_ERROR'
      });
    }

    const { email, name, ensName, chains, socialProvider, socialId, preferences } = value;
    
    logger.info(`Creating one-click account for: ${email}`);

    // Generate ENS name if not provided
    const finalEnsName = ensName || generateEnsName(name, email);
    const userSocialId = socialId || `${socialProvider}:${email}`;
    
    // Step 1: Create wallet using NexusSDK
    logger.info(`Creating wallet for ENS: ${finalEnsName}`);
    
    const walletData = {
      socialId: `ens:${finalEnsName}`,
      socialType: 'ensIdentity',
      chains,
      paymaster: preferences.paymasterEnabled,
      metadata: {
        email,
        name,
        socialProvider,
        ensName: finalEnsName,
        preferences,
        createdAt: new Date().toISOString(),
        version: '1.0.0'
      }
    };

    const authNexusSDK = new AuthNexusSDK();
    const wallet = await authNexusSDK.createWallet(walletData);
    
    // Step 2: Generate user profile and JWT token
    const userProfile = {
      id: generateUserId(),
      email,
      name,
      ensName: finalEnsName,
      socialId: userSocialId,
      socialType: socialProvider,
      walletAddresses: wallet.addresses,
      preferences,
      createdAt: new Date().toISOString(),
      lastLogin: new Date().toISOString()
    };

    // Step 3: Create JWT token with wallet permissions
    const token = jwt.sign(
      {
        id: userProfile.id,
        email: userProfile.email,
        ensName: finalEnsName,
        socialId: userSocialId,
        socialType: socialProvider,
        walletAddresses: wallet.addresses,
        permissions: [
          'wallet:create',
          'wallet:read',
          'wallet:execute',
          'ai:query',
          'identity:manage',
          'storage:access'
        ]
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
    );

    logger.info(`✅ One-click account created successfully for ${email}`);
    logger.info(`🔗 Wallet addresses: ${JSON.stringify(wallet.addresses)}`);

    // Step 4: Return complete account setup
    res.status(201).json({
      success: true,
      message: 'Account created successfully with wallet setup',
      user: userProfile,
      wallet: {
        addresses: wallet.addresses,
        socialId: wallet.socialId,
        socialType: wallet.socialType,
        canDeploy: wallet.canDeploy,
        crossChainEnabled: wallet.crossChainEnabled,
        contractAddresses: wallet.contractAddresses,
        balances: wallet.balances || {},
        gasTank: wallet.gasTank || { totalBalance: '0' }
      },
      token,
      setup: {
        chains: chains.length,
        paymasterEnabled: preferences.paymasterEnabled,
        defaultChain: preferences.defaultChain,
        ensName: finalEnsName
      },
      nextSteps: [
        'Your wallet is ready across all selected chains',
        'You can now make transactions with gas sponsorship',
        'Your ENS identity is linked to all addresses',
        'Use the provided token for authenticated API calls'
      ]
    });

  } catch (error) {
    logger.error('One-click account creation failed:', error);
    res.status(500).json({
      error: 'Account creation failed',
      message: error.message,
      code: 'ACCOUNT_CREATION_FAILED'
    });
  }
});

/**
 * POST /api/auth/quick-setup
 * Simplified version with minimal input required
 */
router.post('/quick-setup', async (req, res) => {
  try {
    const { email, name, deployImmediately = true } = req.body;
    
    if (!email || !name) {
      return res.status(400).json({
        error: 'Email and name are required',
        code: 'MISSING_REQUIRED_FIELDS'
      });
    }

    logger.info(`Creating one-click account for: ${email}`);

    // Use default settings for quickest setup
    const chains = ['ethereum', 'polygon', 'solana']; // Default cross-chain setup
    const finalEnsName = generateEnsName(name, email);
    const userSocialId = `manual:${email}`;
    
    // Step 1: Create wallet using NexusSDK
    logger.info(`Creating wallet for ENS: ${finalEnsName}`);
    
    const walletData = {
      socialId: `ens:${finalEnsName}`,
      socialType: 'ensIdentity',
      chains,
      paymaster: true,
      metadata: {
        email,
        name,
        socialProvider: 'manual',
        ensName: finalEnsName,
        preferences: {
          defaultChain: 'ethereum',
          paymasterEnabled: true,
          notificationsEnabled: true
        },
        createdAt: new Date().toISOString(),
        version: '1.0.0'
      }
    };

    const authNexusSDK = new AuthNexusSDK();
    const wallet = await authNexusSDK.createWallet(walletData);

    // Step 2: Deploy wallet if requested
    let deploymentResult = null;
    if (deployImmediately) {
      logger.info(`🚀 Deploying wallet immediately for: ${email}`);
      try {
        deploymentResult = await authNexusSDK.deployWallet({
          socialId: `ens:${finalEnsName}`,
          socialType: 'ensIdentity',
          chains,
          paymaster: true,
          deployImmediately: true
        });
        logger.info(`✅ Wallet deployed successfully for ${email}`);
      } catch (deployError) {
        logger.warn(`⚠️ Wallet created but deployment failed: ${deployError.message}`);
        // Continue without deployment - wallet addresses are still valid
      }
    }
    
    // Step 3: Generate user profile and JWT token
    const userProfile = {
      id: generateUserId(),
      email,
      name,
      ensName: finalEnsName,
      socialId: userSocialId,
      socialType: 'manual',
      walletAddresses: wallet.addresses,
      preferences: {
        defaultChain: 'ethereum',
        paymasterEnabled: true,
        notificationsEnabled: true
      },
      createdAt: new Date().toISOString(),
      lastLogin: new Date().toISOString()
    };

    // Step 4: Create JWT token with wallet permissions
    const token = jwt.sign(
      {
        id: userProfile.id,
        email: userProfile.email,
        ensName: finalEnsName,
        socialId: userSocialId,
        socialType: 'manual',
        walletAddresses: wallet.addresses,
        permissions: [
          'wallet:create',
          'wallet:read',
          'wallet:execute',
          'ai:query',
          'identity:manage',
          'storage:access'
        ]
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
    );

    logger.info(`✅ One-click account created successfully for ${email}`);
    logger.info(`🔗 Wallet addresses: ${JSON.stringify(wallet.addresses)}`);

    // Step 5: Return complete account setup
    const response = {
      success: true,
      message: 'Account created successfully with wallet setup',
      user: userProfile,
      wallet: {
        addresses: wallet.addresses,
        socialId: wallet.socialId,
        socialType: wallet.socialType,
        crossChainEnabled: wallet.crossChainEnabled,
        balances: wallet.balances || {},
        gasTank: wallet.gasTank || { totalBalance: '0' },
        explorerUrls: generateExplorerUrls(wallet.addresses, chains)
      },
      token,
      setup: {
        chains: chains.length,
        paymasterEnabled: true,
        defaultChain: 'ethereum',
        ensName: finalEnsName,
        deployed: deploymentResult !== null
      },
      nextSteps: [
        deploymentResult ? 'Your wallet is deployed and ready across all selected chains' : 'Your wallet is ready across all selected chains',
        'You can now make transactions with gas sponsorship',
        'Your ENS identity is linked to all addresses',
        'Use the provided token for authenticated API calls'
      ]
    };

    // Add deployment info if available
    if (deploymentResult) {
      response.deployment = {
        status: 'deployed',
        transactions: deploymentResult.transactions,
        timestamp: new Date().toISOString()
      };
    }

    res.status(201).json(response);

  } catch (error) {
    logger.error('Quick setup failed:', error);
    res.status(500).json({
      error: 'Quick setup failed',
      message: error.message,
      code: 'QUICK_SETUP_FAILED'
    });
  }
});

// Helper functions
function generateEnsName(name, email) {
  // Create ENS name from user's name and email
  const cleanName = name.toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .substring(0, 10);
  
  const emailHash = email.split('@')[0].toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .substring(0, 6);
    
  const timestamp = Date.now().toString().slice(-4);
  
  return `${cleanName}${emailHash}${timestamp}.eth`;
}

function generateUserId() {
  return `user_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

// Helper function to generate explorer URLs for auth routes
function generateExplorerUrls(addresses, chains) {
  const explorers = {
    ethereum: 'https://sepolia.etherscan.io/address',
    polygon: 'https://mumbai.polygonscan.com/address',
    arbitrum: 'https://goerli.arbiscan.io/address',
    base: 'https://goerli.basescan.org/address',
    optimism: 'https://goerli-optimism.etherscan.io/address',
    solana: 'https://explorer.solana.com/address'
  };

  const urls = {};
  for (const chain of chains) {
    if (addresses[chain] && explorers[chain]) {
      const suffix = chain === 'solana' ? '?cluster=devnet' : '';
      urls[chain] = `${explorers[chain]}/${addresses[chain]}${suffix}`;
    }
  }
  return urls;
}

/**
 * POST /api/auth/google
 * Google OAuth login
 */
router.post('/google', async (req, res) => {
  try {
    const { googleToken } = req.body;
    
    if (!googleToken) {
      return res.status(400).json({
        error: 'Google token required'
      });
    }

    // Verify Google token (placeholder)
    // In production, verify with Google's API
    const userData = {
      id: 'google_user_123',
      email: 'user@example.com',
      name: 'John Doe'
    };

    // Generate JWT
    const token = jwt.sign(
      {
        id: userData.id,
        socialId: `google:${userData.email}`,
        socialType: 'google',
        email: userData.email,
        name: userData.name
      },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      token,
      user: userData,
      message: 'Google authentication successful'
    });

  } catch (error) {
    logger.error('Google auth error:', error);
    res.status(500).json({
      error: 'Authentication failed',
      message: error.message
    });
  }
});

/**
 * POST /api/auth/x
 * X (Twitter) OAuth login
 */
router.post('/x', async (req, res) => {
  try {
    const { xToken } = req.body;
    
    if (!xToken) {
      return res.status(400).json({
        error: 'X token required'
      });
    }

    // Verify X token (placeholder)
    const userData = {
      id: 'x_user_123',
      handle: '@johndoe',
      name: 'John Doe'
    };

    // Generate JWT
    const token = jwt.sign(
      {
        id: userData.id,
        socialId: `x:${userData.handle}`,
        socialType: 'x',
        handle: userData.handle,
        name: userData.name
      },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      token,
      user: userData,
      message: 'X authentication successful'
    });

  } catch (error) {
    logger.error('X auth error:', error);
    res.status(500).json({
      error: 'Authentication failed',
      message: error.message
    });
  }
});

/**
 * POST /api/auth/test
 * Generate test JWT token for development
 */
router.post('/test', async (req, res) => {
  try {
    // Only allow in development
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({
        error: 'Test auth not available in production'
      });
    }

    const { ensName = 'test.eth', socialId = 'test:user123' } = req.body;

    // Generate test JWT
    const token = jwt.sign(
      {
        id: 'test_user_123',
        ensName,
        socialId,
        socialType: 'test',
        walletAddresses: {},
        permissions: ['wallet:create', 'wallet:read', 'ai:query']
      },
      process.env.JWT_SECRET || 'test_secret',
      { expiresIn: '24h' }
    );

    res.json({
      success: true,
      token,
      user: {
        id: 'test_user_123',
        ensName,
        socialId,
        socialType: 'test'
      },
      message: 'Test authentication successful',
      usage: 'Use this token in Authorization header: Bearer <token>'
    });

  } catch (error) {
    logger.error('Test auth error:', error);
    res.status(500).json({
      error: 'Test authentication failed',
      message: error.message
    });
  }
});

export default router; 