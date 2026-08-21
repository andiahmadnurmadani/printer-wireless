// ─────────────────────────────────────────────
// Paper dimensions (in millimeters) & aspect ratios
// ─────────────────────────────────────────────

export const PAPER_DIMENSIONS = {
  A4: { width: 210, height: 297, label: 'A4 (210 × 297 mm)', baseScale: 1.0 },
  A3: { width: 297, height: 420, label: 'A3 (297 × 420 mm)', baseScale: 1.25 },
  A5: { width: 148, height: 210, label: 'A5 (148 × 210 mm)', baseScale: 0.82 },
  A6: { width: 105, height: 148, label: 'A6 (105 × 148 mm)', baseScale: 0.65 },
  Letter: { width: 215.9, height: 279.4, label: 'Letter (8.5 × 11 in)', baseScale: 1.0 },
  Legal: { width: 215.9, height: 355.6, label: 'Legal (8.5 × 14 in)', baseScale: 1.08 },
  Tabloid: { width: 279.4, height: 431.8, label: 'Tabloid (11 × 17 in)', baseScale: 1.28 },
  Executive: { width: 184.2, height: 266.7, label: 'Executive (7.25 × 10.5 in)', baseScale: 0.92 },
  '4x6 Photo': { width: 101.6, height: 152.4, label: '4×6 Photo (102 × 152 mm)', baseScale: 0.68 },
  '5x7 Photo': { width: 127, height: 177.8, label: '5×7 Photo (127 × 178 mm)', baseScale: 0.76 },
  B5: { width: 176, height: 250, label: 'B5 (176 × 250 mm)', baseScale: 0.88 },
}

export const PAPER_SIZES = Object.keys(PAPER_DIMENSIONS)

/**
 * Get dimensional metadata for a paper size and orientation.
 * @param {string} size e.g. "A4", "Letter"
 * @param {'Portrait'|'Landscape'} orientation
 */
export function getPaperDimensions(size = 'A4', orientation = 'Portrait') {
  const norm = Object.keys(PAPER_DIMENSIONS).find(
    (k) => k.toLowerCase() === (size || '').toLowerCase()
  ) || 'A4'
  const spec = PAPER_DIMENSIONS[norm] || PAPER_DIMENSIONS.A4

  const isLandscape = orientation === 'Landscape'
  const widthMm = isLandscape ? spec.height : spec.width
  const heightMm = isLandscape ? spec.width : spec.height
  const aspectRatio = widthMm / heightMm

  // Base width in px for preview display scaling relative to A4
  const baseWidthPx = isLandscape
    ? Math.round(380 * spec.baseScale)
    : Math.round(270 * spec.baseScale)

  return {
    name: norm,
    label: spec.label,
    widthMm,
    heightMm,
    aspectRatio,
    aspectRatioCss: `${widthMm} / ${heightMm}`,
    isLandscape,
    baseScale: spec.baseScale,
    baseWidthPx: Math.max(180, Math.min(480, baseWidthPx)),
    printableMarginMm: 5,
  }
}
