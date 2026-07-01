// Receipt text parser — line-by-line heuristics for common SG receipt formats.
// Intentionally simple: the Review screen lets users fix whatever is wrong.

import { repairParsedReceipt } from './repairReceipt'

export type Confidence = 'high' | 'medium' | 'low'

export interface ParsedItem {
  name: string
  unitPrice: number
  quantity: number
  totalPrice: number
  confidence: Confidence
}

export type ChargeType =
  | 'subtotal'
  | 'gst'
  | 'service_charge'
  | 'discount'
  | 'rounding'
  | 'total'

export interface ParsedCharge {
  type: ChargeType
  label: string   // trimmed original line
  amount: number  // negative for discounts and negative rounding
}

export interface ParseResult {
  items: ParsedItem[]
  charges: ParsedCharge[]
  warnings: string[]
}

// Fix common OCR artifacts before any line parsing.
function normalizeOcrText(text: string): string {
  return text
    .split('\n')
    .map((line) =>
      line
        // Comma-as-decimal separator ("3,50" → "3.50")
        .replace(/\b(\d{1,4}),(\d{2})\b/g, '$1.$2')
        // Interpunct / middle dot ("3·50" → "3.50")
        .replace(/(\d)[·•](\d)/g, '$1.$2')
        // Space after decimal point ("13. 00" → "13.00")
        .replace(/(\d)\.\s+(\d{2})\b/g, '$1.$2')
        // Space instead of decimal ("44 40" → "44.40") at end of line
        .replace(/(\d{1,4})\s+(\d{2})(\s*(?:[|}\]])?\s*)$/g, '$1.$2$3')
        // Trailing junk after price ("12.10}" → "12.10")
        .replace(/(\d\.\d{2})[|}\]]+/g, '$1')
        // Missing space before amount ("SUBTOTAL$371.80", "Vis$445.79")
        .replace(/([A-Za-z])(\$)/g, '$1 $2')
        // Bracket misread as I ("[TEM DISC" → "ITEM DISC")
        .replace(/\[TEM\s+DISC/gi, 'ITEM DISC')
        .replace(/\{TEM\s+DISC/gi, 'ITEM DISC')
        // Comma decimals inside brackets/parens: ($135, 80) → ($135.80)
        .replace(/([({\[])\s*S?\$?\s*(\d{1,4}),(\d{2})\s*([)\]}])/g, '$1$2.$3$4')
        // Shadow / blur misreads on footer labels
        .replace(/\bCUBTOTA\b/gi, 'SUBTOTAL')
        .replace(/\bSUBTOTA\b/gi, 'SUBTOTAL')
        .replace(/\bS\s*J\s*B\s*TOTAL\b/gi, 'SUBTOTAL')
        .replace(/\bSur\s+Chir?ge?\b/gi, 'Svr Chrg')
        .replace(/\bSur\s+Cha(?:rge)?\b/gi, 'Service Charge')
        .replace(/\b0%\s*GST\b/gi, '9% GST'),
    )
    .join('\n')
}

