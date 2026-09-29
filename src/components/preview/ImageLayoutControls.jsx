import { useMemo } from 'react'
import {
  IMAGE_SIZE_PRESETS,
  ALIGNMENT_GRID,
  DEFAULT_IMAGE_CONFIG,
} from '../../utils/imageLayoutHelper'
import { getPaperDimensions } from '../../utils/paperDimensions'
import {
  IconLock,
  IconUnlock,
  IconRotateCw,
  IconMove,
  IconCrop,
  IconLayoutGrid,
  IconMinus,
  IconZoomIn,
  IconZoomOut,
} from '../ui/icons'

// Returns the recommended paper size for a photo preset (smallest paper that fits)
function recommendedPaperForPreset(preset, currentPaperSize) {
  if (!preset.widthMm || !preset.heightMm) return null
  const maxDim = Math.max(preset.widthMm, preset.heightMm)
  const minDim = Math.min(preset.widthMm, preset.heightMm)
  // Check if current paper already fits
  const cur = getPaperDimensions(currentPaperSize, 'Portrait')
  const curMax = Math.max(cur.widthMm, cur.heightMm)
  const curMin = Math.min(cur.widthMm, cur.heightMm)
  if (curMax >= maxDim && curMin >= minDim) return null // fits, no change needed
  // Find smallest paper that fits the preset. Only sizes the printer really
  // offers are candidates (the catalogue is the single source of truth — "A3"
  // used to be listed here although the L3210 cannot print it).
  const candidates = ['A6', 'A5', '16K', '4x6', '5x7', '8x10', 'A4', 'Letter', 'Legal']
  for (const size of candidates) {
    const dim = getPaperDimensions(size, 'Portrait')
    const dMax = Math.max(dim.widthMm, dim.heightMm)
    const dMin = Math.min(dim.widthMm, dim.heightMm)
    if (dMax >= maxDim && dMin >= minDim) return size
  }
  return 'A4'
}

