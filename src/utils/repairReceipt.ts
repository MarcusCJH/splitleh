import type { ParseResult, ParsedCharge, ParsedItem } from './parseReceipt'
import { round2 } from './money'

function letterRatio(name: string): number {
  const alpha = (name.match(/[a-zA-Z]/g) ?? []).length
  return name.length > 0 ? alpha / name.length : 0
}

function isSubtotalName(name: string): boolean {
  return /\b(?:sub|cub|sjb)\s*tot/i.test(name) || /^subtot/i.test(name)
}

function isFooterGarbageName(name: string): boolean {
  const n = name.trim()
  if (letterRatio(n) < 0.42 && n.length <= 14) return true
  return /^(?:se oy|sar ii|cubtota|subtota|ttl|tot|vr cheg)/i.test(n)
}

function looksLikeServiceLabel(name: string): boolean {
  return /\b(?:svr|svc|cheg|chrg|service|sur)\b/i.test(name)
}

function looksLikeGstLabel(name: string): boolean {
  return /\bgst\b/i.test(name) || /\d{1,2}\s*ST\b/i.test(name)
}

function matchChargePattern(name: string): boolean {
  return /\b(?:total|subtotal|gst|service|discount)\b/i.test(name)
}

function hasCharge(charges: ParsedCharge[], type: ParsedCharge['type']): boolean {
  return charges.some((c) => c.type === type)
}

function shouldInferTaxes(charges: ParsedCharge[], items: ParsedItem[]): boolean {
  if (hasCharge(charges, 'service_charge')) return true
  if (hasCharge(charges, 'subtotal') && hasCharge(charges, 'gst')) return false
  return items.length <= 4
}

function findPriceNear(rawText: string, target: number): number | null {
  const re = /(?:S?\$\s*)?(\d{1,4}\.\d{1,2})/g
  let m: RegExpExecArray | null
  let best: number | null = null
  let bestDiff = Infinity
  while ((m = re.exec(rawText)) !== null) {
    const v = parseFloat(m[1])
    const diff = Math.abs(v - target)
    if (diff < 0.12 && diff < bestDiff) {
      best = v
      bestDiff = diff
    }
  }
  return best
}

function foodItemSum(items: ParsedItem[], charges: ParsedCharge[]): number {
  const subtotal = charges.find((c) => c.type === 'subtotal')?.amount
  const footerAmounts = new Set(
    charges
      .filter((c) => c.type !== 'discount')
      .map((c) => round2(Math.abs(c.amount))),
  )

  return round2(
    items
      .filter((it) => {
        if (subtotal !== undefined && Math.abs(it.totalPrice - subtotal) < 0.03) return false
        if (footerAmounts.has(round2(it.totalPrice))) return false
        if (isFooterGarbageName(it.name)) return false
        if (isSubtotalName(it.name)) return false
        if (looksLikeServiceLabel(it.name) || looksLikeGstLabel(it.name)) return false
        return true
      })
      .reduce((s, it) => s + it.totalPrice, 0),
  )
}

function removeFooterAmountItems(
  items: ParsedItem[],
  charges: ParsedCharge[],
): ParsedItem[] {
  const subtotal = charges.find((c) => c.type === 'subtotal')
  const svc = charges.find((c) => c.type === 'service_charge')
  const gst = charges.find((c) => c.type === 'gst')
  const total = charges.find((c) => c.type === 'total')

  return items.filter((it) => {
    if (subtotal && Math.abs(it.totalPrice - subtotal.amount) < 0.03) {
      if (isSubtotalName(it.name) || letterRatio(it.name) < 0.55) return false
    }
    if (svc && Math.abs(it.totalPrice - svc.amount) < 0.03) {
      if (looksLikeServiceLabel(it.name) || letterRatio(it.name) < 0.55) return false
    }
    if (gst && Math.abs(it.totalPrice - gst.amount) < 0.03) {
      if (looksLikeGstLabel(it.name) || letterRatio(it.name) < 0.55) return false
    }
    if (total && Math.abs(it.totalPrice - total.amount) < 0.03) {
      if (matchChargePattern(it.name) || isFooterGarbageName(it.name)) return false
    }
    if (isFooterGarbageName(it.name)) return false
    if (looksLikeServiceLabel(it.name) && it.totalPrice < 100) return false
    if (looksLikeGstLabel(it.name) && it.totalPrice < 100) return false
    return true
  })
}

