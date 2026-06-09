/**
 * DorkFi Harbormaster — Health Monitor
 *
 * Polls registered wallets every 60s.
 * When HF drops below threshold:
 *   1. Builds an unsigned repay transaction
 *   2. Creates a short-lived signing session (30 min)
 *   3. Fires a Telegram alert with a one-tap "Repay Now" button
 *      → button opens the signing page with transaction pre-loaded
 */

import algosdk from 'algosdk';
import { config } from './lib/env.mjs';
import { getHealthFactor, getAlgodClient } from './lib/dorkfi.mjs';
import { getActiveWallets } from './lib/registry.mjs';
import { createSession } from './lib/sessions.mjs';
import { sendTelegram, log, hfEmoji } from './lib/notify.mjs';

const POLL_INTERVAL_MS  = 60_000;
const ALERT_COOLDOWN_MS = 5 * 60_000;
const CRITICAL_HF       = 1.02;
const SIGN_BASE_URL     = process.env.SIGN_BASE_URL || 'https://harbormaster.dork.fi';

// DorkFi pool IDs
const POOLS = {
  voi:      [47139778, 47139781],
  algorand: [3333688282, 3345940978],
};

// ABI method: repay(market_id: uint64, amount: uint256) -> uint256
const REPAY_METHOD = new algosdk.ABIMethod({
  name:    'repay',
  args:    [{ type: 'uint64', name: 'market_id' }, { type: 'uint256', name: 'amount' }],
  returns: { type: 'uint256' },
});

const lastAlerted = {};

// ── Repay calculation ──────────────────────────────────────────────────────
function calcRepayTarget(borrows, hf) {
  if (!borrows?.length) return null;

  const sorted = [...borrows].sort((a, b) =>
    parseFloat(b.borrow_value_usd ?? b.value_usd ?? 0) -
    parseFloat(a.borrow_value_usd ?? a.value_usd ?? 0)
  );

  const top     = sorted[0];
  const debtUsd = parseFloat(top.borrow_value_usd ?? top.value_usd ?? 0);
  if (!debtUsd) return null;

  const TARGET_HF     = 1.25;
  const repayFraction = Math.min(0.6, Math.max(0.05, (TARGET_HF - hf) / TARGET_HF));

  return {
    symbol:       top.symbol ?? top.asset ?? 'debt',
    marketId:     top.market_id ?? top.marketId ?? null,
    decimals:     top.decimals ?? 6,
    rawAmount:    top.borrow_amount ?? top.amount ?? 0,
    repayFraction,
    repayUsd:     debtUsd * repayFraction,
    totalDebtUsd: debtUsd,
  };
}

// ── Build unsigned repay transaction ──────────────────────────────────────
async function buildRepayTxn(wallet, chain, repay) {
  if (!repay?.marketId) return null;

  try {
    const algod   = getAlgodClient(chain);
    const sp      = await algod.getTransactionParams().do();
    const poolId  = POOLS[chain]?.[0];
    if (!poolId) return null;

    // Calculate base units
    const repayBaseUnits = BigInt(
      Math.floor((repay.rawAmount ?? 0) * repay.repayFraction)
    );
    if (repayBaseUnits <= 0n) return null;

    // Build via ATC with empty signer (we just need the unsigned txn bytes)
    const atc = new algosdk.AtomicTransactionComposer();
    atc.addMethodCall({
      appID:           poolId,
      method:          REPAY_METHOD,
      methodArgs:      [repay.marketId, repayBaseUnits],
      sender:          wallet.address,
      suggestedParams: { ...sp, fee: 2000, flatFee: true },
      signer:          algosdk.makeEmptyTransactionSigner(),
    });

    const txns     = await atc.buildGroup();
    const txnBytes = algosdk.encodeUnsignedTransaction(txns[0].txn);
    return Buffer.from(txnBytes).toString('base64');

  } catch (err) {
    log(`  [buildRepayTxn] Error: ${err.message}`);
    return null;
  }
}

