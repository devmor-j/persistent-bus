#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

cd "$ROOT"

# Build
npm run build

# Ensure coverage dir exists
mkdir -p coverage

# Run tests with coverage via c8 (accurate source-map handling)
c8 --reporter=text --reporter=lcov --src=src --report-dir=coverage \
  node --test \
  --experimental-strip-types \
  --enable-source-maps \
  --test-concurrency=4 \
  --test-reporter=spec \
  --test-reporter-destination=stdout \
  --test-timeout=120000 \
  "test/**/*.test.ts"

# Generate coverage badge
npx --yes lcov-badge2 coverage/lcov.info -o coverage.svg
