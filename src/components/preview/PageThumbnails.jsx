import { useEffect, useRef } from 'react'

function isPageInRange(pageNum, rangeStr, total) {
  if (!rangeStr || !rangeStr.trim()) return true
  const parts = rangeStr.split(/[,;\s]+/)
  for (const part of parts) {
    if (!part) continue
    if (part.includes('-')) {
      const [start, end] = part.split('-').map((n) => parseInt(n.trim(), 10))
      const s = isNaN(start) ? 1 : start
      const e = isNaN(end) ? total : end
      if (pageNum >= s && pageNum <= e) return true
    } else {
      const n = parseInt(part.trim(), 10)
      if (n === pageNum) return true
    }
  }
  return false
}

/**
 * Thumbnail strip for multi-page documents with real-time range highlights
 */
export default function PageThumbnails({
  totalPages = 1,
  currentPage = 1,
  onSelectPage,
  pdfDoc = null,
  file = null,
  isImage = false,
  imageUrl = null,
  isText = false,
  textContent = '',
  paperDim,
  color = true,
  duplex = false,
  pageRange = '',
}) {
  if (totalPages <= 1 && !isImage) return null

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="font-figtree text-[12px] font-semibold text-dark-black-900 uppercase tracking-wider">
          Pages ({totalPages}) {pageRange.trim() && <span className="text-lime-600 font-bold ml-1">· Custom Range Active</span>}
        </span>
        <span className="font-geist text-[11px] text-dark-black-900/50">
          Page {currentPage} of {totalPages}
        </span>
      </div>

      <div className="flex gap-2.5 overflow-x-auto pb-2 pt-1 px-1 max-w-full scrollbar-thin">
        {Array.from({ length: totalPages }, (_, idx) => {
          const pageNum = idx + 1
          const isSelected = pageNum === currentPage
          const inRange = isPageInRange(pageNum, pageRange, totalPages)
          const sheetNum = Math.ceil(pageNum / 2)
          const isBack = duplex && pageNum % 2 === 0

          return (
            <button
              key={pageNum}
              type="button"
              onClick={() => onSelectPage(pageNum)}
              className={`group flex flex-col items-center gap-1.5 shrink-0 transition-all cursor-pointer focus:outline-none ${
                !inRange ? 'opacity-40 hover:opacity-80' : ''
              }`}
            >
              {/* Paper thumbnail preview box */}
              <div
                style={{
                  aspectRatio: `${paperDim.widthMm} / ${paperDim.heightMm}`,
                }}
                className={`relative w-[52px] rounded-[6px] border-2 bg-white flex items-center justify-center overflow-hidden transition-all duration-150 ${
                  isSelected
                    ? 'border-dark-black-900 shadow-[3px_3px_0px_0px_rgba(56,56,56,1)] ring-2 ring-lime-400 -translate-y-0.5'
                    : inRange
                    ? 'border-dark-black-900/30 hover:border-dark-black-900 hover:shadow-[2px_2px_0px_0px_rgba(56,56,56,0.7)]'
                    : 'border-dashed border-dark-black-900/20'
                }`}
              >
                {/* Thumbnail content */}
                {pdfDoc ? (
                  <PdfThumbCanvas pdfDoc={pdfDoc} pageNum={pageNum} />
                ) : isImage && imageUrl ? (
                  <img
                    src={imageUrl}
                    alt={`Page ${pageNum}`}
                    className={`w-full h-full object-contain ${!color ? 'grayscale' : ''}`}
                  />
                ) : isText ? (
                  <div className="w-full h-full p-1 text-[4px] leading-[5px] text-dark-black-900/60 font-geist select-none overflow-hidden">
                    {textContent.slice(0, 100)}...
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center text-[10px] font-geist font-bold text-dark-black-900/40">
                    {pageNum}
                  </div>
                )}

                {/* Duplex Front/Back indicator */}
                {duplex && (
                  <span
                    className={`absolute bottom-0.5 right-0.5 text-[7px] font-geist font-bold px-1 rounded-[2px] leading-tight ${
                      isBack ? 'bg-warn-100 text-warn-500' : 'bg-lime-300 text-dark-black-900'
                    }`}
                  >
                    {isBack ? 'B' : 'F'}
                  </span>
                )}
              </div>

              {/* Page label */}
              <span
                className={`font-geist text-[10.5px] font-semibold px-1.5 py-0.5 rounded-[4px] leading-none transition-colors ${
                  isSelected
                    ? 'bg-dark-black-900 text-lime-300'
                    : 'text-dark-black-900/60 group-hover:text-dark-black-900'
                }`}
              >
                {pageNum}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function PdfThumbCanvas({ pdfDoc, pageNum }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    let active = true
    async function renderThumb() {
      if (!pdfDoc || !canvasRef.current) return
      try {
        const page = await pdfDoc.getPage(pageNum)
        if (!active || !canvasRef.current) return
        const viewport = page.getViewport({ scale: 0.18 })
        const canvas = canvasRef.current
        canvas.width = viewport.width
        canvas.height = viewport.height
        const ctx = canvas.getContext('2d')
        ctx.fillStyle = '#FFFFFF'
        ctx.fillRect(0, 0, viewport.width, viewport.height)
        await page.render({ canvasContext: ctx, viewport }).promise
      } catch (err) {
        // silent fail on cancel
      }
    }
    renderThumb()
    return () => {
      active = false
    }
  }, [pdfDoc, pageNum])

  return <canvas ref={canvasRef} className="w-full h-full object-contain" />
}
