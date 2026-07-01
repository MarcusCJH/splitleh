import { describe, it, expect } from 'vitest'
import { calculateSplit, distributeInCents } from '../calculateSplit'
import type { SplitSession, Charge, ReceiptItem, Person } from '../../types'

// ── Helpers ───────────────────────────────────────────────────────────────────

function item(id: string, name: string, unitPrice: number, quantity = 1): ReceiptItem {
  return { id, name, unitPrice, quantity, totalPrice: unitPrice * quantity }
}

function person(id: string, name: string): Person {
  return { id, name, color: '#000000' }
}

function charge(
  id: string,
  type: Charge['type'],
  amount: number,
  strategy: Charge['splitStrategy'] = 'proportional',
  rate?: number,
): Charge {
  return { id, type, label: id, amount, splitStrategy: strategy, rate }
}

function session(overrides: Partial<SplitSession> = {}): SplitSession {
  const items  = overrides.receipt?.items  ?? []
  const charges = overrides.receipt?.charges ?? []
  const subtotal = items.reduce((s, i) => s + i.totalPrice, 0)
  const total    = subtotal + charges.reduce((s, c) => s + c.amount, 0)

  return {
    id: 'test',
    title: 'Test',
    splitMode: 'itemized',
    createdAt: 0,
    updatedAt: 0,
    people: [],
    assignments: [],
    ...overrides,
    receipt: {
      currency: 'SGD',
      subtotal,
      total,
      items,
      charges,
      ...overrides.receipt,
    },
  }
}

// Round to 2dp to make assertions readable
const r2 = (n: number) => Math.round(n * 100) / 100

// ── distributeInCents unit tests ──────────────────────────────────────────────

describe('distributeInCents', () => {
  it('distributes evenly when amount is divisible', () => {
    expect(distributeInCents(300, [1, 1, 1])).toEqual([100, 100, 100])
  })

  it('applies largest-remainder to 1 cent that cannot be split three ways', () => {
    // 100 cents / 3 → exact [33.33, 33.33, 33.33]
    // floors [33, 33, 33] → remainder 1 → index 0 gets +1
    expect(distributeInCents(100, [1, 1, 1])).toEqual([34, 33, 33])
  })

  it('distributes proportionally by weight', () => {
    // 300 cents, weights 2:1 → 200:100
    expect(distributeInCents(300, [2, 1])).toEqual([200, 100])
  })

  it('applies largest-remainder for proportional with odd cent', () => {
    // 10 cents, weights 3:1
    // exact: [7.5, 2.5] → floors [7, 2] = 9, remainder 1
    // fracs: 0.5, 0.5 (tie) → index 0 wins
    expect(distributeInCents(10, [3, 1])).toEqual([8, 2])
  })

  it('falls back to equal distribution when all weights are 0', () => {
    expect(distributeInCents(100, [0, 0])).toEqual([50, 50])
  })

  it('falls back to equal with remainder for odd cent', () => {
    expect(distributeInCents(100, [0, 0, 0])).toEqual([34, 33, 33])
  })

  it('handles a single recipient', () => {
    expect(distributeInCents(999, [5])).toEqual([999])
  })

  it('handles negative totals (discounts)', () => {
    // -100 cents / 3
    // exact: [-33.33, -33.33, -33.33]
    // floors: [-34, -34, -34] → sum = -102, remainder = 2
    // fracs: 0.67, 0.67, 0.67 (tied) → indices 0,1 get +1
    expect(distributeInCents(-100, [1, 1, 1])).toEqual([-33, -33, -34])
  })

  it('handles exact negative split with no remainder', () => {
    expect(distributeInCents(-300, [1, 1, 1])).toEqual([-100, -100, -100])
  })

  it('sum of result always equals totalCents for large proportional splits', () => {
    const weights = [137, 249, 88, 312, 64]
    const total = 1000
    const result = distributeInCents(total, weights)
    expect(result.reduce((s, v) => s + v, 0)).toBe(total)
  })
})

// ── calculateSplit edge cases ─────────────────────────────────────────────────

