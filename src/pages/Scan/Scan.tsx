import { useRef, useState, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useReceipt } from '../../store/ReceiptContext'
import type { ParseResult } from '../../utils/parseReceipt'
import { preprocessReceiptImage } from '../../utils/receiptImage'
import { runReceiptOcr } from '../../utils/receiptOcr'
import {
  chargesFromParse,
  extractMerchant,
  type Reconciliation,
} from '../../utils/receiptReconcile'
import { generateId } from '../../utils/storage'
import { formatCurrency } from '../../utils/split'
import styles from './Scan.module.css'

// ── State machine ─────────────────────────────────────────────────────────────

type ScanState =
  | { mode: 'idle' }
  | { mode: 'preview';  dataUrl: string; processedUrl?: string; showProcessed: boolean }
  | { mode: 'scanning'; dataUrl: string; ocrStatus: string; progress: number }
  | { mode: 'parsed';   dataUrl: string; rawText: string; parseResult: ParseResult; reconciliation: Reconciliation }
  | { mode: 'error';    dataUrl: string; message: string }

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Scan() {
  const navigate  = useNavigate()
  const { draft, dispatch } = useReceipt()
  const fileRef   = useRef<HTMLInputElement>(null)
  const [state, setState] = useState<ScanState>({ mode: 'idle' })
  const [isDragging, setIsDragging] = useState(false)

  // ── File selection ──────────────────────────────────────────────────────────

  const handleFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) return
    const reader = new FileReader()
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string
      setState({ mode: 'preview', dataUrl, showProcessed: false })
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

  const onDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const onDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragging(false)
    }
  }, [])

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      setIsDragging(false)
      const file = e.dataTransfer.files?.[0]
      if (file) handleFile(file)
    },
    [handleFile],
  )

  // ── OCR ─────────────────────────────────────────────────────────────────────

  // Preprocess in background so the user can preview the enhanced image before OCR.
  useEffect(() => {
    if (state.mode !== 'preview') return
    let cancelled = false
    preprocessReceiptImage(state.dataUrl)
      .then((processedUrl) => {
        if (!cancelled) {
          setState((prev) =>
            prev.mode === 'preview' ? { ...prev, processedUrl } : prev,
          )
        }
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [state.mode === 'preview' ? state.dataUrl : null])

  const startScan = useCallback(
    async (dataUrl: string, processedUrl?: string) => {
      setState({ mode: 'scanning', dataUrl, ocrStatus: 'Starting…', progress: 0 })

      try {
        const { rawText, parseResult, reconciliation } = await runReceiptOcr(dataUrl, (ocrStatus, progress) => {
          setState((prev) =>
            prev.mode === 'scanning' ? { ...prev, ocrStatus, progress } : prev,
          )
        }, processedUrl)

        // Store image + raw text on-device; never sent to a server
        dispatch({
          type: 'SET_RECEIPT_META',
          payload: { rawImageDataUrl: dataUrl, rawText },
        })

        setState({ mode: 'parsed', dataUrl, rawText, parseResult, reconciliation })
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

  const confirmScan = useCallback(
    (parseResult: ParseResult, rawText: string) => {
      const items = parseResult.items.map((it) => ({
        id: generateId(),
        name: it.name,
        unitPrice: it.unitPrice,
        quantity: it.quantity,
        totalPrice: it.totalPrice,
      }))
      const charges = chargesFromParse(parseResult)
      const merchant = extractMerchant(rawText)

      dispatch({
        type: 'APPLY_SCAN_RESULT',
        payload: { items, charges, merchant },
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
            ? 'Check items and receipt math before continuing.'
            : 'Something went wrong with OCR.'}
        </p>
      </header>

      {/* ── Idle: upload zone ─────────────────────────────────────────── */}
      {state.mode === 'idle' && (
        <>
          <div
            className={`${styles.uploadZone} ${isDragging ? styles.uploadZoneDragging : ''}`}
            onDrop={onDrop}
            onDragOver={(e) => e.preventDefault()}
            onDragEnter={onDragEnter}
            onDragLeave={onDragLeave}
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
            src={
              state.showProcessed && state.processedUrl
                ? state.processedUrl
                : state.dataUrl
            }
            alt="Receipt preview"
            className={styles.receiptImg}
          />
          <div className={styles.previewToolbar}>
            <button
              type="button"
              className={`${styles.previewToggle} ${!state.showProcessed ? styles.previewToggleActive : ''}`}
              onClick={() => setState((prev) =>
                prev.mode === 'preview' ? { ...prev, showProcessed: false } : prev,
              )}
            >
              Original
            </button>
            <button
              type="button"
              className={`${styles.previewToggle} ${state.showProcessed ? styles.previewToggleActive : ''}`}
              onClick={() => setState((prev) =>
                prev.mode === 'preview' ? { ...prev, showProcessed: true } : prev,
              )}
              disabled={!state.processedUrl}
            >
              Enhanced{state.processedUrl ? '' : '…'}
            </button>
          </div>
          <p className={styles.previewHint}>
            {state.processedUrl
              ? 'Enhanced view shows how OCR sees your receipt. Retake if text looks washed out.'
              : 'Preparing enhanced preview…'}
          </p>
          <div className={styles.photoActions}>
            <button
              className="btn btn-secondary"
              onClick={() => fileRef.current?.click()}
            >
              <CameraIcon /> Retake
            </button>
            <button
              className="btn btn-primary"
              onClick={() => startScan(state.dataUrl, state.processedUrl)}
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
            {state.progress >= 48 && state.progress < 95 && (
              <p className={styles.progressHint}>
                Trying multiple read modes for best accuracy…
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
          parseResult={state.parseResult}
          reconciliation={state.reconciliation}
          currency={draft.receipt.currency}
          onConfirm={() => confirmScan(state.parseResult, state.rawText)}
          onRetake={() => fileRef.current?.click()}
          onSkip={() => navigate('/review')}
        />
      )}

      {/* ── Error ─────────────────────────────────────────────────────── */}
      {state.mode === 'error' && (
        <ErrorView
          dataUrl={state.dataUrl}
          message={state.message}
          onRetry={() => startScan(state.dataUrl)}
          onRetake={() => fileRef.current?.click()}
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
  parseResult: ParseResult
  reconciliation: Reconciliation
  currency: string
  onConfirm: () => void
  onRetake: () => void
  onSkip: () => void
}

function ParsedView({
  dataUrl, rawText, parseResult, reconciliation, currency, onConfirm, onRetake, onSkip,
}: ParsedViewProps) {
  const [showRaw, setShowRaw] = useState(false)
  const { items } = parseResult
  const hasItems = items.length > 0
  const mathOk = reconciliation.status === 'ok'
  const mathWarn = reconciliation.status === 'warn'

  return (
    <div className={styles.parsedBlock}>
      {/* Thumbnail + result badge */}
      <div className={styles.thumbRow}>
        <img src={dataUrl} alt="Scanned receipt" className={styles.thumb} />
        <div className={styles.thumbMeta}>
          {hasItems ? (
            <>
              <span className={mathOk ? styles.thumbBadgeOk : mathWarn ? styles.thumbBadgeWarn : styles.thumbBadgeFail}>
                {mathOk ? <CheckIcon /> : <WarnIcon />}
                {mathOk ? ' Math checks out' : mathWarn ? ' Review math' : ' Math mismatch'}
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

      {/* Receipt math reconciliation */}
      {hasItems && reconciliation.lines.length > 1 && (
        <div className={`card ${styles.mathCard} ${mathOk ? styles.mathOk : mathWarn ? styles.mathWarn : styles.mathFail}`}>
          <h3 className={styles.mathTitle}>Receipt math</h3>
          <ul className={styles.mathLines}>
            {reconciliation.lines.map((line, i) => (
              <li
                key={`${line.label}-${i}`}
                className={
                  line.label.startsWith('Total') || line.label.startsWith('Calculated')
                    ? styles.mathLineTotal
                    : styles.mathLine
                }
              >
                <span>{line.label}</span>
                <span>{formatCurrency(line.amount, currency)}</span>
              </li>
            ))}
          </ul>
          {reconciliation.messages.length > 0 && (
            <p className={styles.mathHint}>{reconciliation.messages[0]}</p>
          )}
        </div>
      )}

      {/* Parsed item list */}
      {hasItems && (
        <ul className={styles.parsedList}>
          {items.map((item, i) => (
            <li key={i} className={styles.parsedItem}>
              <span className={styles.parsedName}>
                {item.name}
                <span className={styles.parsedQty}>
                  {' '}{item.quantity} × {formatCurrency(item.unitPrice, currency)}
                </span>
              </span>
              <span className={styles.parsedPrice}>
                {formatCurrency(item.totalPrice, currency)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* CTAs */}
      <div className={styles.parsedActions}>
        {hasItems ? (
          <button type="button" className="btn btn-primary" onClick={onConfirm}>
            Review &amp; Edit &rarr;
          </button>
        ) : (
          <button type="button" className="btn btn-primary" onClick={onSkip}>
            Add Manually &rarr;
          </button>
        )}
        <button type="button" className="btn btn-ghost" onClick={onRetake}>
          <CameraIcon /> Retake
        </button>
      </div>

      {/* Raw text disclosure — below CTAs so sticky overlay never blocks it */}
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
