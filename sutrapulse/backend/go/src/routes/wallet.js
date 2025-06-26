import express from 'express';
import axios from 'axios';
import Joi from 'joi';
import winston from 'winston';
import Redis from 'redis';

const router = express.Router();
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.simple(),
  transports: [new winston.transports.Console()]
});

// Custom NexusSDK client using axios with correct headers
class CustomNexusSDK {
  constructor(config) {
    this.apiKey = config.apiKey;
    this.baseURL = config.endpoints?.api || 'https://backend-amber-zeta-94.vercel.app';
    this.client = axios.create({
      baseURL: this.baseURL,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey
      }
    });
  }

  async initialize() {
    // Test the connection
    try {
      await this.client.get('/health');
      return true;
    } catch (error) {
      throw new Error(`Failed to initialize NexusSDK: ${error.message}`);
    }
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

  async getWallet(socialId) {
    try {
      const response = await this.client.get(`/api/wallets/${socialId}`);
      return response.data;
    } catch (error) {
      if (error.response?.status === 404) {
        return null;
      }
      throw new Error(error.response?.data?.error || error.message);
    }
  }

  async getWalletStatus(socialId) {
    try {
      const response = await this.client.get(`/api/wallets/status?socialId=${socialId}`);
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.error || error.message);
    }
  }

  async healthCheck() {
    try {
      const response = await this.client.get('/health');
      return { status: 'healthy', api: response.data };
    } catch (error) {
      return { status: 'unhealthy', error: error.message };
    }
  }

  getStats() {
    return {
      supportedChains: ['ethereum', 'polygon', 'arbitrum', 'base', 'optimism', 'solana'],
      cacheSize: 0
    };
  }
}

// Initialize Custom NexusSDK
const nexusSDK = new CustomNexusSDK({
  apiKey: process.env.NEXUS_API_KEY,
  environment: process.env.NEXUS_ENVIRONMENT || 'production',
  endpoints: {
    api: process.env.NEXUS_API_ENDPOINT || 'https://backend-amber-zeta-94.vercel.app'
  }
});

// Initialize Redis for caching
const redis = Redis.createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
  password: process.env.REDIS_PASSWORD
});

redis.on('error', (err) => logger.error('Redis Client Error', err));
redis.connect().catch(console.error);

// Validation schemas
const createWalletSchema = Joi.object({
  ensName: Joi.string().pattern(/^[a-zA-Z0-9-]+\.eth$/).required(),
  chains: Joi.array().items(Joi.string().valid('ethereum', 'polygon', 'arbitrum', 'solana')).min(1).required(),
  paymaster: Joi.boolean().default(true),
  metadata: Joi.object().optional()
});

const executeTransactionSchema = Joi.object({
  socialId: Joi.string().required(),
  chain: Joi.string().valid('ethereum', 'polygon', 'arbitrum', 'solana').required(),
  to: Joi.string().required(),
  value: Joi.string().optional(),
  data: Joi.string().optional(),
  gasLimit: Joi.number().optional()
});

const deployWalletSchema = Joi.object({
  socialId: Joi.string().required(),
  socialType: Joi.string().valid('email', 'ensIdentity', 'google', 'x', 'manual').default('ensIdentity'),
  chains: Joi.array().items(Joi.string().valid('ethereum', 'polygon', 'arbitrum', 'base', 'optimism', 'solana')).min(1).required(),
  paymaster: Joi.boolean().default(true),
  deployImmediately: Joi.boolean().default(true)
});

// Initialize SDK
(async () => {
  try {
    await nexusSDK.initialize();
    logger.info('✅ NexusSDK initialized successfully');
  } catch (error) {
    logger.error('❌ Failed to initialize NexusSDK:', error);
  }
})();

/**
 * POST /api/wallet/create
 * Create cross-chain wallet with ENS-based identity
 */