describe('calculateSplit — edge cases', () => {

  // ── 1. No people ──────────────────────────────────────────────────────────

  it('returns empty results when there are no people', () => {
    const s = session({
      receipt: { items: [item('i1', 'Pizza', 10)], charges: [] },
    })
    const result = calculateSplit(s)
    expect(result.personResults).toHaveLength(0)
    expect(result.assignedTotal).toBe(0)
    expect(result.unassignedItems).toHaveLength(1)
  })

  // ── 2. One person ─────────────────────────────────────────────────────────

  it('assigns all items and charges to a single person', () => {
    // Items: $5.00 + $7.00 = $12.00
    // GST:   $1.08 (proportional)
    // Total: $13.08
    const alice = person('p1', 'Alice')
    const s = session({
      people: [alice],
      assignments: [
        { itemId: 'i1', personIds: ['p1'] },
        { itemId: 'i2', personIds: ['p1'] },
      ],
      receipt: {
        items: [item('i1', 'Latte', 5.00), item('i2', 'Muffin', 7.00)],
        charges: [charge('gst', 'gst', 1.08)],
      },
    })

    const result = calculateSplit(s)
    expect(result.personResults).toHaveLength(1)

    const alice_result = result.personResults[0]
    expect(alice_result.subtotal).toBe(12.00)
    expect(alice_result.chargesTotal).toBe(1.08)
    expect(alice_result.total).toBe(13.08)
    expect(alice_result.itemShares).toHaveLength(2)
    expect(alice_result.chargeShares).toHaveLength(1)

    expect(result.unassignedItems).toHaveLength(0)
    expect(result.assignedTotal).toBe(13.08)
  })

  // ── 3. Shared item (even divisible) ───────────────────────────────────────

  it('splits a shared item evenly between 2 people', () => {
    // $9.00 / 2 = $4.50 each
    const [alice, bob] = [person('p1', 'Alice'), person('p2', 'Bob')]
    const s = session({
      people: [alice, bob],
      assignments: [{ itemId: 'i1', personIds: ['p1', 'p2'] }],
      receipt: { items: [item('i1', 'Pizza', 9.00)], charges: [] },
    })

    const { personResults } = calculateSplit(s)

    expect(personResults[0].subtotal).toBe(4.50)
    expect(personResults[1].subtotal).toBe(4.50)
    expect(personResults[0].itemShares[0].outOf).toBe(2)
    expect(personResults[1].itemShares[0].outOf).toBe(2)
  })

  // ── 4. Shared item (rounding difference — 3-way) ──────────────────────────

  it('applies largest-remainder when a shared item has an indivisible price', () => {
    // $10.00 / 3 → $3.34, $3.33, $3.33 (first person gets the extra cent)
    const [a, b, c] = ['p1','p2','p3'].map((id) => person(id, id))
    const s = session({
      people: [a, b, c],
      assignments: [{ itemId: 'i1', personIds: ['p1', 'p2', 'p3'] }],
      receipt: { items: [item('i1', 'Shared dish', 10.00)], charges: [] },
    })

    const { personResults } = calculateSplit(s)
    const totals = personResults.map((r) => r.total)

    expect(totals[0]).toBe(3.34)
    expect(totals[1]).toBe(3.33)
    expect(totals[2]).toBe(3.33)
    expect(totals.reduce((s, v) => s + v, 0)).toBeCloseTo(10.00, 10)
  })

  // ── 5. Unassigned item ────────────────────────────────────────────────────

  it('excludes unassigned items from all person bills', () => {
    // item-A → Alice, item-B → nobody
    const [alice] = [person('p1', 'Alice')]
    const s = session({
      people: [alice],
      assignments: [{ itemId: 'iA', personIds: ['p1'] }],
      receipt: {
        items: [item('iA', 'Mine', 5.00), item('iB', 'Unclaimed', 7.00)],
        charges: [],
      },
    })

    const result = calculateSplit(s)

    expect(result.unassignedItems).toHaveLength(1)
    expect(result.unassignedItems[0].id).toBe('iB')

    const alice_result = result.personResults[0]
    expect(alice_result.subtotal).toBe(5.00)
    expect(alice_result.itemShares).toHaveLength(1)
    expect(alice_result.itemShares[0].item.id).toBe('iA')
  })

  // ── 6. Discount allocated proportionally ─────────────────────────────────

  it("allocates a discount proportionally to each person's subtotal", () => {
    // Alice: $10.00, Bob: $5.00 — subtotal $15.00
    // Discount: -$3.00 (proportional)
    // Alice gets: 10/15 × -3 = -$2.00  → total $10 - $2 = $8.00
    // Bob gets:    5/15 × -3 = -$1.00  → total $5  - $1 = $4.00
    const [alice, bob] = [person('p1', 'Alice'), person('p2', 'Bob')]
    const s = session({
      people: [alice, bob],
      assignments: [
        { itemId: 'iA', personIds: ['p1'] },
        { itemId: 'iB', personIds: ['p2'] },
      ],
      receipt: {
        items: [item('iA', 'Burger', 10.00), item('iB', 'Fries', 5.00)],
        charges: [charge('disc', 'discount', -3.00)],
      },
    })

    const { personResults } = calculateSplit(s)
    const [a, b] = personResults

    expect(a.subtotal).toBe(10.00)
    expect(a.chargeShares[0].amount).toBe(-2.00)
    expect(a.total).toBe(8.00)

    expect(b.subtotal).toBe(5.00)
    expect(b.chargeShares[0].amount).toBe(-1.00)
    expect(b.total).toBe(4.00)

    // Totals sum to receipt total
    expect(a.total + b.total).toBe(12.00)
  })

  // ── 7. GST and service charge proportional ────────────────────────────────

  it('distributes GST and service charge proportionally and both sum exactly', () => {
    // Alice: $20.00, Bob: $10.00 — subtotal $30.00
    // Service charge 10%: $3.00  → Alice $2.00, Bob $1.00
    // GST 9%: $2.70              → Alice $1.80, Bob $0.90
    const [alice, bob] = [person('p1', 'Alice'), person('p2', 'Bob')]
    const s = session({
      people: [alice, bob],
      assignments: [
        { itemId: 'iA', personIds: ['p1'] },
        { itemId: 'iB', personIds: ['p2'] },
      ],
      receipt: {
        items: [item('iA', 'Steak', 20.00), item('iB', 'Pasta', 10.00)],
        charges: [
          charge('svc', 'service_charge', 3.00, 'proportional', 0.1),
          charge('gst', 'gst', 2.70, 'proportional', 0.09),
        ],
      },
    })

    const { personResults } = calculateSplit(s)
    const [a, b] = personResults

    // Service charge
    const a_svc = a.chargeShares.find((cs) => cs.charge.id === 'svc')!
    const b_svc = b.chargeShares.find((cs) => cs.charge.id === 'svc')!
    expect(a_svc.amount).toBe(2.00)
    expect(b_svc.amount).toBe(1.00)
    expect(a_svc.amount + b_svc.amount).toBe(3.00)

    // GST
    const a_gst = a.chargeShares.find((cs) => cs.charge.id === 'gst')!
    const b_gst = b.chargeShares.find((cs) => cs.charge.id === 'gst')!
    expect(a_gst.amount).toBe(1.80)
    expect(b_gst.amount).toBe(0.90)
    expect(a_gst.amount + b_gst.amount).toBe(2.70)

    expect(a.total).toBe(23.80)
    expect(b.total).toBe(11.90)
    expect(a.total + b.total).toBe(35.70)
  })

  // ── 8. Rounding difference — proportional charge with odd cent ────────────

  it('corrects a 1-cent rounding difference when distributing charges', () => {
    // $10.01 GST split proportionally among 3 equal-subtotal people
    // Naive: each gets $3.333... → rounds to $3.33 → sum $9.99 ← WRONG
    // Correct (largest-remainder): $3.34, $3.33, $3.34 or similar that sums to $10.01
    const people3 = ['p1','p2','p3'].map((id) => person(id, id))
    const s = session({
      people: people3,
      assignments: [
        { itemId: 'iA', personIds: ['p1'] },
        { itemId: 'iB', personIds: ['p2'] },
        { itemId: 'iC', personIds: ['p3'] },
      ],
      receipt: {
        items: [
          item('iA', 'A', 10.00),
          item('iB', 'B', 10.00),
          item('iC', 'C', 10.00),
        ],
        charges: [charge('gst', 'gst', 10.01)],
      },
    })

    const { personResults } = calculateSplit(s)
    const chargeSums = personResults.reduce(
      (s, r) => s + r.chargeShares[0].amount,
      0
    )
    // Must equal exactly 10.01 (not 10.00 or 10.02)
    expect(Math.round(chargeSums * 100)).toBe(1001)

    // All totals must sum to the receipt total
    const totalSum = personResults.reduce((s, r) => s + r.total, 0)
    expect(Math.round(totalSum * 100)).toBe(Math.round((30 + 10.01) * 100))
  })

  // ── 9. Rounding charge (splitStrategy: 'none') is not distributed ─────────

  it('does not distribute a rounding charge to any person', () => {
    const alice = person('p1', 'Alice')
    const s = session({
      people: [alice],
      assignments: [{ itemId: 'i1', personIds: ['p1'] }],
      receipt: {
        items: [item('i1', 'Item', 10.00)],
        charges: [charge('rnd', 'rounding', -0.02, 'none')],
      },
    })

    const { personResults } = calculateSplit(s)
    const alice_result = personResults[0]

    // chargeShares should be empty (rounding charge has splitStrategy: 'none')
    expect(alice_result.chargeShares).toHaveLength(0)
    // Alice pays only her item total; the rounding adjustment is absorbed at receipt level
    expect(alice_result.total).toBe(10.00)
  })

  // ── 10. Equal split mode ─────────────────────────────────────────────────

  it('splits the total evenly in equal mode regardless of item assignment', () => {
    // Total: $20.00 + $1.80 = $21.80, 2 people
    // Each: distributeInCents(2180, [1,1]) = [1090, 1090] → $10.90 each
    const [alice, bob] = [person('p1', 'Alice'), person('p2', 'Bob')]
    const s = session({
      splitMode: 'equal',
      people: [alice, bob],
      assignments: [{ itemId: 'iA', personIds: ['p1'] }], // only Alice assigned
      receipt: {
        items: [item('iA', 'Meal', 20.00)],
        charges: [charge('gst', 'gst', 1.80)],
      },
    })

    const { personResults, assignedTotal } = calculateSplit(s)

    // Both pay the same
    expect(personResults[0].total).toBe(10.90)
    expect(personResults[1].total).toBe(10.90)
    expect(assignedTotal).toBe(21.80)
  })

  it('applies largest-remainder in equal mode for odd totals', () => {
    // Total: $10.01, 3 people
    // distributeInCents(1001, [1,1,1]) → [334, 334, 333] → $3.34, $3.34, $3.33
    const people3 = ['p1','p2','p3'].map((id) => person(id, id))
    const s = session({
      splitMode: 'equal',
      people: people3,
      assignments: [],
      receipt: {
        items: [item('i1', 'Item', 10.01)],
        charges: [],
      },
    })

    // Can't easily predict which person gets the extra cent without knowing
    // sort order, but the sum must be exact and max difference is 1 cent
    const { personResults } = calculateSplit(s)
    const totals = personResults.map((r) => r.total)
    const sum = Math.round(totals.reduce((s, v) => s + v, 0) * 100)

    expect(sum).toBe(1001)
    const max = Math.max(...totals)
    const min = Math.min(...totals)
    expect(max - min).toBeLessThanOrEqual(0.01)
  })

})

