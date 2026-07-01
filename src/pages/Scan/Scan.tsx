import { useRef, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { createWorker, PSM } from 'tesseract.js'
import type { LoggerMessage } from 'tesseract.js'
import { useReceipt } from '../../store/ReceiptContext'
import { parseReceiptText } from '../../utils/parseReceipt'
import type { ParsedItem } from '../../utils/parseReceipt'
import { formatCurrency } from '../../utils/split'
import styles from './Scan.module.css'

// ── State machine ─────────────────────────────────────────────────────────────

type ScanState =
  | { mode: 'idle' }
  | { mode: 'preview';  dataUrl: string }
  | { mode: 'scanning'; dataUrl: string; ocrStatus: string; progress: number }
  | { mode: 'parsed';   dataUrl: string; rawText: string; items: ParsedItem[] }
  | { mode: 'error';    dataUrl: string; message: string }

// ── Image preprocessor ────────────────────────────────────────────────────────

// Otsu's global thresholding: finds the intensity split that maximises
// between-class variance, then converts every pixel to pure black or white.
// This outperforms CSS contrast filters for thermal receipt photos because it
// adapts to the actual luminance distribution rather than applying a fixed boost.
function binarize(imageData: ImageData): ImageData {
  const { data, width, height } = imageData
  const n = width * height

  const hist = new Uint32Array(256)
  for (let i = 0; i < n; i++) hist[data[i * 4]]++

  let sum = 0
  for (let t = 0; t < 256; t++) sum += t * hist[t]

  let sumB = 0, wB = 0, max = 0, threshold = 128
  for (let t = 0; t < 256; t++) {
    wB += hist[t]
    if (wB === 0) continue
    const wF = n - wB
    if (wF === 0) break
    sumB += t * hist[t]
    const between = wB * wF * ((sumB / wB) - ((sum - sumB) / wF)) ** 2
    if (between > max) { max = between; threshold = t }
  }

  const output = new ImageData(width, height)
  const out = output.data
  for (let i = 0; i < n; i++) {
    const val = data[i * 4] >= threshold ? 255 : 0
    const j = i * 4
    out[j] = val; out[j + 1] = val; out[j + 2] = val; out[j + 3] = 255
  }
  return output
}

function preprocessImage(dataUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const MAX = 2400
      const MIN = 1200
      const longest = Math.max(img.width, img.height)
      const scale = longest > MAX
        ? MAX / longest
        : longest < MIN ? Math.min(2, MIN / longest) : 1

      const w = Math.round(img.width  * scale)
      const h = Math.round(img.height * scale)

      const canvas = document.createElement('canvas')
      canvas.width  = w
      canvas.height = h
      const ctx = canvas.getContext('2d')!

      ctx.filter = 'grayscale(1)'
      ctx.drawImage(img, 0, 0, w, h)

      ctx.putImageData(binarize(ctx.getImageData(0, 0, w, h)), 0, 0)
      resolve(canvas.toDataURL('image/png'))
    }
    img.onerror = reject
    img.src = dataUrl
  })
}

// ── OCR runner (module-level pure async fn) ───────────────────────────────────

