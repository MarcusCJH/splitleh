import { describe, it, expect } from 'vitest'
import { parseReceipt } from '../parseReceipt'

describe('sample OCR output', () => {
  it('parses SINGLE_COLUMN Natureland output', () => {
    const text = [
      'Natureland Cafe',
      '1 (Promg) Guinness              $13.00',
      '1 Apple Juice             $5.00',
      '1 Nikka FT barrel Gls           $18. 00',
      '[TEM DISC 30%                ($5. 40)',
      '2 Ki No Bi Bt]                 $456. 00',
      'ITEM DISC 30%              ($136. 80)',
      '2 Moscato (WP)                 $22.00',
      'SUBTOTAL$371. 80',
      '10% Svr Chrg                  $37.18',
      '0% GST$36. 81',
      'TOTAL      $445. 79',
      'Vis$445. 79',
    ].join('\n')
    const result = parseReceipt(text)
    console.log(JSON.stringify(result, null, 2))
    expect(result.items.length).toBeGreaterThanOrEqual(5)
  })
})
