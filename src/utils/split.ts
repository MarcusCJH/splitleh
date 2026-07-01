export { calculateSplit } from './calculateSplit'

// ── Formatting ────────────────────────────────────────────────────────────────

export function formatCurrency(amount: number, currency = 'SGD'): string {
  return new Intl.NumberFormat('en-SG', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

/** Recompute Receipt.subtotal and Receipt.total from items + charges. */
export function recalcReceiptTotals<T extends { items: { totalPrice: number }[]; charges: { amount: number }[] }>(
  receipt: T
): T & { subtotal: number; total: number } {
  const subtotal = receipt.items.reduce((s, i) => s + i.totalPrice, 0)
  const chargesTotal = receipt.charges.reduce((s, c) => s + c.amount, 0)
  return { ...receipt, subtotal, total: subtotal + chargesTotal }
}
