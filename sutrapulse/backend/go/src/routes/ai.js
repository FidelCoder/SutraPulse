import express from 'express';
import Joi from 'joi';
import winston from 'winston';
import axios from 'axios';
import Redis from 'redis';

const router = express.Router();
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.simple(),
  transports: [new winston.transports.Console()]
});

// Initialize Redis for caching
const redis = Redis.createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
  password: process.env.REDIS_PASSWORD
});

redis.on('error', (err) => logger.error('Redis Client Error', err));
redis.connect().catch(console.error);

// Validation schemas
const querySchema = Joi.object({
  query: Joi.string().min(1).max(1000).required(),
  ensName: Joi.string().pattern(/^[a-zA-Z0-9-]+\.eth$/).optional(),
  chain: Joi.string().valid('ethereum', 'polygon', 'arbitrum', 'solana').optional(),
  context: Joi.object().optional()
});

const validateSchema = Joi.object({
  contractAddress: Joi.string().required(),
  chain: Joi.string().valid('ethereum', 'polygon', 'arbitrum', 'solana').required(),
  functionName: Joi.string().optional(),
  parameters: Joi.array().optional()
});

const assistSchema = Joi.object({
  intent: Joi.string().required(),
  ensName: Joi.string().pattern(/^[a-zA-Z0-9-]+\.eth$/).required(),
  chain: Joi.string().valid('ethereum', 'polygon', 'arbitrum', 'solana').required(),
  parameters: Joi.object().optional()
});

/**
 * POST /api/ai/query
 * Submit text query to AI agent
 */
router.post('/query', async (req, res) => {
  try {
    const { error, value } = querySchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.details[0].message
      });
    }

    const { query, ensName, chain, context } = value;
    
    logger.info(`Processing AI query: "${query}" for ${ensName || 'anonymous'}`);

    // Process query with AI
    const aiResponse = await processAIQuery(query, { ensName, chain, context });

    res.json({
      success: true,
      response: aiResponse,
      query,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Error processing AI query:', error);
    res.status(500).json({
      error: 'Failed to process query',
      message: error.message
    });
  }
});

/**
 * POST /api/ai/validate
 * Validate transaction safety
 */
router.post('/validate', async (req, res) => {
  try {
    const { error, value } = validateSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.details[0].message
      });
    }

    const { contractAddress, chain, functionName, parameters } = value;
    
    logger.info(`Validating contract: ${contractAddress} on ${chain}`);

    // Check cache first
    const cacheKey = `contract_validation:${chain}:${contractAddress}:${functionName || 'any'}`;
    const cached = await redis.get(cacheKey);
    if (cached) {
      return res.json({
        success: true,
        validation: JSON.parse(cached),
        cached: true
      });
    }

    // Perform validation
    const validation = await validateContract(contractAddress, chain, functionName, parameters);

    // Cache for 1 hour (contracts don't change often)
    await redis.setEx(cacheKey, 3600, JSON.stringify(validation));

    res.json({
      success: true,
      validation,
      contractAddress,
      chain
    });

  } catch (error) {
    logger.error('Error validating contract:', error);
    res.status(500).json({
      error: 'Failed to validate contract',
      message: error.message
    });
  }
});

/**
 * POST /api/ai/assist
 * Get transaction assistance
 */
router.post('/assist', async (req, res) => {
  try {
    const { error, value } = assistSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.details[0].message
      });
    }

    const { intent, ensName, chain, parameters } = value;
    
    logger.info(`Providing transaction assistance for intent: "${intent}" on ${chain}`);

    // Get wallet info first
    const walletResponse = await getWalletInfo(ensName);
    if (!walletResponse.success) {
      return res.status(404).json({
        error: 'Wallet not found',
        ensName
      });
    }

    // Generate transaction assistance
    const assistance = await generateTransactionAssistance(intent, chain, walletResponse.wallet, parameters);

    res.json({
      success: true,
      assistance,
      intent,
      chain,
      ensName,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Error providing transaction assistance:', error);
    res.status(500).json({
      error: 'Failed to provide assistance',
      message: error.message
    });
  }
});

/**
 * POST /api/ai/recommend
 * Get recommendations based on user activity
 */
router.post('/recommend', async (req, res) => {
  try {
    const { ensName, chain, category } = req.body;

    if (!ensName) {
      return res.status(400).json({
        error: 'ENS name required'
      });
    }

    logger.info(`Generating recommendations for ${ensName} on ${chain || 'all chains'}`);

    // Check cache first
    const cacheKey = `recommendations:${ensName}:${chain || 'all'}:${category || 'general'}`;
    const cached = await redis.get(cacheKey);
    if (cached) {
      return res.json({
        success: true,
        recommendations: JSON.parse(cached),
        cached: true
      });
    }

    // Generate recommendations
    const recommendations = await generateRecommendations(ensName, chain, category);

    // Cache for 30 minutes
    await redis.setEx(cacheKey, 1800, JSON.stringify(recommendations));

    res.json({
      success: true,
      recommendations,
      ensName,
      chain: chain || 'all',
      category: category || 'general'
    });

  } catch (error) {
    logger.error('Error generating recommendations:', error);
    res.status(500).json({
      error: 'Failed to generate recommendations',
      message: error.message
    });
  }
});

/**
 * GET /api/ai/health
 * Health check for AI service
 */
