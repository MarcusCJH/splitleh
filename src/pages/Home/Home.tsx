import { useNavigate } from 'react-router-dom'
import { useReceipt } from '../../store/ReceiptContext'
import { loadSessions, deleteSession } from '../../utils/storage'
import { formatCurrency } from '../../utils/split'
import { useState, useCallback } from 'react'
import type { SplitSession } from '../../types'
import styles from './Home.module.css'

export default function Home() {
  const navigate = useNavigate()
  const { draft, dispatch } = useReceipt()
  const [sessions, setSessions] = useState<SplitSession[]>(() => loadSessions())

  const startNew = useCallback(() => {
    const title = `Split ${new Date().toLocaleDateString('en-SG', { month: 'short', day: 'numeric' })}`
    dispatch({ type: 'NEW_SESSION', payload: { title } })
    navigate('/scan')
  }, [dispatch, navigate])

  const handleDelete = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    deleteSession(id)
    setSessions(loadSessions())
  }, [])

  const handleViewSession = useCallback((session: SplitSession) => {
    if (draft && draft.id !== session.id) {
      if (!globalThis.confirm(`This will discard your current draft "${draft.title}". Continue?`)) return
    }
    dispatch({ type: 'LOAD_DRAFT', payload: session })
    navigate('/result')
  }, [draft, dispatch, navigate])

  return (
    <div className={styles.page}>
      {/* Hero */}
      <div className={styles.hero}>
        <div className={styles.heroLogo}>
          <span>✂</span>
        </div>
        <h1 className={styles.heroTitle}>Splitsia</h1>
        <p className={styles.heroSub}>Scan. Review. Split fairly.</p>
      </div>

      {/* CTA */}
      <div className={styles.cta}>
        <button className="btn btn-primary btn-full" onClick={startNew}>
          <PlusIcon /> New Split
        </button>
        {draft && (
          <button className="btn btn-secondary btn-full" onClick={() => navigate('/review')}>
            <EditIcon /> Resume Draft — {draft.title}
          </button>
        )}
      </div>

      {/* How it works */}
      <section className={styles.steps}>
        <h2 className={styles.sectionTitle}>How it works</h2>
        <div className={styles.stepGrid}>
          {STEPS.map((step) => (
            <div key={step.label} className={`${styles.stepCard} card`}>
              <span className={styles.stepNum}>{step.num}</span>
              <span className={styles.stepEmoji}>{step.emoji}</span>
              <span className={styles.stepLabel}>{step.label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Past sessions */}
      {sessions.length > 0 && (
        <section className={styles.history}>
          <h2 className={styles.sectionTitle}>Past splits</h2>
          <ul className={styles.sessionList}>
            {sessions.map((s) => {
              const chargesTotal = s.receipt.charges.reduce((t, c) => t + c.amount, 0)
              return (
                <li key={s.id} className={`${styles.sessionCard} card`}>
                  <button
                    className={styles.sessionCardBtn}
                    onClick={() => handleViewSession(s)}
                  >
                    <div className={styles.sessionInfo}>
                      <span className={styles.sessionTitle}>{s.title}</span>
                      <span className={styles.sessionMeta}>
                        {s.people.length} {s.people.length === 1 ? 'person' : 'people'} ·{' '}
                        {s.receipt.items.length} items
                      </span>
                      <span className={styles.sessionDate}>
                        {new Date(s.createdAt).toLocaleDateString('en-SG', {
                          month: 'short', day: 'numeric', year: 'numeric',
                        })}
                      </span>
                    </div>
                    <span className={styles.sessionTotal}>
                      {formatCurrency(s.receipt.subtotal + chargesTotal, s.receipt.currency)}
                    </span>
                  </button>
                  <button
                    className="btn btn-ghost"
                    onClick={(e) => handleDelete(s.id, e)}
                    aria-label="Delete session"
                  >
                    <TrashIcon />
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </div>
  )
}

const STEPS = [
  { num: 1, emoji: '📷', label: 'Scan' },
  { num: 2, emoji: '✏️', label: 'Review' },
  { num: 3, emoji: '👥', label: 'Split' },
  { num: 4, emoji: '💸', label: 'Results' },
]

function PlusIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
    </svg>
  )
}
function EditIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
    </svg>
  )
}
function TrashIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6"/>
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
      <path d="M9 6V4h6v2"/>
    </svg>
  )
}
