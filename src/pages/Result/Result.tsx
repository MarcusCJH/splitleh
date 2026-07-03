import { useState, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useReceipt } from '../../store/ReceiptContext'
import { calculateSplit, formatCurrency } from '../../utils/split'
import { saveSession } from '../../utils/storage'
import type { PersonResult, SplitResult, SplitSession } from '../../types'
import styles from './Result.module.css'

// ── Copy text helpers ─────────────────────────────────────────────────────────

function gstSvcLabel(hasGst: boolean, hasSvc: boolean): string {
  if (hasGst && hasSvc) return 'GST/service'
  return hasGst ? 'GST' : 'Service charge'
}

function personCopyLines(r: PersonResult, cur: string, splitMode: SplitSession['splitMode']): string[] {
  const header = `${r.person.name}: ${formatCurrency(r.total, cur)}`

  const itemLines: string[] = splitMode === 'equal'
    ? [`- Equal share  ${formatCurrency(r.subtotal, cur)}`]
    : r.itemShares.map(({ item, amount, outOf }) => {
        const suffix = outOf > 1 ? ` ÷${outOf}` : ''
        return `- ${item.name || 'Item'}${suffix}  ${formatCurrency(amount, cur)}`
      })

  const chargeLines: string[] = []
  const gstSvc = r.chargeShares.filter(
    (cs) => (cs.charge.type === 'gst' || cs.charge.type === 'service_charge') && cs.amount > 0.005,
  )
  if (gstSvc.length > 0) {
    const total = gstSvc.reduce((s, cs) => s + cs.amount, 0)
    const hasGst = gstSvc.some((cs) => cs.charge.type === 'gst')
    const hasSvc = gstSvc.some((cs) => cs.charge.type === 'service_charge')
    chargeLines.push(`- ${gstSvcLabel(hasGst, hasSvc)}  ${formatCurrency(total, cur)}`)
  }
  for (const cs of r.chargeShares) {
    if (cs.charge.type === 'discount' && cs.amount < -0.005) {
      chargeLines.push(`- Discount  ${formatCurrency(cs.amount, cur)}`)
    }
  }

  return [header, ...itemLines, ...chargeLines]
}

