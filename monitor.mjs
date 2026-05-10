/**
 * DorkFi Harbormaster LaaS — Monitor
 *
 * Polls health factors for all registered wallets.
 * When HF < trigger threshold, executes repay_on_behalf
 * and charges the 0.1% service fee.
 */

import algosdk from 'algosdk';
import { config } from './lib/env.mjs';
import { getHealthFactor, getMarkets, repayOnBehalf } from './lib/dorkfi.mjs';
import { getActiveWallets, chargeFee } from './lib/registry.mjs';
import { sendTelegram, log, hfEmoji } from './lib/notify.mjs';

// Track last action per wallet to prevent double-execution
const lastAction = {};
const ACTION_COOLDOWN_MS = 10 * 60 * 1000; // 10 min between repays per wallet

function getServiceAccount() {
  if (!config.serviceMnemonic) throw new Error('SERVICE_MNEMONIC not set in .env');
  return algosdk.mnemonicToSecretKey(config.serviceMnemonic);
}

/**
 * Find the largest borrowed position and calculate repay amount.
 * Repays enough to push HF back to 1.2 (safe buffer above trigger).
 */
function calcRepayAmount(borrows, collateral, debt, hf) {
  if (!borrows?.length || !debt) return null;

  const sorted = [...borrows].sort((a, b) => {
    const aUsd = parseFloat(a.borrow_value_usd ?? a.value_usd ?? 0);
    const bUsd = parseFloat(b.borrow_value_usd ?? b.value_usd ?? 0);
    return bUsd - aUsd;
  });

  const top = sorted[0];
  const debtUsd = parseFloat(top.borrow_value_usd ?? top.value_usd ?? 0);
  if (!debtUsd) return null;

  // Repay enough to get from current HF to target of 1.2
  // ΔRepay ≈ (targetHF - currentHF) / targetHF × totalDebt
  const TARGET_HF = 1.2;
  const repayFraction = Math.min(0.5, Math.max(0.05, (TARGET_HF - hf) / TARGET_HF));
  const repayUsd = debtUsd * repayFraction;

  return {
    symbol:        top.symbol ?? top.asset ?? 'Unknown',
    marketId:      top.market_id ?? top.marketId ?? null,
    decimals:      top.decimals ?? 6,
    repayFraction,
    repayUsd,
    debtUsd,
    rawAmount:     top.borrow_amount ?? top.amount ?? null,
    poolId:        top.pool_id ?? null,
  };
}

