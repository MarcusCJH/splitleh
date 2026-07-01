import { useState, useCallback, type FocusEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useReceipt } from '../../store/ReceiptContext'
import type { Action } from '../../store/ReceiptContext'
import { formatCurrency } from '../../utils/split'
import type { ReceiptItem, Charge, ChargeType, Receipt } from '../../types'
import styles from './Review.module.css'

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Review() {
  const navigate = useNavigate()
  const { draft, dispatch, newItem } = useReceipt()
  const [editingId, setEditingId] = useState<string | null>(null)

  const addItem = useCallback(() => {
    const item = newItem()
    dispatch({ type: 'ADD_ITEM', payload: item })
    setEditingId(item.id)
  }, [dispatch, newItem])

  if (!draft) {
    return (
      <div className={styles.page}>
        <div className={styles.empty}>
          <span>🧾</span>
          <p>No active session.</p>
          <button className="btn btn-primary" onClick={() => navigate('/')}>Go Home</button>
        </div>
      </div>
    )
  }

  const { receipt } = draft

  return (
    <div className={styles.page}>

      {/* ── Header ─────────────────────────────────────────────────── */}
      <header className={styles.header}>
        <h1 className={styles.title}>Review Items</h1>
        <MerchantInput
          value={receipt.merchant ?? ''}
          onCommit={(v) =>
            dispatch({ type: 'SET_RECEIPT_META', payload: { merchant: v || undefined } })
          }
        />
      </header>

      {/* ── Items ──────────────────────────────────────────────────── */}
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>Items</h2>
          {receipt.items.length > 0 && (
            <span className={styles.sectionBadge}>{receipt.items.length}</span>
          )}
        </div>

        {receipt.items.length === 0 ? (
          <div className={`${styles.emptyItems} card`}>
            <span className={styles.emptyIcon}>🛒</span>
            <p>No items yet.</p>
            <p className={styles.emptyHint}>Tap "Add Item" to start building the receipt.</p>
          </div>
        ) : (
          <ul className={styles.itemList}>
            {receipt.items.map((item) => (
              <ItemCard
                key={item.id}
                item={item}
                isEditing={editingId === item.id}
                currency={receipt.currency}
                onTap={() => setEditingId(item.id)}
                onSave={(updated) => {
                  dispatch({ type: 'UPDATE_ITEM', payload: updated })
                  setEditingId(null)
                }}
                onDelete={() => {
                  dispatch({ type: 'DELETE_ITEM', payload: item.id })
                  setEditingId(null)
                }}
                onCancel={() => setEditingId(null)}
              />
            ))}
          </ul>
        )}

        <button className={`btn btn-secondary btn-full ${styles.addItemBtn}`} onClick={addItem}>
          <PlusIcon /> Add Item
        </button>
      </section>

      {/* ── Charges ────────────────────────────────────────────────── */}
      <ChargesPanel
        charges={receipt.charges}
        subtotal={receipt.subtotal}
        dispatch={dispatch}
      />

      {/* ── Total summary ──────────────────────────────────────────── */}
      <TotalSummary receipt={receipt} />

      {/* ── CTA ────────────────────────────────────────────────────── */}
      <div className={styles.stickyCta}>
        <button
          className="btn btn-primary btn-full"
          disabled={receipt.items.length === 0}
          onClick={() => navigate('/split')}
        >
          Continue to Split &rarr;
        </button>
      </div>

    </div>
  )
}

// ── MerchantInput ─────────────────────────────────────────────────────────────

function MerchantInput({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  return (
    <input
      type="text"
      className={styles.merchantInput}
      placeholder="Restaurant / shop name (optional)"
      defaultValue={value}
      onBlur={(e) => onCommit(e.target.value.trim())}
    />
  )
}

// ── ItemCard ──────────────────────────────────────────────────────────────────

interface ItemCardProps {
  item: ReceiptItem
  isEditing: boolean
  currency: string
  onTap: () => void
  onSave: (item: ReceiptItem) => void
  onDelete: () => void
  onCancel: () => void
}

function ItemCard({ item, isEditing, currency, onTap, onSave, onDelete, onCancel }: ItemCardProps) {
  if (isEditing) {
    return (
      <li className={`${styles.itemCard} ${styles.itemCardEditing} card`}>
        <EditForm item={item} currency={currency} onSave={onSave} onDelete={onDelete} onCancel={onCancel} />
      </li>
    )
  }

  return (
    <li
      className={`${styles.itemCard} card`}
      onClick={onTap}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onTap()}
    >
      <div className={styles.itemBody}>
        <div className={styles.itemLeft}>
          <span className={styles.itemName}>
            {item.name || <em className={styles.unnamed}>Unnamed item</em>}
          </span>
          {item.notes && <span className={styles.itemNotes}>{item.notes}</span>}
        </div>
        <div className={styles.itemRight}>
          {item.quantity > 1 && (
            <span className={styles.itemQty}>
              {item.quantity} &times; {formatCurrency(item.unitPrice, currency)}
            </span>
          )}
          <span className={styles.itemTotal}>{formatCurrency(item.totalPrice, currency)}</span>
        </div>
      </div>
      <ChevronIcon />
    </li>
  )
}

