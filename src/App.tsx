import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { ReceiptProvider } from './store/ReceiptContext'
import AppShell from './components/AppShell/AppShell'
import Home from './pages/Home/Home'
import Scan from './pages/Scan/Scan'
import Review from './pages/Review/Review'
import Split from './pages/Split/Split'
import Result from './pages/Result/Result'

export default function App() {
  return (
    <ReceiptProvider>
      <HashRouter>
        <AppShell>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/scan" element={<Scan />} />
            <Route path="/review" element={<Review />} />
            <Route path="/split" element={<Split />} />
            <Route path="/result" element={<Result />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AppShell>
      </HashRouter>
    </ReceiptProvider>
  )
}