router.post('/create', async (req, res) => {
  try {
    const { error, value } = createWalletSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.details[0].message
      });
    }

    const { ensName, chains, paymaster, metadata } = value;
    
    // Generate unique social ID based on ENS name
    const socialId = `ens:${ensName}`;
    const socialType = 'ensIdentity';

    logger.info(`Creating wallet for ENS: ${ensName}, chains: ${chains.join(', ')}`);

    // Check cache first
    const cacheKey = `wallet:${socialId}`;
    const cached = await redis.get(cacheKey);
    if (cached) {
      logger.info(`Returning cached wallet for ${ensName}`);
      return res.json({
        success: true,
        wallet: JSON.parse(cached),
        cached: true
      });
    }

    // Create wallet using NexusSDK
    const wallet = await nexusSDK.createWallet({
      socialId,
      socialType,
      chains,
      paymaster,
      metadata: {
        ...metadata,
        ensName,
        createdAt: new Date().toISOString(),
        version: '1.0.0'
      }
    });

    // Cache the result for 5 minutes
    await redis.setEx(cacheKey, 300, JSON.stringify(wallet));

    logger.info(`✅ Wallet created successfully for ${ensName}`);
    logger.info(`🔗 Addresses: ${JSON.stringify(wallet.addresses)}`);

    res.json({
      success: true,
      wallet,
      message: `Cross-chain wallet created for ${ensName}`,
      chains: Object.keys(wallet.addresses)
    });

  } catch (error) {
    logger.error('Error creating wallet:', error);
    res.status(500).json({
      error: 'Failed to create wallet',
      message: error.message,
      code: error.code || 'WALLET_CREATION_FAILED'
    });
  }
});

/**
 * GET /api/wallet/test
 * Test endpoint for wallet creation simulation (no real API calls)
 */
router.get('/test', async (req, res) => {
  try {
    // Mock successful wallet creation response
    const mockWallet = {
      socialId: 'ens:test.eth',
      socialType: 'ensIdentity',
      addresses: {
        ethereum: '0x1234567890123456789012345678901234567890',
        polygon: '0x0987654321098765432109876543210987654321',
        solana: 'ABC123def456GHI789jkl012MNO345pqr678STU901'
      },
      chains: ['ethereum', 'polygon', 'solana'],
      paymaster: true,
      metadata: {
        ensName: 'test.eth',
        createdAt: new Date().toISOString(),
        version: '1.0.0'
      },
      created: new Date().toISOString()
    };

    logger.info('Test wallet creation successful');

    res.json({
      success: true,
      wallet: mockWallet,
      message: 'Test wallet created successfully (mock data)',
      note: 'This is test data - real wallet creation requires valid NexusSDK API key'
    });

  } catch (error) {
    logger.error('Test endpoint error:', error);
    res.status(500).json({
      error: 'Test endpoint failed',
      message: error.message
    });
  }
});

/**
 * GET /api/wallet/:socialId
 * Get wallet information by social ID (ENS name)
 */
router.get('/:socialId', async (req, res) => {
  try {
    const { socialId } = req.params;
    
    // Support both direct social ID and ENS name
    const normalizedSocialId = socialId.startsWith('ens:') ? socialId : `ens:${socialId}`;
    
    logger.info(`Fetching wallet for social ID: ${normalizedSocialId}`);

    // Check cache first
    const cacheKey = `wallet:${normalizedSocialId}`;
    const cached = await redis.get(cacheKey);
    if (cached) {
      return res.json({
        success: true,
        wallet: JSON.parse(cached),
        cached: true
      });
    }

    // Get wallet from NexusSDK
    const wallet = await nexusSDK.getWallet(normalizedSocialId);
    
    if (!wallet) {
      return res.status(404).json({
        error: 'Wallet not found',
        socialId: normalizedSocialId
      });
    }

    // Cache for 5 minutes
    await redis.setEx(cacheKey, 300, JSON.stringify(wallet));

    res.json({
      success: true,
      wallet
    });

  } catch (error) {
    logger.error('Error fetching wallet:', error);
    res.status(500).json({
      error: 'Failed to fetch wallet',
      message: error.message
    });
  }
});

/**
 * POST /api/wallet/execute
 * Execute transaction through account abstraction
 */
