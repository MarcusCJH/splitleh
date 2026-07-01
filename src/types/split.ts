import type { Receipt, ReceiptItem, Charge } from './receipt'
import type { Person } from './people'

// ── Session ───────────────────────────────────────────────────────────────────

/**
 * How the bill is divided between people.
 * - itemized: each person pays for their assigned items + proportional charges
 * - equal:    the total is split evenly regardless of who ordered what
 */
export type SplitMode = 'itemized' | 'equal'

/**
 * Records which people share a single receipt item.
 * Each listed person pays an equal share: item.totalPrice / personIds.length
 */
export interface ItemAssignment {
  itemId: string
  personIds: string[]   // IDs of everyone sharing this item
}

/**
 * The full working session — receipt data plus split configuration.
 * This is what gets persisted to localStorage.
 */
export interface SplitSession {
  id: string
  title: string
  receipt: Receipt
  people: Person[]
  assignments: ItemAssignment[]
  splitMode: SplitMode
  createdAt: number
  updatedAt: number
}

// ── Computed results ──────────────────────────────────────────────────────────
// These are derived at display time; never stored.

/** One person's share of a single receipt item. */
export interface ItemShare {
  item: ReceiptItem
  amount: number      // How much this person pays for the item
  outOf: number       // Total number of people sharing it
}

/** One person's share of a receipt charge (GST, service charge, etc.). */
export interface ChargeShare {
  charge: Charge
  amount: number
}

/** Full cost breakdown for one person. */
export interface PersonResult {
  person: Person
  itemShares: ItemShare[]
  chargeShares: ChargeShare[]
  subtotal: number        // Sum of itemShare amounts
  chargesTotal: number    // Sum of chargeShare amounts
  total: number           // subtotal + chargesTotal
}

/** The computed output of a split calculation. */
export interface SplitResult {
  personResults: PersonResult[]
  unassignedItems: ReceiptItem[]  // Items not in any assignment — shown as a warning
  assignedTotal: number           // Sum of all personResult totals
  receiptTotal: number            // session.receipt.total (for reconciliation)
}
