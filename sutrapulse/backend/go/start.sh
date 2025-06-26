#!/bin/bash

# Load environment variables from .env file
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
    echo "✅ Environment variables loaded from .env"
else
    echo "⚠️  .env file not found, using system environment variables"
fi

# Start the server
echo "🚀 Starting SutraPulse Backend Server..."
npm start 