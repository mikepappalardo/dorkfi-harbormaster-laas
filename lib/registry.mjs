/**
 * Registry — manages registered wallets and their fee deposits.
 * Backed by registry.json (auto-created on first run).
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REGISTRY_PATH = join(__dirname, '..', 'registry.json');

export function loadRegistry() {
  if (!existsSync(REGISTRY_PATH)) {
    const empty = { wallets: [] };
    writeFileSync(REGISTRY_PATH, JSON.stringify(empty, null, 2));
    return empty;
  }
  return JSON.parse(readFileSync(REGISTRY_PATH, 'utf8'));
}

export function saveRegistry(registry) {
  writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2));
}

export function getWallet(address) {
  const { wallets } = loadRegistry();
  return wallets.find(w => w.address === address) ?? null;
}

export function registerWallet({ address, label, chains, hf_floor, contact }) {
  const registry = loadRegistry();
  const existing = registry.wallets.findIndex(w => w.address === address);

  const entry = {
    address,
    label: label || address.slice(0, 8) + '...',
    chains: chains || ['voi', 'algorand'],
    hf_floor: hf_floor || 1.05,
    contact: contact || null,       // Telegram user ID or email for per-user alerts
    fee_deposit_usd: 0,             // Pre-deposited fee balance in USD
    fees_charged_usd: 0,            // Total fees charged to date
    protections_count: 0,           // Number of times protected
    registered_at: new Date().toISOString(),
    active: true,
  };

  if (existing >= 0) {
    registry.wallets[existing] = { ...registry.wallets[existing], ...entry };
  } else {
    registry.wallets.push(entry);
  }

  saveRegistry(registry);
  return entry;
}

export function deregisterWallet(address) {
  const registry = loadRegistry();
  registry.wallets = registry.wallets.filter(w => w.address !== address);
  saveRegistry(registry);
}

export function creditFeeDeposit(address, amountUsd) {
  const registry = loadRegistry();
  const wallet = registry.wallets.find(w => w.address === address);
  if (!wallet) throw new Error(`Wallet ${address} not registered`);
  wallet.fee_deposit_usd = (wallet.fee_deposit_usd || 0) + amountUsd;
  saveRegistry(registry);
  return wallet;
}

export function chargeFee(address, amountUsd) {
  const registry = loadRegistry();
  const wallet = registry.wallets.find(w => w.address === address);
  if (!wallet) throw new Error(`Wallet ${address} not registered`);
  wallet.fee_deposit_usd = Math.max(0, (wallet.fee_deposit_usd || 0) - amountUsd);
  wallet.fees_charged_usd = (wallet.fees_charged_usd || 0) + amountUsd;
  wallet.protections_count = (wallet.protections_count || 0) + 1;
  if (wallet.fee_deposit_usd <= 0) wallet.active = false; // suspend if balance exhausted
  saveRegistry(registry);
  return wallet;
}

export function getActiveWallets() {
  const { wallets } = loadRegistry();
  return wallets.filter(w => w.active !== false);
}
