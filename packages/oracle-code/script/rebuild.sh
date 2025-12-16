#!/bin/bash
# Quick rebuild script for oracle-code
# Builds only for the current platform and optionally runs

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PKG_DIR"

echo "🔨 Building oracle-code for current platform..."

# Run the build script with --single flag to only build current platform
# and --skip-install to skip reinstalling dependencies
bun run script/build.ts --single --skip-install

# Find the built binary
PLATFORM=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

# Map architecture names
if [ "$ARCH" = "arm64" ] || [ "$ARCH" = "aarch64" ]; then
  ARCH="arm64"
elif [ "$ARCH" = "x86_64" ]; then
  ARCH="x64"
fi

BINARY_DIR="dist/oracle-code-${PLATFORM}-${ARCH}/bin"
BINARY_PATH="${BINARY_DIR}/ocode"

if [ -f "$BINARY_PATH" ]; then
  echo "✅ Build complete: $BINARY_PATH"
  
  # If --run flag is passed, execute the binary
  if [ "$1" = "--run" ] || [ "$1" = "-r" ]; then
    shift
    echo "🚀 Running oracle-code..."
    exec "$BINARY_PATH" "$@"
  fi
else
  echo "❌ Build failed: binary not found at $BINARY_PATH"
  exit 1
fi
