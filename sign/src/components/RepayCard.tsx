import type { Session } from '../App'

interface Wallet {
  id:       string
  metadata: { name: string; icon: string }
  isConnected: boolean
  connect:    () => Promise<unknown>
  disconnect: () => Promise<unknown>
}

interface Props {
  session:       Session
  status:        'ready' | 'signing' | 'error'
  errMsg:        string
  activeAddress: string | null
  wallets:       Wallet[]
  onRepay:       () => void
}

function hfColor(hf: number) {
  if (hf < 1.02) return '#f87171'
  if (hf < 1.1)  return '#fb923c'
  if (hf < 1.3)  return '#facc15'
  return '#4ade80'
}

export default function RepayCard({ session, status, errMsg, activeAddress, wallets, onRepay }: Props) {
  const connected   = !!activeAddress
  const canRepay    = connected && status !== 'signing'
  const timeLeft    = Math.max(0, Math.floor((session.expiresAt - Date.now()) / 60000))
  const chainLabel  = session.chain.charAt(0).toUpperCase() + session.chain.slice(1)

  const activeWallet = wallets.find(w => w.isConnected)

  return (
    <div>
      {/* Position summary */}
      <div style={{ ...s.banner, borderColor: hfColor(session.currentHF) }}>
        <Row label="Health Factor">
          <span style={{ color: hfColor(session.currentHF), fontWeight: 700, fontSize: 22 }}>
            {session.currentHF.toFixed(4)}
          </span>
        </Row>
        <Row label="Repay amount">
          <strong style={{ color: '#fff' }}>${session.repayUsd.toFixed(2)} {session.symbol}</strong>
        </Row>
        <Row label="Chain"><span>{chainLabel}</span></Row>
        <Row label="Link expires"><span style={{ color: '#64748b' }}>{timeLeft}m</span></Row>
      </div>

      <div style={s.addrRow}>
        <span style={s.label}>Sign with</span>
        <code style={s.code}>
          {session.walletAddress.slice(0,10)}…{session.walletAddress.slice(-6)}
        </code>
      </div>

      {/* Wallet buttons */}
      {!connected && (
        <>
          <p style={{ ...s.label, marginBottom: 10 }}>Connect your wallet:</p>
          <div style={s.walletGrid}>
            {wallets.map(wallet => (
              <button key={wallet.id} onClick={() => wallet.connect()} style={s.walletBtn}>
                {wallet.metadata.icon
                  ? <img src={wallet.metadata.icon} alt="" style={{ width: 28, height: 28 }} />
                  : <span style={{ fontSize: 24 }}>🔑</span>
                }
                <span style={{ fontSize: 12, marginTop: 4 }}>{wallet.metadata.name}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {/* Connected badge */}
      {connected && activeWallet && (
        <div style={s.connRow}>
          <span style={{ color: '#4ade80', fontSize: 12 }}>
            ✅ {activeWallet.metadata.name} — {activeAddress!.slice(0,8)}…{activeAddress!.slice(-4)}
          </span>
          <button onClick={() => activeWallet.disconnect()} style={s.discBtn}>
            Disconnect
          </button>
        </div>
      )}

      {/* Repay CTA */}
      <button
        onClick={onRepay}
        disabled={!canRepay}
        style={{ ...s.repayBtn, opacity: canRepay ? 1 : 0.4, cursor: canRepay ? 'pointer' : 'not-allowed' }}
      >
        {status === 'signing'
          ? '⏳ Waiting for wallet…'
          : `⚡ Repay $${session.repayUsd.toFixed(2)} ${session.symbol}`
        }
      </button>

      {status === 'error' && errMsg && (
        <p style={s.errMsg}>❌ {errMsg}</p>
      )}

      <p style={s.disclaimer}>
        Harbormaster never holds your keys. Signing happens entirely in your wallet.
      </p>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
      <span style={{ color: '#94a3b8', fontSize: 13 }}>{label}</span>
      {children}
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  banner:    { background: '#0f1923', border: '1px solid', borderRadius: 10, padding: '14px 16px', marginBottom: 14 },
  addrRow:   { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  label:     { color: '#94a3b8', fontSize: 12 },
  code:      { background: '#0f1923', borderRadius: 4, padding: '2px 6px', fontSize: 11, color: '#cbd5e1', fontFamily: 'monospace' },
  walletGrid:{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 4 },
  walletBtn: { background: '#0f1923', border: '1px solid #1e3a5f', borderRadius: 10, padding: '12px 8px', color: '#e2e8f0', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 },
  connRow:   { display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#0d2218', borderRadius: 8, padding: '8px 12px', marginBottom: 4 },
  discBtn:   { background: 'transparent', border: 'none', color: '#64748b', fontSize: 12, cursor: 'pointer', textDecoration: 'underline' },
  repayBtn:  { width: '100%', background: '#00a39e', border: 'none', borderRadius: 12, padding: '14px 0', color: '#fff', fontWeight: 700, fontSize: 16, marginTop: 16 },
  errMsg:    { color: '#f87171', fontSize: 13, marginTop: 10, textAlign: 'center' },
  disclaimer:{ color: '#475569', fontSize: 11, textAlign: 'center', marginTop: 16, lineHeight: 1.5 },
}