async function executeProtection(wallet, chain, hf, borrows, collateral, debt) {
  const key = `${wallet.address}:${chain}`;
  const now = Date.now();

  if (lastAction[key] && now - lastAction[key] < ACTION_COOLDOWN_MS) {
    log(`  [${key}] Cooldown active — skipping execution`);
    return;
  }

  const repay = calcRepayAmount(borrows, collateral, debt, hf);
  if (!repay || !repay.marketId) {
    log(`  [${key}] Could not determine repay target — alerting only`);
    await sendTelegram(
      `⚠️ *Harbormaster LaaS — Manual Action Required*\n\nWallet: \`${wallet.address.slice(0,8)}...\`\nChain: ${chain}\nHF: ${hf?.toFixed(4)}\n\nCould not auto-repay — insufficient position data. Please act immediately.`,
      wallet.contact
    );
    return;
  }

  log(`  [${key}] Executing repay: ${(repay.repayFraction * 100).toFixed(1)}% of ${repay.symbol} ($${repay.repayUsd.toFixed(2)})`);

  try {
    const serviceAccount = getServiceAccount();

    // Calculate base units for repay
    const repayBaseUnits = BigInt(
      Math.floor((repay.rawAmount ?? 0) * repay.repayFraction)
    );

    if (repayBaseUnits <= 0n) {
      log(`  [${key}] Repay amount too small — skipping`);
      return;
    }

    const poolId = repay.poolId ?? (chain === 'voi' ? 47139778 : 3333688282);

    const txid = await repayOnBehalf({
      chain,
      poolId,
      marketId:        repay.marketId,
      borrowerAddress: wallet.address,
      amountBaseUnits: repayBaseUnits,
      serviceAccount,
    });

    lastAction[key] = now;

    // Charge fee: 0.1% of repay value
    const feeUsd = repay.repayUsd * config.feeRate;
    chargeFee(wallet.address, feeUsd);

    log(`  [${key}] Protection executed. Tx: ${txid} | Fee charged: $${feeUsd.toFixed(4)}`);

    await sendTelegram(
      [
        `🛡️ *Harbormaster LaaS — Position Protected*`,
        ``,
        `Wallet: \`${wallet.address.slice(0,8)}...${wallet.address.slice(-4)}\``,
        `Chain: ${chain.charAt(0).toUpperCase() + chain.slice(1)}`,
        `HF before: ${hf?.toFixed(4)} → target: 1.20`,
        `Repaid: ${(repay.repayFraction * 100).toFixed(1)}% of ${repay.symbol} ($${repay.repayUsd.toFixed(2)})`,
        `Service fee: $${feeUsd.toFixed(4)} (0.1%)`,
        `Tx: \`${txid}\``,
      ].join('\n'),
      wallet.contact
    );

    // Notify operator too
    await sendTelegram(
      `🛡️ *Protection executed*\n${wallet.label} on ${chain}\nTx: \`${txid}\` | Fee: $${feeUsd.toFixed(4)}`
    );

  } catch (err) {
    log(`  [${key}] Execution failed: ${err.message}`);
    await sendTelegram(
      `🚨 *Harbormaster LaaS — Execution Failed*\n\nWallet: \`${wallet.address.slice(0,8)}...\`\nChain: ${chain}\nHF: ${hf?.toFixed(4)}\nError: ${err.message}\n\n⚠️ Manual intervention required.`,
      wallet.contact
    );
  }
}

async function runCycle() {
  const wallets = getActiveWallets();
  if (!wallets.length) {
    log('No active wallets registered');
    return;
  }

  log(`Checking ${wallets.length} wallet(s)...`);

  for (const wallet of wallets) {
    for (const chain of wallet.chains ?? ['voi', 'algorand']) {
      try {
        const result = await getHealthFactor(wallet.address, chain);
        if (!result) { log(`  ${wallet.label} [${chain}] — no data`); continue; }

        const { hf, collateral, debt, borrows } = result;
        log(`${hfEmoji(hf)} ${wallet.label} [${chain}] HF: ${hf?.toFixed(4) ?? 'N/A'}`);

        if (!hf || isNaN(hf) || hf <= 0) continue;

        // Execute protection
        if (hf < config.triggerHF) {
          log(`  ⚡ HF ${hf.toFixed(4)} < trigger ${config.triggerHF} — protecting`);
          await executeProtection(wallet, chain, hf, borrows, collateral, debt);
        }

        // Early warning: 15% above trigger
        else if (hf < config.triggerHF * 1.15) {
          log(`  ⚠️  Approaching trigger — HF: ${hf.toFixed(4)}`);
          const key = `${wallet.address}:${chain}:warn`;
          const last = lastAction[key] ?? 0;
          if (Date.now() - last > 60 * 60 * 1000) { // warn once per hour
            await sendTelegram(
              `⚠️ *Harbormaster LaaS — Early Warning*\n\nWallet: \`${wallet.address.slice(0,8)}...\`\nChain: ${chain}\nHF: ${hf.toFixed(4)} — approaching protection threshold of ${config.triggerHF}\n\nConsider adding collateral or repaying debt.`,
              wallet.contact
            );
            lastAction[key] = Date.now();
          }
        }

      } catch (err) {
        log(`  Error checking ${wallet.label} [${chain}]: ${err.message}`);
      }
    }
  }
}

export async function startMonitor() {
  log(`Harbormaster LaaS monitor starting | Trigger HF: ${config.triggerHF} | Poll: ${config.pollInterval}s`);
  await runCycle();
  setInterval(runCycle, config.pollInterval * 1000);
}
