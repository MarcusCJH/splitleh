import { createWorker, PSM } from 'tesseract.js'
import type { LoggerMessage } from 'tesseract.js'
import { parseReceipt } from './parseReceipt'
import type { ParseResult } from './parseReceipt'
import { reconcileReceipt } from './receiptReconcile'
import type { Reconciliation } from './receiptReconcile'
import { preprocessReceiptImage, preprocessReceiptImageGrayscale } from './receiptImage'

const PSM_CASCADE = [
  PSM.SINGLE_COLUMN,
  PSM.SPARSE_TEXT,
  PSM.SINGLE_BLOCK,
  PSM.RAW_LINE,
] as const

const SCORE_EARLY_EXIT = 45

const RECEIPT_INIT = {
  load_system_dawg: '0',
  load_freq_dawg: '0',
  load_unambig_dawg: '0',
  load_punc_dawg: '0',
  load_number_dawg: '0',
  load_bigram_dawg: '0',
} as const

export function scoreParsedReceipt(text: string): number {
  return scoreParseResult(parseReceipt(text))
}

export function scoreParseResult(result: ParseResult): number {
  const { items, charges, warnings } = result
  let score = 0

  for (const item of items) {
    const alpha = (item.name.match(/[a-zA-Z]/g) ?? []).length
    const ratio = item.name.length > 0 ? alpha / item.name.length : 0
    if (ratio < 0.4 || item.name.length > 55) {
      score -= 12
      continue
    }
    if (item.totalPrice > 500) {
      score -= 8
      continue
    }
    score += 10
    if (item.confidence === 'high') score += 4
    if (item.quantity > 1) score += 2
  }

  score += charges.filter((c) => c.type === 'subtotal').length * 25
  score += charges.filter((c) => c.type === 'total').length * 25
  score += charges.filter((c) => ['gst', 'service_charge', 'discount'].includes(c.type)).length * 10
  score -= warnings.length * 8

  const recon = reconcileReceipt(result)
  if (recon.status === 'ok') score += 35
  else if (recon.totalDiff !== null && recon.totalDiff <= 0.03) score += 25
  else if (recon.status === 'warn') score += 10
  else score -= 20

  const subtotal = charges.find((c) => c.type === 'subtotal')
  if (subtotal && subtotal.amount > 0) {
    const itemSum = items.reduce((s, it) => s + it.totalPrice, 0)
    const diff = Math.abs(itemSum - subtotal.amount)
    if (diff < 1) score += 15
    else if (diff < 30) score += 3
    else score -= 10
  }

  return score
}

export interface OcrResult {
  rawText: string
  parseResult: ParseResult
  reconciliation: Reconciliation
  processedImageUrl: string
}

export async function runReceiptOcr(
  dataUrl: string,
  onUpdate: (status: string, progress: number) => void,
  alreadyProcessed?: string,
): Promise<OcrResult> {
  let processedImageUrl: string
  let grayscaleImageUrl: string | undefined
  if (alreadyProcessed) {
    processedImageUrl = alreadyProcessed
  } else {
    onUpdate('Preparing image…', 2)
    const [binarized, grayscale] = await Promise.all([
      preprocessReceiptImage(dataUrl),
      preprocessReceiptImageGrayscale(dataUrl),
    ])
    processedImageUrl = binarized
    grayscaleImageUrl = grayscale
  }

  const ocrImages = grayscaleImageUrl
    ? [processedImageUrl, grayscaleImageUrl]
    : [processedImageUrl]

  const worker = await createWorker('eng', 1, {
    logger: (m: LoggerMessage) => mapLoggerProgress(m, onUpdate),
  }, RECEIPT_INIT)

  try {
    let best = { text: '', score: -1 }

    for (const imageUrl of ocrImages) {
      for (let i = 0; i < PSM_CASCADE.length; i++) {
        const psm = PSM_CASCADE[i]
        onUpdate(
          `Reading receipt (${i + 1}/${PSM_CASCADE.length})…`,
          48 + Math.round((i / PSM_CASCADE.length) * 40),
        )

        await worker.setParameters({
          tessedit_pageseg_mode: psm,
          user_defined_dpi: '300',
          preserve_interword_spaces: '1',
        })

        const { data } = await worker.recognize(imageUrl)
        const text = data.text ?? ''
        const score = scoreParsedReceipt(text)

        if (score > best.score) best = { text, score }
        if (score >= SCORE_EARLY_EXIT) break
      }
      if (best.score >= SCORE_EARLY_EXIT) break
    }

    onUpdate('Checking receipt math…', 95)
    const parseResult = parseReceipt(best.text)
    const reconciliation = reconcileReceipt(parseResult)
    return { rawText: best.text, parseResult, reconciliation, processedImageUrl }
  } finally {
    await worker.terminate()
  }
}

function mapLoggerProgress(
  m: LoggerMessage,
  onUpdate: (status: string, progress: number) => void,
): void {
  const { status, progress } = m
  let pct = 0
  let label = ''

  if (status === 'loading tesseract core') {
    pct = 8
    label = 'Loading OCR engine…'
  } else if (status === 'initializing tesseract') {
    pct = 13
    label = 'Initializing…'
  } else if (status === 'loading language traineddata') {
    pct = 13 + progress * 30
    label = 'Downloading language data…'
  } else if (status === 'initializing api') {
    pct = 45
    label = 'Almost ready…'
  }

  if (label) onUpdate(label, Math.round(pct))
}
