/**
 * DorkFi Harbormaster — Health Monitor (Alert Mode)
 *
 * Monitors registered wallets and fires Telegram alerts with
 * a pre-built action link when HF drops below threshold.
 * No on-chain execution — user taps the link and signs in their wallet.
 */

import { config } from './lib/env.mjs';
import { getHealthFactor } from './lib/dorkfi.mjs';
import { getActiveWallets } from './lib/registry.mjs';
import { sendTelegram, log, hfEmoji } from './lib/notify.mjs';

const POLL_INTERVAL_MS   = 60_000;  // 1 min between full sweeps
const ALERT_COOLDOWN_MS  = 5 * 60_000;  // 5 min between repeat alerts per wallet+chain
const CRITICAL_THRESHOLD = 1.02;        // escalate to CRITICAL below this

// Track last alert time per wallet+chain to prevent spam
const lastAlerted = {};

// ── Deep link builder ──────────────────────────────────────────────────────
/**
 * Build a dork.fi repay URL with pre-filled params.
 * Falls back to the main app if the market/amount can't be determined.
 */
function buildRepayLink(chain, address, repay) {
  const base = `https://dork.fi`;
  if (!repay?.symbol) return base;
  const params = new URLSearchParams({
    action:  'repay',
    chain,
    wallet:  address,
    market:  repay.symbol,
    amount:  repay.repayUsd.toFixed(2),
  });
  return `${base}?${params.toString()}`;
}

// ── Repay calculation ──────────────────────────────────────────────────────
function calcRepayTarget(borrows, hf) {
  if (!borrows?.length) return null;

  const sorted = [...borrows].sort((a, b) => {
    const aUsd = parseFloat(a.borrow_value_usd ?? a.value_usd ?? 0);
    const bUsd = parseFloat(b.borrow_value_usd ?? b.value_usd ?? 0);
    return bUsd - aUsd;
  });

  const top = sorted[0];
  const debtUsd = parseFloat(top.borrow_value_usd ?? top.value_usd ?? 0);
  if (!debtUsd) return null;

  // How much to repay to restore HF to 1.25 (safe buffer)
  const TARGET_HF      = 1.25;
  const repayFraction  = Math.min(0.6, Math.max(0.05, (TARGET_HF - hf) / TARGET_HF));
  const repayUsd       = debtUsd * repayFraction;

  return {
    symbol:       top.symbol ?? top.asset ?? 'debt',
    repayFraction,
    repayUsd,
    totalDebtUsd: debtUsd,
  };
}

// ── Alert sender ───────────────────────────────────────────────────────────
async function sendAlert(wallet, chain, hf, repay) {
  const key      = `${wallet.address}:${chain}`;
  const now      = Date.now();
  const lastTime = lastAlerted[key] || 0;

  if (now - lastTime < ALERT_COOLDOWN_MS) {
    log(`  [${key}] Alert cooldown active — suppressing`);
    return;
  }

  const isCritical = hf < CRITICAL_THRESHOLD;
  const urgency    = isCritical ? '🚨 *CRITICAL*' : '⚠️ *WARNING*';
  const repayLink  = buildRepayLink(chain, wallet.address, repay);
  const shortAddr  = wallet.address.slice(0, 8) + '...' + wallet.address.slice(-4);
  const label      = wallet.label || shortAddr;

  let msg = `${urgency} — Liquidation Risk Detected\n\n`;
  msg += `*Wallet:* ${label} (\`${shortAddr}\`)\n`;
  msg += `*Chain:* ${chain.charAt(0).toUpperCase() + chain.slice(1)}\n`;
  msg += `*Health Factor:* ${hfEmoji(hf)} \`${hf.toFixed(4)}\` (threshold: ${wallet.hf_floor ?? 1.05})\n\n`;

  if (repay) {
    msg += `*Recommended Action:*\n`;
    msg += `Repay ~${(repay.repayFraction * 100).toFixed(0)}% of ${repay.symbol} `;
    msg += `(*$${repay.repayUsd.toFixed(2)}* of $${repay.totalDebtUsd.toFixed(2)} total)\n`;
    msg += `This restores your HF to ~1.25\n\n`;
  }

  if (isCritical) {
    msg += `⏰ *Act immediately* — liquidation imminent\\.\n\n`;
  } else {
    msg += `You have some time, but act soon to stay safe\\.\n\n`;
  }

  msg += `[Repay on dork\\.fi →](${repayLink})`;

  // Send to per-user contact if set, else operator fallback
  const target = wallet.contact || config.telegramChatId;
  await sendTelegram(msg, target);
  lastAlerted[key] = now;

  log(`  [${key}] Alert sent — HF=${hf.toFixed(4)} repay=$${repay?.repayUsd?.toFixed(2) ?? '?'}`);
}

// ── Main monitor loop ──────────────────────────────────────────────────────
async function sweep() {
  const wallets = getActiveWallets();
  if (!wallets.length) {
    log('No registered wallets — waiting...');
    return;
  }

  for (const wallet of wallets) {
    const chains = wallet.chains || ['voi', 'algorand'];
    const floor  = wallet.hf_floor ?? 1.05;

    for (const chain of chains) {
      try {
        const result = await getHealthFactor(wallet.address, chain);
        if (!result) continue;

        const { hf, borrows } = result;
        if (!hf || isNaN(hf) || hf <= 0) continue;

        log(`  ${wallet.label || wallet.address.slice(0,8)} [${chain}] HF=${hf.toFixed(4)} ${hfEmoji(hf)}`);

        if (hf < floor) {
          const repay = calcRepayTarget(borrows, hf);
          await sendAlert(wallet, chain, hf, repay);
        }
      } catch (err) {
        log(`  [${wallet.address}:${chain}] Error: ${err.message}`);
      }

      // Pace requests
      await new Promise(r => setTimeout(r, 500));
    }
  }
}

export async function startMonitor() {
  log('Harbormaster monitor started (alert mode)');
  log(`Poll interval: ${POLL_INTERVAL_MS / 1000}s | Alert cooldown: ${ALERT_COOLDOWN_MS / 60000}m`);

  // Run immediately then on interval
  await sweep();
  setInterval(sweep, POLL_INTERVAL_MS);
}
