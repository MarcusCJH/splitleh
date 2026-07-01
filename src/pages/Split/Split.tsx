import { useState, useCallback, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useReceipt } from '../../store/ReceiptContext'
import { formatCurrency } from '../../utils/split'
import { SAMPLE_SESSION } from '../../mocks/sampleData'
import type { Person, ReceiptItem } from '../../types'
import styles from './Split.module.css'

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Split() {
  const navigate = useNavigate()
  const { draft, dispatch, getAssignedPersonIds } = useReceipt()
  const [newName, setNewName] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // Per-person item counts + subtotals, derived from assignments
  const { personItemCounts, personSubtotals } = useMemo(() => {
    const counts   = new Map<string, number>()
    const subtotals = new Map<string, number>()
    if (!draft) return { personItemCounts: counts, personSubtotals: subtotals }

    for (const assignment of draft.assignments) {
      const item = draft.receipt.items.find((i) => i.id === assignment.itemId)
      if (!item || assignment.personIds.length === 0) continue
      const share = item.totalPrice / assignment.personIds.length
      for (const pid of assignment.personIds) {
        counts.set(pid, (counts.get(pid) ?? 0) + 1)
        subtotals.set(pid, (subtotals.get(pid) ?? 0) + share)
      }
    }

    return { personItemCounts: counts, personSubtotals: subtotals }
  }, [draft?.assignments, draft?.receipt.items])

  const addPerson = useCallback(() => {
    const name = newName.trim()
    if (!name) return
    dispatch({ type: 'ADD_PERSON', payload: { name } })
    setNewName('')
    inputRef.current?.focus()
  }, [newName, dispatch])

  const toggleAssign = useCallback(
    (itemId: string, personId: string, assigned: boolean) =>
      dispatch({ type: assigned ? 'UNASSIGN_ITEM' : 'ASSIGN_ITEM', payload: { itemId, personId } }),
    [dispatch]
  )

  const assignAll = useCallback(
    (itemId: string) => dispatch({ type: 'ASSIGN_ALL', payload: { itemId } }),
    [dispatch]
  )

  const clearItem = useCallback(
    (item: ReceiptItem) => {
      getAssignedPersonIds(item.id).forEach((pid) =>
        dispatch({ type: 'UNASSIGN_ITEM', payload: { itemId: item.id, personId: pid } })
      )
    },
    [dispatch, getAssignedPersonIds]
  )

  const splitAllEqually = useCallback(() => {
    if (!draft) return
    draft.receipt.items.forEach((item) =>
      dispatch({ type: 'ASSIGN_ALL', payload: { itemId: item.id } })
    )
  }, [draft, dispatch])

  // ── No session ──────────────────────────────────────────────────────────────
  if (!draft) {
    return (
      <div className={styles.page}>
        <div className={styles.emptyPage}>
          <span className={styles.emptyIcon}>👥</span>
          <h2>No active session</h2>
          <p>Start a new split from Home, or try with sample data.</p>
          <button
            className="btn btn-primary"
            onClick={() => dispatch({ type: 'LOAD_DRAFT', payload: SAMPLE_SESSION })}
          >
            Try sample receipt
          </button>
          <button className="btn btn-secondary" onClick={() => navigate('/')}>
            Go Home
          </button>
        </div>
      </div>
    )
  }

  const { receipt, people } = draft
  const totalItems    = receipt.items.length
  const assignedCount = receipt.items.filter((i) => getAssignedPersonIds(i.id).length > 0).length
  const allDone       = totalItems > 0 && assignedCount === totalItems
  const canContinue   = totalItems > 0 && people.length > 0

  return (
    <div className={styles.page}>

      {/* ── Header ─────────────────────────────────────────────────── */}
      <header className={styles.header}>
        <h1 className={styles.title}>Split Bill</h1>
        {receipt.merchant
          ? <p className={styles.merchant}>{receipt.merchant}</p>
          : <p className={styles.sub}>Add people, then assign each item.</p>
        }
      </header>

      {/* ── People roster ──────────────────────────────────────────── */}
      <section>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>People</h2>
          {people.length > 0 && (
            <span className={styles.sectionBadge}>{people.length}</span>
          )}
        </div>

        {people.length > 0 && (
          <div className={styles.peopleRoster}>
            {people.map((p) => (
              <PersonCard
                key={p.id}
                person={p}
                itemCount={personItemCounts.get(p.id) ?? 0}
                subtotal={personSubtotals.get(p.id) ?? 0}
                currency={receipt.currency}
                onRemove={() => dispatch({ type: 'REMOVE_PERSON', payload: p.id })}
              />
            ))}
          </div>
        )}

        <div className={styles.addPersonRow}>
          <input
            ref={inputRef}
            className="input-field"
            placeholder={people.length === 0 ? 'Type a name to get started…' : 'Add another person…'}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addPerson()}
          />
          <button
            className="btn btn-primary"
            onClick={addPerson}
            disabled={!newName.trim()}
          >
            Add
          </button>
        </div>
      </section>

      {/* ── Item assignment ─────────────────────────────────────────── */}
      {totalItems === 0 ? (
        <div className={`${styles.nudgeCard} card`}>
          <span>🧾</span>
          <div>
            <strong>No items yet.</strong>
            <p>Go back to Review to add items first.</p>
          </div>
          <button className="btn btn-secondary" onClick={() => navigate('/review')}>
            Review &rarr;
          </button>
        </div>
      ) : people.length === 0 ? (
        <div className={`${styles.nudgeCard} card`}>
          <span>👆</span>
          <p>Add at least one person above to start assigning items.</p>
        </div>
      ) : (
        <section>
          {/* Progress header */}
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>Assign Items</h2>
            <span className={`${styles.progressLabel} ${allDone ? styles.progressDone : ''}`}>
              {assignedCount}/{totalItems}
            </span>
          </div>

          {/* Progress bar */}
          <div className={styles.progressTrack} role="progressbar"
            aria-valuenow={assignedCount} aria-valuemin={0} aria-valuemax={totalItems}>
            <div
              className={`${styles.progressFill} ${allDone ? styles.progressFillDone : ''}`}
              style={{ width: `${totalItems ? (assignedCount / totalItems) * 100 : 0}%` }}
            />
          </div>

          {/* Item cards */}
          <ul className={styles.itemList}>
            {receipt.items.map((item) => {
              const assignedIds = getAssignedPersonIds(item.id)
              return (
                <AssignItemCard
                  key={item.id}
                  item={item}
                  assignedIds={assignedIds}
                  people={people}
                  currency={receipt.currency}
                  onToggle={toggleAssign}
                  onAssignAll={() => assignAll(item.id)}
                  onClear={() => clearItem(item)}
                />
              )
            })}
          </ul>

          {/* Bulk action */}
          {!allDone && (
            <button className="btn btn-secondary btn-full" onClick={splitAllEqually}>
              <EqualIcon /> Split everything equally
            </button>
          )}
        </section>
      )}

      {/* ── CTA ────────────────────────────────────────────────────── */}
      <button
        className="btn btn-primary btn-full"
        disabled={!canContinue}
        onClick={() => navigate('/result')}
      >
        See Results &rarr;
      </button>

    </div>
  )
}