async function runOcr(
  dataUrl: string,
  onUpdate: (status: string, progress: number) => void,
): Promise<{ rawText: string; items: ParsedItem[] }> {
  // Preprocess before handing off to Tesseract
  onUpdate('Preparing image…', 2)
  const processedUrl = await preprocessImage(dataUrl)

  const worker = await createWorker('eng', 1, {
    logger: (m: LoggerMessage) => {
      const { status, progress } = m
      let pct = 0
      let label = ''

      if (status === 'loading tesseract core') {
        pct = 8;  label = 'Loading OCR engine…'
      } else if (status === 'initializing tesseract') {
        pct = 13; label = 'Initializing…'
      } else if (status === 'loading language traineddata') {
        pct = 13 + progress * 30; label = 'Downloading language data…'
      } else if (status === 'initializing api') {
        pct = 45; label = 'Almost ready…'
      } else if (status === 'recognizing text') {
        pct = 48 + progress * 52; label = 'Reading receipt…'
      }

      if (label) onUpdate(label, Math.round(pct))
    },
  })

  try {
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
      // Tesseract defaults to 70 DPI; receipts are 200–300 DPI — setting this
      // correctly changes how Tesseract estimates character widths and spacing.
      user_defined_dpi: '300',
      // Prevent Tesseract from collapsing inter-word spaces (common on column-
      // aligned receipts where the gap between item name and price is wide).
      preserve_interword_spaces: '1',
    } as Parameters<typeof worker.setParameters>[0])

    const { data: { text } } = await worker.recognize(processedUrl)
    const items = parseReceiptText(text)
    return { rawText: text, items }
  } finally {
    await worker.terminate()
  }
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Scan() {
  const navigate  = useNavigate()
  const { draft, dispatch } = useReceipt()
  const fileRef   = useRef<HTMLInputElement>(null)
  const [state, setState] = useState<ScanState>({ mode: 'idle' })

  // ── File selection ──────────────────────────────────────────────────────────

  const handleFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) return
    const reader = new FileReader()
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string
      setState({ mode: 'preview', dataUrl })
    }
    reader.readAsDataURL(file)
  }, [])

  const onFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) handleFile(file)
      // Reset input so the same file can be re-selected after Retake
      e.target.value = ''
    },
    [handleFile],
  )

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      const file = e.dataTransfer.files?.[0]
      if (file) handleFile(file)
    },
    [handleFile],
  )

  // ── OCR ─────────────────────────────────────────────────────────────────────

  const startScan = useCallback(
    async (dataUrl: string) => {
      setState({ mode: 'scanning', dataUrl, ocrStatus: 'Starting…', progress: 0 })

      try {
        const { rawText, items } = await runOcr(dataUrl, (ocrStatus, progress) => {
          setState((prev) =>
            prev.mode === 'scanning' ? { ...prev, ocrStatus, progress } : prev,
          )
        })

        // Store image + raw text on-device; never sent to a server
        dispatch({
          type: 'SET_RECEIPT_META',
          payload: { rawImageDataUrl: dataUrl, rawText },
        })

        setState({ mode: 'parsed', dataUrl, rawText, items })
      } catch (err) {
        setState({
          mode: 'error',
          dataUrl,
          message: err instanceof Error ? err.message : String(err),
        })
      }
    },
    [dispatch],
  )

  // ── Confirm parsed items ─────────────────────────────────────────────────────

  const confirmItems = useCallback(
    (items: ParsedItem[]) => {
      dispatch({
        type: 'SET_ITEMS',
        payload: items.map((it) => ({
          id: crypto.randomUUID(),
          name:       it.name,
          unitPrice:  it.unitPrice,
          quantity:   it.quantity,
          totalPrice: it.totalPrice,
        })),
      })
      navigate('/review')
    },
    [dispatch, navigate],
  )

  // ── No session guard ────────────────────────────────────────────────────────

  if (!draft) {
    return (
      <div className={styles.page}>
        <div className={styles.emptyPage}>
          <p>No active session. Go home and start a new split.</p>
          <button className="btn btn-primary" onClick={() => navigate('/')}>
            Go Home
          </button>
        </div>
      </div>
    )
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Scan Receipt</h1>
        <p className={styles.sub}>
          {state.mode === 'idle'
            ? 'Upload or photograph your receipt. OCR runs in your browser — nothing is uploaded.'
            : state.mode === 'preview'
            ? 'Looks good? Tap Scan to extract items automatically.'
            : state.mode === 'scanning'
            ? 'Running OCR in your browser…'
            : state.mode === 'parsed'
            ? 'Review the extracted items before continuing.'
            : 'Something went wrong with OCR.'}
        </p>
      </header>

      {/* ── Idle: upload zone ─────────────────────────────────────────── */}
      {state.mode === 'idle' && (
        <>
          <div
            className={styles.uploadZone}
            onDrop={onDrop}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => fileRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && fileRef.current?.click()}
          >
            <span className={styles.uploadIcon}>📷</span>
            <p className={styles.uploadLabel}>Tap to take photo or choose file</p>
            <p className={styles.uploadHint}>JPEG · PNG · HEIC — drag &amp; drop also works</p>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={onFileChange}
              className={styles.hiddenInput}
              aria-label="Upload receipt image"
            />
          </div>

          <div className={styles.divider}><span>or skip OCR</span></div>

          <div className={styles.skipActions}>
            <button
              className="btn btn-secondary btn-full"
              onClick={() => navigate('/review')}
            >
              <PencilIcon /> Enter Items Manually
            </button>
          </div>
        </>
      )}

      {/* ── Preview ───────────────────────────────────────────────────── */}
      {state.mode === 'preview' && (
        <div className={styles.photoBlock}>
          <img
            src={state.dataUrl}
            alt="Receipt preview"
            className={styles.receiptImg}
          />
          <div className={styles.photoActions}>
            <button
              className="btn btn-secondary"
              onClick={() => { setState({ mode: 'idle' }); fileRef.current?.click() }}
            >
              <CameraIcon /> Retake
            </button>
            <button
              className="btn btn-primary"
              onClick={() => startScan(state.dataUrl)}
            >
              <ScanIcon /> Scan Receipt
            </button>
          </div>
        </div>
      )}

      {/* ── Scanning ──────────────────────────────────────────────────── */}
      {state.mode === 'scanning' && (
        <div className={styles.scanningBlock}>
          <img
            src={state.dataUrl}
            alt="Receipt being scanned"
            className={`${styles.receiptImg} ${styles.receiptImgDim}`}
          />

          <div className={`${styles.progressCard} card`}>
            <div className={styles.progressHeader}>
              <span className={styles.progressStatus}>{state.ocrStatus}</span>
              <span className={styles.progressPct}>{state.progress}%</span>
            </div>
            <div className={styles.progressTrack}>
              <div
                className={styles.progressFill}
                style={{ width: `${state.progress}%` }}
              />
            </div>
            {state.progress < 45 && (
              <p className={styles.progressHint}>
                Language data downloads once and is cached on your device.
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── Parsed ────────────────────────────────────────────────────── */}
      {state.mode === 'parsed' && (
        <ParsedView
          dataUrl={state.dataUrl}
          rawText={state.rawText}
          items={state.items}
          currency={draft.receipt.currency}
          onConfirm={confirmItems}
          onRetake={() => { setState({ mode: 'idle' }); fileRef.current?.click() }}
          onSkip={() => navigate('/review')}
        />
      )}

      {/* ── Error ─────────────────────────────────────────────────────── */}
      {state.mode === 'error' && (
        <ErrorView
          dataUrl={state.dataUrl}
          message={state.message}
          onRetry={() => startScan(state.dataUrl)}
          onRetake={() => { setState({ mode: 'idle' }); fileRef.current?.click() }}
          onSkip={() => navigate('/review')}
        />
      )}

      {/* Hidden file input reused across states */}
      {state.mode !== 'idle' && (
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={onFileChange}
          className={styles.hiddenInput}
          aria-label="Upload receipt image"
        />
      )}
    </div>
  )
}

// ── ParsedView ────────────────────────────────────────────────────────────────

interface ParsedViewProps {
  dataUrl: string
  rawText: string
  items: ParsedItem[]
  currency: string
  onConfirm: (items: ParsedItem[]) => void
  onRetake: () => void
  onSkip: () => void
}

function ParsedView({
  dataUrl, rawText, items, currency, onConfirm, onRetake, onSkip,
}: ParsedViewProps) {
  const [showRaw, setShowRaw] = useState(false)
  const hasItems = items.length > 0

  return (
    <div className={styles.parsedBlock}>
      {/* Thumbnail + result badge */}
      <div className={styles.thumbRow}>
        <img src={dataUrl} alt="Scanned receipt" className={styles.thumb} />
        <div className={styles.thumbMeta}>
          {hasItems ? (
            <>
              <span className={styles.thumbBadgeOk}>
                <CheckIcon /> OCR complete
              </span>
              <p className={styles.thumbCount}>
                Found <strong>{items.length}</strong> item{items.length !== 1 ? 's' : ''}
              </p>
            </>
          ) : (
            <>
              <span className={styles.thumbBadgeWarn}>
                <WarnIcon /> No items found
              </span>
              <p className={styles.thumbCount}>
                Add items manually on the next screen.
              </p>
            </>
          )}
        </div>
      </div>

      {/* Parsed item list */}
      {hasItems && (
        <ul className={styles.parsedList}>
          {items.map((item, i) => (
            <li key={i} className={styles.parsedItem}>
              <span className={styles.parsedName}>
                {item.name}
                {item.quantity > 1 && (
                  <span className={styles.parsedQty}> ×{item.quantity}</span>
                )}
              </span>
              <span className={styles.parsedPrice}>
                {formatCurrency(item.totalPrice, currency)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* Raw text disclosure */}
      <button
        className={styles.rawToggle}
        onClick={() => setShowRaw((v) => !v)}
        aria-expanded={showRaw}
      >
        <ChevronIcon open={showRaw} /> Raw OCR text
      </button>
      {showRaw && (
        <pre className={styles.rawText}>{rawText || '(empty)'}</pre>
      )}

      {/* CTAs */}
      <div className={styles.parsedActions}>
        <button className="btn btn-ghost" onClick={onRetake}>
          <CameraIcon /> Retake
        </button>
        {hasItems ? (
          <button
            className="btn btn-primary"
            onClick={() => onConfirm(items)}
          >
            Review &amp; Edit &rarr;
          </button>
        ) : (
          <button className="btn btn-primary" onClick={onSkip}>
            Add Manually &rarr;
          </button>
        )}
      </div>
    </div>
  )
}

// ── ErrorView ─────────────────────────────────────────────────────────────────

interface ErrorViewProps {
  dataUrl: string
  message: string
  onRetry: () => void
  onRetake: () => void
  onSkip: () => void
}

function ErrorView({ dataUrl, message, onRetry, onRetake, onSkip }: ErrorViewProps) {
  const [showDetail, setShowDetail] = useState(false)
  const isOffline = !navigator.onLine || message.toLowerCase().includes('fetch')

  return (
    <div className={styles.errorBlock}>
      <img src={dataUrl} alt="Receipt" className={`${styles.receiptImg} ${styles.receiptImgDim}`} />

      <div className={`${styles.errorCard} card`}>
        <span className={styles.errorIcon}>⚠️</span>
        <div>
          <strong>OCR failed</strong>
          <p>
            {isOffline
              ? 'Language data needs to download on first use. Check your connection and try again.'
              : 'Something went wrong while reading the receipt.'}
          </p>
        </div>
      </div>

      <button className={styles.rawToggle} onClick={() => setShowDetail((v) => !v)}>
        <ChevronIcon open={showDetail} /> Error details
      </button>
      {showDetail && <pre className={styles.rawText}>{message}</pre>}

      <div className={styles.errorActions}>
        <button className="btn btn-secondary" onClick={onRetry}>Retry OCR</button>
        <button className="btn btn-ghost" onClick={onRetake}>Retake Photo</button>
        <button className="btn btn-primary btn-full" onClick={onSkip}>
          Add Items Manually &rarr;
        </button>
      </div>
    </div>
  )
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function PencilIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>
    </svg>
  )
}

function CameraIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
      <circle cx="12" cy="13" r="4"/>
    </svg>
  )
}

function ScanIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 7 4 4 7 4"/>
      <polyline points="17 4 20 4 20 7"/>
      <polyline points="20 17 20 20 17 20"/>
      <polyline points="7 20 4 20 4 17"/>
      <line x1="5" y1="12" x2="19" y2="12"/>
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  )
}

function WarnIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
      <line x1="12" y1="9" x2="12" y2="13"/>
      <line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>
  )
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="13" height="13"
      viewBox="0 0 24 24"
      fill="none" stroke="currentColor"
      strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
      style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}
    >
      <polyline points="9 18 15 12 9 6"/>
    </svg>
  )
}