router.post('/execute', async (req, res) => {
  try {
    const { error, value } = executeTransactionSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.details[0].message
      });
    }

    const { socialId, chain, to, value: txValue, data, gasLimit } = value;
    
    logger.info(`Executing transaction for ${socialId} on ${chain}`);

    // Prepare transaction data
    const transactionData = {
      socialId: socialId.startsWith('ens:') ? socialId : `ens:${socialId}`,
      chain,
      transaction: {
        to,
        value: txValue || '0',
        data: data || '0x',
        gasLimit: gasLimit || 'auto'
      }
    };

    // Execute through NexusSDK
    const result = await nexusSDK.executeTransaction(transactionData);

    logger.info(`✅ Transaction executed: ${result.transactionHash}`);

    res.json({
      success: true,
      transaction: result,
      chain,
      explorerUrl: getExplorerUrl(chain, result.transactionHash)
    });

  } catch (error) {
    logger.error('Error executing transaction:', error);
    res.status(500).json({
      error: 'Failed to execute transaction',
      message: error.message
    });
  }
});

/**
 * GET /api/wallet/status/:txHash
 * Get transaction status
 */
router.get('/status/:txHash', async (req, res) => {
  try {
    const { txHash } = req.params;
    const { chain } = req.query;

    if (!chain) {
      return res.status(400).json({
        error: 'Chain parameter required'
      });
    }

    logger.info(`Checking transaction status: ${txHash} on ${chain}`);

    // Check cache first
    const cacheKey = `tx_status:${chain}:${txHash}`;
    const cached = await redis.get(cacheKey);
    if (cached) {
      const status = JSON.parse(cached);
      if (status.confirmed) {
        return res.json({ success: true, status, cached: true });
      }
    }

    // Get status from NexusSDK or blockchain
    const status = await getTransactionStatus(chain, txHash);

    // Cache confirmed transactions for 1 hour, pending for 30 seconds
    const cacheTime = status.confirmed ? 3600 : 30;
    await redis.setEx(cacheKey, cacheTime, JSON.stringify(status));

    res.json({
      success: true,
      status,
      explorerUrl: getExplorerUrl(chain, txHash)
    });

  } catch (error) {
    logger.error('Error checking transaction status:', error);
    res.status(500).json({
      error: 'Failed to check transaction status',
      message: error.message
    });
  }
});

/**
 * POST /api/wallet/batch
 * Create multiple wallets efficiently
 */
router.post('/batch', async (req, res) => {
  try {
    const { walletRequests } = req.body;

    if (!Array.isArray(walletRequests) || walletRequests.length === 0) {
      return res.status(400).json({
        error: 'walletRequests must be a non-empty array'
      });
    }

    if (walletRequests.length > 100) {
      return res.status(400).json({
        error: 'Maximum 100 wallets per batch request'
      });
    }

    logger.info(`Creating batch of ${walletRequests.length} wallets`);

    // Validate all requests
    const validatedRequests = [];
    for (const request of walletRequests) {
      const { error, value } = createWalletSchema.validate(request);
      if (error) {
        return res.status(400).json({
          error: 'Validation failed for batch request',
          details: error.details[0].message,
          request
        });
      }
      
      validatedRequests.push({
        socialId: `ens:${value.ensName}`,
        socialType: 'ensIdentity',
        chains: value.chains,
        paymaster: value.paymaster,
        metadata: {
          ...value.metadata,
          ensName: value.ensName,
          createdAt: new Date().toISOString()
        }
      });
    }

    // Create wallets using NexusSDK batch operation
    const results = await nexusSDK.createWalletBatch(validatedRequests);

    logger.info(`✅ Batch wallet creation completed: ${results.length} wallets`);

    res.json({
      success: true,
      wallets: results,
      count: results.length,
      message: `Successfully created ${results.length} wallets`
    });

  } catch (error) {
    logger.error('Error creating wallet batch:', error);
    res.status(500).json({
      error: 'Failed to create wallet batch',
      message: error.message
    });
  }
});

/**
 * GET /api/wallet/health
 * Health check for wallet service and NexusSDK
 */