// ── PersonCard ────────────────────────────────────────────────────────────────

interface PersonCardProps {
  person: Person
  itemCount: number
  subtotal: number
  currency: string
  onRemove: () => void
}

function PersonCard({ person, itemCount, subtotal, currency, onRemove }: PersonCardProps) {
  return (
    <div className={styles.personCard}>
      <button
        className={styles.personRemoveBtn}
        onClick={onRemove}
        aria-label={`Remove ${person.name}`}
      >
        ×
      </button>
      <div className={styles.personAvatar} style={{ background: person.color }}>
        {person.name.charAt(0).toUpperCase()}
      </div>
      <span className={styles.personCardName}>{person.name}</span>
      <span className={styles.personCardSub}>
        {itemCount > 0 ? formatCurrency(subtotal, currency) : '—'}
      </span>
    </div>
  )
}

// ── AssignItemCard ────────────────────────────────────────────────────────────

interface AssignItemCardProps {
  item: ReceiptItem
  assignedIds: string[]
  people: Person[]
  currency: string
  onToggle: (itemId: string, personId: string, assigned: boolean) => void
  onAssignAll: () => void
  onClear: () => void
}

function AssignItemCard({
  item, assignedIds, people, currency, onToggle, onAssignAll, onClear,
}: AssignItemCardProps) {
  const isAssigned    = assignedIds.length > 0
  const allAssigned   = assignedIds.length === people.length && people.length > 0
  const isShared      = assignedIds.length > 1
  const perPerson     = isShared ? item.totalPrice / assignedIds.length : null

  const cardMod = allAssigned ? styles.cardAll
    : isAssigned ? styles.cardPartial
    : styles.cardUnassigned

  return (
    <li className={`${styles.itemCard} ${cardMod} card`}>
      {/* Item info row */}
      <div className={styles.itemRow}>
        <div className={styles.itemInfo}>
          <span className={styles.itemName}>{item.name || <em>Unnamed</em>}</span>
          {item.quantity > 1 && (
            <span className={styles.itemQtyHint}>
              {item.quantity} × {formatCurrency(item.unitPrice, currency)}
            </span>
          )}
        </div>
        <span className={styles.itemPrice}>{formatCurrency(item.totalPrice, currency)}</span>
      </div>

      {/* Person selector chips */}
      <div className={styles.chipRow}>
        {people.map((person) => {
          const selected = assignedIds.includes(person.id)
          return (
            <PersonToggleChip
              key={person.id}
              person={person}
              selected={selected}
              onToggle={() => onToggle(item.id, person.id, selected)}
            />
          )
        })}

        {/* All / Clear action */}
        {!isAssigned
          ? <button className={styles.actionChip} onClick={onAssignAll}>All</button>
          : <button className={`${styles.actionChip} ${styles.clearChip}`} onClick={onClear}>Clear</button>
        }
      </div>

      {/* Shared note */}
      {isShared && perPerson !== null && (
        <div className={styles.sharedNote}>
          <ShareIcon />
          Shared ÷{assignedIds.length} &mdash; {formatCurrency(perPerson, currency)} per person
        </div>
      )}

      {/* Unassigned label */}
      {!isAssigned && (
        <div className={styles.unassignedLabel}>
          <DotIcon /> Not assigned yet
        </div>
      )}
    </li>
  )
}

// ── PersonToggleChip ──────────────────────────────────────────────────────────

function PersonToggleChip({
  person, selected, onToggle,
}: { person: Person; selected: boolean; onToggle: () => void }) {
  return (
    <button
      className={`${styles.personChip} ${selected ? styles.personChipOn : ''}`}
      style={selected ? {
        background: person.color + '18',
        borderColor: person.color,
        color:       person.color,
      } : undefined}
      onClick={onToggle}
      aria-pressed={selected}
    >
      {selected && <CheckIcon />}
      {person.name}
    </button>
  )
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function CheckIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  )
}

function ShareIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="18" r="3"/><circle cx="16" cy="6" r="3"/>
      <line x1="18.5" y1="8.5" x2="5.5" y2="15.5"/>
    </svg>
  )
}

function DotIcon() {
  return (
    <svg width="8" height="8" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10" fill="currentColor"/>
    </svg>
  )
}

function EqualIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <line x1="5" y1="9" x2="19" y2="9"/><line x1="5" y1="15" x2="19" y2="15"/>
    </svg>
  )
}
