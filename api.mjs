/**
 * DorkFi Harbormaster — Registration API (Alert Mode)
 *
 * POST   /register         — register a wallet for monitoring + alerts
 * DELETE /register/:addr   — remove a wallet
 * GET    /status/:addr     — live HF + registration status
 * GET    /wallets          — list all wallets (operator only)
 * GET    /health           — service health check
 */

import express from 'express';
import { config } from './lib/env.mjs';
import {
  registerWallet,
  deregisterWallet,
  getWallet,
  loadRegistry,
} from './lib/registry.mjs';
import { getHealthFactor } from './lib/dorkfi.mjs';
import { log } from './lib/notify.mjs';

const app = express();
app.use(express.json());

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
    if (address.length < 58) return res.status(400).json({ error: 'invalid Algorand/Voi address' });

    const entry = registerWallet({ address, label, chains, hf_floor, contact });
    log(`Registered: ${address} (${label || 'unlabeled'})`);

    res.json({
      ok: true,
      message: 'Wallet registered — Harbormaster will alert you when HF drops below threshold',
      wallet: {
        address:       entry.address,
        label:         entry.label,
        chains:        entry.chains,
        hf_floor:      entry.hf_floor,
        contact:       entry.contact,
        registered_at: entry.registered_at,
      },
      next_steps: [
        `Alerts will fire when HF < ${entry.hf_floor ?? 1.05}`,
        `Each alert includes a direct link to repay on dork.fi`,
        contact
          ? `Alerts will be sent to your Telegram (contact: ${entry.contact})`
          : `No contact set — alerts go to operator only. Add contact via re-registering with contact field`,
        `Check live status at GET /status/${address}`,
      ],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /register/:address
app.delete('/register/:address', async (req, res) => {
  try {
    deregisterWallet(req.params.address);
    log(`Deregistered: ${req.params.address}`);
    res.json({ ok: true, message: 'Wallet removed from monitoring' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /status/:address
app.get('/status/:address', async (req, res) => {
  try {
    const wallet = getWallet(req.params.address);
    if (!wallet) return res.status(404).json({ error: 'Wallet not registered' });

    const hfData = {};
    for (const chain of wallet.chains ?? ['voi', 'algorand']) {
      const result = await getHealthFactor(req.params.address, chain);
      hfData[chain] = result?.hf ?? null;
    }

    const lowestHF = Object.values(hfData).filter(Boolean).reduce(
      (min, v) => Math.min(min, v), Infinity
    );

    res.json({
      address:           wallet.address,
      label:             wallet.label,
      active:            wallet.active,
      chains:            wallet.chains,
      hf_floor:          wallet.hf_floor,
      contact:           wallet.contact,
      protections_count: wallet.protections_count,
      registered_at:     wallet.registered_at,
      current_hf:        hfData,
      status:            lowestHF < 1.02 ? 'CRITICAL'
                       : lowestHF < (wallet.hf_floor ?? 1.05) ? 'AT_RISK'
                       : 'SAFE',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /wallets — operator only
app.get('/wallets', requireOperator, (req, res) => {
  res.json(loadRegistry());
});

// GET /health
app.get('/health', (req, res) => {
  res.json({
    status:   'ok',
    service:  'DorkFi Harbormaster (alert mode)',
    mode:     'alert — no on-chain execution',
    uptime_s: Math.floor(process.uptime()),
  });
});

export function startApi() {
  app.listen(config.port, () => {
    log(`Harbormaster API listening on port ${config.port}`);
  });
}
