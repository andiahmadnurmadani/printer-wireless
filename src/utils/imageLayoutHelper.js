// ─────────────────────────────────────────────
// KroomPrint Image Layout & Placement Engine
// Photo sizing, 9-point grid alignment, offsets,
// and high-res print-ready compositing for CUPS.
// ─────────────────────────────────────────────

export const IMAGE_SIZE_PRESETS = [
  { id: 'fit', label: 'Fit Utuh (Proporsional, Tanpa Terpotong)', sub: 'Sesuai rasio asli foto tanpa crop', widthMm: null, heightMm: null },
  { id: 'fill', label: 'Fill (Crop, Penuh Kertas Tanpa Sisa Putih)', sub: 'Penuh seluruh kertas sesuai pilihan kertas', widthMm: null, heightMm: null },
  { id: 'original', label: '100% Original (1:1 DPI Asli)', sub: 'Sesuai resolusi asli file', widthMm: null, heightMm: null },
  { id: '4x6', label: 'Foto 4 × 6 in (10 × 15 cm / 4R)', sub: '101.6 × 152.4 mm', widthMm: 101.6, heightMm: 152.4 },
  { id: '5x7', label: 'Foto 5 × 7 in (13 × 18 cm / 5R)', sub: '127 × 177.8 mm', widthMm: 127, heightMm: 177.8 },
  { id: '8x10', label: 'Foto 8 × 10 in (20 × 25 cm / 8R)', sub: '203.2 × 254 mm', widthMm: 203.2, heightMm: 254 },
  { id: '3.5x5', label: 'Foto 3.5 × 5 in (9 × 13 cm / 3R)', sub: '88.9 × 127 mm', widthMm: 88.9, heightMm: 127 },
  { id: 'pasfoto_4x6', label: 'Pasfoto 4 × 6 cm', sub: '38.1 × 55.9 mm (Ijazah)', widthMm: 38.1, heightMm: 55.9 },
  { id: 'pasfoto_3x4', label: 'Pasfoto 3 × 4 cm', sub: '28 × 38 mm (Buku Nikah/Form)', widthMm: 28, heightMm: 38 },
  { id: 'pasfoto_2x3', label: 'Pasfoto 2 × 3 cm', sub: '20 × 28 mm (KTP)', widthMm: 20, heightMm: 28 },
  { id: 'wallet', label: 'Dompet / Wallet (6 × 9 cm)', sub: '60 × 90 mm', widthMm: 60, heightMm: 90 },
  { id: 'custom', label: 'Custom Dimensions...', sub: 'Tentukan ukuran bebas', widthMm: null, heightMm: null },
]

export const ALIGNMENT_GRID = [
  { id: 'top-left', label: 'Top Left', xAlign: 'left', yAlign: 'top', hint: 'Atas Kiri' },
  { id: 'top-center', label: 'Top Center', xAlign: 'center', yAlign: 'top', hint: 'Atas Tengah' },
  { id: 'top-right', label: 'Top Right', xAlign: 'right', yAlign: 'top', hint: 'Atas Kanan' },
  { id: 'center-left', label: 'Center Left', xAlign: 'left', yAlign: 'center', hint: 'Tengah Kiri' },
  { id: 'center', label: 'Center', xAlign: 'center', yAlign: 'center', hint: 'Tengah Kertas' },
  { id: 'center-right', label: 'Center Right', xAlign: 'right', yAlign: 'center', hint: 'Tengah Kanan' },
  { id: 'bottom-left', label: 'Bottom Left', xAlign: 'left', yAlign: 'bottom', hint: 'Bawah Kiri' },
  { id: 'bottom-center', label: 'Bottom Center', xAlign: 'center', yAlign: 'bottom', hint: 'Bawah Tengah' },
  { id: 'bottom-right', label: 'Bottom Right', xAlign: 'right', yAlign: 'bottom', hint: 'Bawah Kanan' },
]

