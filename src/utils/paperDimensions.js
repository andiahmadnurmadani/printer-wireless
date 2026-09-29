// ─────────────────────────────────────────────
// Paper catalogue — mirrors the printer PPD
// ─────────────────────────────────────────────
// Single source of truth for the panel. The `name` values are exactly the
// strings the backend sends as `paperSize` (see backend/internal/discovery/
// pagesize.go — keep both files in sync): they round-trip as
// panel name → PPD PageSize → lp/IPP option, which is what makes the preview
// and the physical sheet agree.
//
// Sizes + millimetre dimensions are taken from the Epson ESC/P-R PPD shipped
// with the L3210 / L3250 family (22 PageSize choices, `lpoptions -p <q> -l`).

export const PAPER_CATALOGUE = [
  { name: 'A4', label: 'A4', widthMm: 210, heightMm: 297 },
  { name: 'Letter', label: 'Letter (US)', widthMm: 215.9, heightMm: 279.4 },
  { name: 'A5', label: 'A5', widthMm: 148, heightMm: 210 },
  { name: 'Legal', label: 'Legal (US)', widthMm: 215.9, heightMm: 355.6 },
  { name: 'A6', label: 'A6', widthMm: 105, heightMm: 148 },
  { name: 'B5', label: 'B5 (JIS)', widthMm: 182, heightMm: 257 },
  { name: 'B6', label: 'B6 (JIS)', widthMm: 128, heightMm: 182 },
  { name: '16K', label: '16K', widthMm: 195, heightMm: 270 },
  { name: '4x6', label: 'Foto 4 × 6 in (10 × 15 cm)', widthMm: 101.6, heightMm: 152.4 },
  { name: '4x6 Borderless', label: 'Foto 4 × 6 in (10 × 15 cm) — Borderless', widthMm: 101.6, heightMm: 152.4 },
  { name: '5x7', label: 'Foto 5 × 7 in (13 × 18 cm)', widthMm: 127, heightMm: 178 },
  { name: '8x10', label: 'Foto 8 × 10 in (20 × 25 cm)', widthMm: 203.2, heightMm: 254 },
  { name: '4x7', label: 'Foto 4 × 7 in (10 × 18 cm)', widthMm: 101.6, heightMm: 180.6 },
  { name: '4x7 Borderless', label: 'Foto 4 × 7 in (10 × 18 cm) — Borderless', widthMm: 101.6, heightMm: 180.6 },
  { name: '3.5x5', label: 'Foto 3.5 × 5 in (9 × 13 cm)', widthMm: 89, heightMm: 127 },
  { name: '3.5x5 Borderless', label: 'Foto 3.5 × 5 in (9 × 13 cm) — Borderless', widthMm: 89, heightMm: 127 },
  { name: 'Index 5x8', label: 'Index Card 5 × 8 in', widthMm: 127, heightMm: 203.2 },
  { name: 'Postcard', label: 'Postcard 100 × 148 mm', widthMm: 100, heightMm: 148 },
  { name: 'Postcard Borderless', label: 'Postcard 100 × 148 mm — Borderless', widthMm: 100, heightMm: 148 },
  { name: 'Env #10', label: 'Amplop #10', widthMm: 104.8, heightMm: 241.3 },
  { name: 'Env DL', label: 'Amplop DL', widthMm: 110, heightMm: 220 },
  { name: 'Env C6', label: 'Amplop C6', widthMm: 114, heightMm: 162 },
]

export const PAPER_SIZES = PAPER_CATALOGUE.map((p) => p.name)

// Dropdown option for one size name — falls back to the raw name for sizes the
// catalogue does not know (e.g. a PPD choice we have not mapped yet).
export function paperOption(name) {
  const spec = PAPER_CATALOGUE.find((p) => p.name.toLowerCase() === String(name).toLowerCase())
  return spec
    ? { value: spec.name, label: `${spec.label} · ${spec.widthMm} × ${spec.heightMm} mm` }
    : { value: name, label: name }
}

// Dropdown options: { value, label } so the list reads like a normal print
// dialog ("A4 — 210 × 297 mm").
export const PAPER_OPTIONS = PAPER_CATALOGUE.map((p) => ({
  value: p.name,
  label: `${p.label} · ${p.widthMm} × ${p.heightMm} mm`,
}))

// A4 is the reference sheet: the preview renders it at 270 px wide (portrait),
// and every other size is scaled by its true physical width so the on-screen
// comparison between sheets is to scale.
const A4_WIDTH_MM = 210
const A4_PREVIEW_PORTRAIT_PX = 270
const A4_PREVIEW_LANDSCAPE_PX = 380
const MM_TO_PX = A4_PREVIEW_PORTRAIT_PX / A4_WIDTH_MM // ≈ 1.286 px per mm
const PREVIEW_MIN_PX = 190
const PREVIEW_MAX_PX = 460

/**
 * Dimensional metadata for a paper size and orientation.
 * @param {string} size catalogue name, e.g. "A4" or "13x18 cm (5x7 in)"
 * @param {'Portrait'|'Landscape'} orientation
 */
export function getPaperDimensions(size = 'A4', orientation = 'Portrait') {
  const spec =
    PAPER_CATALOGUE.find((p) => p.name.toLowerCase() === String(size || '').toLowerCase()) ||
    PAPER_CATALOGUE[0]

  const isLandscape = orientation === 'Landscape'
  const widthMm = isLandscape ? spec.heightMm : spec.widthMm
  const heightMm = isLandscape ? spec.widthMm : spec.heightMm
  const baseScale = widthMm / A4_WIDTH_MM

  const rawWidthPx = isLandscape
    ? Math.round((A4_PREVIEW_LANDSCAPE_PX / A4_WIDTH_MM) * widthMm)
    : Math.round(MM_TO_PX * widthMm)
  const baseWidthPx = Math.max(PREVIEW_MIN_PX, Math.min(PREVIEW_MAX_PX, rawWidthPx))

  return {
    name: spec.name,
    label: `${spec.name} (${widthMm} × ${heightMm} mm)`,
    widthMm,
    heightMm,
    aspectRatio: widthMm / heightMm,
    aspectRatioCss: `${widthMm} / ${heightMm}`,
    isLandscape,
    baseScale,
    baseWidthPx,
    // Real millimetres of the printer's unprintable border, expressed in preview
    // pixels so the on-screen "printable area" guide is physically meaningful.
    printableMarginMm: 5,
    safeZoneInsetPx: Math.max(4, Math.round((baseWidthPx / widthMm) * 5)),
  }
}
