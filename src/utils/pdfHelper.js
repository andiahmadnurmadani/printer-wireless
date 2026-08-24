import * as pdfjsLib from 'pdfjs-dist'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?url'

// Set worker source for Vite bundler
if (typeof window !== 'undefined' && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker
}

/**
 * Load a PDF document from an ArrayBuffer or Blob URL
 * @param {ArrayBuffer|Blob|File|string} source
 * @returns {Promise<pdfjsLib.PDFDocumentProxy>}
 */
export async function loadPdfDocument(source) {
  let data
  if (source instanceof Blob || source instanceof File) {
    data = await source.arrayBuffer()
  } else if (typeof source === 'string') {
    const res = await fetch(source)
    data = await res.arrayBuffer()
  } else {
    data = source
  }

  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(data) })
  return loadingTask.promise
}

// In-memory render cache for instant page navigation (< 5ms)
const pageBitmapCache = new Map()

/**
 * Render a single PDF page onto an HTML5 canvas with intelligent memory caching
 * @param {pdfjsLib.PDFDocumentProxy} pdfDoc
 * @param {number} pageNum 1-indexed
 * @param {HTMLCanvasElement} canvas
 * @param {number} targetWidth desired rendered width in px
 * @returns {Promise<void>}
 */
export async function renderPdfPageToCanvas(pdfDoc, pageNum, canvas, targetWidth = 800) {
  if (!pdfDoc || !canvas) return

  const cacheKey = `${pdfDoc.fingerprint || 'doc'}_p${pageNum}_w${targetWidth}`
  const ctx = canvas.getContext('2d', { alpha: false })
  const outputScale = window.devicePixelRatio || 1

  // Fast cache hit
  if (pageBitmapCache.has(cacheKey)) {
    const cached = pageBitmapCache.get(cacheKey)
    canvas.width = cached.width
    canvas.height = cached.height
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    ctx.drawImage(cached.image, 0, 0)
    return
  }

  const page = await pdfDoc.getPage(pageNum)
  const unscaledViewport = page.getViewport({ scale: 1.0 })
  const scale = targetWidth / unscaledViewport.width
  const viewport = page.getViewport({ scale: Math.max(0.5, scale) })

  // Support HiDPI / Retina screens
  canvas.width = Math.floor(viewport.width * outputScale)
  canvas.height = Math.floor(viewport.height * outputScale)
  canvas.style.width = '100%'
  canvas.style.height = '100%'

  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.scale(outputScale, outputScale)

  // Clear background with white paper color
  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, viewport.width, viewport.height)

  const renderContext = {
    canvasContext: ctx,
    viewport,
  }

  await page.render(renderContext).promise

  // Store in cache
  try {
    const img = new Image()
    img.src = canvas.toDataURL('image/jpeg', 0.88)
    img.onload = () => {
      pageBitmapCache.set(cacheKey, { image: img, width: canvas.width, height: canvas.height })
      // Keep cache size bounded
      if (pageBitmapCache.size > 80) {
        const firstKey = pageBitmapCache.keys().next().value
        pageBitmapCache.delete(firstKey)
      }
    }
  } catch {
    // Ignore canvas security errors
  }
}