export const DEFAULT_IMAGE_CONFIG = {
  sizePreset: 'fit', // Default Fit Utuh
  customWidthMm: 100,
  customHeightMm: 150,
  lockAspect: true,
  alignment: 'center', // one of ALIGNMENT_GRID ids
  offsetX: 0, // mm offset from alignment anchor
  offsetY: 0, // mm offset from alignment anchor
  fitMode: 'contain', // Default contain (Fit Utuh)
  cropPositionX: 50, // 0 to 100% (default center 50%)
  cropPositionY: 50, // 0 to 100% (default center 50%)
  zoomLevel: 100, // 30 to 300% (default 100%)
  repeat: 1, // 1, 2, 4, 6, 9 (grid copies on single sheet)
  rotation: 0, // 0, 90, 180, 270 degrees
}

/**
 * Computes exact millimeter and preview-pixel placement of the image on the paper.
 */
export function calculateImageLayout({
  paperDim,
  imgConfig = DEFAULT_IMAGE_CONFIG,
  imgNaturalWidth = 1200,
  imgNaturalHeight = 800,
  showMargins = true,
}) {
  const paperW = paperDim.widthMm
  const paperH = paperDim.heightMm
  const baseWidthPx = paperDim.baseWidthPx
  const scaleMmToPx = baseWidthPx / paperW

  const isFill = imgConfig.sizePreset === 'fill'
  const marginMm = (showMargins && !isFill) ? (paperDim.printableMarginMm || 4) : 0
  const availW = Math.max(10, paperW - 2 * marginMm)
  const availH = Math.max(10, paperH - 2 * marginMm)

  // Account for image rotation when calculating intrinsic aspect ratio
  const rot = (imgConfig.rotation || 0) % 360
  const isRotated90 = rot === 90 || rot === 270
  const naturalW = isRotated90 ? imgNaturalHeight : imgNaturalWidth
  const naturalH = isRotated90 ? imgNaturalWidth : imgNaturalHeight
  const naturalAspect = naturalW > 0 && naturalH > 0 ? naturalW / naturalH : 1.5

  let targetW_mm = paperW
  let targetH_mm = paperH
  let dimensionLabel = ''

  const preset = IMAGE_SIZE_PRESETS.find((p) => p.id === imgConfig.sizePreset) || IMAGE_SIZE_PRESETS[0]

  if (imgConfig.sizePreset === 'fill') {
    // Fill (Crop): Penuh seluruh kertas sesuai ukuran kertas yang dipilih pengguna
    targetW_mm = paperW
    targetH_mm = paperH
    dimensionLabel = `Fill (Penuh Kertas) (${Math.round(targetW_mm)} × ${Math.round(targetH_mm)} mm)`
  } else if (imgConfig.sizePreset === 'original') {
    // 1:1 image native pixels at standard 300 DPI (1 in = 25.4 mm)
    const origW_mm = (naturalW / 300) * 25.4
    const origH_mm = (naturalH / 300) * 25.4
    targetW_mm = origW_mm
    targetH_mm = origH_mm
    dimensionLabel = `Original (${Math.round(targetW_mm)} × ${Math.round(targetH_mm)} mm)`
  } else if (imgConfig.sizePreset === 'custom') {
    targetW_mm = Math.max(5, parseFloat(imgConfig.customWidthMm) || 100)
    targetH_mm = Math.max(5, parseFloat(imgConfig.customHeightMm) || 150)
    dimensionLabel = `Custom (${targetW_mm.toFixed(1)} × ${targetH_mm.toFixed(1)} mm)`
  } else if (preset && preset.widthMm && preset.heightMm) {
    // Standard photo size preset (4x6, 5x7, 8x10, 3.5x5, pasfoto_4x6, pasfoto_3x4, pasfoto_2x3, wallet, etc.)
    const photoAspect = preset.widthMm / preset.heightMm
    const shouldRotateToFit = (paperW > paperH && photoAspect < 1) || (paperW < paperH && photoAspect > 1)
    if (shouldRotateToFit) {
      targetW_mm = preset.heightMm
      targetH_mm = preset.widthMm
    } else {
      targetW_mm = preset.widthMm
      targetH_mm = preset.heightMm
    }
    dimensionLabel = `${preset.label.split('(')[0].trim()} (${targetW_mm} × ${targetH_mm} mm)`
  } else {
    // Default: Fit Utuh (proporsional sesuai printable area kertas tanpa terpotong)
    const fitW = availW
    const fitH = availH
    if (fitW / fitH > naturalAspect) {
      targetH_mm = fitH
      targetW_mm = fitH * naturalAspect
    } else {
      targetW_mm = fitW
      targetH_mm = fitW / naturalAspect
    }
    dimensionLabel = `Fit Utuh (${Math.round(targetW_mm)} × ${Math.round(targetH_mm)} mm)`
  }

  // Calculate layout for repeat grid (1, 2, 4, 6, 9 copies)
  const repeatCount = parseInt(imgConfig.repeat, 10) || 1
  let cols = 1
  let rows = 1

  if (repeatCount === 2) {
    cols = paperW >= paperH ? 2 : 1
    rows = paperW >= paperH ? 1 : 2
  } else if (repeatCount === 4) {
    cols = 2
    rows = 2
  } else if (repeatCount === 6) {
    cols = paperW >= paperH ? 3 : 2
    rows = paperW >= paperH ? 2 : 3
  } else if (repeatCount === 9) {
    cols = 3
    rows = 3
  }

  // If repeat > 1, downscale single item to fit cell if needed
  let singleItemW_mm = targetW_mm
  let singleItemH_mm = targetH_mm
  const cellW_mm = availW / cols
  const cellH_mm = availH / rows

  if (repeatCount > 1) {
    // Scale item to fit cell with a small 2mm gap
    const maxItemW = Math.max(5, cellW_mm - 4)
    const maxItemH = Math.max(5, cellH_mm - 4)
    if (imgConfig.sizePreset === 'fit' || singleItemW_mm > maxItemW || singleItemH_mm > maxItemH) {
      const itemAspect = singleItemW_mm / singleItemH_mm
      if (maxItemW / maxItemH > itemAspect) {
        singleItemH_mm = maxItemH
        singleItemW_mm = maxItemH * itemAspect
      } else {
        singleItemW_mm = maxItemW
        singleItemH_mm = maxItemW / itemAspect
      }
    }
  }

  const gridItems = []
  const align = ALIGNMENT_GRID.find((a) => a.id === imgConfig.alignment) || ALIGNMENT_GRID[4]
  const offX = parseFloat(imgConfig.offsetX) || 0
  const offY = parseFloat(imgConfig.offsetY) || 0

  if (repeatCount === 1) {
    // Single placement according to 9-point alignment + offsets
    let x_mm = marginMm
    let y_mm = marginMm

    if (align.xAlign === 'left') {
      x_mm = marginMm + offX
    } else if (align.xAlign === 'center') {
      x_mm = marginMm + (availW - targetW_mm) / 2 + offX
    } else if (align.xAlign === 'right') {
      x_mm = paperW - marginMm - targetW_mm + offX
    }

    if (align.yAlign === 'top') {
      y_mm = marginMm + offY
    } else if (align.yAlign === 'center') {
      y_mm = marginMm + (availH - targetH_mm) / 2 + offY
    } else if (align.yAlign === 'bottom') {
      y_mm = paperH - marginMm - targetH_mm + offY
    }

    gridItems.push({
      index: 0,
      xMm: x_mm,
      yMm: y_mm,
      wMm: targetW_mm,
      hMm: targetH_mm,
      xPx: Math.round(x_mm * scaleMmToPx),
      yPx: Math.round(y_mm * scaleMmToPx),
      wPx: Math.round(targetW_mm * scaleMmToPx),
      hPx: Math.round(targetH_mm * scaleMmToPx),
    })
  } else {
    // Multi-copy placement distributed across cells
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const itemIdx = r * cols + c
        if (itemIdx >= repeatCount) break

        let x_mm = cellLeft_mm + (cellW_mm - singleItemW_mm) / 2 + offX
        let y_mm = cellTop_mm + (cellH_mm - singleItemH_mm) / 2 + offY

        if (align.xAlign === 'left') {
          x_mm = cellLeft_mm + offX
        } else if (align.xAlign === 'right') {
          x_mm = cellLeft_mm + (cellW_mm - singleItemW_mm) + offX
        }

        if (align.yAlign === 'top') {
          y_mm = cellTop_mm + offY
        } else if (align.yAlign === 'bottom') {
          y_mm = cellTop_mm + (cellH_mm - singleItemH_mm) + offY
        }

        gridItems.push({
          index: itemIdx,
          xMm: x_mm,
          yMm: y_mm,
          wMm: singleItemW_mm,
          hMm: singleItemH_mm,
          xPx: Math.round(x_mm * scaleMmToPx),
          yPx: Math.round(y_mm * scaleMmToPx),
          wPx: Math.round(singleItemW_mm * scaleMmToPx),
          hPx: Math.round(singleItemH_mm * scaleMmToPx),
        })
      }
    }
  }

  // Check if image boundaries exceed paper bounds
  const isOverflow = gridItems.some(
    (item) => item.xMm < 0 || item.yMm < 0 || item.xMm + item.wMm > paperW + 1 || item.yMm + item.hMm > paperH + 1
  )

  return {
    paperW,
    paperH,
    availW,
    availH,
    marginMm,
    scaleMmToPx,
    dimensionLabel,
    gridItems,
    isOverflow,
    cols,
    rows,
    repeatCount,
    singleItemW_mm,
    singleItemH_mm,
  }
}