router.get('/health', async (req, res) => {
  try {
    const health = await nexusSDK.healthCheck();
    const stats = nexusSDK.getStats();

    res.json({
      success: true,
      nexusSDK: {
        status: health.status,
        version: health.sdk?.version,
        api: health.api
      },
      cache: {
        connected: redis.isReady,
        stats: stats.cacheSize
      },
      supportedChains: stats.supportedChains,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Health check failed:', error);
    res.status(500).json({
      success: false,
      error: 'Health check failed',
      message: error.message
    });
  }
});

/**
 * POST /api/wallet/deploy
 * Deploy counterfactual wallets to blockchain to make them visible on block explorers
 */
router.post('/deploy', async (req, res) => {
  try {
    const { error, value } = deployWalletSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.details[0].message
      });
    }

    const { socialId, socialType, chains, paymaster, deployImmediately } = value;
    
    logger.info(`🚀 Deploying wallet for: ${socialId}, chains: ${chains.join(', ')}`);

    // First, check if wallet exists
    let wallet = await nexusSDK.getWallet(socialId);
    
    if (!wallet) {
      // Create wallet first if it doesn't exist
      logger.info(`Creating wallet before deployment for: ${socialId}`);
      wallet = await nexusSDK.createWallet({
        socialId,
        socialType,
        chains,
        paymaster,
        metadata: {
          createdAt: new Date().toISOString(),
          deploymentRequested: true,
          version: '1.0.0'
        }
      });
    }

    // Deploy wallet to blockchain
    const deploymentData = {
      socialId,
      socialType,
      chains,
      paymaster,
      deployImmediately: true
    };

    const deploymentResult = await nexusSDK.deployWallet(deploymentData);

    logger.info(`✅ Wallet deployment initiated for ${socialId}`);
    logger.info(`🔗 Deployment transactions:`, deploymentResult.transactions || {});

    // Cache deployment status
    const cacheKey = `wallet_deployment:${socialId}`;
    await redis.setEx(cacheKey, 300, JSON.stringify({
      status: 'deployed',
      deploymentResult,
      timestamp: new Date().toISOString()
    }));

    res.json({
      success: true,
      message: 'Wallet deployment successful',
      wallet: {
        ...wallet,
        deploymentStatus: 'deployed',
        deploymentTransactions: deploymentResult.transactions,
        explorerUrls: generateExplorerUrls(wallet.addresses, chains)
      },
      deployment: {
        status: 'deployed',
        chains: chains,
        transactions: deploymentResult.transactions,
        timestamp: new Date().toISOString()
      },
      nextSteps: [
        'Wallet is now deployed and visible on block explorers',
        'You can now send and receive transactions',
        'Check the explorer URLs to verify deployment'
      ]
    });

  } catch (error) {
    logger.error('Error deploying wallet:', error);
    res.status(500).json({
      error: 'Failed to deploy wallet',
      message: error.message,
      code: 'WALLET_DEPLOYMENT_FAILED'
    });
  }
});

/**
 * GET /api/wallet/deployment-status/:socialId
 * Check deployment status of a wallet
 */
router.get('/deployment-status/:socialId', async (req, res) => {
  try {
    const { socialId } = req.params;
    
    logger.info(`Checking deployment status for: ${socialId}`);

    // Check cache first
    const cacheKey = `wallet_deployment:${socialId}`;
    const cached = await redis.get(cacheKey);
    if (cached) {
      return res.json({
        success: true,
        status: JSON.parse(cached),
        cached: true
      });
    }

    // Get status from NexusSDK
    const status = await nexusSDK.getWalletStatus(socialId);

    // Cache for 2 minutes
    await redis.setEx(cacheKey, 120, JSON.stringify(status));

    res.json({
      success: true,
      status
    });

  } catch (error) {
    logger.error('Error checking deployment status:', error);
    res.status(500).json({
      error: 'Failed to check deployment status',
      message: error.message
    });
  }
});

// Helper functions
function getExplorerUrl(chain, txHash) {
  const explorers = {
    ethereum: `https://etherscan.io/tx/${txHash}`,
    polygon: `https://polygonscan.com/tx/${txHash}`,
    arbitrum: `https://arbiscan.io/tx/${txHash}`,
    solana: `https://explorer.solana.com/tx/${txHash}`
  };
  return explorers[chain] || `https://etherscan.io/tx/${txHash}`;
}

async function getTransactionStatus(chain, txHash) {
  // This would integrate with chain-specific providers
  // For now, return mock status
  return {
    hash: txHash,
    chain,
    status: 'pending',
    confirmed: false,
    blockNumber: null,
    timestamp: new Date().toISOString()
  };
}

// Helper function to generate explorer URLs
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

export default router; 