// ── Alert sender ───────────────────────────────────────────────────────────
async function sendAlert(wallet, chain, hf, repay, sessionToken) {
  const key      = `${wallet.address}:${chain}`;
  const now      = Date.now();
  if (now - (lastAlerted[key] || 0) < ALERT_COOLDOWN_MS) {
    log(`  [${key}] Alert cooldown active — suppressing`);
    return;
  }

  const isCritical = hf < CRITICAL_HF;
  const urgency    = isCritical ? '🚨 *CRITICAL*' : '⚠️ *WARNING*';
  const shortAddr  = wallet.address.slice(0, 8) + '...' + wallet.address.slice(-4);
  const label      = wallet.label || shortAddr;

  let msg = `${urgency} — Liquidation Risk Detected\n\n`;
  msg += `*Wallet:* ${label} (\`${shortAddr}\`)\n`;
  msg += `*Chain:* ${chain.charAt(0).toUpperCase() + chain.slice(1)}\n`;
  msg += `*Health Factor:* ${hfEmoji(hf)} \`${hf.toFixed(4)}\`\n\n`;

  if (repay) {
    msg += `*Recommended Repay:*\n`;
    msg += `~${(repay.repayFraction * 100).toFixed(0)}% of ${repay.symbol}`;
    msg += ` (*$${repay.repayUsd.toFixed(2)}* of $${repay.totalDebtUsd.toFixed(2)})\n`;
    msg += `Restores HF to ~1.25\n\n`;
  }

  msg += isCritical
    ? `⏰ Act immediately — liquidation imminent.`
    : `Act soon to stay safe.`;

  // Build button
  const buttons = sessionToken
    ? [{ text: '⚡ Repay Now', url: `${SIGN_BASE_URL}/repay/${sessionToken}` }]
    : [{ text: '🔗 Open dork.fi', url: 'https://dork.fi' }];

  const target = wallet.contact || config.telegramChatId;
  await sendTelegram(msg, target, [buttons]);
  lastAlerted[key] = now;

  log(`  [${key}] Alert sent — HF=${hf.toFixed(4)} ${sessionToken ? `session=${sessionToken.slice(0,8)}` : '(no session)'}`);
}

// ── Main sweep ─────────────────────────────────────────────────────────────
async function sweep() {
  const wallets = getActiveWallets();
  if (!wallets.length) { log('No registered wallets — waiting...'); return; }

  for (const wallet of wallets) {
    const chains = wallet.chains || ['voi', 'algorand'];
    const floor  = wallet.hf_floor ?? config.triggerHF ?? 1.05;

    for (const chain of chains) {
      try {
        const result = await getHealthFactor(wallet.address, chain);
        if (!result) continue;

        const { hf, borrows } = result;
        if (!hf || isNaN(hf) || hf <= 0) continue;

        log(`  ${wallet.label || wallet.address.slice(0,8)} [${chain}] HF=${hf.toFixed(4)} ${hfEmoji(hf)}`);

        if (hf < floor) {
          const repay = calcRepayTarget(borrows, hf);

          // Build unsigned transaction and create signing session
          let sessionToken = null;
          if (repay?.marketId) {
            const txnB64 = await buildRepayTxn(wallet, chain, repay);
            if (txnB64) {
              sessionToken = createSession({
                txnB64,
                walletAddress: wallet.address,
                chain,
                poolId:    POOLS[chain]?.[0],
                symbol:    repay.symbol,
                repayUsd:  repay.repayUsd,
                currentHF: hf,
              });
            }
          }

          await sendAlert(wallet, chain, hf, repay, sessionToken);
        }
      } catch (err) {
        log(`  [${wallet.address}:${chain}] Error: ${err.message}`);
      }

      await new Promise(r => setTimeout(r, 500));
    }
  }
}

export async function startMonitor() {
  log(`Harbormaster monitor started | poll=${POLL_INTERVAL_MS/1000}s | sign_url=${SIGN_BASE_URL}`);
  await sweep();
  setInterval(sweep, POLL_INTERVAL_MS);
}