export function isDefaultImageConfig(cfg) {
  if (!cfg) return true
  const isDefaultPreset = cfg.sizePreset === 'fill' || cfg.sizePreset === 'fit' || !cfg.sizePreset
  const isDefaultFitMode = cfg.fitMode === 'cover' || cfg.fitMode === 'contain' || !cfg.fitMode
  const isCenter = !cfg.alignment || cfg.alignment === 'center'
  const isZeroOffX = !cfg.offsetX || parseFloat(cfg.offsetX) === 0
  const isZeroOffY = !cfg.offsetY || parseFloat(cfg.offsetY) === 0
  const isZeroRot = !cfg.rotation || parseInt(cfg.rotation, 10) === 0
  const isSingle = !cfg.repeat || parseInt(cfg.repeat, 10) === 1
  const isDefaultCrop = (cfg.cropPositionX ?? 50) === 50 && (cfg.cropPositionY ?? 50) === 50
  const isDefaultZoom = (cfg.zoomLevel ?? 100) === 100
  return isDefaultPreset && isDefaultFitMode && isCenter && isZeroOffX && isZeroOffY && isZeroRot && isSingle && isDefaultCrop && isDefaultZoom
}

/**
 * Renders the image onto a crisp 200 DPI Canvas matching the exact paper aspect ratio & millimeters,
 * and exports it as a lightweight high-res JPEG Blob. This ensures physical accuracy without network timeouts.
 */
