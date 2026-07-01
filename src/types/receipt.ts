// ── Charges ───────────────────────────────────────────────────────────────────

/**
 * The kinds of additional line items that appear at the bottom of a receipt.
 * Discounts carry a negative amount; rounding may be positive or negative.
 */
export type ChargeType =
  | 'gst'             // Goods and Services Tax
  | 'service_charge'  // Restaurant service charge
  | 'discount'        // Promotional or manual discount (negative amount)
  | 'rounding'        // Cash-rounding adjustment (positive or negative)
  | 'other'

/**
 * How a charge is distributed across the people in a split.
 * - proportional: each person pays charge × (their subtotal / bill subtotal)
 * - equal: charge is split evenly regardless of what each person ordered
 * - none: the charge is shown but not attributed to anyone (e.g. absorbed)
 */
export type ChargeSplitStrategy = 'proportional' | 'equal' | 'none'

export interface Charge {
  id: string
  type: ChargeType
  label: string               // Display label, e.g. "GST (9%)"
  amount: number              // Dollar amount; negative for discounts
  rate?: number               // Decimal rate if applicable, e.g. 0.09 for 9%
  splitStrategy: ChargeSplitStrategy
}

// ── Receipt items ─────────────────────────────────────────────────────────────

export interface ReceiptItem {
  id: string
  name: string
  unitPrice: number           // Price for a single unit
  quantity: number
  totalPrice: number          // unitPrice × quantity (stored explicitly for OCR edge cases)
  notes?: string              // e.g. "no chilli", "extra rice"
}

// ── Receipt ───────────────────────────────────────────────────────────────────

/**
 * The raw data captured from the physical receipt.
 * Everything here is what the restaurant printed — no split logic.
 */
export interface Receipt {
  merchant?: string           // Restaurant / shop name
  date?: string               // ISO date string if detected on receipt
  rawImageDataUrl?: string    // Data URL kept on-device; never uploaded
  rawText?: string            // Raw OCR output for re-processing
  items: ReceiptItem[]
  charges: Charge[]           // GST, service charge, discounts, rounding, etc.
  subtotal: number            // Sum of all item totalPrices
  total: number               // subtotal + all charge amounts
  currency: string            // ISO 4217 code, e.g. 'SGD', 'USD'
}