function stripComputedTotalItems(
  items: ParsedItem[],
  charges: ParsedCharge[],
): void {
  const subtotal = charges.find((c) => c.type === 'subtotal')
  const svc = charges.find((c) => c.type === 'service_charge')
  const gst = charges.find((c) => c.type === 'gst')
  if (!subtotal || !svc || !gst) return
  const expected = round2(subtotal.amount + svc.amount + gst.amount)
  for (let i = items.length - 1; i >= 0; i--) {
    if (Math.abs(items[i].totalPrice - expected) < 0.15) {
      items.splice(i, 1)
    }
  }
}
function promoteSubtotal(items: ParsedItem[], charges: ParsedCharge[]): void {
  if (hasCharge(charges, 'subtotal')) return

  const foodish =
    /\b(?:juice|beer|wine|moscato|guinness|pho|coffee|btl|bt\]|bt\}|noodle|rice|satay|chicken)\b/i

  const candidates = items
    .map((it, i) => ({ it, i }))
    .filter(
      ({ it }) =>
        (isSubtotalName(it.name) ||
          (it.totalPrice >= 50 &&
            it.totalPrice < 2000 &&
            letterRatio(it.name) < 0.8 &&
            !foodish.test(it.name))) &&
        !(it.quantity > 1 && !isSubtotalName(it.name)),
    )

  if (candidates.length === 0) return

  const maxPrice = Math.max(...items.map((it) => it.totalPrice))
  const itemSum = items.reduce((s, it) => s + it.totalPrice, 0)

  candidates.sort((a, b) => {
    if (isSubtotalName(a.it.name) !== isSubtotalName(b.it.name)) {
      return isSubtotalName(a.it.name) ? -1 : 1
    }
    const aBelowMax = a.it.totalPrice < maxPrice ? 1 : 0
    const bBelowMax = b.it.totalPrice < maxPrice ? 1 : 0
    if (bBelowMax !== aBelowMax) return bBelowMax - aBelowMax
    const aBelowSum = a.it.totalPrice < itemSum - 20 ? 1 : 0
    const bBelowSum = b.it.totalPrice < itemSum - 20 ? 1 : 0
    if (bBelowSum !== aBelowSum) return bBelowSum - aBelowSum
    return letterRatio(a.it.name) - letterRatio(b.it.name)
  })

  const pick = candidates[0]
  charges.push({ type: 'subtotal', label: pick.it.name, amount: pick.it.totalPrice })
  items.splice(pick.i, 1)
}

function ensureServiceCharge(
  items: ParsedItem[],
  charges: ParsedCharge[],
  warnings: string[],
): void {
  const subtotal = charges.find((c) => c.type === 'subtotal')
  if (!subtotal) return

  const expected = round2(subtotal.amount * 0.1)
  const existing = charges.find((c) => c.type === 'service_charge')

  if (existing) {
    if (Math.abs(existing.amount - expected) > 0.55) {
      existing.amount = expected
      warnings.push('Service charge corrected to 10% of subtotal.')
    }
    return
  }

  const idx = items.findIndex(
    (it) =>
      looksLikeServiceLabel(it.name) ||
      (letterRatio(it.name) < 0.55 && Math.abs(it.totalPrice - expected) < 6),
  )
  if (idx >= 0 && Math.abs(items[idx].totalPrice - expected) < 6) {
    charges.push({
      type: 'service_charge',
      label: items[idx].name,
      amount: expected,
    })
    if (Math.abs(items[idx].totalPrice - expected) > 0.03) {
      warnings.push('Service charge corrected to 10% of subtotal.')
    }
    items.splice(idx, 1)
  } else {
    charges.push({ type: 'service_charge', label: '10% Svr Chrg', amount: expected })
    warnings.push('Service charge inferred at 10% of subtotal.')
  }
}

