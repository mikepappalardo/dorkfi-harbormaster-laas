/**
 * DorkFi API client + transaction builder
 */

import algosdk from 'algosdk';
import { config } from './env.mjs';

const DORKFI_API = 'https://dorkfi-api.nautilus.sh';

// Pool IDs per chain
const POOLS = {
  voi:      [47139778, 47139781],
  algorand: [3333688282, 3345940978],
};

async function apiFetch(path) {
  const r = await fetch(`${DORKFI_API}${path}`, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`DorkFi API ${r.status}: ${path}`);
  return r.json();
}

export async function getHealthFactor(address, chain) {
  try {
    const data = await apiFetch(`/user-health/user/${address}?network=${chain}`);
    if (typeof data === 'number') return { hf: data, collateral: null, debt: null, borrows: [] };
    return {
      hf:         parseFloat(data?.health_factor ?? data?.healthFactor ?? data?.hf ?? 0),
      collateral: data?.collateral_value ?? data?.collateralValue ?? null,
      debt:       data?.borrow_value ?? data?.borrowValue ?? null,
      borrows:    data?.borrows ?? data?.borrowed_markets ?? [],
    };
  } catch {
    return null;
  }
}

export async function getMarkets(chain) {
  try {
    const data = await apiFetch(`/market-data/${chain}`);
    return Array.isArray(data) ? data : (data.markets ?? []);
  } catch {
    return [];
  }
}

export function getAlgodClient(chain) {
  const server = chain === 'voi' ? config.algodServerVoi : config.algodServerAlgo;
  return new algosdk.Algodv2(config.algodToken, server, config.algodPort);
}

/**
 * Build and sign a repay_on_behalf transaction group.
 *
 * The service wallet repays `amountBaseUnits` of `marketId` debt
 * on behalf of `borrowerAddress`. Returns txid on success.
 *
 * Note: The DorkFi repay_on_behalf ABI method signature:
 *   repay_on_behalf(uint64 market_id, uint256 amount, address borrower) uint256
 */
export async function repayOnBehalf({ chain, poolId, marketId, borrowerAddress, amountBaseUnits, serviceAccount }) {
  const algod = getAlgodClient(chain);

  const sp = await algod.getTransactionParams().do();

  // ABI method call — repay_on_behalf(uint64,uint256,address)uint256
  const abiMethod = new algosdk.ABIMethod({
    name: 'repay_on_behalf',
    args: [
      { type: 'uint64',  name: 'market_id' },
      { type: 'uint256', name: 'amount' },
      { type: 'address', name: 'borrower' },
    ],
    returns: { type: 'uint256' },
  });

  const atc = new algosdk.AtomicTransactionComposer();

  atc.addMethodCall({
    appID:        poolId,
    method:       abiMethod,
    methodArgs:   [marketId, amountBaseUnits, borrowerAddress],
    sender:       serviceAccount.addr,
    suggestedParams: { ...sp, fee: 2000, flatFee: true },
    signer: algosdk.makeBasicAccountTransactionSigner(serviceAccount),
  });

  const result = await atc.execute(algod, 4);
  return result.txIDs[0];
}
