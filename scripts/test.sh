#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

cd "$ROOT"

# Build
npm run build

# Ensure coverage dir exists
mkdir -p coverage

# Run tests with coverage
node --test \
  --experimental-test-coverage \
  --experimental-strip-types \
  --enable-source-maps \
  --test-concurrency=4 \
  --test-reporter=spec \
  --test-reporter-destination=stdout \
  --test-reporter=lcov \
  --test-reporter-destination=coverage/lcov.info \
  "test/**/*.test.ts"

# Generate coverage badge
npx --yes lcov-badge2 coverage/lcov.info -o coverage.svg
