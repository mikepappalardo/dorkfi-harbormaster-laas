# DorkFi Harbormaster

**Liquidation alert service for DorkFi positions.**

Monitors registered wallets and fires Telegram alerts with a direct repay link when health factor drops below threshold. Users sign the repay themselves — no private keys required.

## How it works

```
User registers wallet via POST /register
         ↓
Monitor polls health factor every 60s
         ↓
HF drops below threshold (default: 1.05)
         ↓
Harbormaster fires Telegram alert with:
  - Current HF + recommended repay amount
  - Direct link to dork.fi pre-filled for repay
         ↓
User taps link → signs repay in wallet
```

## Architecture

```
index.mjs     Entry point — starts API + monitor
api.mjs       Registration API (Express)
monitor.mjs   Health factor monitor + alert dispatcher
lib/
  env.mjs     Config from .env
  registry.mjs Wallet registry (registry.json)
  dorkfi.mjs  DorkFi API client
  notify.mjs  Telegram alerts + logging
```

## Setup

### 1. Install

```bash
git clone https://github.com/mikepappalardo/dorkfi-harbormaster-laas
cd dorkfi-harbormaster-laas
npm install
```

### 2. Configure

```bash
cp .env.example .env
```

| Variable | Description |
|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Telegram bot token for alerts |
| `TELEGRAM_CHAT_ID` | Operator fallback Telegram chat ID |
| `OPERATOR_KEY` | Secret key for operator-only API endpoints |
| `PORT` | API port (default: 3456) |
| `TRIGGER_HF` | Alert threshold (default: 1.05) |

### 3. Run

```bash
node index.mjs
```

## API

### Register a wallet
```bash
curl -X POST http://localhost:3456/register \
  -H "Content-Type: application/json" \
  -d '{
    "address": "YOUR_ALGORAND_OR_VOI_ADDRESS",
    "label": "My DorkFi Wallet",
    "chains": ["voi", "algorand"],
    "hf_floor": 1.05,
    "contact": "YOUR_TELEGRAM_CHAT_ID"
  }'
```

### Check live status
```bash
curl http://localhost:3456/status/YOUR_ADDRESS
```

### Remove wallet
```bash
curl -X DELETE http://localhost:3456/register/YOUR_ADDRESS
```

## Alert example

```
⚠️ WARNING — Liquidation Risk Detected

Wallet: ABCD1234...XY78
Chain: Voi
Health Factor: 🟠 1.0412 (threshold: 1.05)

Recommended Action:
Repay ~15% of WAD ($42.30 of $282 total)
This restores your HF to ~1.25

You have some time, but act soon to stay safe.

[Repay on dork.fi →]
```

## Roadmap

- **v1 (current):** Alert-only mode — monitor + Telegram alerts + dork.fi deep links
- **v2:** Auto-repay via `repay_on_behalf` contract method (pending DorkFi contract upgrade)
