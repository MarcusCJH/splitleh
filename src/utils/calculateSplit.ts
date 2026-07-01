import type {
  SplitSession,
  SplitResult,
  PersonResult,
  ItemShare,
  ChargeShare,
  ReceiptItem,
  Charge,
} from '../types'

// ── Integer-cent arithmetic ───────────────────────────────────────────────────
//
// All distribution is done in integer cents to avoid floating-point drift.
// `toCents` converts a dollar amount to the nearest integer cent.
// Results are divided back to dollars only when assembling the final output.

function toCents(dollars: number): number {
  return Math.round(dollars * 100)
}

/**
 * Distributes `totalCents` among recipients proportionally to `weights` using
 * the largest-remainder method. Guarantees sum(result) === totalCents exactly.
 *
 * Works correctly for negative totals (discounts): floors toward −∞ and the
 * remainder brings totals back up by 1 cent for the highest-fractional slots.
 *
 * Falls back to equal distribution when weightSum is 0 (e.g. nobody has items).
 */
export function distributeInCents(totalCents: number, weights: number[]): number[] {
  const n = weights.length
  if (n === 0) return []
  if (n === 1) return [totalCents]

  const weightSum = weights.reduce((s, w) => s + w, 0)

  // Equal fallback
  if (weightSum === 0) {
    const base = Math.floor(totalCents / n)
    const rem = totalCents - base * n
    return weights.map((_, i) => base + (i < rem ? 1 : 0))
  }

  const exact = weights.map((w) => (totalCents * w) / weightSum)
  const floors = exact.map(Math.floor)
  const remainder = totalCents - floors.reduce((s, v) => s + v, 0)

  // Hand the remaining cents to the slots with the largest fractional parts
  const ranked = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i)   // stable: ties resolved by index

  const result = [...floors]
  for (let k = 0; k < Math.abs(remainder); k++) {
    result[ranked[k].i] += Math.sign(remainder) === 0 ? 0 : 1
  }

  return result
}

// ── Public entry point ────────────────────────────────────────────────────────

export function calculateSplit(session: SplitSession): SplitResult {
  const { receipt, people, assignments, splitMode } = session

  const assignedItemIds = new Set(
    assignments.filter((a) => a.personIds.length > 0).map((a) => a.itemId)
  )
  const unassignedItems: ReceiptItem[] = receipt.items.filter(
    (item) => !assignedItemIds.has(item.id)
  )

  if (people.length === 0) {
    return { personResults: [], unassignedItems, assignedTotal: 0, receiptTotal: receipt.total }
  }

  return splitMode === 'equal'
    ? equalSplit(session, unassignedItems)
    : itemizedSplit(session, unassignedItems)
}

// ── Equal split ───────────────────────────────────────────────────────────────

function equalSplit(session: SplitSession, unassignedItems: ReceiptItem[]): SplitResult {
  const { receipt, people } = session
  const n = people.length
  const evenWeights = Array<number>(n).fill(1)

  const subtotalCentsPerPerson = distributeInCents(toCents(receipt.subtotal), evenWeights)

  const chargeDistributionsCents = receipt.charges.map((charge) =>
    distributeInCents(toCents(charge.amount), evenWeights)
  )

  const personResults: PersonResult[] = people.map((person, i) => {
    const chargeShares: ChargeShare[] = receipt.charges.map((charge, ci) => ({
      charge,
      amount: chargeDistributionsCents[ci][i] / 100,
    }))
    const chargesTotalCents = chargeDistributionsCents.reduce((s, d) => s + d[i], 0)
    const subtotalCents = subtotalCentsPerPerson[i]

    return {
      person,
      itemShares: [],
      chargeShares,
      subtotal: subtotalCents / 100,
      chargesTotal: chargesTotalCents / 100,
      total: (subtotalCents + chargesTotalCents) / 100,
    }
  })

  return {
    personResults,
    unassignedItems,
    assignedTotal: receipt.total,
    receiptTotal: receipt.total,
  }
}

// ── Itemized split ────────────────────────────────────────────────────────────

function itemizedSplit(session: SplitSession, unassignedItems: ReceiptItem[]): SplitResult {
  const { receipt, people, assignments } = session

  // ── 1. Distribute each item's price among its assigned people ─────────────

  type ItemShareCents = { item: ReceiptItem; amountCents: number; outOf: number }
  type ChargeShareCents = { charge: Charge; amountCents: number }

  const itemSharesMap = new Map<string, ItemShareCents[]>(people.map((p) => [p.id, []]))
  const subtotalCentsMap = new Map<string, number>(people.map((p) => [p.id, 0]))

  for (const assignment of assignments) {
    if (assignment.personIds.length === 0) continue
    const item = receipt.items.find((i) => i.id === assignment.itemId)
    if (!item) continue

    const n = assignment.personIds.length
    const shares = distributeInCents(toCents(item.totalPrice), Array<number>(n).fill(1))

    assignment.personIds.forEach((personId, idx) => {
      itemSharesMap.get(personId)?.push({ item, amountCents: shares[idx], outOf: n })
      subtotalCentsMap.set(personId, (subtotalCentsMap.get(personId) ?? 0) + shares[idx])
    })
  }

  // ── 2. Distribute charges ─────────────────────────────────────────────────
  //
  // - proportional: weight = person's item subtotal in cents
  // - equal: weight = 1 for all
  // - none: skip entirely (e.g. rounding adjustments printed on the receipt)

  const subtotalWeights = people.map((p) => subtotalCentsMap.get(p.id) ?? 0)
  const evenWeights = Array<number>(people.length).fill(1)

  const chargeSharesMap = new Map<string, ChargeShareCents[]>(people.map((p) => [p.id, []]))

  for (const charge of receipt.charges) {
    if (charge.splitStrategy === 'none') continue

    const weights = charge.splitStrategy === 'equal' ? evenWeights : subtotalWeights
    const amounts = distributeInCents(toCents(charge.amount), weights)

    people.forEach((person, i) => {
      chargeSharesMap.get(person.id)?.push({ charge, amountCents: amounts[i] })
    })
  }

  // ── 3. Assemble PersonResult[] ────────────────────────────────────────────

  const personResults: PersonResult[] = people.map((person) => {
    const rawItems = itemSharesMap.get(person.id) ?? []
    const rawCharges = chargeSharesMap.get(person.id) ?? []

    const itemShares: ItemShare[] = rawItems.map((s) => ({
      item: s.item,
      amount: s.amountCents / 100,
      outOf: s.outOf,
    }))

    const chargeShares: ChargeShare[] = rawCharges.map((s) => ({
      charge: s.charge,
      amount: s.amountCents / 100,
    }))

    const subtotalCents = rawItems.reduce((s, is) => s + is.amountCents, 0)
    const chargesTotalCents = rawCharges.reduce((s, cs) => s + cs.amountCents, 0)

    return {
      person,
      itemShares,
      chargeShares,
      subtotal: subtotalCents / 100,
      chargesTotal: chargesTotalCents / 100,
      total: (subtotalCents + chargesTotalCents) / 100,
    }
  })

  // assignedTotal is the sum of all person totals (excludes unassigned items)
  const assignedTotalCents = personResults.reduce(
    (s, r) => s + toCents(r.total),
    0
  )

  return {
    personResults,
    unassignedItems,
    assignedTotal: assignedTotalCents / 100,
    receiptTotal: receipt.total,
  }
}