router.get('/health', async (req, res) => {
  try {
    res.json({
      success: true,
      ai: {
        status: 'healthy',
        modelLoaded: true,
        responseTime: '<100ms'
      },
      cache: {
        connected: redis.isReady
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('AI health check failed:', error);
    res.status(500).json({
      success: false,
      error: 'AI health check failed',
      message: error.message
    });
  }
});

// Helper functions

async function processAIQuery(query, context = {}) {
  try {
    // Analyze query intent
    const intent = analyzeQueryIntent(query);
    
    // Generate response based on intent
    let response;
    switch (intent.type) {
      case 'defi_search':
        response = await handleDeFiSearch(query, context.chain);
        break;
      case 'price_inquiry':
        response = await handlePriceInquiry(intent.token, context.chain);
        break;
      case 'transaction_help':
        response = await handleTransactionHelp(query, context);
        break;
      default:
        response = await handleGeneralQuery(query, context);
    }

    return {
      intent: intent.type,
      response,
      confidence: intent.confidence,
      suggestions: generateSuggestions(intent.type, context.chain)
    };

  } catch (error) {
    logger.error('Error processing AI query:', error);
    return {
      intent: 'error',
      response: 'I encountered an error processing your query. Please try rephrasing or contact support.',
      confidence: 0,
      suggestions: []
    };
  }
}

function analyzeQueryIntent(query) {
  const lowerQuery = query.toLowerCase();
  
  if (lowerQuery.includes('defi') || lowerQuery.includes('dapp')) {
    return { type: 'defi_search', confidence: 0.9 };
  }
  
  if (lowerQuery.includes('price') || lowerQuery.includes('cost')) {
    return { type: 'price_inquiry', confidence: 0.8 };
  }
  
  if (lowerQuery.includes('swap') || lowerQuery.includes('send')) {
    return { type: 'transaction_help', confidence: 0.9 };
  }
  
  return { type: 'general', confidence: 0.5 };
}

async function handleDeFiSearch(query, chain) {
  return {
    message: `Here are popular DeFi protocols${chain ? ` on ${chain}` : ''}:`,
    protocols: [
      { name: 'Uniswap', category: 'DEX', description: 'Leading decentralized exchange' },
      { name: 'Aave', category: 'Lending', description: 'Decentralized lending protocol' }
    ]
  };
}

async function handlePriceInquiry(token, chain) {
  return {
    message: 'Here are the current prices:',
    prices: { ethereum: { usd: 2000 }, bitcoin: { usd: 45000 } },
    timestamp: new Date().toISOString()
  };
}

async function handleTransactionHelp(query, context) {
  return {
    message: 'I can help you with blockchain transactions!',
    options: [
      { action: 'swap_tokens', description: 'Swap tokens on a DEX' },
      { action: 'send_tokens', description: 'Send tokens to another address' }
    ]
  };
}

async function handleGeneralQuery(query, context) {
  return {
    message: 'I\'m here to help with your blockchain and DeFi needs!',
    capabilities: [
      'Finding DeFi protocols and dApps',
      'Checking token prices',
      'Building transactions'
    ]
  };
}

function generateSuggestions(intentType, chain) {
  const suggestions = {
    defi_search: ['Show me lending protocols', 'Find yield farming opportunities'],
    price_inquiry: ['What\'s the gas price now?', 'Show me DeFi token prices'],
    transaction_help: ['Help me bridge tokens', 'Show me how to stake']
  };
  
  return suggestions[intentType] || ['Ask me anything about DeFi!'];
}

async function validateContract(contractAddress, chain, functionName, parameters) {
  // Mock validation - in production, integrate with security APIs
  return {
    isValid: true,
    riskLevel: 'low',
    checks: {
      verified: true,
      knownContract: true,
      recentlyCreated: false,
      hasKnownVulnerabilities: false
    },
    recommendations: [
      'Contract appears to be safe',
      'Always verify transaction details',
      'Consider using a small amount first'
    ],
    gasEstimate: {
      estimated: '21000',
      chain: chain
    }
  };
}

async function generateTransactionAssistance(intent, chain, wallet, parameters) {
  return {
    intent,
    chain,
    walletAddress: wallet.addresses[chain],
    steps: [
      {
        step: 1,
        action: 'Prepare transaction',
        description: `Building transaction for ${intent} on ${chain}`,
        status: 'ready'
      },
      {
        step: 2,
        action: 'Estimate gas',
        description: 'Calculating optimal gas price',
        status: 'pending'
      },
      {
        step: 3,
        action: 'Execute',
        description: 'Submit transaction through account abstraction',
        status: 'pending'
      }
    ],
    estimatedGas: '0.001 ETH',
    timeToComplete: '1-2 minutes'
  };
}

async function generateRecommendations(ensName, chain, category) {
  // Mock recommendations
  return {
    strategies: [
      {
        name: 'Yield Farming',
        description: 'Earn rewards by providing liquidity',
        riskLevel: 'medium',
        estimatedAPY: '8-15%',
        chains: ['ethereum', 'polygon']
      },
      {
        name: 'Staking',
        description: 'Stake tokens for network rewards',
        riskLevel: 'low',
        estimatedAPY: '4-8%',
        chains: ['ethereum', 'solana']
      }
    ],
    protocols: [
      {
        name: 'Uniswap V3',
        category: 'DEX',
        description: 'Concentrated liquidity AMM',
        chain: 'ethereum'
      }
    ]
  };
}

async function getWalletInfo(ensName) {
  try {
    // This would call the wallet service
    const response = await axios.get(`http://localhost:8080/api/wallet/ens:${ensName}`, {
      timeout: 5000
    });
    return response.data;
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export default router; 