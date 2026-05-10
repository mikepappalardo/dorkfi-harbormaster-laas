# DorkFi Harbormaster LaaS

**Liquidation Protection as a Service for DorkFi**

A monitored-wallet service where users register their DorkFi position and a guardian bot automatically repays debt on their behalf before liquidation hits — charging a 0.1% fee per protection event.

## How it works

```
User registers wallet via POST /register
         ↓
User funds fee deposit (USDC, minimum $5)
         ↓
Monitor polls health factor every 60s
         ↓
HF drops below 1.05 (trigger threshold)
         ↓
Harbormaster calls repay_on_behalf on DorkFi
Repays enough debt to restore HF to ~1.2
         ↓
0.1% fee deducted from user's deposit
User notified via Telegram
```

## Architecture

```
index.mjs       Entry point — starts API + monitor
api.mjs         Registration API (Express)
monitor.mjs     Health factor monitor + executor
lib/
  env.mjs       Config from .env
  registry.mjs  Wallet registry (registry.json)
  dorkfi.mjs    DorkFi API client + tx builder
  notify.mjs    Telegram + logging
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

Key values to set:

| Variable | Description |
|----------|-------------|
| `SERVICE_MNEMONIC` | Mnemonic for the service wallet (holds repay capital) |
| `SERVICE_WALLET` | Service wallet address |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token for alerts |
| `TELEGRAM_CHAT_ID` | Operator Telegram chat ID |
| `OPERATOR_KEY` | Secret key for operator-only API endpoints |
| `TRIGGER_HF` | HF threshold to trigger protection (default: 1.05) |
| `FEE_RATE` | Service fee as decimal (default: 0.001 = 0.1%) |

### 3. Fund the service wallet

The service wallet must hold the assets it will repay on behalf of users — primarily WAD and USDC/aUSDC on both chains.

Recommended starting capital: $500–$1,000 per chain.

### 4. Run

```bash
node index.mjs
```

Or separately:

```bash
node api.mjs      # API only
node monitor.mjs  # Monitor only
```

---

## API Reference

### Register a wallet

```bash
POST /register
Content-Type: application/json

{
  "address": "YOUR_WALLET_ADDRESS",
  "label": "My DorkFi Position",
  "chains": ["voi", "algorand"],
  "hf_floor": 1.05,
  "contact": "TELEGRAM_CHAT_ID"   # optional, for per-user alerts
}
```

Response:

```json
{
  "ok": true,
  "wallet": { ... },
  "next_steps": ["Fund your fee deposit via POST /deposit/..."],
  "service_fee": "0.1% of debt repaid per protection event",
  "trigger_hf": 1.05
}
```

### Check wallet status

```bash
GET /status/:address
```

Returns live health factor, fee deposit balance, protection count, and active status.

### Remove protection

```bash
DELETE /register/:address
```

### Health check

```bash
GET /health
```

---

## Fee model

| Event | Fee |
|-------|-----|
| Registration | Free |
| Monitoring | Free |
| Protection executed | 0.1% of debt repaid |

Users pre-deposit a fee balance (minimum $5 USDC recommended). Each protection event deducts 0.1% of the repaid debt amount. When balance reaches $0, protection is suspended until topped up.

**Example:** Position has $1,000 WAD debt. HF drops to 1.02. Harbormaster repays $150 to restore HF to 1.2. Fee: $0.15 deducted from user's deposit.

---

## Service wallet capital requirements

The service wallet must hold sufficient assets to repay on behalf of users. Assets needed depend on your user base — primarily WAD, USDC, and aUSDC.

The service recovers capital after each repayment (the repay call settles on-chain immediately). However, the wallet needs enough float to cover simultaneous events.

---

## Run as a service

### macOS LaunchAgent

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.dorkfi.harbormaster.laas</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>/path/to/dorkfi-harbormaster-laas/index.mjs</string>
  </array>
  <key>WorkingDirectory</key><string>/path/to/dorkfi-harbormaster-laas</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/path/to/dorkfi-harbormaster-laas/harbormaster.log</string>
  <key>StandardErrorPath</key><string>/path/to/dorkfi-harbormaster-laas/harbormaster.log</string>
</dict>
</plist>
```

### Linux systemd

```ini
[Unit]
Description=DorkFi Harbormaster LaaS
After=network.target

[Service]
Type=simple
WorkingDirectory=/path/to/dorkfi-harbormaster-laas
ExecStart=/usr/bin/node index.mjs
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

---

## License

MIT