export default function ImageLayoutControls({
  config = DEFAULT_IMAGE_CONFIG,
  onChange,
  onChangePaperSize,
  paperDim,
  currentPaperSize = 'A4',
}) {
  const update = (patch) => {
    onChange({ ...config, ...patch })
  }

  const isCustom = config.sizePreset === 'custom'

  // Handle custom dimensions with aspect lock
  const handleCustomWidthChange = (val) => {
    const num = parseFloat(val) || 0
    if (config.lockAspect && config.customWidthMm > 0) {
      const ratio = config.customHeightMm / config.customWidthMm
      update({ customWidthMm: val, customHeightMm: Math.round(num * ratio * 10) / 10 })
    } else {
      update({ customWidthMm: val })
    }
  }

  const handleCustomHeightChange = (val) => {
    const num = parseFloat(val) || 0
    if (config.lockAspect && config.customHeightMm > 0) {
      const ratio = config.customWidthMm / config.customHeightMm
      update({ customHeightMm: val, customWidthMm: Math.round(num * ratio * 10) / 10 })
    } else {
      update({ customHeightMm: val })
    }
  }

  return (
    <div className="flex flex-col gap-4 bg-vanilla-100/90 border-2 border-dark-black-900 p-4 rounded-[16px] shadow-[3px_3px_0_0_rgba(56,56,56,1)]">
      {/* Header Strip */}
      <div className="flex items-center justify-between border-b-2 border-dark-black-900/15 pb-2.5">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-lime-400 border border-dark-black-900" />
          <h3 className="font-figtree font-bold text-[14px] text-dark-black-900 tracking-tight">
            Photo Layout & Sizing
          </h3>
        </div>
        <span className="font-geist text-[10.5px] font-semibold text-dark-black-900/60 bg-vanilla-300 px-2 py-0.5 rounded-[5px]">
          Paper: {paperDim.widthMm} × {paperDim.heightMm} mm
        </span>
      </div>

      {/* 1. Size Preset Selection */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <label className="font-figtree text-[13px] font-bold text-dark-black-900 flex items-center gap-1.5">
            <IconCrop size={14} />
            <span>Ukuran Foto / Image Size</span>
          </label>
        </div>

        <select
          value={config.sizePreset}
          onChange={(e) => {
            const nextVal = e.target.value
            const preset = IMAGE_SIZE_PRESETS.find((p) => p.id === nextVal)
            if (nextVal === 'fill') {
              update({ sizePreset: nextVal, fitMode: 'cover' })
            } else if (nextVal === 'fit') {
              update({ sizePreset: nextVal, fitMode: 'contain', zoomLevel: 100, cropPositionX: 50, cropPositionY: 50 })
            } else {
              update({ sizePreset: nextVal, fitMode: 'contain', zoomLevel: 100, cropPositionX: 50, cropPositionY: 50 })
              // Auto-switch paper size if preset doesn't fit current paper
              if (preset?.widthMm && onChangePaperSize) {
                const rec = recommendedPaperForPreset(preset, currentPaperSize)
                if (rec) onChangePaperSize(rec)
              }
            }
          }}
          className="w-full border-2 border-dark-black-900 bg-white rounded-[11px] px-3 py-2 font-figtree text-[13px] text-dark-black-900 focus:outline-none focus:bg-lime-300/30 transition-colors cursor-pointer"
        >
          {IMAGE_SIZE_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label} {p.sub ? `(${p.sub})` : ''}
            </option>
          ))}
        </select>

        {/* Preset Info Card: show dimensions when a fixed photo size is selected */}
        {(() => {
          const preset = IMAGE_SIZE_PRESETS.find((p) => p.id === config.sizePreset)
          if (!preset?.widthMm) return null
          const fits = (() => {
            const cur = getPaperDimensions(currentPaperSize, 'Portrait')
            const maxDim = Math.max(preset.widthMm, preset.heightMm)
            const minDim = Math.min(preset.widthMm, preset.heightMm)
            const curMax = Math.max(cur.widthMm, cur.heightMm)
            const curMin = Math.min(cur.widthMm, cur.heightMm)
            return curMax >= maxDim && curMin >= minDim
          })()
          const recPaper = fits ? null : recommendedPaperForPreset(preset, currentPaperSize)
          return (
            <div className={`flex items-start gap-2 p-2.5 rounded-[10px] border text-[11.5px] font-figtree ${
              fits
                ? 'bg-lime-300/30 border-dark-black-900/20 text-dark-black-900'
                : 'bg-amber-100 border-amber-400 text-amber-900'
            }`}>
              <div className="flex-1">
                <span className="font-bold">Ukuran: </span>
                <span>{preset.widthMm} × {preset.heightMm} mm</span>
                {!fits && recPaper && (
                  <span className="block mt-0.5 font-semibold text-amber-700">
                    Foto tidak muat di kertas {currentPaperSize}.
                    {onChangePaperSize && (
                      <button
                        type="button"
                        onClick={() => onChangePaperSize(recPaper)}
                        className="ml-1.5 underline font-bold text-amber-800 cursor-pointer"
                      >
                        Ganti ke {recPaper}
                      </button>
                    )}
                  </span>
                )}
              </div>
            </div>
          )
        })()}

        {/* Custom Width & Height Row */}
        {isCustom && (
          <div className="grid grid-cols-2 gap-2 mt-1.5 p-2.5 bg-vanilla-200 border border-dark-black-900 rounded-[10px]">
            <div>
              <span className="block font-geist text-[10px] text-dark-black-900/70 font-semibold mb-1">
                Lebar (Width mm)
              </span>
              <input
                type="number"
                min="10"
                max={paperDim.widthMm}
                value={config.customWidthMm}
                onChange={(e) => handleCustomWidthChange(e.target.value)}
                className="w-full border border-dark-black-900 bg-white rounded-[7px] px-2.5 py-1.5 font-geist text-[12px] font-bold text-dark-black-900 focus:outline-none"
              />
            </div>
            <div>
              <span className="block font-geist text-[10px] text-dark-black-900/70 font-semibold mb-1">
                Tinggi (Height mm)
              </span>
              <input
                type="number"
                min="10"
                max={paperDim.heightMm}
                value={config.customHeightMm}
                onChange={(e) => handleCustomHeightChange(e.target.value)}
                className="w-full border border-dark-black-900 bg-white rounded-[7px] px-2.5 py-1.5 font-geist text-[12px] font-bold text-dark-black-900 focus:outline-none"
              />
            </div>
            <div className="col-span-2 flex items-center justify-between pt-1">
              <button
                type="button"
                onClick={() => update({ lockAspect: !config.lockAspect })}
                className="flex items-center gap-1.5 font-figtree text-[11px] font-semibold text-dark-black-900 cursor-pointer"
              >
                {config.lockAspect ? <IconLock size={12} /> : <IconUnlock size={12} />}
                <span>{config.lockAspect ? 'Kunci Rasio (Locked)' : 'Bebas Rasio (Unlocked)'}</span>
              </button>
              <span className="font-geist text-[10px] text-dark-black-900/50">
                Maks: {paperDim.widthMm} × {paperDim.heightMm} mm
              </span>
            </div>
          </div>
        )}
      </div>

      {/* 2. Placement & 9-Point Alignment Grid */}
      <div className="flex flex-col gap-2 border-t border-dark-black-900/10 pt-3">
        <div className="flex items-center justify-between">
          <label className="font-figtree text-[13px] font-bold text-dark-black-900 flex items-center gap-1.5">
            <IconLayoutGrid size={14} />
            <span>Posisi pada Kertas (Placement)</span>
          </label>
          <span className="font-geist text-[11px] font-bold text-dark-black-900 bg-lime-300 px-2 py-0.5 rounded-[5px] border border-dark-black-900/20">
            {ALIGNMENT_GRID.find((a) => a.id === config.alignment)?.hint || 'Tengah'}
          </span>
        </div>

        <div className="grid grid-cols-12 gap-3 items-center">
          {/* 3x3 Alignment Anchor Grid */}
          <div className="col-span-5 bg-white border-2 border-dark-black-900 rounded-[10px] p-1.5 grid grid-cols-3 gap-1 shadow-xs">
            {ALIGNMENT_GRID.map((pos) => {
              const active = config.alignment === pos.id
              return (
                <button
                  key={pos.id}
                  type="button"
                  onClick={() => {
                    const patch = { alignment: pos.id, offsetX: 0, offsetY: 0 }
                    if (config.fitMode === 'cover') {
                      patch.cropPositionX = pos.xAlign === 'left' ? 0 : pos.xAlign === 'right' ? 100 : 50
                      patch.cropPositionY = pos.yAlign === 'top' ? 0 : pos.yAlign === 'bottom' ? 100 : 50
                    }
                    update(patch)
                  }}
                  className={`h-7 rounded-[6px] border flex items-center justify-center transition-all cursor-pointer ${
                    active
                      ? 'border-dark-black-900 bg-dark-black-900 text-lime-300 shadow-xs'
                      : 'border-dark-black-900/20 bg-vanilla-100 hover:border-dark-black-900 text-dark-black-900/70 hover:bg-lime-200'
                  }`}
                  title={`${pos.label} (${pos.hint})`}
                >
                  <span className={`w-2 h-2 rounded-[1.5px] ${active ? 'bg-lime-300' : 'bg-dark-black-900/40'}`} />
                </button>
              )
            })}
          </div>

          {/* Fine Tuning Offsets */}
          <div className="col-span-7 flex flex-col gap-1.5">
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col">
                <span className="font-geist text-[10px] text-dark-black-900/70 font-semibold">
                  Offset X (mm)
                </span>
                <input
                  type="number"
                  value={config.offsetX}
                  onChange={(e) => update({ offsetX: parseFloat(e.target.value) || 0 })}
                  className="border border-dark-black-900 bg-white rounded-[7px] px-2 py-1 font-geist text-[12px] font-bold text-dark-black-900 focus:outline-none"
                  placeholder="0"
                />
              </label>
              <label className="flex flex-col">
                <span className="font-geist text-[10px] text-dark-black-900/70 font-semibold">
                  Offset Y (mm)
                </span>
                <input
                  type="number"
                  value={config.offsetY}
                  onChange={(e) => update({ offsetY: parseFloat(e.target.value) || 0 })}
                  className="border border-dark-black-900 bg-white rounded-[7px] px-2 py-1 font-geist text-[12px] font-bold text-dark-black-900 focus:outline-none"
                  placeholder="0"
                />
              </label>
            </div>

            <div className="flex gap-1.5 pt-0.5">
              <button
                type="button"
                onClick={() => {
                  update({
                    alignment: 'center',
                    offsetX: 0,
                    offsetY: 0,
                    cropPositionX: 50,
                    cropPositionY: 50,
                  })
                }}
                className="flex-1 py-1 px-1.5 rounded-[6px] border border-dark-black-900 bg-vanilla-200 hover:bg-lime-300 font-figtree text-[10.5px] font-bold transition-colors cursor-pointer text-center"
              >
                Pusatkan (Center)
              </button>
              <button
                type="button"
                onClick={() => update({ offsetX: 0, offsetY: 0, cropPositionX: 50, cropPositionY: 50 })}
                className="py-1 px-2 rounded-[6px] border border-dark-black-900 bg-vanilla-200 hover:bg-lime-300 font-figtree text-[10.5px] font-bold transition-colors cursor-pointer text-center"
              >
                Reset
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 3. Fit Mode & Rotation Row */}
      <div className="grid grid-cols-2 gap-3 border-t border-dark-black-900/10 pt-3">
        {/* Fit Mode */}
        <div className="flex flex-col gap-1">
          <span className="font-figtree text-[11.5px] font-bold text-dark-black-900">
            Penanganan Tepi Foto
          </span>
          <div className="flex rounded-[8px] border border-dark-black-900 bg-white p-0.5">
            <button
              type="button"
              onClick={() => update({
                fitMode: 'contain',
                sizePreset: config.sizePreset === 'fill' ? 'fit' : config.sizePreset,
                zoomLevel: 100,
                cropPositionX: 50,
                cropPositionY: 50,
              })}
              className={`flex-1 py-1 rounded-[6px] font-figtree text-[11px] font-bold transition-colors cursor-pointer text-center ${
                config.fitMode === 'contain'
                  ? 'bg-dark-black-900 text-lime-300'
                  : 'text-dark-black-900/70 hover:bg-vanilla-200'
              }`}
              title="Foto utuh 100% tanpa terpotong (aman untuk foto yang sudah dicrop sendiri)"
            >
              Fit Utuh
            </button>
            <button
              type="button"
              onClick={() => update({
                fitMode: 'cover',
                sizePreset: config.sizePreset === 'fit' ? 'fill' : config.sizePreset,
              })}
              className={`flex-1 py-1 rounded-[6px] font-figtree text-[11px] font-bold transition-colors cursor-pointer text-center ${
                config.fitMode === 'cover'
                  ? 'bg-dark-black-900 text-lime-300'
                  : 'text-dark-black-900/70 hover:bg-vanilla-200'
              }`}
              title="Penuh kertas (tepi foto akan terpotong jika rasio foto beda dari kertas)"
            >
              Fill (Crop)
            </button>
          </div>
          <span className="font-figtree text-[10px] text-dark-black-900/60 leading-tight">
            {config.fitMode === 'contain'
              ? 'Foto utuh 100% tanpa terpotong (aman untuk teks/poster).'
              : 'Tepi terpotong otomatis untuk menutup bingkai penuh.'}
          </span>
        </div>

        {/* Rotation */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <span className="font-figtree text-[11.5px] font-bold text-dark-black-900 flex items-center gap-1">
              <IconRotateCw size={12} />
              <span>Rotasi Foto</span>
            </span>
            <span className="font-geist text-[10.5px] font-bold text-dark-black-900 bg-lime-300 px-1.5 py-0.5 rounded-[4px] border border-dark-black-900/20">
              {config.rotation || 0}°
            </span>
          </div>
          <div className="grid grid-cols-4 gap-1">
            {[0, 90, 180, 270].map((deg) => (
              <button
                key={deg}
                type="button"
                onClick={() => update({ rotation: deg })}
                className={`py-1 rounded-[6px] border border-dark-black-900 font-figtree text-[11px] font-bold transition-all cursor-pointer ${
                  (config.rotation || 0) === deg
                    ? 'bg-dark-black-900 text-lime-300 shadow-xs'
                    : 'bg-white hover:bg-vanilla-200 text-dark-black-900'
                }`}
                title={`Putar foto ${deg} derajat`}
              >
                {deg}°
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Interactive Crop & Zoom Position Adjustment (when Fill / Crop is selected) */}
      {config.fitMode === 'cover' ? (
        <div className="flex flex-col gap-3 bg-lime-300/15 border-2 border-dark-black-900 p-3 rounded-[12px] shadow-xs">
          <div className="flex items-center justify-between border-b border-dark-black-900/15 pb-2">
            <label className="font-figtree text-[12px] font-bold text-dark-black-900 flex items-center gap-1.5">
              <IconCrop size={14} />
              <span>Atur Potongan & Skala (Crop & Zoom)</span>
            </label>
            <button
              type="button"
              onClick={() => update({ cropPositionX: 50, cropPositionY: 50, zoomLevel: 100 })}
              className="font-geist text-[10.5px] font-bold text-dark-black-900/60 hover:text-dark-black-900 underline cursor-pointer"
            >
              Reset Semua
            </button>
          </div>

          {/* ── Zoom Controls (Kecilkan / Perbesar) ── */}
          <div className="flex flex-col gap-2 bg-white/70 border border-dark-black-900/20 p-2.5 rounded-[10px]">
            <div className="flex items-center justify-between">
              <label className="font-figtree text-[11.5px] font-bold text-dark-black-900 flex items-center gap-1.5">
                <IconZoomIn size={13} />
                <span>Zoom Foto (Perbesar / Perkecil)</span>
              </label>
              <div className="flex items-center gap-1.5">
                <span className="font-geist text-[11px] font-bold text-dark-black-900 bg-lime-300 px-2 py-0.5 rounded-[5px] border border-dark-black-900/20">
                  {config.zoomLevel ?? 100}%
                </span>
                {(config.zoomLevel ?? 100) !== 100 && (
                  <button
                    type="button"
                    onClick={() => update({ zoomLevel: 100 })}
                    className="font-geist text-[9.5px] font-semibold text-dark-black-900/60 hover:text-dark-black-900 underline cursor-pointer"
                  >
                    100%
                  </button>
                )}
              </div>
            </div>

            {/* Zoom Slider with Minus and Plus Buttons */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => update({ zoomLevel: Math.max(30, (config.zoomLevel ?? 100) - 10) })}
                className="p-1.5 rounded-[7px] border border-dark-black-900 bg-vanilla-200 hover:bg-lime-300 text-dark-black-900 transition-colors cursor-pointer shrink-0"
                title="Kecilkan (Zoom Out -10%)"
              >
                <IconMinus size={13} />
              </button>

              <input
                type="range"
                min="30"
                max="250"
                step="5"
                value={config.zoomLevel ?? 100}
                onChange={(e) => update({ zoomLevel: parseInt(e.target.value, 10) })}
                className="flex-1 accent-dark-black-900 cursor-pointer h-2"
              />

              <button
                type="button"
                onClick={() => update({ zoomLevel: Math.min(250, (config.zoomLevel ?? 100) + 10) })}
                className="p-1.5 rounded-[7px] border border-dark-black-900 bg-vanilla-200 hover:bg-lime-300 text-dark-black-900 transition-colors cursor-pointer shrink-0"
                title="Perbesar (Zoom In +10%)"
              >
                <IconZoomIn size={13} />
              </button>
            </div>

            {/* Quick Zoom Presets */}
            <div className="grid grid-cols-6 gap-1 pt-0.5">
              {[
                { label: '50%', val: 50 },
                { label: '75%', val: 75 },
                { label: '100%', val: 100 },
                { label: '125%', val: 125 },
                { label: '150%', val: 150 },
                { label: '200%', val: 200 },
              ].map((btn) => (
                <button
                  key={btn.label}
                  type="button"
                  onClick={() => update({ zoomLevel: btn.val })}
                  className={`py-0.5 rounded-[5px] border font-geist text-[10px] font-bold transition-all cursor-pointer text-center ${
                    (config.zoomLevel ?? 100) === btn.val
                      ? 'border-dark-black-900 bg-dark-black-900 text-lime-300 shadow-xs'
                      : 'border-dark-black-900/20 bg-white hover:border-dark-black-900 text-dark-black-900/80 hover:bg-lime-200'
                  }`}
                >
                  {btn.label}
                </button>
              ))}
            </div>
          </div>

          {/* ── Position / Crop Pan Controls ── */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <label className="font-figtree text-[11.5px] font-bold text-dark-black-900 flex items-center gap-1.5">
                <IconMove size={13} />
                <span>Posisi Potongan (Pan / Geser)</span>
              </label>
              <button
                type="button"
                onClick={() => update({ cropPositionX: 50, cropPositionY: 50 })}
                className="font-geist text-[10px] font-bold text-dark-black-900/60 hover:text-dark-black-900 underline cursor-pointer"
              >
                Pusatkan
              </button>
            </div>

            {/* Quick Crop Anchor Presets */}
            <div className="grid grid-cols-5 gap-1.5">
              {[
                { label: 'Atas', key: 'cropPositionY', val: 0 },
                { label: 'Kiri', key: 'cropPositionX', val: 0 },
                { label: 'Tengah', reset: true },
                { label: 'Kanan', key: 'cropPositionX', val: 100 },
                { label: 'Bawah', key: 'cropPositionY', val: 100 },
              ].map((btn) => {
                const active = btn.reset
                  ? (config.cropPositionX ?? 50) === 50 && (config.cropPositionY ?? 50) === 50
                  : config[btn.key] === btn.val
                return (
                  <button
                    key={btn.label}
                    type="button"
                    onClick={() => {
                      if (btn.reset) update({ cropPositionX: 50, cropPositionY: 50 })
                      else update({ [btn.key]: btn.val })
                    }}
                    className={`py-1 rounded-[6px] border font-figtree text-[11px] font-bold transition-all cursor-pointer text-center ${
                      active
                        ? 'border-dark-black-900 bg-dark-black-900 text-lime-300 shadow-xs'
                        : 'border-dark-black-900/25 bg-white hover:border-dark-black-900 text-dark-black-900/80 hover:bg-lime-200'
                    }`}
                  >
                    {btn.label}
                  </button>
                )
              })}
            </div>

            {/* Sliders for fine-tuning */}
            <div className="flex flex-col gap-1.5 pt-1">
              <div className="flex items-center gap-2">
                <span className="font-geist text-[10px] font-semibold text-dark-black-900/70 w-22 shrink-0">
                  Horisontal: {config.cropPositionX ?? 50}%
                </span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={config.cropPositionX ?? 50}
                  onChange={(e) => update({ cropPositionX: parseInt(e.target.value, 10) })}
                  className="flex-1 accent-dark-black-900 cursor-pointer h-2"
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="font-geist text-[10px] font-semibold text-dark-black-900/70 w-22 shrink-0">
                  Vertikal: {config.cropPositionY ?? 50}%
                </span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={config.cropPositionY ?? 50}
                  onChange={(e) => update({ cropPositionY: parseInt(e.target.value, 10) })}
                  className="flex-1 accent-dark-black-900 cursor-pointer h-2"
                />
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between bg-dark-black-900 text-lime-300 px-2 py-1 rounded-[6px] font-geist text-[9px] font-medium">
            <span>Geser: Drag lembar pratinjau</span>
            <span>Zoom: Scroll mouse atau slider</span>
          </div>
        </div>
      ) : (
        /* Notice when Fit Utuh is active: Zoom In/Out is only active in Fill (Crop) */
        <div className="flex items-center justify-between gap-2 p-2.5 bg-vanilla-200/60 border border-dark-black-900/15 rounded-[10px]">
          <div className="flex items-center gap-1.5 text-dark-black-900/70 font-geist text-[11px]">
            <IconCrop size={13} className="shrink-0 text-dark-black-900" />
            <span>Zoom In/Out & Geser posisi aktif saat memilih <strong>Penuh Kertas (Fill)</strong></span>
          </div>
          <button
            type="button"
            onClick={() => update({ sizePreset: 'fill', fitMode: 'cover' })}
            className="px-2 py-0.5 rounded-[5px] bg-lime-300 hover:bg-lime-400 text-dark-black-900 border border-dark-black-900 font-figtree font-bold text-[10.5px] cursor-pointer shrink-0"
          >
            Pilih Fill
          </button>
        </div>
      )}

      {/* 4. Multi-Copy / Repeat Grid on Single Sheet */}
      <div className="flex flex-col gap-1.5 border-t border-dark-black-900/10 pt-3">
        <div className="flex items-center justify-between">
          <span className="font-figtree text-[12px] font-bold text-dark-black-900 flex items-center gap-1.5">
            <IconMove size={13} />
            <span>Perbanyak Foto di 1 Lembar (Multi-Print)</span>
          </span>
          <span className="font-geist text-[11px] font-bold text-dark-black-900 bg-lime-300 px-2 py-0.5 rounded-[5px] border border-dark-black-900/20">
            {config.repeat === 1 ? '1x (Tunggal)' : `${config.repeat}x Foto/Lembar`}
          </span>
        </div>

        <div className="grid grid-cols-5 gap-1.5">
          {[
            { val: 1, label: '1x' },
            { val: 2, label: '2x' },
            { val: 4, label: '4x' },
            { val: 6, label: '6x' },
            { val: 9, label: '9x' },
          ].map((item) => (
            <button
              key={item.val}
              type="button"
              onClick={() => update({ repeat: item.val })}
              className={`py-1.5 rounded-[8px] border font-figtree text-[12px] font-bold transition-all cursor-pointer text-center ${
                config.repeat === item.val
                  ? 'border-dark-black-900 bg-dark-black-900 text-lime-300 shadow-xs'
                  : 'border-dark-black-900/25 bg-white hover:border-dark-black-900 text-dark-black-900'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
