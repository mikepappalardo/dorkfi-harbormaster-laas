import React from 'react'
import ReactDOM from 'react-dom/client'
import { WalletProvider, WalletManager, WalletId, NetworkId } from '@txnlab/use-wallet-react'
import App from './App'

const manager = new WalletManager({
  wallets: [
    WalletId.PERA,
    WalletId.DEFLY,
    WalletId.KIBISIS,
  ],
  network: NetworkId.MAINNET,
  algod: {
    token:      '',
    baseServer: 'https://mainnet-api.algonode.cloud',
    port:       '443',
  },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <WalletProvider manager={manager}>
      <App />
    </WalletProvider>
  </React.StrictMode>
)
