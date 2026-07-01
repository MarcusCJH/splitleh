import type { Charge } from '../types'
import type { ParseResult, ParsedCharge } from './parseReceipt'
import { round2 } from './money'

export type ReconcileStatus = 'ok' | 'warn' | 'fail'

export interface ReceiptMathLine {
  label: string
  amount: number
  /** True when read from the receipt footer, not computed from items */
  fromReceipt: boolean
}

export interface Reconciliation {
  itemsSum: number
  discountSum: number
  netBeforeTax: number
  serviceCharge: number | null
  gst: number | null
  rounding: number
  detectedSubtotal: number | null
  detectedTotal: number | null
  computedTotal: number
  totalDiff: number | null
  subtotalDiff: number | null
  status: ReconcileStatus
  messages: string[]
  lines: ReceiptMathLine[]
}

const TOLERANCE = 0.03

function sumCharges(charges: ParsedCharge[], type: ParsedCharge['type']): number | null {
  const matches = charges.filter((c) => c.type === type)
  if (matches.length === 0) return null
  return round2(matches.reduce((s, c) => s + c.amount, 0))
}

/** Pull a percentage from labels like "10% Svr Chrg" or "ITEM DISC 30%". */
export function extractRate(label: string): number | undefined {
  const m = label.match(/(\d+(?:\.\d+)?)\s*%/)
  if (!m) return undefined
  const pct = parseFloat(m[1])
  return Number.isFinite(pct) ? pct / 100 : undefined
}

