/**
 * In-memory session store for pre-built repay transactions.
 * Each session holds an unsigned transaction + metadata, keyed by UUID.
 * Sessions expire after 30 minutes.
 */

import { randomUUID } from 'crypto';

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 min
const sessions = new Map();

// Prune expired sessions every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (session.expiresAt < now) sessions.delete(token);
  }
}, 5 * 60 * 1000);

/**
 * Create a new signing session.
 * @param {object} opts
 * @param {string}   opts.txnB64       - Base64-encoded unsigned transaction
 * @param {string}   opts.walletAddress - The signer's address
 * @param {string}   opts.chain         - 'voi' | 'algorand'
 * @param {number}   opts.poolId        - DorkFi pool app ID
 * @param {string}   opts.symbol        - Asset symbol (e.g. 'WAD')
 * @param {number}   opts.repayUsd      - USD value of repay
 * @param {number}   opts.currentHF     - Health factor at time of alert
 * @returns {string} Session token
 */
export function createSession({ txnB64, walletAddress, chain, poolId, symbol, repayUsd, currentHF }) {
  const token = randomUUID();
  sessions.set(token, {
    txnB64,
    walletAddress,
    chain,
    poolId,
    symbol,
    repayUsd,
    currentHF,
    createdAt:  Date.now(),
    expiresAt:  Date.now() + SESSION_TTL_MS,
    used:       false,
  });
  return token;
}

/**
 * Retrieve a session by token. Returns null if not found or expired.
 */
export function getSession(token) {
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }
  return session;
}

/**
 * Mark a session as used (prevent replay).
 */
export function markSessionUsed(token) {
  const session = sessions.get(token);
  if (session) session.used = true;
}
