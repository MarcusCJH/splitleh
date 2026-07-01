import { createContext, useContext, useReducer, useEffect, type ReactNode } from 'react'
import type { SplitSession, ReceiptItem, Charge, Receipt } from '../types'
import type { Person } from '../types'
import { saveDraft, loadDraft, clearDraft, generateId } from '../utils/storage'
import { recalcReceiptTotals } from '../utils/split'

const PERSON_COLORS = [
  '#6C63FF', '#FF6584', '#43C6AC', '#F7971E',
  '#4ECDC4', '#FF6B6B', '#A18AFF', '#FEB17E',
]

/** Pre-seeded charges on every new session (Singapore defaults). */
const DEFAULT_CHARGES: Charge[] = [
  {
    id: 'svc',
    type: 'service_charge',
    label: 'Service Charge (10%)',
    amount: 0,
    rate: 0.1,
    splitStrategy: 'proportional',
  },
  {
    id: 'gst',
    type: 'gst',
    label: 'GST (9%)',
    amount: 0,
    rate: 0.09,
    splitStrategy: 'proportional',
  },
]

// ── State ─────────────────────────────────────────────────────────────────────

interface State {
  draft: SplitSession | null
}

// ── Actions ───────────────────────────────────────────────────────────────────

export type Action =
  | { type: 'NEW_SESSION';      payload: { title: string } }
  | { type: 'LOAD_DRAFT';       payload: SplitSession }
  | { type: 'SET_RECEIPT_META'; payload: Partial<Pick<Receipt, 'merchant' | 'date' | 'rawImageDataUrl' | 'rawText' | 'currency'>> }
  | { type: 'SET_ITEMS';        payload: ReceiptItem[] }
  | { type: 'ADD_ITEM';         payload: ReceiptItem }
  | { type: 'UPDATE_ITEM';      payload: ReceiptItem }
  | { type: 'DELETE_ITEM';      payload: string }
  | { type: 'UPSERT_CHARGE';    payload: Charge }
  | { type: 'REMOVE_CHARGE';    payload: string }
  | { type: 'ADD_PERSON';       payload: { name: string } }
  | { type: 'REMOVE_PERSON';    payload: string }
  | { type: 'ASSIGN_ITEM';      payload: { itemId: string; personId: string } }
  | { type: 'UNASSIGN_ITEM';    payload: { itemId: string; personId: string } }
  | { type: 'ASSIGN_ALL';       payload: { itemId: string } }
  | { type: 'SET_SPLIT_MODE';   payload: SplitSession['splitMode'] }
  | { type: 'CLEAR_DRAFT' }

// ── Reducer ───────────────────────────────────────────────────────────────────

function withUpdated(session: SplitSession, changes: Partial<SplitSession>): State {
  return { draft: { ...session, ...changes, updatedAt: Date.now() } }
}

function withReceipt(session: SplitSession, receipt: Receipt): State {
  return withUpdated(session, { receipt: recalcReceiptTotals(receipt) })
}