// Lines matching this are skipped before any price extraction — they're payment
// info, contact details, or filler that may still contain digit sequences.
const NOISE_RE = new RegExp(
  [
    '\\bcash\\b',
    '\\bchange\\b',
    '\\bcredit\\s*card\\b',
    '\\bdebit\\s*card\\b',
    '\\bnets\\b',
    '\\bvisa\\b',
    '\\bvis\\b',          // truncated "VISA" from OCR
    '\\bmastercard\\b',
    '\\bamex\\b',
    '\\bkrisplus\\b',
    '\\bpaynow\\b',
    '\\bgrabpay\\b',
    '\\bpayment\\b',
    '\\bpayment\\s+info\\b',
    '\\bpaid\\s*by\\b',
    '\\bref(?:erence)?\\s*(?:no|#)\\b',
    '\\breceipt\\s*(?:no|#|num)\\b',
    '\\brcpt\\b',
    '\\brept\\b',
    '\\border\\s*(?:no|#|num)\\b',
    '\\binvoice\\s*(?:no|#|num)\\b',
    '\\bserver\\b',
    '\\bcashier\\b',
    '\\btable\\s+\\d',
    '\\bgst\\s*reg\\b',
    '\\buen\\b',
    '\\bnric\\b',
    '\\bthank\\s*you\\b',
    '\\bthanks\\b',
    '\\bclosed\\s+bill\\b',
    '\\bbill\\s+close\\b',
    '\\bsignature\\b',
    '\\bmember\\s+tier\\b',
    '\\bredeemable\\s+points\\b',
    '\\brewards\\s+catalogue\\b',
    '\\bsales\\s+no\\b',
    '\\btel\\b',
    '\\bregister\\b',
    '\\bcover\\b',
    '\\bcaver\\b',
    '\\baccumulated\\b',
    '\\bissued\\s+points\\b',
    '\\bpoints\\b',
    '\\bplease\\s+(?:come|visit|call)\\b',
    '\\bwelcome\\b',
    '\\bwifi\\b',
    '\\bpassword\\b',
    '@',       // email addresses
    'www\\.',  // websites
    '\\.com\\b',
    '\\.sg\\b',
  ].join('|'),
  'i',
)

// First match wins; keep subtotal before total so "Subtotal" isn't caught by total.
const CHARGE_PATTERNS: ReadonlyArray<{
  type: ChargeType
  re: RegExp
  forceNegative?: boolean
}> = [
  { type: 'subtotal',       re: /\b(sub[\s-]?total|sub[\s-]?amt|sub\s*ttl|cubtota|subtota)\b/i },
  { type: 'gst',            re: /\bgst\b|\bg\.s\.t\.?\b/i },
  { type: 'gst',            re: /\b\d{1,2}\s*ST\b/i },
  { type: 'gst',            re: /\b\d+%\s*(?:tax|vat)\b|\btax\b|\bvat\b/i },
  {
    type: 'service_charge',
    re: /\bservice\s*charges?\b|\bservice\s*cha(?:r(?:ge)?)?\b|\bsvc\.?\s*ch(?:r?g?)?\b|\bsvr\.?\s*ch(?:r?g?)?\b|\bsur\s+ch(?:r?g?)?\b|\bs\/c\b|\b\d+%\s*sur\b|\bvr\s+cheg/i,
  },
  {
    type: 'discount',
    // "promo" removed — it appears in item names (e.g. "(Promo) Guinness") and causes
    // false positives. Discounts are still caught via "disc", "voucher", etc.
    re: /\bdisc(?:ount)?\b|\bvoucher\b|\brebate\b|\bcoupon\b|\bitem\s+disc\b/i,
    forceNegative: true,
  },
  { type: 'rounding', re: /\brounding\b|\bround\s*adj\b/i },
  {
    type: 'total',
    re: /\b(?:grand|nett?|net|bill)\s+total\b|\btotal\s+(?:amount|bill|due|payable)\b|\bamount\s+due\b/i,
  },
  { type: 'total', re: /^\s*total\b/i },
]

// Matches a price: optional S$ or $, then 1–4 digits, dot, 1–2 digits.
// 1-digit decimals ("3.5") are treated as "3.50" via normPrice.
const PRICE_RE = /(?:S?\$\s*)?(\d{1,4}\.\d{1,2})(?!\d)/g

function normPrice(raw: string): number {
  const parts = raw.split('.')
  if (parts.length === 2 && parts[1].length === 1) return parseFloat(raw + '0')
  return parseFloat(raw)
}

interface PriceMatch {
  value: number
  index: number
  length: number
}

