#!/bin/bash
set -e

REQUIRED_NODE_VERSION="24.9.0"
REQUIRED_NPM_VERSION="10.9.0"

echo "========================================================"
echo " Starting CI Environment Setup"
echo " Target Node: v${REQUIRED_NODE_VERSION} | Target npm: v${REQUIRED_NPM_VERSION}"
echo "========================================================"

echo "1. Checking for nvm..."
if [ -s "$HOME/.nvm/nvm.sh" ]; then
    . "$HOME/.nvm/nvm.sh"
elif [ -s "/usr/local/opt/nvm/nvm.sh" ]; then
    . "/usr/local/opt/nvm/nvm.sh"
else
    echo "nvm not found. Installing nvm..."
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash

    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
    [ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"

    if ! command -v nvm &> /dev/null; then
        echo "Error: nvm installation failed. Please restart your terminal and try again."
        exit 1
    fi
fi
echo "nvm loaded successfully."

echo "2. Installing and using Node.js v${REQUIRED_NODE_VERSION}..."
nvm install ${REQUIRED_NODE_VERSION}
nvm use ${REQUIRED_NODE_VERSION}

CURRENT_NODE_VERSION=$(node -v)
echo "Current Node version set to: ${CURRENT_NODE_VERSION}"

echo "3. Enabling Corepack and activating npm v${REQUIRED_NPM_VERSION}..."
corepack enable
corepack prepare npm@${REQUIRED_NPM_VERSION} --activate

CURRENT_NPM_VERSION=$(corepack npm -v)
echo "Current npm version set to: ${CURRENT_NPM_VERSION}"

echo "4. Running 'corepack npm ci'..."
corepack npm ci

echo "5. Installing Linux-specific native binaries..."
corepack npm install --no-save \
    @rollup/rollup-linux-x64-gnu \
    @tailwindcss/oxide-linux-x64-gnu \
    lightningcss-linux-x64-gnu \
    @embedded-postgres/linux-x64