function reducer(state: State, action: Action): State {
  const s = state.draft

  switch (action.type) {
    case 'NEW_SESSION':
      return {
        draft: {
          id: generateId(),
          title: action.payload.title,
          receipt: {
            items: [],
            charges: DEFAULT_CHARGES,
            subtotal: 0,
            total: 0,
            currency: 'SGD',
          },
          people: [],
          assignments: [],
          splitMode: 'itemized',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      }

    case 'LOAD_DRAFT':
      return { draft: action.payload }

    case 'SET_RECEIPT_META':
      if (!s) return state
      return withUpdated(s, { receipt: { ...s.receipt, ...action.payload } })

    case 'SET_ITEMS':
      if (!s) return state
      return withReceipt(s, { ...s.receipt, items: action.payload })

    case 'ADD_ITEM':
      if (!s) return state
      return withReceipt(s, { ...s.receipt, items: [...s.receipt.items, action.payload] })

    case 'UPDATE_ITEM':
      if (!s) return state
      return withReceipt(s, {
        ...s.receipt,
        items: s.receipt.items.map((i) => (i.id === action.payload.id ? action.payload : i)),
      })

    case 'DELETE_ITEM':
      if (!s) return state
      return withUpdated(
        { ...s, assignments: s.assignments.filter((a) => a.itemId !== action.payload) },
        { receipt: recalcReceiptTotals({ ...s.receipt, items: s.receipt.items.filter((i) => i.id !== action.payload) }) }
      )

    case 'UPSERT_CHARGE': {
      if (!s) return state
      const exists = s.receipt.charges.some((c) => c.id === action.payload.id)
      const charges = exists
        ? s.receipt.charges.map((c) => (c.id === action.payload.id ? action.payload : c))
        : [...s.receipt.charges, action.payload]
      return withReceipt(s, { ...s.receipt, charges })
    }

    case 'REMOVE_CHARGE':
      if (!s) return state
      return withReceipt(s, {
        ...s.receipt,
        charges: s.receipt.charges.filter((c) => c.id !== action.payload),
      })

    case 'ADD_PERSON': {
      if (!s) return state
      const colorIdx = s.people.length % PERSON_COLORS.length
      const newPerson: Person = {
        id: generateId(),
        name: action.payload.name,
        color: PERSON_COLORS[colorIdx],
      }
      return withUpdated(s, { people: [...s.people, newPerson] })
    }

    case 'REMOVE_PERSON': {
      if (!s) return state
      const removedId = action.payload
      return withUpdated(s, {
        people: s.people.filter((p) => p.id !== removedId),
        assignments: s.assignments
          .map((a) => ({ ...a, personIds: a.personIds.filter((id) => id !== removedId) }))
          .filter((a) => a.personIds.length > 0),
      })
    }

    case 'ASSIGN_ITEM': {
      if (!s) return state
      const { itemId, personId } = action.payload
      const existing = s.assignments.find((a) => a.itemId === itemId)
      if (existing?.personIds.includes(personId)) return state

      const assignments = existing
        ? s.assignments.map((a) =>
            a.itemId === itemId ? { ...a, personIds: [...a.personIds, personId] } : a
          )
        : [...s.assignments, { itemId, personIds: [personId] }]
      return withUpdated(s, { assignments })
    }

    case 'UNASSIGN_ITEM': {
      if (!s) return state
      const { itemId, personId } = action.payload
      return withUpdated(s, {
        assignments: s.assignments
          .map((a) =>
            a.itemId === itemId
              ? { ...a, personIds: a.personIds.filter((id) => id !== personId) }
              : a
          )
          .filter((a) => a.personIds.length > 0),
      })
    }

    case 'ASSIGN_ALL': {
      if (!s) return state
      const { itemId } = action.payload
      const allPersonIds = s.people.map((p) => p.id)
      const existing = s.assignments.find((a) => a.itemId === itemId)
      const assignments = existing
        ? s.assignments.map((a) => (a.itemId === itemId ? { ...a, personIds: allPersonIds } : a))
        : [...s.assignments, { itemId, personIds: allPersonIds }]
      return withUpdated(s, { assignments })
    }

    case 'SET_SPLIT_MODE':
      if (!s) return state
      return withUpdated(s, { splitMode: action.payload })

    case 'CLEAR_DRAFT':
      return { draft: null }

    default:
      return state
  }
}

// ── Context ───────────────────────────────────────────────────────────────────

interface ReceiptContextValue {
  draft: SplitSession | null
  dispatch: React.Dispatch<Action>
  newItem: () => ReceiptItem
  getAssignedPersonIds: (itemId: string) => string[]
}

const ReceiptContext = createContext<ReceiptContextValue | null>(null)

export function ReceiptProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, { draft: null }, () => ({
    draft: loadDraft(),
  }))

  useEffect(() => {
    if (state.draft) {
      saveDraft(state.draft)
    } else {
      clearDraft()
    }
  }, [state.draft])

  function newItem(): ReceiptItem {
    return { id: generateId(), name: '', unitPrice: 0, quantity: 1, totalPrice: 0 }
  }

  function getAssignedPersonIds(itemId: string): string[] {
    return state.draft?.assignments.find((a) => a.itemId === itemId)?.personIds ?? []
  }

  return (
    <ReceiptContext.Provider value={{ draft: state.draft, dispatch, newItem, getAssignedPersonIds }}>
      {children}
    </ReceiptContext.Provider>
  )
}

export function useReceipt() {
  const ctx = useContext(ReceiptContext)
  if (!ctx) throw new Error('useReceipt must be used within ReceiptProvider')
  return ctx
}
