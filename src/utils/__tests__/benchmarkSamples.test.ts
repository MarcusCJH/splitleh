/**
 * Benchmark OCR + parse on samples/*.jpg (optional local files).
 * Run: npx vitest run src/utils/__tests__/benchmarkSamples.test.ts
 */
import { describe, it } from 'vitest'
import { existsSync } from 'fs'
import { createWorker, PSM } from 'tesseract.js'
import { parseReceipt } from '../parseReceipt'
import { scoreParsedReceipt } from '../receiptOcr'
import { reconcileReceipt } from '../receiptReconcile'

const SAMPLES = ['sample.jpg', 'sample2.jpg', 'sample3.jpg', 'sample4.jpg']
const PSM_CASCADE = [PSM.SINGLE_COLUMN, PSM.SPARSE_TEXT, PSM.SINGLE_BLOCK, PSM.RAW_LINE]

const RECEIPT_INIT = {
  load_system_dawg: '0',
  load_freq_dawg: '0',
  load_unambig_dawg: '0',
  load_punc_dawg: '0',
  load_number_dawg: '0',
  load_bigram_dawg: '0',
} as const

async function ocrSample(path: string) {
  const worker = await createWorker('eng', 1, {}, RECEIPT_INIT)
  let best = { text: '', score: -1 }

  for (const psm of PSM_CASCADE) {
    await worker.setParameters({
      tessedit_pageseg_mode: psm,
      user_defined_dpi: '300',
      preserve_interword_spaces: '1',
    })
    const { data } = await worker.recognize(path)
    const text = data.text ?? ''
    const score = scoreParsedReceipt(text)
    if (score > best.score) best = { text, score }
  }

  await worker.terminate()
  return best
}

describe('benchmark samples', () => {
  for (const file of SAMPLES) {
    it(`scans ${file}`, async () => {
      const path = `samples/${file}`
      if (!existsSync(path)) return

      const { text, score } = await ocrSample(path)
      const result = parseReceipt(text)
      const recon = reconcileReceipt(result)

      console.log(`\n${'='.repeat(60)}\n${file} (score ${score})\n${'='.repeat(60)}`)
      console.log('\n--- ITEMS ---')
      for (const it of result.items) {
        console.log(
          `  qty=${it.quantity} unit=$${it.unitPrice.toFixed(2)} total=$${it.totalPrice.toFixed(2)}  ${it.name}`,
        )
      }
      console.log('\n--- CHARGES ---')
      for (const c of result.charges) {
        console.log(`  ${c.type}: ${c.amount}`)
      }
      if (result.warnings.length) console.log('\n--- WARNINGS ---', result.warnings)
      console.log('\n--- RECON ---', recon.status, recon.messages)
      console.log('\n--- TEXT (first 40 lines) ---')
      console.log(text.split('\n').slice(0, 40).join('\n'))
    }, 120000)
  }
})
