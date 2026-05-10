/**
 * DorkFi Harbormaster LaaS — Registration API
 *
 * POST /register          — register a wallet for protection
 * DELETE /register/:addr  — remove a wallet
 * GET  /status/:addr      — get wallet status + fee balance
 * GET  /wallets           — list all registered wallets (operator only)
 * POST /deposit/:addr     — record a fee deposit (manual, off-chain payment)
 * GET  /health            — service health check
 */

import express from 'express';
import { config } from './lib/env.mjs';
import {
  registerWallet,
  deregisterWallet,
  getWallet,
  loadRegistry,
  creditFeeDeposit,
} from './lib/registry.mjs';
import { getHealthFactor } from './lib/dorkfi.mjs';
import { log } from './lib/notify.mjs';

const app = express();
app.use(express.json());

// Simple operator auth via header
function requireOperator(req, res, next) {
  const key = req.headers['x-operator-key'];
  if (!key || key !== process.env.OPERATOR_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// POST /register
app.post('/register', async (req, res) => {
  try {
    const { address, label, chains, hf_floor, contact } = req.body;

    if (!address) return res.status(400).json({ error: 'address required' });
    if (address.length < 58) return res.status(400).json({ error: 'invalid address' });

    const entry = registerWallet({ address, label, chains, hf_floor, contact });

    log(`Registered: ${address} (${label || 'unlabeled'})`);

    res.json({
      ok: true,
      message: 'Wallet registered for Harbormaster protection',
      wallet: {
        address:       entry.address,
        label:         entry.label,
        chains:        entry.chains,
        hf_floor:      entry.hf_floor,
        fee_deposit:   entry.fee_deposit_usd,
        registered_at: entry.registered_at,
      },
      next_steps: [
        `Fund your fee deposit via POST /deposit/${address} (minimum $5 USDC recommended)`,
        `Protection activates immediately once fee deposit is confirmed`,
        `Check status at GET /status/${address}`,
      ],
      service_fee: `${config.feeRate * 100}% of debt repaid per protection event`,
      trigger_hf:  config.triggerHF,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /register/:address
app.delete('/register/:address', async (req, res) => {
  try {
    const { address } = req.params;
    deregisterWallet(address);
    log(`Deregistered: ${address}`);
    res.json({ ok: true, message: 'Wallet removed from protection' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /status/:address
app.get('/status/:address', async (req, res) => {
  try {
    const { address } = req.params;
    const wallet = getWallet(address);

    if (!wallet) return res.status(404).json({ error: 'Wallet not registered' });

    // Fetch live HF for both chains
    const hfData = {};
    for (const chain of wallet.chains ?? ['voi', 'algorand']) {
      const result = await getHealthFactor(address, chain);
      hfData[chain] = result?.hf ?? null;
    }

    res.json({
      address:           wallet.address,
      label:             wallet.label,
      active:            wallet.active,
      chains:            wallet.chains,
      hf_floor:          wallet.hf_floor,
      trigger_hf:        config.triggerHF,
      fee_deposit_usd:   wallet.fee_deposit_usd,
      fees_charged_usd:  wallet.fees_charged_usd,
      protections_count: wallet.protections_count,
      registered_at:     wallet.registered_at,
      current_hf:        hfData,
      warning: wallet.fee_deposit_usd <= 0
        ? 'Fee deposit exhausted — protection suspended. Fund via POST /deposit/:address'
        : null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /deposit/:address — operator records a fee deposit
app.post('/deposit/:address', requireOperator, async (req, res) => {
  try {
    const { address } = req.params;
    const { amount_usd } = req.body;

    if (!amount_usd || amount_usd <= 0) {
      return res.status(400).json({ error: 'amount_usd must be positive' });
    }

    const wallet = creditFeeDeposit(address, parseFloat(amount_usd));
    log(`Fee deposit: ${address} +$${amount_usd} (balance: $${wallet.fee_deposit_usd})`);

    res.json({
      ok: true,
      address,
      fee_deposit_usd:  wallet.fee_deposit_usd,
      active:           wallet.active,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /wallets — operator only
app.get('/wallets', requireOperator, (req, res) => {
  const registry = loadRegistry();
  res.json(registry);
});

// GET /health
app.get('/health', (req, res) => {
  res.json({
    status:     'ok',
    service:    'DorkFi Harbormaster LaaS',
    trigger_hf: config.triggerHF,
    fee_rate:   config.feeRate,
    uptime_s:   Math.floor(process.uptime()),
  });
});

export function startApi() {
  app.listen(config.port, () => {
    log(`Harbormaster LaaS API listening on port ${config.port}`);
  });
}
