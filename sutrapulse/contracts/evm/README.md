# SutraPulse Smart Contracts

This repository contains the smart contracts for the SutraPulse project's Account Abstraction implementation.

## Overview

The project implements ERC-4337 Account Abstraction with the following main components:

1. **EntryPoint Contract**: The main entry point for all AA transactions
2. **SmartWallet Contract**: The actual smart contract wallet implementation
3. **SmartWalletFactory Contract**: Factory contract for deploying new wallet instances
4. **Paymaster Contract**: Handles gas fee payments in both ETH and ERC20 tokens

## Features

- Full ERC-4337 Account Abstraction support
- Multi-signature wallet capabilities
- Gas fee abstraction through Paymaster
- Upgradeable smart contract architecture
- Comprehensive test coverage
- Gas-optimized implementations

## Prerequisites

- Node.js v16+ LTS
- npm v7+
- Git

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd sutrapulse/contracts/evm
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file:
```bash
cp .env.example .env
```

4. Fill in your environment variables in `.env`:
```bash
INFURA_API_KEY=your_infura_api_key
PRIVATE_KEY=your_private_key
ETHERSCAN_API_KEY=your_etherscan_api_key
COINMARKETCAP_API_KEY=your_coinmarketcap_api_key
```

## Usage

### Compile Contracts

```bash
npm run compile
```

### Run Tests

```bash
npm test
```

### Run Coverage

```bash
npm run test:coverage
```

### Deploy Contracts

Local network:
```bash
npm run deploy:local
```

Testnet (Sepolia):
```bash
npm run deploy:testnet
```

Mainnet:
```bash
npm run deploy:mainnet
```

## Contract Architecture

### EntryPoint

The EntryPoint contract is the main entry point for all Account Abstraction operations. It:
- Validates and executes user operations
- Manages gas payments and refunds
- Handles signature verification
- Supports batched operations

### SmartWallet

The smart contract wallet implementation that:
- Supports multiple authorized signers
- Implements function whitelisting
- Handles batch transactions
- Is upgradeable through proxy pattern

### SmartWalletFactory

Factory contract for wallet deployment that:
- Uses CREATE2 for deterministic addresses
- Implements batch wallet creation
- Supports counterfactual wallet deployment

### Paymaster

Handles gas fee payments with features like:
- Multi-token support
- Exchange rate management
- Deposit tracking
- Security controls

## Security

The contracts implement several security features:

- Reentrancy protection
- Access control
- Input validation
- Emergency functions
- Function whitelisting
- Upgradeable architecture

## Testing

The test suite covers:

- Contract deployment
- Basic functionality
- Edge cases
- Gas optimization
- Security scenarios

## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a new Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.
