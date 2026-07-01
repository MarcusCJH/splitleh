import { describe, it, expect } from 'vitest'
import { parseReceipt } from '../parseReceipt'
import { reconcileReceipt, chargesFromParse, extractMerchant } from '../receiptReconcile'

const POS_RECEIPT = `
Natureland Cafe
GST REG NO: 201630159R
1 (Promo) Guinness      $13.00
1 Apple Juice            $5.00
2 Ki No Bi Btl         $456.00
ITEM DISC 30%          ($136.80)
2 Moscato (WP)          $22.00
SUBTOTAL               $371.80
10% Svr Chrg            $37.18
9% GST                  $36.81
TOTAL                  $445.79
VISA                   $445.79
Thank you
`.trim()

describe('reconcileReceipt', () => {
  it('validates Natureland subtotal + service + GST = total', () => {
    const parse = parseReceipt(POS_RECEIPT)
    const r = reconcileReceipt(parse)

    expect(r.detectedSubtotal).toBeCloseTo(371.8)
    expect(r.serviceCharge).toBeCloseTo(37.18)
    expect(r.gst).toBeCloseTo(36.81)
    expect(r.detectedTotal).toBeCloseTo(445.79)
    expect(r.computedTotal).toBeCloseTo(445.79)
    expect(r.totalDiff).toBeLessThanOrEqual(0.03)
    expect(r.status).toBe('warn')
    expect(r.messages[0]).toMatch(/checks out/i)
  })

  it('warns when items do not match printed subtotal', () => {
    const parse = parseReceipt(`
Foo $10.00
SUBTOTAL $50.00
9% GST $4.50
TOTAL $54.50
`.trim())
    const r = reconcileReceipt(parse)
    expect(r.subtotalDiff).toBeGreaterThan(1)
    expect(r.status).not.toBe('ok')
    expect(r.messages.some((m) => /subtotal/i.test(m))).toBe(true)
  })
})

describe('chargesFromParse', () => {
  it('maps footer lines to Review charges with detected amounts', () => {
    const parse = parseReceipt(POS_RECEIPT)
    const charges = chargesFromParse(parse)

    expect(charges.find((c) => c.id === 'svc')?.amount).toBeCloseTo(37.18)
    expect(charges.find((c) => c.id === 'gst')?.amount).toBeCloseTo(36.81)
    expect(charges.find((c) => c.id === 'discount')?.amount).toBeCloseTo(-136.8)
  })
})

describe('extractMerchant', () => {
  it('reads shop name from first line', () => {
    expect(extractMerchant(POS_RECEIPT)).toBe('Natureland Cafe')
  })
})