function shortenLabel(label: string, max = 32): string {
  const t = label.replace(/\s+/g, ' ').trim()
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`
}

/**
 * Cross-check parsed items and footer charges the way a human would:
 * items (+ discounts) → subtotal → service → GST → total.
 */
export function reconcileReceipt(parse: ParseResult): Reconciliation {
  const itemsSum = round2(parse.items.reduce((s, i) => s + i.totalPrice, 0))
  const discountSum = sumCharges(parse.charges, 'discount') ?? 0
  const detectedSubtotal = parse.charges.find((c) => c.type === 'subtotal')?.amount ?? null
  const detectedTotal = parse.charges.find((c) => c.type === 'total')?.amount ?? null
  const serviceCharge = sumCharges(parse.charges, 'service_charge')
  const gst = sumCharges(parse.charges, 'gst')
  const rounding = sumCharges(parse.charges, 'rounding') ?? 0

  const netFromItems = round2(itemsSum + discountSum)
  const netBeforeTax = detectedSubtotal ?? netFromItems

  const computedTotal = round2(
    netBeforeTax + (serviceCharge ?? 0) + (gst ?? 0) + rounding,
  )

  const subtotalDiff =
    detectedSubtotal !== null ? round2(Math.abs(netFromItems - detectedSubtotal)) : null

  const totalDiff =
    detectedTotal !== null ? round2(Math.abs(computedTotal - detectedTotal)) : null

  const messages: string[] = []
  let status: ReconcileStatus = 'ok'

  const lines: ReceiptMathLine[] = [
    { label: 'Items', amount: itemsSum, fromReceipt: false },
  ]

  if (discountSum !== 0) {
    lines.push({ label: 'Discounts', amount: discountSum, fromReceipt: true })
    lines.push({ label: 'After discounts', amount: netFromItems, fromReceipt: false })
  }

  if (detectedSubtotal !== null) {
    lines.push({
      label: 'Subtotal (receipt)',
      amount: detectedSubtotal,
      fromReceipt: true,
    })
  }

  if (serviceCharge !== null) {
    lines.push({ label: 'Service charge', amount: serviceCharge, fromReceipt: true })
  }

  if (gst !== null) {
    lines.push({ label: 'GST', amount: gst, fromReceipt: true })
  }

  if (rounding !== 0) {
    lines.push({ label: 'Rounding', amount: rounding, fromReceipt: true })
  }

  if (detectedTotal !== null) {
    lines.push({ label: 'Total (receipt)', amount: detectedTotal, fromReceipt: true })
  }

  lines.push({ label: 'Calculated total', amount: computedTotal, fromReceipt: false })

  if (subtotalDiff !== null && subtotalDiff > TOLERANCE) {
    const missing = detectedSubtotal! > netFromItems
    messages.push(
      missing
        ? `Items add up to $${netFromItems.toFixed(2)} but receipt subtotal is $${detectedSubtotal!.toFixed(2)} — some lines may be missing from OCR.`
        : `Items add up to $${netFromItems.toFixed(2)} but receipt subtotal is $${detectedSubtotal!.toFixed(2)} — check for duplicate or wrong prices.`,
    )
  }

  if (totalDiff !== null) {
    if (totalDiff <= TOLERANCE) {
      messages.unshift('Receipt math checks out: subtotal + service + GST = total.')
      if (subtotalDiff !== null && subtotalDiff > TOLERANCE) {
        status = 'warn'
      } else {
        status = 'ok'
      }
    } else {
      messages.push(
        `Calculated $${computedTotal.toFixed(2)} vs receipt total $${detectedTotal!.toFixed(2)} ($${totalDiff.toFixed(2)} off).`,
      )
      status = totalDiff > 1 ? 'fail' : 'warn'
    }
  } else if (detectedSubtotal !== null && serviceCharge !== null && gst !== null) {
    messages.push('Footer total not detected — calculated from subtotal + charges.')
    status = subtotalDiff !== null && subtotalDiff > TOLERANCE ? 'warn' : 'warn'
  } else if (parse.items.length > 0) {
    messages.push('Could not read full receipt footer — verify charges on the next screen.')
    if (subtotalDiff !== null && subtotalDiff > 5) status = 'warn'
    else status = 'warn'
  } else if (subtotalDiff !== null && subtotalDiff > 5) {
    status = 'warn'
  }

  if (detectedSubtotal !== null && serviceCharge !== null && gst !== null) {
    const taxBase = round2(detectedSubtotal + serviceCharge)
    const impliedGstRate = taxBase > 0 ? gst / taxBase : 0
    if (Math.abs(impliedGstRate - 0.09) > 0.015 && Math.abs(impliedGstRate - 0.08) > 0.015) {
      messages.push(
        `GST looks like ${(impliedGstRate * 100).toFixed(1)}% of (subtotal + service), not the usual 9%.`,
      )
    }
  }

  return {
    itemsSum,
    discountSum,
    netBeforeTax,
    serviceCharge,
    gst,
    rounding,
    detectedSubtotal,
    detectedTotal,
    computedTotal,
    totalDiff,
    subtotalDiff,
    status,
    messages,
    lines,
  }
}

/** First plausible merchant line from OCR (shop name at top of receipt). */
export function extractMerchant(rawText: string): string | undefined {
  const skip =
    /^(table|pax|date|dine|gst|uen|tel|order|invoice|receipt|bill|cover|member|cashier|server|\d)/i

  for (const line of rawText.split('\n').map((l) => l.trim()).filter(Boolean)) {
    if (line.length < 3 || line.length > 48) continue
    if (skip.test(line)) continue
    if (!/[a-zA-Z]{3,}/.test(line)) continue
    if (/\$\d/.test(line)) continue
    return line
  }
  return undefined
}

/** Map OCR footer lines into Review-screen charges (amounts from receipt, not auto-%). */
export function chargesFromParse(parse: ParseResult): Charge[] {
  const charges: Charge[] = []

  const svc = parse.charges.find((c) => c.type === 'service_charge')
  const gstLine = parse.charges.find((c) => c.type === 'gst')
  const discounts = parse.charges.filter((c) => c.type === 'discount')
  const rounding = parse.charges.find((c) => c.type === 'rounding')

  const svcRate = svc ? extractRate(svc.label) : undefined
  charges.push({
    id: 'svc',
    type: 'service_charge',
    label: svcRate
      ? `Service Charge (${Math.round(svcRate * 100)}%)`
      : 'Service Charge (10%)',
    amount: svc?.amount ?? 0,
    rate: svcRate ?? 0.1,
    splitStrategy: 'proportional',
  })

  const gstRate = gstLine ? extractRate(gstLine.label) : undefined
  charges.push({
    id: 'gst',
    type: 'gst',
    label: gstRate ? `GST (${Math.round(gstRate * 100)}%)` : 'GST (9%)',
    amount: gstLine?.amount ?? 0,
    rate: gstRate ?? 0.09,
    splitStrategy: 'proportional',
  })

  if (discounts.length > 0) {
    const amount = round2(discounts.reduce((s, d) => s + d.amount, 0))
    charges.push({
      id: 'discount',
      type: 'discount',
      label:
        discounts.length === 1
          ? shortenLabel(discounts[0].label)
          : `Discounts (${discounts.length})`,
      amount,
      splitStrategy: 'proportional',
    })
  }

  if (rounding && rounding.amount !== 0) {
    charges.push({
      id: 'rounding',
      type: 'rounding',
      label: 'Rounding',
      amount: rounding.amount,
      splitStrategy: 'none',
    })
  }

  return charges
}
