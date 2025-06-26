#!/bin/bash

echo "🚀 Setting up SutraPulse Backend with NexusSDK Integration"
echo "==========================================================="

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18+ first."
    exit 1
fi

# Check Node.js version
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Node.js version must be 18 or higher. Current version: $(node -v)"
    exit 1
fi

echo "✅ Node.js version: $(node -v)"

# Install dependencies
echo "📦 Installing dependencies..."
npm install

if [ $? -ne 0 ]; then
    echo "❌ Failed to install dependencies"
    exit 1
fi

echo "✅ Dependencies installed successfully"

# Create necessary directories
echo "📁 Creating necessary directories..."
mkdir -p logs
mkdir -p models
mkdir -p temp

# Copy environment file
if [ ! -f .env ]; then
    echo "📝 Creating environment file..."
    cp env.example .env
    echo "⚠️  Please update .env file with your configuration"
else
    echo "⚠️  .env file already exists"
fi

# Check if Redis is running (optional)
if command -v redis-cli &> /dev/null; then
    if redis-cli ping &> /dev/null; then
        echo "✅ Redis is running"
    else
        echo "⚠️  Redis is not running. Please start Redis server:"
        echo "   brew services start redis (macOS)"
        echo "   sudo systemctl start redis (Linux)"
    fi
else
    echo "⚠️  Redis not found. Please install Redis:"
    echo "   brew install redis (macOS)"
    echo "   sudo apt install redis-server (Linux)"
fi

# Display next steps
echo ""
echo "🎉 Setup completed!"
echo ""
echo "📋 Next steps:"
echo "1. Get your NexusSDK API key from: https://backend-amber-zeta-94.vercel.app/"
echo "2. Update the .env file with your configuration:"
echo "   - NEXUS_API_KEY=your_api_key_here"
echo "   - JWT_SECRET=your_jwt_secret"
echo "   - Other API keys and configurations"
echo ""
echo "3. Start the development server:"
echo "   npm run dev"
echo ""
echo "4. Test the API:"
echo "   curl http://localhost:8080/health"
echo ""
echo "📚 API Documentation will be available at:"
echo "   http://localhost:8080/api/docs"
echo ""
echo "🔗 Key Features Integrated:"
echo "   ✅ NexusSDK for cross-chain wallets (EVM + SVM)"
echo "   ✅ ENS-based identity system"
echo "   ✅ AI transaction assistant"
echo "   ✅ OAuth integration (Google + X)"
echo "   ✅ IPFS storage"
echo "   ✅ Redis caching"
echo "   ✅ Comprehensive logging"
echo "   ✅ Health monitoring"
echo ""

# Check for updates
echo "🔄 Checking for NexusSDK updates..."
npm list @nexuspay/sdk 2>/dev/null || echo "⚠️  NexusSDK not found in node_modules"

echo "✨ Happy coding!" 