function buildCopyText(session: SplitSession, result: SplitResult): string {
  const cur = session.receipt.currency
  const personSections = result.personResults.flatMap(
    (r) => ['', ...personCopyLines(r, cur, session.splitMode)],
  )
  const unassignedSection = result.unassignedItems.length > 0
    ? ['', `Not split: ${result.unassignedItems.map((i) => i.name || 'Item').join(', ')}`]
    : []

  return [
    'SplitSia result',
    `Total: ${formatCurrency(session.receipt.total, cur)}`,
    ...personSections,
    ...unassignedSection,
  ].join('\n')
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Result() {
  const navigate = useNavigate()
  const { draft, dispatch } = useReceipt()
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle')
  const [confirmFinish, setConfirmFinish] = useState(false)

  const splitResult = useMemo(
    () => (draft ? calculateSplit(draft) : null),
    [draft],
  )

  const copyResult = useCallback(async () => {
    if (!draft || !splitResult) return
    const text = buildCopyText(draft, splitResult)
    try {
      await navigator.clipboard.writeText(text)
      setCopyState('copied')
      setTimeout(() => setCopyState('idle'), 2000)
    } catch {
      setCopyState('error')
      setTimeout(() => setCopyState('idle'), 2000)
    }
  }, [draft, splitResult])

  const saveAndFinish = useCallback(() => {
    if (!draft) return
    saveSession(draft)
    dispatch({ type: 'CLEAR_DRAFT' })
    navigate('/')
  }, [draft, dispatch, navigate])

  if (!draft) {
    return (
      <div className={styles.page}>
        <div className={styles.empty}>
          <p>No active session.</p>
          <button className="btn btn-primary" onClick={() => navigate('/')}>Go Home</button>
        </div>
      </div>
    )
  }

  if (!splitResult || splitResult.personResults.length === 0) {
    return (
      <div className={styles.page}>
        <div className={styles.empty}>
          <span className={styles.emptyIcon}>👥</span>
          <p>Add people in the Split step first.</p>
          <button className="btn btn-secondary" onClick={() => navigate('/split')}>← Go Back</button>
        </div>
      </div>
    )
  }

  const { personResults, unassignedItems, assignedTotal } = splitResult
  const { currency, total: receiptTotal } = draft.receipt
  const hasUnassigned = unassignedItems.length > 0

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Results</h1>
        <p className={styles.sub}>{draft.title}</p>
      </header>

      {/* Per-person cards */}
      <section className={styles.resultList}>
        {personResults.map((result, i) => (
          <PersonCard
            key={result.person.id}
            result={result}
            currency={currency}
            splitMode={draft.splitMode}
            index={i}
          />
        ))}
      </section>

      {/* Unassigned items warning */}
      {hasUnassigned && (
        <div className={`${styles.unassignedNote} card`}>
          <WarningIcon />
          <div>
            <strong>Not included in anyone's bill:</strong>{' '}
            {unassignedItems.map((i) => i.name || 'Item').join(', ')}
          </div>
        </div>
      )}

      {/* Grand total */}
      <div className={`${styles.grandTotalCard} card`}>
        <div className={styles.gtRow}>
          <span className={styles.gtLabel}>Receipt total</span>
          <span className={styles.gtAmount}>{formatCurrency(receiptTotal, currency)}</span>
        </div>
        {hasUnassigned && (
          <div className={styles.gtNote}>
            {formatCurrency(assignedTotal, currency)} split ·{' '}
            {unassignedItems.length} item{unassignedItems.length > 1 ? 's' : ''} not assigned
          </div>
        )}
      </div>

      {/* Actions */}
      <div className={styles.actions}>
        <button
          className={`btn btn-full ${copyState === 'copied' ? styles.btnCopied : 'btn-secondary'}`}
          onClick={copyResult}
        >
          <CopyResultLabel state={copyState} />
        </button>
        {confirmFinish ? (
          <div className={styles.confirmRow}>
            <span className={styles.confirmLabel}>Save and finish?</span>
            <button className="btn btn-ghost" onClick={() => setConfirmFinish(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={saveAndFinish}>Confirm</button>
          </div>
        ) : (
          <button className="btn btn-primary btn-full" onClick={() => setConfirmFinish(true)}>
            <CheckIcon /> Save &amp; Done
          </button>
        )}
      </div>

      <button
        className={`btn btn-ghost ${styles.startOver}`}
        onClick={() => navigate('/')}
      >
        Start a new split
      </button>
    </div>
  )
}

// ── PersonCard helpers ─────────────────────────────────────────────────────────

function personSubLabel(isEqual: boolean, itemCount: number): string {
  if (isEqual) return 'Equal split'
  const suffix = itemCount === 1 ? '' : 's'
  return `${itemCount} item${suffix}`
}

function chargesSuffix(chargesTotal: number, currency: string): string {
  if (chargesTotal > 0.005) return ` + ${formatCurrency(chargesTotal, currency)} charges`
  if (chargesTotal < -0.005) return ` − ${formatCurrency(Math.abs(chargesTotal), currency)} off`
  return ''
}

// ── PersonCard ────────────────────────────────────────────────────────────────

function PersonCard({
  result,
  currency,
  splitMode,
  index,
}: Readonly<{
  result: PersonResult
  currency: string
  splitMode: SplitSession['splitMode']
  index: number
}>) {
  const { person, itemShares, chargeShares, subtotal, chargesTotal, total } = result
  const isEqual = splitMode === 'equal'

  const visibleCharges = chargeShares.filter((cs) => Math.abs(cs.amount) > 0.005)
  const hasCharges = visibleCharges.length > 0
  const hasBreakdown = hasCharges && Math.abs(chargesTotal) > 0.005

  // In itemized mode with no items the person was never assigned anything
  const hasContent = isEqual || itemShares.length > 0

  return (
    <div
      className={`${styles.personCard} card animate-in`}
      style={{ animationDelay: `${index * 60}ms`, '--person-color': person.color } as React.CSSProperties}
    >
      {/* Header */}
      <div className={styles.personHeader}>
        <div className={styles.personAvatar} style={{ background: person.color }}>
          {person.name.charAt(0).toUpperCase()}
        </div>
        <div className={styles.personMeta}>
          <span className={styles.personName}>{person.name}</span>
          <span className={styles.personSub}>{personSubLabel(isEqual, itemShares.length)}</span>
        </div>
        <span className={styles.personTotal} style={{ color: person.color }}>
          {formatCurrency(total, currency)}
        </span>
      </div>

      {/* Items */}
      {hasContent && (
        <ul className={styles.rowList}>
          {isEqual ? (
            <li className={styles.itemRow}>
              <span className={styles.rowName}>Equal share</span>
              <span className={styles.rowAmount}>{formatCurrency(subtotal, currency)}</span>
            </li>
          ) : (
            itemShares.map(({ item, amount, outOf }) => (
              <li key={item.id} className={styles.itemRow}>
                <span className={styles.rowName}>
                  {item.name || 'Item'}
                  {outOf > 1 && <span className={styles.sharedBadge}> ÷{outOf}</span>}
                </span>
                <span className={styles.rowAmount}>{formatCurrency(amount, currency)}</span>
              </li>
            ))
          )}
        </ul>
      )}

      {/* Charges — visually separated from item rows */}
      {hasCharges && (
        <ul className={`${styles.rowList} ${styles.chargeList}`}>
          {visibleCharges.map((cs) => (
            <li key={cs.charge.id} className={`${styles.itemRow} ${styles.chargeRow}`}>
              <span className={styles.chargeName}>{cs.charge.label}</span>
              <span className={cs.amount < 0 ? styles.chargeNeg : styles.chargePos}>
                {formatCurrency(cs.amount, currency)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* Breakdown footer */}
      {hasBreakdown && (
        <div className={styles.breakdown}>
          <span className={styles.breakdownLeft}>
            {formatCurrency(subtotal, currency)} items{chargesSuffix(chargesTotal, currency)}
          </span>
          <span className={styles.breakdownTotal} style={{ color: person.color }}>
            = {formatCurrency(total, currency)}
          </span>
        </div>
      )}
    </div>
  )
}

// ── Copy button label (extracted to avoid nested ternary) ─────────────────────

function CopyResultLabel({ state }: Readonly<{ state: 'idle' | 'copied' | 'error' }>) {
  if (state === 'copied') return <><CheckIcon /> Copied!</>
  if (state === 'error')  return <><CopyIcon /> Copy failed — try again</>
  return <><CopyIcon /> Copy result</>
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function CopyIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  )
}

function WarningIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
      <line x1="12" y1="9" x2="12" y2="13"/>
      <line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>
  )
}