// ── Integration test with realistic Singapore receipt ─────────────────────────

describe('calculateSplit — realistic Singapore restaurant receipt', () => {
  /**
   * The Hawker Table, 4 people:
   *
   *  item-1  Chicken Rice ×2   $13.00  → Alice ($6.50) + Bob ($6.50)
   *  item-2  Char Kway Teow    $9.00   → Carol ($9.00)
   *  item-3  Prawn Laksa       $10.50  → Dave ($10.50)
   *  item-4  Teh Tarik ×4      $8.00   → all 4 ($2.00 each)
   *  item-5  Roti Prata        $4.00   → Alice ($2.00) + Dave ($2.00)
   *  item-6  Milo Dinosaur ×2  $7.00   → Bob ($3.50) + Carol ($3.50)
   *
   *  Subtotals:
   *    Alice  = 6.50 + 2.00 + 2.00 = $10.50  (1050 cents)
   *    Bob    = 6.50 + 2.00 + 3.50 = $12.00  (1200 cents)
   *    Carol  = 9.00 + 2.00 + 3.50 = $14.50  (1450 cents)
   *    Dave   = 10.50 + 2.00 + 2.00 = $14.50  (1450 cents)
   *    Total  = $51.50
   *
   *  Service charge $5.15 (10%, proportional):
   *    515 × 1050/5150 = 105.06 → floor 105, frac 0.06
   *    515 × 1200/5150 = 120.00 → floor 120, frac 0.00
   *    515 × 1450/5150 = 145.00 → floor 145, frac 0.00 (×2)
   *    Sum floors = 515, remainder = 0 → no correction needed
   *    Alice=$1.05, Bob=$1.20, Carol=$1.45, Dave=$1.45
   *
   *  GST $5.10 (9%, proportional):
   *    510 × 1050/5150 = 103.98 → floor 103, frac 0.98  ← 1st
   *    510 × 1200/5150 = 118.83 → floor 118, frac 0.83  ← 2nd
   *    510 × 1450/5150 = 143.59 → floor 143, frac 0.59  ← 3rd (Carol before Dave by index)
   *    510 × 1450/5150 = 143.59 → floor 143, frac 0.59
   *    Sum floors = 507, remainder = 3 → Alice, Bob, Carol each get +1 cent
   *    Alice=$1.04, Bob=$1.19, Carol=$1.44, Dave=$1.43
   *
   *  Final totals:
   *    Alice  = 10.50 + 1.05 + 1.04 = $12.59
   *    Bob    = 12.00 + 1.20 + 1.19 = $14.39
   *    Carol  = 14.50 + 1.45 + 1.44 = $17.39
   *    Dave   = 14.50 + 1.45 + 1.43 = $17.38
   *    Sum    = $61.75  ✓
   */

  const people = [
    person('p1', 'Alice'),
    person('p2', 'Bob'),
    person('p3', 'Carol'),
    person('p4', 'Dave'),
  ]

  const s = session({
    people,
    assignments: [
      { itemId: 'i1', personIds: ['p1', 'p2'] },
      { itemId: 'i2', personIds: ['p3'] },
      { itemId: 'i3', personIds: ['p4'] },
      { itemId: 'i4', personIds: ['p1', 'p2', 'p3', 'p4'] },
      { itemId: 'i5', personIds: ['p1', 'p4'] },
      { itemId: 'i6', personIds: ['p2', 'p3'] },
    ],
    receipt: {
      items: [
        item('i1', 'Chicken Rice ×2', 6.50, 2),
        item('i2', 'Char Kway Teow',  9.00),
        item('i3', 'Prawn Laksa',     10.50),
        item('i4', 'Teh Tarik ×4',    2.00, 4),
        item('i5', 'Roti Prata',      4.00),
        item('i6', 'Milo Dinosaur ×2',3.50, 2),
      ],
      charges: [
        charge('svc', 'service_charge', 5.15, 'proportional', 0.1),
        charge('gst', 'gst',            5.10, 'proportional', 0.09),
      ],
    },
  })

  const result = calculateSplit(s)
  const byName = Object.fromEntries(result.personResults.map((r) => [r.person.name, r]))

  it('computes correct item subtotals', () => {
    expect(byName['Alice'].subtotal).toBe(10.50)
    expect(byName['Bob'].subtotal).toBe(12.00)
    expect(byName['Carol'].subtotal).toBe(14.50)
    expect(byName['Dave'].subtotal).toBe(14.50)
  })

  it('distributes service charge proportionally and it sums to $5.15', () => {
    const get = (name: string) =>
      byName[name].chargeShares.find((cs) => cs.charge.id === 'svc')!.amount

    expect(get('Alice')).toBe(1.05)
    expect(get('Bob')).toBe(1.20)
    expect(get('Carol')).toBe(1.45)
    expect(get('Dave')).toBe(1.45)

    const svcSum = r2(get('Alice') + get('Bob') + get('Carol') + get('Dave'))
    expect(svcSum).toBe(5.15)
  })

  it('distributes GST proportionally with 3-cent remainder and it sums to $5.10', () => {
    const get = (name: string) =>
      byName[name].chargeShares.find((cs) => cs.charge.id === 'gst')!.amount

    expect(get('Alice')).toBe(1.04)
    expect(get('Bob')).toBe(1.19)
    expect(get('Carol')).toBe(1.44)
    expect(get('Dave')).toBe(1.43)

    const gstSum = r2(get('Alice') + get('Bob') + get('Carol') + get('Dave'))
    expect(gstSum).toBe(5.10)
  })

  it('computes correct final totals per person', () => {
    expect(byName['Alice'].total).toBe(12.59)
    expect(byName['Bob'].total).toBe(14.39)
    expect(byName['Carol'].total).toBe(17.39)
    expect(byName['Dave'].total).toBe(17.38)
  })

  it('all person totals sum exactly to the receipt total ($61.75)', () => {
    const sum = result.personResults.reduce((s, r) => s + r.total, 0)
    expect(Math.round(sum * 100)).toBe(6175)
  })

  it('has no unassigned items', () => {
    expect(result.unassignedItems).toHaveLength(0)
  })

  it('reports assignedTotal equal to receipt total', () => {
    expect(result.assignedTotal).toBe(61.75)
  })
})
