// Browser-side receipt photo preprocessing for Tesseract.js.
// Pipeline: grayscale → CLAHE → crop dark margins → adaptive binarization.
//
// Memory budget (worst case at MAX=1200, portrait 900×1200):
//   canvas ImageData : 900×1200×4 =  4.3 MB
//   CLAHE gray+output: 900×1200×1 =  1.1 MB ×2
//   Int32 integral   : 901×1201×4 =  4.3 MB   ← single integral, not two Float64s
//   output ImageData : 900×1200×4 =  4.3 MB
//   Total peak       :            ≈ 15 MB   (was 140 MB with Sauvola at 2400px)

function applyClahe(gray: Uint8Array, width: number, height: number): void {
  const tilesX = 8
  const tilesY = 8
  const clipLimit = 2.5
  const tileW = Math.ceil(width / tilesX)
  const tileH = Math.ceil(height / tilesY)
  const output = new Uint8Array(gray.length)

  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      const x0 = tx * tileW
      const y0 = ty * tileH
      const x1 = Math.min(width, x0 + tileW)
      const y1 = Math.min(height, y0 + tileH)

      const hist = new Uint32Array(256)
      let count = 0
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          hist[gray[y * width + x]]++
          count++
        }
      }

      const clipThreshold = Math.max(1, Math.floor((count / 256) * clipLimit))
      let excess = 0
      for (let i = 0; i < 256; i++) {
        if (hist[i] > clipThreshold) {
          excess += hist[i] - clipThreshold
          hist[i] = clipThreshold
        }
      }
      const redist = Math.floor(excess / 256)
      for (let i = 0; i < 256; i++) hist[i] += redist

      const cdf = new Uint32Array(256)
      cdf[0] = hist[0]
      for (let i = 1; i < 256; i++) cdf[i] = cdf[i - 1] + hist[i]

      const cdfMin = cdf.find((v) => v > 0) ?? 0
      const scale = cdfMin < count ? (255 / (count - cdfMin)) : 0

      const lut = new Uint8Array(256)
      for (let i = 0; i < 256; i++) {
        lut[i] = scale > 0 ? Math.round((cdf[i] - cdfMin) * scale) : i
      }

      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          output[y * width + x] = lut[gray[y * width + x]]
        }
      }
    }
  }

  gray.set(output)
}

function cropToContent(imageData: ImageData, pad = 12): ImageData {
  const { data, width, height } = imageData

  const corners = [
    0,
    (width - 1) * 4,
    (height - 1) * width * 4,
    ((height - 1) * width + (width - 1)) * 4,
  ]
  let bg = 0
  for (const i of corners) bg += data[i]
  bg /= corners.length

  let minX = width
  let minY = height
  let maxX = 0
  let maxY = 0

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const v = data[i]
      if (Math.abs(v - bg) > 25 || v < 210) {
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
      }
    }
  }

  if (maxX <= minX || maxY <= minY) return imageData

  minX = Math.max(0, minX - pad)
  minY = Math.max(0, minY - pad)
  maxX = Math.min(width - 1, maxX + pad)
  maxY = Math.min(height - 1, maxY + pad)

  const cropW = maxX - minX + 1
  const cropH = maxY - minY + 1
  const cropped = new ImageData(cropW, cropH)
  for (let y = 0; y < cropH; y++) {
    for (let x = 0; x < cropW; x++) {
      const src = ((minY + y) * width + (minX + x)) * 4
      const dst = (y * cropW + x) * 4
      cropped.data[dst]     = data[src]
      cropped.data[dst + 1] = data[src + 1]
      cropped.data[dst + 2] = data[src + 2]
      cropped.data[dst + 3] = 255
    }
  }
  return cropped
}

// Mean-based adaptive threshold via a single integral image (Int32).
// Int32 is safe here: max value = 255 × w × h ≤ 255 × 900 × 1200 = 274 M < 2.1 B.
// Uses less than half the memory of Sauvola (which needs two Float64 integrals).
function adaptiveBinarize(imageData: ImageData, radius = 25, bias = 8): ImageData {
  const { data, width, height } = imageData
  const n = width * height

  const integral = new Int32Array((width + 1) * (height + 1))
  for (let y = 0; y < height; y++) {
    let rowSum = 0
    for (let x = 0; x < width; x++) {
      rowSum += data[(y * width + x) * 4]
      integral[(y + 1) * (width + 1) + (x + 1)] =
        rowSum + integral[y * (width + 1) + (x + 1)]
    }
  }

  const output = new ImageData(width, height)
  const out = output.data
  for (let i = 0; i < n; i++) {
    const y = Math.floor(i / width)
    const x = i % width
    const y1 = Math.max(0, y - radius)
    const y2 = Math.min(height - 1, y + radius)
    const x1 = Math.max(0, x - radius)
    const x2 = Math.min(width - 1, x + radius)
    const count = (x2 - x1 + 1) * (y2 - y1 + 1)
    const sum =
      integral[(y2 + 1) * (width + 1) + (x2 + 1)] -
      integral[y1       * (width + 1) + (x2 + 1)] -
      integral[(y2 + 1) * (width + 1) + x1      ] +
      integral[y1       * (width + 1) + x1      ]
    const threshold = sum / count - bias
    const val = data[i * 4] >= threshold ? 255 : 0
    const j = i * 4
    out[j] = val; out[j + 1] = val; out[j + 2] = val; out[j + 3] = 255
  }
  return output
}

function loadScaledGray(dataUrl: string): Promise<{
  gray: Uint8Array
  w: number
  h: number
}> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const MAX = 1600
      const MIN = 1000
      const longest = Math.max(img.width, img.height)
      const scale =
        longest > MAX
          ? MAX / longest
          : longest < MIN
            ? Math.min(2, MIN / longest)
            : 1

      const w = Math.round(img.width * scale)
      const h = Math.round(img.height * scale)

      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')!

      ctx.filter = 'grayscale(1) contrast(1.15)'
      ctx.drawImage(img, 0, 0, w, h)

      let imageData = ctx.getImageData(0, 0, w, h)
      const gray = new Uint8Array(w * h)
      for (let i = 0; i < w * h; i++) gray[i] = imageData.data[i * 4]
      applyClahe(gray, w, h)

      resolve({ gray, w, h })
    }
    img.onerror = reject
    img.src = dataUrl
  })
}

function grayToDataUrl(gray: Uint8Array, w: number, h: number, binarize: boolean): string {
  let imageData = new ImageData(w, h)
  for (let i = 0; i < w * h; i++) {
    imageData.data[i * 4] = gray[i]
    imageData.data[i * 4 + 1] = gray[i]
    imageData.data[i * 4 + 2] = gray[i]
    imageData.data[i * 4 + 3] = 255
  }

  imageData = cropToContent(imageData)
  const canvas = document.createElement('canvas')
  canvas.width = imageData.width
  canvas.height = imageData.height
  const ctx = canvas.getContext('2d')!
  ctx.putImageData(binarize ? adaptiveBinarize(imageData) : imageData, 0, 0)
  return canvas.toDataURL('image/png')
}

/** CLAHE + crop, no binarization — often better on shadowed phone photos. */
export async function preprocessReceiptImageGrayscale(dataUrl: string): Promise<string> {
  const { gray, w, h } = await loadScaledGray(dataUrl)
  return grayToDataUrl(gray, w, h, false)
}

/** CLAHE + crop + adaptive binarization — best for clean scans. */
export function preprocessReceiptImage(dataUrl: string): Promise<string> {
  return loadScaledGray(dataUrl).then(({ gray, w, h }) => grayToDataUrl(gray, w, h, true))
}