// ── EditForm ──────────────────────────────────────────────────────────────────

interface EditFormProps {
  item: ReceiptItem
  currency: string
  onSave: (item: ReceiptItem) => void
  onDelete: () => void
  onCancel: () => void
}

function EditForm({ item, currency, onSave, onDelete, onCancel }: EditFormProps) {
  const [name,  setName]  = useState(item.name)
  const [price, setPrice] = useState(item.unitPrice > 0 ? String(item.unitPrice) : '')
  const [qty,   setQty]   = useState(String(item.quantity))
  const [notes, setNotes] = useState(item.notes ?? '')

  const unitPrice    = parseFloat(price) || 0
  const quantity     = Math.max(1, parseInt(qty) || 1)
  const computedTotal = unitPrice * quantity

  const save = useCallback(() => {
    onSave({
      ...item,
      name:       name.trim() || 'Item',
      unitPrice,
      quantity,
      totalPrice: computedTotal,
      notes:      notes.trim() || undefined,
    })
  }, [item, name, unitPrice, quantity, computedTotal, notes, onSave])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') save()
    if (e.key === 'Escape') onCancel()
  }

  return (
    <div className={styles.editForm}>
      {/* Name */}
      <input
        autoFocus
        className="input-field"
        placeholder="Item name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={handleKeyDown}
      />

      {/* Price + Qty row */}
      <div className={styles.editGrid}>
        <div className={styles.editField}>
          <label className={styles.editLabel}>Unit price</label>
          <div className={styles.currencyWrap}>
            <span className={styles.currencyPrefix}>$</span>
            <input
              type="text"
              inputMode="decimal"
              className={`input-field ${styles.currencyInput}`}
              placeholder="0.00"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              onKeyDown={handleKeyDown}
            />
          </div>
        </div>
        <div className={styles.editField}>
          <label className={styles.editLabel}>Qty</label>
          <input
            type="text"
            inputMode="numeric"
            className="input-field"
            placeholder="1"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            onKeyDown={handleKeyDown}
          />
        </div>
      </div>

      {/* Live total preview */}
      {computedTotal > 0 && (
        <div className={styles.editPreview}>
          <span>
            {quantity} &times; {formatCurrency(unitPrice, currency)}
          </span>
          <span className={styles.editPreviewTotal}>
            = {formatCurrency(computedTotal, currency)}
          </span>
        </div>
      )}

      {/* Notes */}
      <input
        className="input-field"
        placeholder="Notes — e.g. no chilli, extra rice (optional)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        onKeyDown={handleKeyDown}
      />

      {/* Actions */}
      <div className={styles.editActions}>
        <button className="btn btn-danger" onClick={onDelete}>
          <TrashIcon /> Delete
        </button>
        <div className={styles.editRight}>
          <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary" onClick={save}>Save</button>
        </div>
      </div>
    </div>
  )
}

// ── ChargesPanel ──────────────────────────────────────────────────────────────

const EXTRA_CHARGE_DEFAULTS: Record<'discount' | 'rounding', Charge> = {
  discount: {
    id: 'discount',
    type: 'discount',
    label: 'Discount',
    amount: 0,
    splitStrategy: 'proportional',
  },
  rounding: {
    id: 'rounding',
    type: 'rounding',
    label: 'Rounding',
    amount: 0,
    splitStrategy: 'none',
  },
}

interface ChargesPanelProps {
  charges: Charge[]
  subtotal: number
  dispatch: React.Dispatch<Action>
}

