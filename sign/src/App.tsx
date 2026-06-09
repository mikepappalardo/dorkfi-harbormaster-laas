import { useEffect, useState } from 'react'
import { useWallet } from '@txnlab/use-wallet-react'
import algosdk from 'algosdk'
import RepayCard from './components/RepayCard'

export interface Session {
  txnB64:        string
  walletAddress: string
  chain:         'voi' | 'algorand'
  symbol:        string
  repayUsd:      number
  currentHF:     number
  expiresAt:     number
}

const NODE: Record<string, { server: string; port: string }> = {
  algorand: { server: 'https://mainnet-api.algonode.cloud', port: '443' },
  voi:      { server: 'https://mainnet-api.voi.nodely.dev', port: '443' },
}

type Status = 'loading' | 'ready' | 'signing' | 'success' | 'error' | 'expired'

export default function App() {
  const pathToken  = window.location.pathname.match(/\/repay\/([^/]+)/)?.[1]
  const [session,  setSession]  = useState<Session | null>(null)
  const [status,   setStatus]   = useState<Status>('loading')
  const [txid,     setTxid]     = useState('')
  const [errMsg,   setErrMsg]   = useState('')

  const { wallets, activeAddress, signTransactions } = useWallet()

  useEffect(() => {
    if (!pathToken) { setStatus('error'); setErrMsg('No session token in URL'); return }
    fetch(`/repay/${pathToken}`)
      .then(r => { if (!r.ok) throw r.status; return r.json() })
      .then((data: Session) => { setSession(data); setStatus('ready') })
      .catch((code: number) => {
        if (code === 404 || code === 410) setStatus('expired')
        else { setStatus('error'); setErrMsg('Failed to load session') }
      })
  }, [pathToken])

  async function handleRepay() {
    if (!session || !activeAddress) return
    setStatus('signing')
    setErrMsg('')

    try {
      const txnBytes = new Uint8Array(
        atob(session.txnB64).split('').map(c => c.charCodeAt(0))
      )

      // Sign via connected wallet
      const signed = await signTransactions([txnBytes])
      const signedBytes = signed[0]
      if (!signedBytes) throw new Error('Wallet returned no signature')

      // Submit to node
      const cfg  = NODE[session.chain]
      const algod = new algosdk.Algodv2('', cfg.server, cfg.port)
      const resp  = await algod.sendRawTransaction(signedBytes).do()
      const confirmedTxid: string = (resp as any).txid ?? ''

      await fetch(`/repay/${pathToken}/complete`, { method: 'POST' })
      setTxid(confirmedTxid)
      setStatus('success')
    } catch (err: unknown) {
      setStatus('error')
      setErrMsg(err instanceof Error ? err.message : 'Transaction failed')
    }
  }

  const explorerBase = session?.chain === 'voi'
    ? 'https://explorer.voi.network/explorer/transaction'
    : 'https://allo.info/tx'

  return (
    <div style={s.outer}>
      <div style={s.card}>
        <div style={s.header}>
          <div style={s.logo}>⚓</div>
          <h1 style={s.title}>DorkFi Harbormaster</h1>
          <p style={s.sub}>One-tap liquidation protection</p>
        </div>

        {status === 'loading' && <p style={s.center}>Loading…</p>}

        {status === 'expired' && (
          <div style={s.errorBox}>
            <p>⏰ This link has expired (30 min limit)</p>
            <p style={{ marginTop: 10 }}>
              <a href="https://dork.fi" style={s.link}>Repay manually on dork.fi →</a>
            </p>
          </div>
        )}

        {status === 'success' && (
          <div style={s.successBox}>
            <p style={{ fontSize: 32 }}>✅</p>
            <p style={{ fontWeight: 700, marginTop: 8 }}>Repay submitted!</p>
            {txid && (
              <a href={`${explorerBase}/${txid}`} target="_blank" rel="noreferrer" style={{ ...s.link, display: 'block', marginTop: 10 }}>
                View on explorer →
              </a>
            )}
          </div>
        )}

        {(status === 'ready' || status === 'signing' || status === 'error') && session && (
          <RepayCard
            session={session}
            status={status}
            errMsg={errMsg}
            activeAddress={activeAddress}
            wallets={wallets}
            onRepay={handleRepay}
          />
        )}
      </div>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  outer:      { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: '#061228' },
  card:       { background: '#18212f', borderRadius: 16, padding: 32, width: '100%', maxWidth: 440, boxShadow: '0 8px 32px rgba(0,0,0,0.4)' },
  header:     { textAlign: 'center', marginBottom: 28 },
  logo:       { fontSize: 36 },
  title:      { fontSize: 22, fontWeight: 700, color: '#fff', marginTop: 8 },
  sub:        { fontSize: 13, color: '#8fa3b1', marginTop: 4 },
  center:     { textAlign: 'center', color: '#8fa3b1', padding: '24px 0' },
  errorBox:   { background: '#2d1515', border: '1px solid #7f1d1d', borderRadius: 10, padding: 16, color: '#fecaca', textAlign: 'center' },
  successBox: { background: '#0d2218', border: '1px solid #166534', borderRadius: 10, padding: 24, color: '#bbf7d0', textAlign: 'center' },
  link:       { color: '#00a39e', textDecoration: 'underline' },
}
