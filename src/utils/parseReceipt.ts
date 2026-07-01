// Receipt text parser — line-by-line heuristics for common SG receipt formats.
// Intentionally simple: the Review screen lets users fix whatever is wrong.

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
    // Comma-as-decimal separator ("3,50" → "3.50") — common on thermal printers
    .replace(/\b(\d{1,4}),(\d{2})\b/g, '$1.$2')
    // Interpunct / middle dot ("3·50" → "3.50")
    .replace(/(\d)[·•](\d)/g, '$1.$2')
    // Space after decimal point ("13. 00" → "13.00") — Tesseract inserts this
    // when receipt columns cause the cents to be spaced away from the dot
    .replace(/(\d)\.\s+(\d{2})\b/g, '$1.$2')
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
    '\\bmastercard\\b',
    '\\bamex\\b',
    '\\bpayment\\b',
    '\\bpaid\\s*by\\b',
    '\\bref(?:erence)?\\s*(?:no|#)\\b',
    '\\breceipt\\s*(?:no|#|num)\\b',
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
  { type: 'subtotal',       re: /\b(sub[\s-]?total|sub[\s-]?amt)\b/i },
  { type: 'gst',            re: /\bgst\b|\bg\.s\.t\.?\b/i },
  { type: 'gst',            re: /\b\d+%\s*(?:tax|vat)\b|\btax\b|\bvat\b/i },
  {
    type: 'service_charge',
    // covers: Service Charge, Svc Ch, Svc Chrg, Svr Ch, Svr Chrg, S/C
    re: /\bservice\s*charges?\b|\bsvc\.?\s*ch(?:r?g?)?\b|\bsvr\.?\s*ch(?:r?g?)?\b|\bs\/c\b/i,
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
    // Ignore percentage values like "10.00%"
    if (line[m.index + m[0].length] === '%') continue
    const value = normPrice(m[1])
    if (value > 0 && value < 9999.99) {
      matches.push({ value, index: m.index, length: m[0].length })
    }
  }
  return matches
}

function extractSignedAmount(line: string): number | null {
  // Explicit negative sign: "-$1.23" or "- 1.23"
  const negMatch = line.match(/-\s*(?:S?\$\s*)?(\d{1,4}\.\d{1,2})/)
  if (negMatch) return -normPrice(negMatch[1])

  // Parenthetical negative: "(1.23)" or "($1.23)"
  const parenMatch = line.match(/\(\s*S?\$?\s*(\d{1,4}\.\d{1,2})\s*\)/)
  if (parenMatch) return -normPrice(parenMatch[1])

  const prices = allPrices(line)
  return prices.length > 0 ? prices[prices.length - 1].value : null
}

function detectCharge(line: string): ParsedCharge | null {
  for (const { type, re, forceNegative } of CHARGE_PATTERNS) {
    if (!re.test(line)) continue
    const raw = extractSignedAmount(line)
    if (raw === null) return null
    const amount = forceNegative && raw > 0 ? -raw : raw
    return { type, label: line, amount }
  }
  return null
}

function extractQty(text: string): { name: string; qty: number } {
  let name = text.trim()
  let qty = 1

  // "2 x Foo" or "2 × Foo" or "2 @ Foo"
  const front = name.match(/^(\d{1,2})\s*[x×@]\s+/i)
  if (front) {
    qty = Math.max(1, parseInt(front[1]))
    name = name.slice(front[0].length)
  } else {
    // "Foo x2" or "Foo ×2"
    const back = name.match(/\s+[x×]\s*(\d{1,2})$/i)
    if (back) {
      qty = Math.max(1, parseInt(back[1]))
      name = name.slice(0, name.length - back[0].length)
    } else {
      // "2 Foo" — bare leading quantity (common on SG POS receipts).
      // Only strip when immediately followed by a letter or "(" so we don't
      // accidentally eat 3-digit item codes (those are handled by cleanName).
      const bare = name.match(/^(\d{1,2})\s+(?=[A-Za-z(])/)
      if (bare) {
        qty = Math.max(1, parseInt(bare[1]))
        name = name.slice(bare[0].length)
      }
    }
  }
  return { name, qty }
}

function cleanName(raw: string): string {
  return raw
    .replace(/^\d{3,}\s+/, '')         // strip 3+ digit leading item codes
    .replace(/^[*\-#.•|\\/]+\s*/, '')  // strip leading symbols
    .replace(/\s{2,}/g, ' ')           // collapse OCR-artifact double spaces
    .trim()
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

  // Tracks the last non-noise, price-free line so we can join it with a
  // following price-only line (common in column-layout receipt formats).
  let orphanName: string | null = null

  for (const line of lines) {
    if (NOISE_RE.test(line)) {
      orphanName = null
      continue
    }

    const prices = allPrices(line)

    if (prices.length === 0) {
      // No price on this line — remember it; the price may be on the next line.
      orphanName = line
      continue
    }

    // Line has at least one price — check for a named charge first.
    const charge = detectCharge(line)
    if (charge) {
      orphanName = null
      charges.push(charge)
      continue
    }

    const last = prices[prices.length - 1]
    let rawName = line.slice(0, last.index).trim()

    // Orphan-price join: if this line has no name before the price, try using
    // the previous name-only line (price was printed on a separate line).
    if (rawName.length < 2 && orphanName !== null) {
      rawName = orphanName
      // Re-check the combined text in case it's actually a charge (e.g. "GST\n0.88")
      const combinedCharge = detectCharge(rawName + ' ' + line.trim())
      if (combinedCharge) {
        orphanName = null
        charges.push(combinedCharge)
        continue
      }
    }

    orphanName = null

    if (rawName.length < 2) continue

    const { name: nameWithQty, qty } = extractQty(rawName)
    const name = cleanName(nameWithQty)
    if (name.length < 2) continue

    const totalPrice = last.value
    const unitPrice = qty > 1 ? Math.round((totalPrice / qty) * 100) / 100 : totalPrice
    const confidence = scoreConfidence(name, prices.length)

    items.push({ name, unitPrice, quantity: qty, totalPrice, confidence })
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

  if (subtotal !== undefined) {
    const itemSum = items.reduce((s, it) => s + it.totalPrice, 0)
    const diff = Math.abs(itemSum - subtotal.amount)
    if (diff > 0.10) {
      warnings.push(
        `Items sum $${itemSum.toFixed(2)} differs from detected subtotal ` +
        `$${subtotal.amount.toFixed(2)} — some items may be missing.`,
      )
    }
  }

  const lowCount = items.filter((it) => it.confidence === 'low').length
  if (lowCount > 0) {
    warnings.push(
      `${lowCount} item${lowCount > 1 ? 's' : ''} ` +
      `${lowCount > 1 ? 'have' : 'has'} low OCR confidence — check names and prices carefully.`,
    )
  }

  return { items, charges, warnings }
}

// Backward-compatible shim used by Scan.tsx — returns only the items array.
export function parseReceiptText(rawText: string): ParsedItem[] {
  return parseReceipt(rawText).items
}