function ChargesPanel({ charges, subtotal, dispatch }: ChargesPanelProps) {
  const hasDiscount = charges.some((c) => c.type === 'discount')
  const hasRounding = charges.some((c) => c.type === 'rounding')

  const addCharge = (key: 'discount' | 'rounding') =>
    dispatch({ type: 'UPSERT_CHARGE', payload: { ...EXTRA_CHARGE_DEFAULTS[key] } })

  return (
    <section className={`card ${styles.chargesPanel}`}>
      <h2 className={styles.chargesPanelTitle}>Charges</h2>

      {charges.map((charge) => (
        <ChargeRow
          key={`${charge.id}-${charge.amount}`}
          charge={charge}
          subtotal={subtotal}
          onUpdate={(c) => dispatch({ type: 'UPSERT_CHARGE', payload: c })}
          onRemove={(id) => dispatch({ type: 'REMOVE_CHARGE', payload: id })}
        />
      ))}

      {(!hasDiscount || !hasRounding) && (
        <div className={styles.addCharges}>
          <span className={styles.addChargesLabel}>Add:</span>
          {!hasDiscount && (
            <button className={styles.addChargeBtn} onClick={() => addCharge('discount')}>
              <PlusIcon /> Discount
            </button>
          )}
          {!hasRounding && (
            <button className={styles.addChargeBtn} onClick={() => addCharge('rounding')}>
              <PlusIcon /> Rounding
            </button>
          )}
        </div>
      )}
    </section>
  )
}

// ── ChargeRow ─────────────────────────────────────────────────────────────────

const CHARGE_META: Record<ChargeType, { icon: string; removable: boolean }> = {
  gst:            { icon: '🏛', removable: false },
  service_charge: { icon: '🛎', removable: false },
  discount:       { icon: '🏷', removable: true  },
  rounding:       { icon: '≈',  removable: true  },
  other:          { icon: '•',  removable: true  },
}

interface ChargeRowProps {
  charge: Charge
  subtotal: number
  onUpdate: (c: Charge) => void
  onRemove: (id: string) => void
}

function ChargeRow({ charge, subtotal, onUpdate, onRemove }: ChargeRowProps) {
  const meta       = CHARGE_META[charge.type]
  const isDiscount = charge.type === 'discount'
  const displayAbs = Math.abs(charge.amount)

  const commit = (e: FocusEvent<HTMLInputElement>) => {
    const raw = parseFloat(e.target.value) || 0
    onUpdate({ ...charge, amount: isDiscount ? -Math.abs(raw) : raw })
  }

  const autoCompute = () => {
    if (!charge.rate) return
    const computed = Math.round(subtotal * charge.rate * 100) / 100
    onUpdate({ ...charge, amount: computed })
  }

  return (
    <div className={styles.chargeRow}>
      <div className={styles.chargeHeader}>
        <span className={styles.chargeIcon}>{meta.icon}</span>
        <span className={styles.chargeLabelText}>{charge.label}</span>
        <div className={styles.chargeBtns}>
          {charge.rate && (
            <button className={styles.autoBtn} onClick={autoCompute}>
              Auto {Math.round(charge.rate * 100)}%
            </button>
          )}
          {meta.removable && (
            <button
              className={styles.removeChargeBtn}
              onClick={() => onRemove(charge.id)}
              aria-label={`Remove ${charge.label}`}
            >
              ×
            </button>
          )}
        </div>
      </div>
      <div className={styles.chargeInputRow}>
        {isDiscount && <span className={styles.negSign}>−</span>}
        <span className={styles.currencySign}>$</span>
        <input
          type="text"
          inputMode="decimal"
          className={`input-field ${styles.chargeInput}`}
          placeholder="0.00"
          defaultValue={displayAbs > 0 ? String(displayAbs) : ''}
          onBlur={commit}
        />
      </div>
    </div>
  )
}

// ── TotalSummary ──────────────────────────────────────────────────────────────

function TotalSummary({ receipt }: { receipt: Receipt }) {
  const { items, charges, subtotal, total, currency } = receipt
  const visibleCharges = charges.filter((c) => c.amount !== 0)

  return (
    <div className={`card ${styles.totalCard}`}>
      <div className={styles.totalRow}>
        <span>
          Items
          {items.length > 0 && (
            <span className={styles.totalCount}> ({items.length})</span>
          )}
        </span>
        <span>{formatCurrency(subtotal, currency)}</span>
      </div>

      {visibleCharges.map((c) => (
        <div key={c.id} className={styles.totalRow}>
          <span>{c.label}</span>
          <span className={c.amount < 0 ? styles.totalNegative : undefined}>
            {c.amount < 0 ? '−' : ''}{formatCurrency(Math.abs(c.amount), currency)}
          </span>
        </div>
      ))}

      <div className={styles.totalDivider} />

      <div className={`${styles.totalRow} ${styles.totalFinal}`}>
        <span>Total</span>
        <span>{formatCurrency(total, currency)}</span>
      </div>
    </div>
  )
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
    </svg>
  )
}
function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6"/>
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
      <path d="M9 6V4h6v2"/>
    </svg>
  )
}
function ChevronIcon() {
  return (
    <svg className={styles.chevron} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6"/>
    </svg>
  )
}