function allPrices(line: string): PriceMatch[] {
  const matches: PriceMatch[] = []
  let m: RegExpExecArray | null
  PRICE_RE.lastIndex = 0
  while ((m = PRICE_RE.exec(line)) !== null) {
    if (line[m.index + m[0].length] === '%') continue
    const value = normPrice(m[1])
    if (value > 0 && value < 9999.99) {
      matches.push({ value, index: m.index, length: m[0].length })
    }
  }

  // Thermal printers sometimes drop the decimal point ("990" → $9.90).
  // Require wide column gap so postcodes / phone numbers are not mistaken.
  if (!line.includes('.')) {
    const implicit = line.match(/\s{2,}(\d{3,4})(?:\s*[|}\]])?\s*$/)
    if (implicit && !/[/:]|gst\s*reg/i.test(line)) {
      const value = parseInt(implicit[1], 10) / 100
      if (value > 0 && value < 500) {
        const index = line.lastIndexOf(implicit[1])
        const overlaps = matches.some(
          (pm) => index >= pm.index && index < pm.index + pm.length,
        )
        if (!overlaps) {
          matches.push({ value, index, length: implicit[1].length })
        }
      }
    }
  }

  return matches.sort((a, b) => a.index - b.index)
}

function extractSignedAmount(line: string): number | null {
  // Explicit negative sign: "-$1.23" or "- 1.23"
  const negMatch = line.match(/-\s*(?:S?\$\s*)?(\d{1,4}\.\d{1,2})/)
  if (negMatch) return -normPrice(negMatch[1])

  // Parenthetical negative: "(1.23)" or "($1.23)" or "($135, 80)"
  const parenMatch = line.match(/[{(\[]\s*S?\$?\s*(\d{1,4})[.,](\d{2})\s*[)\]}]/)
  if (parenMatch) return -normPrice(`${parenMatch[1]}.${parenMatch[2]}`)

  const parenPlain = line.match(/\(\s*S?\$?\s*(\d{1,4}\.\d{1,2})\s*\)/)
  if (parenPlain) return -normPrice(parenPlain[1])

  const prices = allPrices(line)
  return prices.length > 0 ? prices[prices.length - 1].value : null
}

function matchChargePattern(line: string): {
  type: ChargeType
  forceNegative?: boolean
} | null {
  for (const { type, re, forceNegative } of CHARGE_PATTERNS) {
    if (re.test(line)) return { type, forceNegative }
  }
  return null
}

function detectCharge(line: string, fallbackAmount?: number): ParsedCharge | null {
  const pattern = matchChargePattern(line)
  if (!pattern) return null
  const raw = extractSignedAmount(line) ?? fallbackAmount ?? null
  if (raw === null) return null
  const amount = pattern.forceNegative && raw > 0 ? -raw : raw
  return { type: pattern.type, label: line, amount }
}