function ensureGst(
  items: ParsedItem[],
  charges: ParsedCharge[],
  warnings: string[],
): void {
  const subtotal = charges.find((c) => c.type === 'subtotal')
  const svc = charges.find((c) => c.type === 'service_charge')
  if (!subtotal || !svc) return

  const expected = round2((subtotal.amount + svc.amount) * 0.09)
  const existing = charges.find((c) => c.type === 'gst')

  if (existing) {
    if (Math.abs(existing.amount - expected) > 0.55) {
      existing.amount = expected
      warnings.push('GST corrected to 9% of (subtotal + service).')
    }
    return
  }

  const idx = items.findIndex(
    (it) =>
      looksLikeGstLabel(it.name) ||
      (letterRatio(it.name) < 0.55 && Math.abs(it.totalPrice - expected) < 1.5),
  )
  if (idx >= 0) {
    charges.push({
      type: 'gst',
      label: items[idx].name,
      amount: Math.abs(items[idx].totalPrice - expected) < 1.5 ? items[idx].totalPrice : expected,
    })
    items.splice(idx, 1)
  } else {
    charges.push({ type: 'gst', label: '9% GST (inferred)', amount: expected })
    warnings.push('GST inferred at 9% — footer was unclear in the photo.')
  }
}

function fixUnderpricedQtyItem(
  items: ParsedItem[],
  charges: ParsedCharge[],
  warnings: string[],
): void {
  const subtotal = charges.find((c) => c.type === 'subtotal')
  if (!subtotal) return

  const discountSum = charges
    .filter((c) => c.type === 'discount')
    .reduce((s, c) => s + c.amount, 0)
  const net = round2(foodItemSum(items, charges) + discountSum)
  const gap = round2(subtotal.amount - net)
  if (Math.abs(gap) < 0.5 || Math.abs(gap) > 30) return

  const suspect = items.find(
    (it) => it.quantity > 1 && it.unitPrice < 5 && it.totalPrice < it.quantity * 5,
  )
  if (!suspect) return

  suspect.totalPrice = round2(suspect.totalPrice + gap)
  suspect.unitPrice = round2(suspect.totalPrice / suspect.quantity)
  warnings.push(`Adjusted "${suspect.name}" price using receipt subtotal.`)
}

/**
 * Recover footer lines that OCR turned into fake items, and infer missing
 * discount / GST when the printed math is recoverable.
 */
export function repairParsedReceipt(
  parse: ParseResult,
  rawText?: string,
): ParseResult {
  let items: ParsedItem[] = [...parse.items]
  const charges: ParsedCharge[] = [...parse.charges]
  const warnings = [...parse.warnings]

  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]
    if (isSubtotalName(it.name) && !hasCharge(charges, 'subtotal')) {
      charges.push({ type: 'subtotal', label: it.name, amount: it.totalPrice })
      items.splice(i, 1)
    }
  }

  promoteSubtotal(items, charges)

  const subtotal = charges.find((c) => c.type === 'subtotal')
  const inferTaxes = shouldInferTaxes(charges, items)

  if (inferTaxes && subtotal) {
    ensureServiceCharge(items, charges, warnings)
    ensureGst(items, charges, warnings)
  }

  items = removeFooterAmountItems(items, charges)
  stripComputedTotalItems(items, charges)

  if (subtotal && !hasCharge(charges, 'discount')) {
    const foodSum = foodItemSum(items, charges)
    if (foodSum > subtotal.amount + 0.05) {
      const disc = round2(subtotal.amount - foodSum)
      if (disc > -250) {
        charges.push({
          type: 'discount',
          label: 'Inferred item discount',
          amount: disc,
        })
        warnings.push('Inferred discount from items vs printed subtotal.')
      }
    }
  }

  fixUnderpricedQtyItem(items, charges, warnings)

  const svc = charges.find((c) => c.type === 'service_charge')
  const gst = charges.find((c) => c.type === 'gst')

  if (!hasCharge(charges, 'total') && subtotal && ((svc && gst) || items.length <= 4)) {
    const expected = round2(subtotal.amount + (svc?.amount ?? 0) + (gst?.amount ?? 0))
    const fromText = rawText ? findPriceNear(rawText, expected) : null
    charges.push({
      type: 'total',
      label: fromText !== null ? 'TOTAL' : 'TOTAL (calculated)',
      amount: fromText ?? expected,
    })
  }

  return { items, charges, warnings }
}
