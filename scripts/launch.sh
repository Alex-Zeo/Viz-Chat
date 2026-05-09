#!/usr/bin/env bash
set -euo pipefail

# Self-Assembling Control Room — Launch Script
# Starts Chrome with remote debugging + dev servers

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
CHROME_PORT=9222
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}═══════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Self-Assembling Control Room — Launch${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════${NC}"

# Check if Chrome is already running with debugging
if curl -s "http://127.0.0.1:${CHROME_PORT}/json/version" > /dev/null 2>&1; then
  echo -e "${GREEN}✓ Chrome already running with remote debugging on port ${CHROME_PORT}${NC}"
else
  echo -e "${YELLOW}→ Launching Chrome with remote debugging on port ${CHROME_PORT}...${NC}"

  if [ ! -f "$CHROME" ]; then
    echo -e "${RED}✗ Chrome not found at ${CHROME}${NC}"
    echo "  Install Chrome or update the CHROME path in this script"
    exit 1
  fi

  "$CHROME" \
    --remote-debugging-port=${CHROME_PORT} \
    --no-first-run \
    --no-default-browser-check \
    --user-data-dir="${PROJECT_DIR}/.chrome-profile" \
    --window-size=2560,1440 \
    "about:blank" &

  # Wait for Chrome to be ready
  echo -n "  Waiting for Chrome"
  for i in $(seq 1 30); do
    if curl -s "http://127.0.0.1:${CHROME_PORT}/json/version" > /dev/null 2>&1; then
      echo ""
      echo -e "${GREEN}  ✓ Chrome ready${NC}"
      break
    fi
    echo -n "."
    sleep 0.5
  done

  if ! curl -s "http://127.0.0.1:${CHROME_PORT}/json/version" > /dev/null 2>&1; then
    echo ""
    echo -e "${RED}  ✗ Chrome failed to start${NC}"
    exit 1
  fi
fi

# Seed database if it doesn't exist
if [ ! -f "${PROJECT_DIR}/data/demo.db" ]; then
  echo -e "${YELLOW}→ Seeding database...${NC}"
  cd "$PROJECT_DIR" && npx tsx data/seed.ts
  echo -e "${GREEN}✓ Database seeded${NC}"
else
  echo -e "${GREEN}✓ Database exists${NC}"
fi

# Start dev servers
echo -e "${YELLOW}→ Starting dev servers...${NC}"
echo -e "  Frontend: ${BLUE}http://localhost:5173${NC}"
echo -e "  Backend:  ${BLUE}http://localhost:3001${NC}"
echo -e "  Chrome:   ${BLUE}http://127.0.0.1:${CHROME_PORT}${NC}"
echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Ready! Open http://localhost:5173${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════${NC}"
echo ""

cd "$PROJECT_DIR" && npm run dev