function extractQty(text: string): { name: string; qty: number } {
  let name = text.trim()
  let qty = 1

  // "(1) Add Noodle" — modifier label, not a line quantity prefix
  if (/^\(\d{1,2}\)\s/.test(name)) {
    return { name, qty: 1 }
  }

  // "2 x Foo" or "2 × Foo" or "2 @ Foo"
  const front = name.match(/^(\d{1,2})\s*[x×@]\s+/i)
  if (front) {
    qty = Math.max(1, parseInt(front[1]))
    name = name.slice(front[0].length)
    return { name, qty }
  }

  // "2 6657 Honey Butterfly" — qty + POS item code + name (Sanook-style)
  const withCode = name.match(/^(\d{1,2})\s+(\d{3,4})\s+(.+)$/)
  if (withCode) {
    qty = Math.max(1, parseInt(withCode[1]))
    name = withCode[3].trim()
    return { name, qty }
  }

  // "Foo x2" or "Foo ×2"
  const back = name.match(/\s+[x×]\s*(\d{1,2})$/i)
  if (back) {
    qty = Math.max(1, parseInt(back[1]))
    name = name.slice(0, name.length - back[0].length)
    return { name, qty }
  }

  // "2 Foo" or "3 (Promo) Guinness" — bare leading quantity
  const bare = name.match(/^(\d{1,2})\s+(?=[A-Za-z(])/)
  if (bare) {
    qty = Math.max(1, parseInt(bare[1]))
    name = name.slice(bare[0].length)
  }

  return { name, qty }
}

function cleanName(raw: string): string {
  return raw
    .replace(/^\d{3,}\s+/, '')
    .replace(/^[A-Za-z]\s+(?=[A-Z(])/, '')  // stray single-char OCR prefix ("J BRAISED")
    .replace(/^[^\w(]+\s*/, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function isLikelySummaryLine(name: string, price: number): boolean {
  if (matchChargePattern(name)) return true
  if (/\b(?:sub\s*total|cubtota|subtota|grand\s*total|amount\s+due)\b/i.test(name)) return true
  if (price >= 100) {
    const alpha = (name.match(/[a-zA-Z]/g) ?? []).length
    const ratio = name.length > 0 ? alpha / name.length : 0
    if (ratio < 0.45) return true
  }
  return false
}

function isJunkNameLine(raw: string): boolean {
  const trimmed = raw.trim()
  if (trimmed.length < 2) return true
  if (/^[\W_=]+$/.test(trimmed)) return true
  const alpha = (trimmed.match(/[a-zA-Z]/g) ?? []).length
  return alpha < 2
}

function scoreConfidence(name: string, priceCount: number): Confidence {
  const alpha = (name.match(/[a-zA-Z]/g) ?? []).length
  const ratio = name.length > 0 ? alpha / name.length : 0
  if (priceCount >= 3 || name.length < 3) return 'low'
  if (priceCount === 1 && name.length >= 4 && ratio >= 0.5) return 'high'
  return 'medium'
}

export function parseReceipt(rawText: string): ParseResult {
  const items: ParsedItem[] = []
  const charges: ParsedCharge[] = []
  const warnings: string[] = []

  const lines = normalizeOcrText(rawText)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length >= 3)

  // Tracks name-only lines for orphan-price joins (price on the next line).
  let orphanName: string | null = null
  const pendingAmounts: number[] = []
  let pendingItemPrice: number | null = null

  const looksLikeNewItemLine = (line: string) =>
    /^\d{1,2}\s+(\d{3,4}\s+)?[A-Za-z(]/.test(line)

  for (const line of lines) {
    if (NOISE_RE.test(line)) {
      orphanName = null
      continue
    }

    const chargePattern = matchChargePattern(line)
    const inlineAmount = extractSignedAmount(line)

    if (chargePattern && inlineAmount === null && pendingAmounts.length > 0) {
      const amount = pendingAmounts.pop()!
      const signed =
        chargePattern.forceNegative && amount > 0 ? -amount : amount
      charges.push({ type: chargePattern.type, label: line, amount: signed })
      orphanName = null
      continue
    }

    const prices = allPrices(line)

    // Standalone total line: "$445.79" with no label (must include $)
    if (prices.length === 1 && /^\s*\$\s*\d{1,4}\.\d{2}\s*$/.test(line)) {
      if (prices[0].value >= 20) {
        charges.push({ type: 'total', label: line, amount: prices[0].value })
        orphanName = null
        continue
      }
    }

    if (prices.length === 0) {
      if (looksLikeNewItemLine(line) && items.length > 0 && /^tot$/i.test(items[items.length - 1].name)) {
        const prev = items.pop()!
        pendingItemPrice = prev.totalPrice
        orphanName = line
        continue
      }
      if (chargePattern) {
        orphanName = line
      } else if (looksLikeNewItemLine(line)) {
        orphanName = line
      } else if (orphanName) {
        const merged = `${orphanName} ${line}`.trim()
        orphanName = merged.length <= 48 ? merged : orphanName
      } else {
        orphanName = line
      }
      continue
    }

    const charge = detectCharge(line)
    if (charge) {
      orphanName = null
      pendingAmounts.length = 0
      charges.push(charge)
      continue
    }

    const last = prices[prices.length - 1]
    let rawName = line.slice(0, last.index).trim()

    if (isJunkNameLine(rawName)) {
      if (orphanName !== null) {
        rawName = orphanName
        const combinedCharge = detectCharge(rawName + ' ' + line.trim())
        if (combinedCharge) {
          orphanName = null
          charges.push(combinedCharge)
          continue
        }
      } else if (/^[\W_=]+\s*$/.test(rawName)) {
        continue
      } else {
        pendingAmounts.push(last.value)
        continue
      }
    }

    const joinedOrphan = orphanName
    orphanName = null
    pendingAmounts.length = 0

    const { name: nameWithQty, qty } = extractQty(rawName)
    let name = cleanName(nameWithQty)
    let totalPrice = last.value
    let quantity = qty

    if (joinedOrphan && (/^tot$/i.test(name) || name.length <= 3) && totalPrice < 50) {
      name = cleanName(extractQty(joinedOrphan).name)
    } else if (/^tot$/i.test(name) && totalPrice < 50) {
      pendingItemPrice = totalPrice
      continue
    } else if (pendingItemPrice !== null && looksLikeNewItemLine(joinedOrphan ?? rawName)) {
      name = cleanName(extractQty(joinedOrphan ?? rawName).name)
      totalPrice = pendingItemPrice
      quantity = extractQty(joinedOrphan ?? rawName).qty
      pendingItemPrice = null
    }

    if (name.length < 2 || name.length > 52) continue
    if (name.length > 28 && totalPrice < 25 && !/^\d/.test(rawName)) continue

    const unitPrice = quantity > 1 ? Math.round((totalPrice / quantity) * 100) / 100 : totalPrice
    const confidence = scoreConfidence(name, prices.length)

    items.push({ name, unitPrice, quantity, totalPrice, confidence })
  }

  // ── Warnings ──────────────────────────────────────────────────────────────

  const subtotal = charges.find((c) => c.type === 'subtotal')
  const totals   = charges.filter((c) => c.type === 'total')

  if (totals.length > 1) {
    warnings.push('Multiple total lines detected — verify the correct total.')
  }

  if (totals.length === 0 && items.length > 0) {
    warnings.push('No total line detected — add the total manually.')
  }

  const lowCount = items.filter((it) => it.confidence === 'low').length
  if (lowCount > 0) {
    warnings.push(
      `${lowCount} item${lowCount > 1 ? 's' : ''} ` +
      `${lowCount > 1 ? 'have' : 'has'} low OCR confidence — check names and prices carefully.`,
    )
  }

  const totalCharge = charges.find((c) => c.type === 'total')
  const filteredItems = items.filter((it) => {
    if (isLikelySummaryLine(it.name, it.totalPrice)) return false
    // OCR sometimes assigns subtotal/total amounts to the last item (e.g. "Ajitama 226.50")
    if (subtotal !== undefined && Math.abs(it.totalPrice - subtotal.amount) < 0.02) {
      if (it.totalPrice > 80 || matchChargePattern(it.name)) return false
    }
    if (totalCharge !== undefined && Math.abs(it.totalPrice - totalCharge.amount) < 0.02) {
      if (matchChargePattern(it.name)) return false
    }
    return true
  })

  if (filteredItems.length < items.length) {
    warnings.push('Removed lines that look like receipt totals, not items.')
  }

  const result = repairParsedReceipt({ items: filteredItems, charges, warnings }, rawText)

  const repairedSubtotal = result.charges.find((c) => c.type === 'subtotal')
  if (repairedSubtotal !== undefined) {
    const discountSum = result.charges
      .filter((c) => c.type === 'discount')
      .reduce((s, c) => s + c.amount, 0)
    const netItems = result.items.reduce((s, it) => s + it.totalPrice, 0) + discountSum
    const diff = Math.abs(netItems - repairedSubtotal.amount)
    if (diff > 0.10) {
      result.warnings.push(
        `Items sum $${netItems.toFixed(2)} differs from detected subtotal ` +
        `$${repairedSubtotal.amount.toFixed(2)} — some items may be missing.`,
      )
    }
  }

  return result
}