export async function compositeImageToPrintBlob(imageSource, paperDim, imgConfig, showMargins = true) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    if (typeof imageSource === 'string' && /^https?:\/\//i.test(imageSource)) {
      img.crossOrigin = 'anonymous'
    }

    img.onload = () => {
      try {
        const paperW_mm = paperDim.widthMm
        const paperH_mm = paperDim.heightMm

        // 200 DPI canvas resolution (1 inch = 25.4 mm) provides crisp photographic quality
        // while keeping the compressed payload under 800 KB to avoid network timeouts.
        const DPI = 200
        const MM_TO_INCH = 1 / 25.4
        const canvasW = Math.round(paperW_mm * MM_TO_INCH * DPI)
        const canvasH = Math.round(paperH_mm * MM_TO_INCH * DPI)

        const canvas = document.createElement('canvas')
        canvas.width = canvasW
        canvas.height = canvasH
        const ctx = canvas.getContext('2d')

        // Fill background with solid crisp white
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, canvasW, canvasH)

        // Compute layout at 300 DPI
        const layout = calculateImageLayout({
          paperDim,
          imgConfig,
          imgNaturalWidth: img.naturalWidth,
          imgNaturalHeight: img.naturalHeight,
          showMargins,
        })

        const scaleMmToCanvasPx = canvasW / paperW_mm

        const rot = (imgConfig.rotation || 0) % 360
        const fitMode = imgConfig.fitMode || 'contain'

        layout.gridItems.forEach((item) => {
          const destX = item.xMm * scaleMmToCanvasPx
          const destY = item.yMm * scaleMmToCanvasPx
          const destW = item.wMm * scaleMmToCanvasPx
          const destH = item.hMm * scaleMmToCanvasPx

          ctx.save()

          // Clip to item bounds
          ctx.beginPath()
          ctx.rect(destX, destY, destW, destH)
          ctx.clip()

          // Move origin to center of destination box for clean rotation
          ctx.translate(destX + destW / 2, destY + destH / 2)
          if (rot !== 0) {
            ctx.rotate((rot * Math.PI) / 180)
          }

          // Source and Destination aspect ratio
          const isRot90 = rot === 90 || rot === 270
          const boxW = isRot90 ? destH : destW
          const boxH = isRot90 ? destW : destH

          let drawW = boxW
          let drawH = boxH

          const imgAspect = img.naturalWidth / img.naturalHeight
          const boxAspect = boxW / boxH

          if (fitMode === 'cover') {
            // Fill / Crop
            if (imgAspect > boxAspect) {
              drawH = boxH
              drawW = boxH * imgAspect
            } else {
              drawW = boxW
              drawH = boxW / imgAspect
            }
          } else {
            // Contain / Fit
            if (imgAspect > boxAspect) {
              drawW = boxW
              drawH = boxW / imgAspect
            } else {
              drawH = boxH
              drawW = boxH * imgAspect
            }
          }

          // Apply zoom / scaling factor — strictly 1.0 in contain mode
          const zoom = fitMode === 'cover' ? Math.max(0.3, Math.min(3.0, (imgConfig?.zoomLevel ?? 100) / 100)) : 1.0
          drawW *= zoom
          drawH *= zoom

          // Compute crop offset (shift only active in cover mode)
          let shiftX = 0
          let shiftY = 0
          if (fitMode === 'cover') {
            const cropX = typeof imgConfig?.cropPositionX === 'number' ? imgConfig.cropPositionX : 50
            const cropY = typeof imgConfig?.cropPositionY === 'number' ? imgConfig.cropPositionY : 50
            const extraW = drawW - boxW
            const extraH = drawH - boxH
            shiftX = ((50 - cropX) / 50) * (extraW / 2)
            shiftY = ((50 - cropY) / 50) * (extraH / 2)
          }

          ctx.drawImage(img, -drawW / 2 + shiftX, -drawH / 2 + shiftY, drawW, drawH)
          ctx.restore()
        })

        canvas.toBlob(
          (blob) => {
            if (blob) resolve(blob)
            else reject(new Error('Canvas export to blob failed'))
          },
          'image/jpeg',
          0.92
        )
      } catch (err) {
        reject(err)
      }
    }

    img.onerror = (e) => reject(new Error('Failed to load image for print compositing: ' + e))

    if (typeof imageSource === 'string') {
      img.src = imageSource
    } else if (imageSource instanceof Blob || imageSource instanceof File) {
      img.src = URL.createObjectURL(imageSource)
    } else {
      reject(new Error('Invalid image source'))
    }
  })
}
