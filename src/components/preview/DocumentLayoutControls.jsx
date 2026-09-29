import {
  IconRotateCw,
  IconCrop,
  IconLayoutGrid,
  IconCheck,
  IconMinus,
  IconPlus,
  IconCopy,
  IconFile,
} from '../ui/icons'

export const DEFAULT_DOC_CONFIG = {
  // 1. Salinan & Pengurutan
  collate: true,

  // 2. Rentang Halaman
  pageRangeMode: 'all', // 'all' | 'current' | 'custom'
  customRange: '',
  pageSubset: 'all', // 'all' | 'odd' | 'even'
  reverseOrder: false,

  // 3. Penanganan Ukuran Halaman (WPS Office Page Sizing & Handling)
  handlingMode: 'size', // 'size' | 'multiple' | 'booklet'
  scaleMode: 'fit', // 'fit' | 'actual' | 'shrink' | 'custom'
  customScale: 100, // 25 - 200 (%)

  // 4. Banyak Halaman per Lembar (Multiple Pages per Sheet / N-Up)
  pagesPerSheet: 1, // 1 | 2 | 4 | 6 | 9 | 16
  pageOrder: 'horizontal', // 'horizontal' | 'vertical'
  printBorder: false,

  // 5. Margin Kertas & Pemusatan
  marginPreset: 'default', // 'default' | 'none' | 'minimum' | 'custom'
  margins: { top: 5, bottom: 5, left: 5, right: 5 }, // mm
  autoCenter: true,

  // 6. Orientasi & Rotasi Halaman
  orientationMode: 'auto', // 'auto' | 'portrait' | 'landscape'
  rotation: 0, // 0 | 90 | 180 | 270

  // 7. Cetak Bolak-Balik (Duplex)
  duplexMode: 'simplex', // 'simplex' | 'long' | 'short' | 'manual'
}

export default function DocumentLayoutControls({
  config = DEFAULT_DOC_CONFIG,
  onChange,
  totalPages = 1,
  currentPage = 1,
  paperDim,
  canDuplex = false,
  duplex = false,
  onToggleDuplex,
  manualDuplex = false,
  onToggleManualDuplex,
  copies = 1,
  onChangeCopies,
  collate = true,
  onChangeCollate,
  nUp = 1,
  onChangeNUp,
  orientation = 'Portrait',
  onChangeOrientation,
}) {
  const update = (patch) => {
    onChange({ ...config, ...patch })
  }

  const isCustomScale = config.scaleMode === 'custom'
  const isCustomMargin = config.marginPreset === 'custom'
  const currentHandling = config.handlingMode || (nUp > 1 ? 'multiple' : 'size')

  const handleScaleStep = (delta) => {
    const next = Math.max(25, Math.min(200, (config.customScale || 100) + delta))
    update({ scaleMode: 'custom', customScale: next })
  }

  const handleRotate = () => {
    const nextRot = ((config.rotation || 0) + 90) % 360
    update({ rotation: nextRot })
  }

  const handleCopiesChange = (delta) => {
    if (!onChangeCopies) return
    const next = Math.max(1, Math.min(999, copies + delta))
    onChangeCopies(next)
  }

  return (
    <div className="flex flex-col gap-4 bg-vanilla-100/95 border-2 border-dark-black-900 p-4 sm:p-5 rounded-[16px] shadow-[3px_3px_0_0_rgba(56,56,56,1)]">
      {/* Header Strip — WPS Office Style */}
      <div className="flex items-center justify-between border-b-2 border-dark-black-900/15 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-[9px] bg-dark-black-900 text-lime-300 flex items-center justify-center border border-dark-black-900 shadow-xs">
            <IconFile size={16} />
          </div>
          <div>
            <h3 className="font-figtree font-bold text-[14.5px] text-dark-black-900 tracking-tight leading-tight">
              Pengaturan Cetak Dokumen
            </h3>
            <span className="font-geist text-[11px] font-semibold text-dark-black-900/60">
              Format dialog cetak standar WPS Office
            </span>
          </div>
        </div>
        <div className="flex flex-col items-end">
          <span className="font-geist text-[11px] font-bold text-dark-black-900 bg-lime-300 px-2 py-0.5 rounded-[6px] border border-dark-black-900/20">
            {paperDim?.widthMm || 210} × {paperDim?.heightMm || 297} mm
          </span>
          <span className="font-geist text-[10px] text-dark-black-900/50 mt-0.5">
            Total {totalPages} Halaman
          </span>
        </div>
      </div>

      {/* ── SEKSI 1: Salinan & Pengurutan (Copies & Collate) ── */}
      {onChangeCopies && (
        <div className="flex flex-col gap-2 bg-white/70 border border-dark-black-900/20 p-3 rounded-[12px]">
          <div className="flex items-center justify-between">
            <label className="font-figtree text-[13px] font-bold text-dark-black-900 flex items-center gap-1.5">
              <IconCopy size={14} />
              <span>Salinan (Copies)</span>
            </label>
            <span className="font-geist text-[11.5px] font-bold text-dark-black-900 bg-vanilla-300 px-2 py-0.5 rounded-[5px]">
              {copies} Rangkap
            </span>
          </div>

          <div className="flex items-center justify-between gap-3 flex-wrap">
            {/* Stepper Jumlah Salinan */}
            <div className="flex items-center gap-1.5 bg-white border-2 border-dark-black-900 rounded-[10px] p-1 shadow-xs">
              <button
                type="button"
                onClick={() => handleCopiesChange(-1)}
                disabled={copies <= 1}
                className="w-8 h-8 rounded-[7px] border border-dark-black-900 bg-vanilla-100 hover:bg-lime-300 flex items-center justify-center font-bold text-[14px] cursor-pointer disabled:opacity-30 disabled:pointer-events-none transition-colors"
                title="Kurangi Salinan"
              >
                <IconMinus size={13} />
              </button>
              <input
                type="number"
                min="1"
                max="999"
                value={copies}
                onChange={(e) => {
                  const val = parseInt(e.target.value) || 1
                  onChangeCopies(Math.max(1, Math.min(999, val)))
                }}
                className="w-14 font-geist font-bold text-[14px] text-dark-black-900 text-center focus:outline-none"
              />
              <button
                type="button"
                onClick={() => handleCopiesChange(1)}
                className="w-8 h-8 rounded-[7px] border border-dark-black-900 bg-vanilla-100 hover:bg-lime-300 flex items-center justify-center font-bold text-[14px] cursor-pointer transition-colors"
                title="Tambah Salinan"
              >
                <IconPlus size={13} />
              </button>
            </div>

            {/* Checkbox Urutkan (Collate) */}
            {onChangeCollate && (
              <button
                type="button"
                onClick={() => onChangeCollate(!collate)}
                className="flex items-center gap-2 px-3 py-2 rounded-[9px] border border-dark-black-900/30 bg-white hover:border-dark-black-900 transition-all cursor-pointer"
              >
                <span
                  className={`w-4 h-4 rounded-[4px] border-2 border-dark-black-900 flex items-center justify-center transition-colors ${
                    collate ? 'bg-dark-black-900 text-lime-300' : 'bg-white'
                  }`}
                >
                  {collate && <IconCheck size={11} />}
                </span>
                <div className="flex flex-col text-left">
                  <span className="font-figtree text-[12px] font-bold text-dark-black-900">
                    Urutkan (Collate)
                  </span>
                  <span className="font-geist text-[10px] text-dark-black-900/60">
                    {collate ? 'Cetak per bundel (1,2,3... 1,2,3...)' : 'Cetak per halaman (1,1... 2,2...)'}
                  </span>
                </div>
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── SEKSI 2: Rentang Halaman (WPS Office Page Range) ── */}
      <div className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between">
          <label className="font-figtree text-[13px] font-bold text-dark-black-900 flex items-center gap-1.5">
            <IconCrop size={14} />
            <span>Rentang Halaman</span>
          </label>
          <span className="font-geist text-[11px] font-bold text-dark-black-900/60">
            {config.pageRangeMode === 'all'
              ? `Semua Halaman (1–${totalPages})`
              : config.pageRangeMode === 'current'
                ? `Halaman ${currentPage}`
                : config.customRange || 'Belum diisi'}
          </span>
        </div>

        {/* 3 Opsi Mode: Semua, Halaman Saat Ini, Halaman (WPS Office Baku) */}
        <div className="grid grid-cols-3 gap-1.5 p-1 bg-vanilla-200 border-2 border-dark-black-900 rounded-[11px]">
          {[
            { id: 'all', label: 'Semua' },
            { id: 'current', label: `Halaman Saat Ini (${currentPage})` },
            { id: 'custom', label: 'Halaman' },
          ].map((mode) => (
            <button
              key={mode.id}
              type="button"
              onClick={() => update({ pageRangeMode: mode.id })}
              className={`py-2 px-2 rounded-[8px] font-figtree text-[12px] font-bold transition-all cursor-pointer text-center ${
                config.pageRangeMode === mode.id
                  ? 'bg-dark-black-900 text-lime-300 shadow-xs'
                  : 'text-dark-black-900/70 hover:bg-vanilla-100 hover:text-dark-black-900'
              }`}
            >
              {mode.label}
            </button>
          ))}
        </div>

        {/* Input Kustom Rentang Halaman jika mode 'custom' */}
        {config.pageRangeMode === 'custom' && (
          <div className="flex flex-col gap-1 p-2.5 bg-white border-2 border-dark-black-900 rounded-[10px]">
            <span className="font-figtree text-[11.5px] font-bold text-dark-black-900">
              Masukkan Nomor Halaman:
            </span>
            <input
              type="text"
              value={config.customRange}
              onChange={(e) => update({ customRange: e.target.value })}
              placeholder="Contoh: 1-5, 8, 11-13"
              className="w-full border-2 border-dark-black-900 bg-vanilla-100 rounded-[8px] px-3 py-1.5 font-geist text-[13px] font-bold text-dark-black-900 focus:outline-none focus:bg-lime-300/20"
            />
            <span className="font-figtree text-[11px] text-dark-black-900/60">
              Gunakan tanda hubung untuk rentang halaman (misal: 1-5) dan koma untuk halaman terpisah (misal: 1, 3, 5).
            </span>
          </div>
        )}

        {/* Filter Subset Halaman (WPS Office Dropdown/Filter) & Urutan Terbalik */}
        <div className="flex items-center justify-between gap-2 pt-0.5 flex-wrap">
          <div className="flex items-center gap-1 bg-white border border-dark-black-900 rounded-[9px] p-0.5">
            {[
              { id: 'all', label: 'Semua Halaman' },
              { id: 'odd', label: 'Hanya Ganjil' },
              { id: 'even', label: 'Hanya Genap' },
            ].map((sub) => (
              <button
                key={sub.id}
                type="button"
                onClick={() => update({ pageSubset: sub.id })}
                className={`px-2.5 py-1 rounded-[6px] font-figtree text-[11.5px] font-semibold transition-colors cursor-pointer ${
                  config.pageSubset === sub.id
                    ? 'bg-dark-black-900 text-lime-300 font-bold'
                    : 'text-dark-black-900/70 hover:text-dark-black-900'
                }`}
              >
                {sub.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => update({ reverseOrder: !config.reverseOrder })}
            className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-[9px] border font-figtree text-[11.5px] font-bold transition-all cursor-pointer ${
              config.reverseOrder
                ? 'border-dark-black-900 bg-dark-black-900 text-lime-300 shadow-xs'
                : 'border-dark-black-900/30 bg-white text-dark-black-900/80 hover:border-dark-black-900'
            }`}
          >
            <span
              className={`w-3.5 h-3.5 rounded-[3px] border border-dark-black-900 flex items-center justify-center ${
                config.reverseOrder ? 'bg-lime-300 text-dark-black-900' : 'bg-white'
              }`}
            >
              {config.reverseOrder && <IconCheck size={9} />}
            </span>
            <span>Urutan Terbalik</span>
          </button>
        </div>
      </div>

      {/* ── SEKSI 3: Penanganan Ukuran Halaman (Page Sizing & Handling) ── */}
      <div className="flex flex-col gap-3 border-t-2 border-dark-black-900/10 pt-3.5">
        <div className="flex items-center justify-between">
          <label className="font-figtree text-[13px] font-bold text-dark-black-900 flex items-center gap-1.5">
            <IconLayoutGrid size={14} />
            <span>Penanganan Ukuran Halaman</span>
          </label>

          {/* Sub-mode Tab: Ukuran vs Banyak Halaman (N-Up) */}
          <div className="flex bg-vanilla-300 p-0.5 rounded-[8px] border border-dark-black-900/25">
            <button
              type="button"
              onClick={() => {
                update({ handlingMode: 'size' })
                if (onChangeNUp) onChangeNUp(1)
              }}
              className={`px-2.5 py-1 rounded-[6px] font-figtree text-[11px] font-bold transition-colors cursor-pointer ${
                currentHandling === 'size'
                  ? 'bg-dark-black-900 text-lime-300'
                  : 'text-dark-black-900/70 hover:text-dark-black-900'
              }`}
            >
              Ukuran
            </button>
            <button
              type="button"
              onClick={() => {
                update({ handlingMode: 'multiple' })
                if (onChangeNUp && nUp === 1) onChangeNUp(2)
              }}
              className={`px-2.5 py-1 rounded-[6px] font-figtree text-[11px] font-bold transition-colors cursor-pointer ${
                currentHandling === 'multiple'
                  ? 'bg-dark-black-900 text-lime-300'
                  : 'text-dark-black-900/70 hover:text-dark-black-900'
              }`}
            >
              Banyak Halaman
            </button>
          </div>
        </div>

        {/* Opsi Tab A: Mode Ukuran (Fit, Actual 100%, Shrink, Custom) */}
        {currentHandling === 'size' && (
          <div className="flex flex-col gap-2">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
              {[
                { id: 'fit', label: 'Paskan', hint: 'Paskan ke area cetak kertas' },
                { id: 'actual', label: 'Ukuran Sebenarnya', hint: 'Ukuran 100% tanpa diubah' },
                { id: 'shrink', label: 'Kecilkan', hint: 'Kecilkan halaman yang terlalu besar' },
                { id: 'custom', label: 'Skala Kustom', hint: 'Tentukan persentase sendiri' },
              ].map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  onClick={() => {
                    if (mode.id === 'actual') {
                      update({ scaleMode: 'actual', customScale: 100 })
                    } else {
                      update({ scaleMode: mode.id })
                    }
                  }}
                  className={`py-2 px-1 rounded-[9px] border-2 font-figtree text-[12px] font-bold transition-all cursor-pointer text-center ${
                    config.scaleMode === mode.id
                      ? 'border-dark-black-900 bg-dark-black-900 text-lime-300 shadow-[1px_1px_0_0_rgba(56,56,56,1)]'
                      : 'border-dark-black-900/25 bg-white hover:border-dark-black-900 text-dark-black-900'
                  }`}
                  title={mode.hint}
                >
                  {mode.label}
                </button>
              ))}
            </div>

            {/* Panel Skala Kustom */}
            {isCustomScale && (
              <div className="flex flex-col gap-2 p-3 bg-white border-2 border-dark-black-900 rounded-[11px] shadow-xs">
                <div className="flex items-center justify-between">
                  <span className="font-figtree text-[12px] font-bold text-dark-black-900">
                    Persentase Skala
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleScaleStep(-5)}
                      className="w-7 h-7 rounded-[6px] border border-dark-black-900 bg-vanilla-100 hover:bg-lime-300 flex items-center justify-center font-bold text-[12px] cursor-pointer"
                      title="Kurang 5%"
                    >
                      <IconMinus size={12} />
                    </button>
                    <div className="flex items-center border-2 border-dark-black-900 rounded-[8px] bg-white px-2 py-0.5">
                      <input
                        type="number"
                        min="25"
                        max="200"
                        step="1"
                        value={config.customScale || 100}
                        onChange={(e) => {
                          const val = parseInt(e.target.value) || 100
                          update({ customScale: Math.max(25, Math.min(200, val)) })
                        }}
                        className="w-12 font-geist font-bold text-[13px] text-dark-black-900 text-center focus:outline-none"
                      />
                      <span className="font-geist text-[11px] font-bold text-dark-black-900/50">%</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleScaleStep(5)}
                      className="w-7 h-7 rounded-[6px] border border-dark-black-900 bg-vanilla-100 hover:bg-lime-300 flex items-center justify-center font-bold text-[12px] cursor-pointer"
                      title="Tambah 5%"
                    >
                      <IconPlus size={12} />
                    </button>
                    <button
                      type="button"
                      onClick={() => update({ customScale: 100 })}
                      className="px-2.5 py-1 rounded-[7px] border border-dark-black-900 bg-vanilla-200 hover:bg-lime-300 font-figtree text-[11.5px] font-bold cursor-pointer"
                    >
                      Reset 100%
                    </button>
                  </div>
                </div>

                <input
                  type="range"
                  min="25"
                  max="200"
                  step="1"
                  value={config.customScale || 100}
                  onChange={(e) => update({ customScale: parseInt(e.target.value) || 100 })}
                  className="w-full accent-dark-black-900 cursor-pointer"
                />
                <div className="flex justify-between font-geist text-[10px] text-dark-black-900/60 font-semibold">
                  <span>25%</span>
                  <span>100% (Normal)</span>
                  <span>200%</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Opsi Tab B: Banyak Halaman per Lembar (Multiple Pages / N-Up) */}
        {currentHandling === 'multiple' && (
          <div className="flex flex-col gap-2.5 p-3 bg-white border-2 border-dark-black-900 rounded-[12px] shadow-xs">
            <div className="flex items-center justify-between">
              <span className="font-figtree text-[12px] font-bold text-dark-black-900">
                Halaman per Lembar:
              </span>
              <span className="font-geist text-[11px] font-bold text-dark-black-900 bg-lime-300 px-2 py-0.5 rounded-[5px] border border-dark-black-900/20">
                {nUp} Halaman / Lembar
              </span>
            </div>

            {/* Pilihan 2, 4, 6, 9, 16 Halaman */}
            <div className="grid grid-cols-5 gap-1.5">
              {[2, 4, 6, 9, 16].map((num) => (
                <button
                  key={num}
                  type="button"
                  onClick={() => {
                    update({ pagesPerSheet: num })
                    if (onChangeNUp) onChangeNUp(num)
                  }}
                  className={`py-1.5 rounded-[8px] border-2 font-geist text-[12.5px] font-bold transition-all cursor-pointer text-center ${
                    nUp === num
                      ? 'border-dark-black-900 bg-dark-black-900 text-lime-300 shadow-xs'
                      : 'border-dark-black-900/25 bg-vanilla-100 hover:border-dark-black-900 text-dark-black-900'
                  }`}
                >
                  {num}
                </button>
              ))}
            </div>

            {/* Pengaturan Urutan Halaman & Border */}
            <div className="flex items-center justify-between gap-2 pt-1 border-t border-dark-black-900/10 flex-wrap">
              <div className="flex items-center gap-1.5">
                <span className="font-figtree text-[11.5px] font-medium text-dark-black-900/80">
                  Urutan:
                </span>
                <div className="flex bg-vanilla-200 border border-dark-black-900 rounded-[7px] p-0.5">
                  {[
                    { id: 'horizontal', label: 'Horisontal' },
                    { id: 'vertical', label: 'Vertikal' },
                  ].map((ord) => (
                    <button
                      key={ord.id}
                      type="button"
                      onClick={() => update({ pageOrder: ord.id })}
                      className={`px-2 py-0.5 rounded-[5px] font-figtree text-[11px] font-bold cursor-pointer ${
                        (config.pageOrder || 'horizontal') === ord.id
                          ? 'bg-dark-black-900 text-lime-300'
                          : 'text-dark-black-900/70 hover:text-dark-black-900'
                      }`}
                    >
                      {ord.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Checkbox Garis Batas Halaman */}
              <button
                type="button"
                onClick={() => update({ printBorder: !config.printBorder })}
                className="flex items-center gap-1.5 font-figtree text-[11.5px] font-bold text-dark-black-900 cursor-pointer"
              >
                <span
                  className={`w-3.5 h-3.5 rounded-[3px] border border-dark-black-900 flex items-center justify-center ${
                    config.printBorder ? 'bg-dark-black-900 text-lime-300' : 'bg-white'
                  }`}
                >
                  {config.printBorder && <IconCheck size={9} />}
                </span>
                <span>Cetak Batas Halaman</span>
              </button>
            </div>
          </div>
        )}

        {/* Pemusatan Otomatis Checkbox (WPS Office Center) */}
        <div className="flex items-center justify-between pt-0.5">
          <button
            type="button"
            onClick={() => update({ autoCenter: !config.autoCenter })}
            className="flex items-center gap-2 cursor-pointer"
          >
            <span
              className={`w-4 h-4 rounded-[4px] border-2 border-dark-black-900 flex items-center justify-center transition-colors ${
                config.autoCenter ? 'bg-dark-black-900 text-lime-300' : 'bg-white'
              }`}
            >
              {config.autoCenter && <IconCheck size={11} />}
            </span>
            <span className="font-figtree text-[12.5px] font-semibold text-dark-black-900">
              Pusatkan di tengah kertas
            </span>
          </button>
        </div>
      </div>

      {/* ── SEKSI 4: Orientasi & Rotasi Dokumen (WPS Office Orientation) ── */}
      <div className="flex flex-col gap-2.5 border-t-2 border-dark-black-900/10 pt-3.5">
        <div className="flex items-center justify-between">
          <label className="font-figtree text-[13px] font-bold text-dark-black-900 flex items-center gap-1.5">
            <IconRotateCw size={14} />
            <span>Orientasi & Rotasi</span>
          </label>
          <span className="font-geist text-[11px] font-bold text-dark-black-900 bg-lime-300 px-2 py-0.5 rounded-[5px] border border-dark-black-900/20">
            {orientation} · {config.rotation || 0}°
          </span>
        </div>

        {/* Pilihan Orientasi 3 Tombol: Otomatis, Potret, Lanskap */}
        <div className="grid grid-cols-3 gap-1.5">
          {[
            { id: 'auto', label: 'Otomatis' },
            { id: 'Portrait', label: 'Potret' },
            { id: 'Landscape', label: 'Lanskap' },
          ].map((item) => {
            const isSelected = item.id === 'auto'
              ? config.orientationMode === 'auto'
              : config.orientationMode !== 'auto' && orientation === item.id

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  if (item.id === 'auto') {
                    update({ orientationMode: 'auto' })
                  } else {
                    update({ orientationMode: item.id.toLowerCase() })
                    if (onChangeOrientation) onChangeOrientation(item.id)
                  }
                }}
                className={`py-2 px-2 rounded-[9px] border-2 font-figtree text-[12px] font-bold transition-all cursor-pointer text-center ${
                  isSelected
                    ? 'border-dark-black-900 bg-dark-black-900 text-lime-300 shadow-xs'
                    : 'border-dark-black-900/25 bg-white hover:border-dark-black-900 text-dark-black-900'
                }`}
              >
                {item.label}
              </button>
            )
          })}
        </div>

        {/* Baris Rotasi Sudut Cepat + Tombol Putar 90° */}
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center pt-0.5">
          <div className="sm:col-span-8 flex rounded-[9px] border border-dark-black-900 bg-white p-0.5 shadow-xs">
            {[0, 90, 180, 270].map((deg) => (
              <button
                key={deg}
                type="button"
                onClick={() => update({ rotation: deg })}
                className={`flex-1 py-1.5 rounded-[7px] font-geist text-[11.5px] font-bold transition-colors cursor-pointer text-center ${
                  (config.rotation || 0) === deg
                    ? 'bg-dark-black-900 text-lime-300'
                    : 'text-dark-black-900/70 hover:bg-vanilla-200'
                }`}
              >
                {deg}°
              </button>
            ))}
          </div>

          <div className="sm:col-span-4">
            <button
              type="button"
              onClick={handleRotate}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-[9px] border-2 border-dark-black-900 bg-white hover:bg-lime-300 font-figtree font-bold text-[12px] text-dark-black-900 shadow-[1px_1px_0_0_rgba(56,56,56,1)] transition-all cursor-pointer"
            >
              <IconRotateCw size={13} />
              <span>Putar 90°</span>
            </button>
          </div>
        </div>
      </div>
      {/* ── SEKSI 5: Margin Kertas (Page Margins) ── */}
      <div className="flex flex-col gap-2.5 border-t-2 border-dark-black-900/10 pt-3.5">
        <div className="flex items-center justify-between">
          <label className="font-figtree text-[13px] font-bold text-dark-black-900 flex items-center gap-1.5">
            <IconCrop size={14} />
            <span>Margin Kertas</span>
          </label>
          <span className="font-geist text-[11px] font-bold text-dark-black-900/70">
            {config.marginPreset === 'none'
              ? 'Tanpa Margin (0 mm)'
              : config.marginPreset === 'minimum'
                ? 'Sempit (3 mm)'
                : config.marginPreset === 'custom'
                  ? 'Kustom'
                  : 'Normal (5 mm)'}
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
          {[
            { id: 'default', label: 'Normal (5 mm)' },
            { id: 'none', label: 'Tanpa Margin' },
            { id: 'minimum', label: 'Sempit (3 mm)' },
            { id: 'custom', label: 'Kustom' },
          ].map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => {
                if (m.id === 'none') {
                  update({ marginPreset: m.id, margins: { top: 0, bottom: 0, left: 0, right: 0 } })
                } else if (m.id === 'minimum') {
                  update({ marginPreset: m.id, margins: { top: 3, bottom: 3, left: 3, right: 3 } })
                } else if (m.id === 'default') {
                  update({ marginPreset: m.id, margins: { top: 5, bottom: 5, left: 5, right: 5 } })
                } else {
                  update({ marginPreset: m.id })
                }
              }}
              className={`py-2 px-1 rounded-[9px] border-2 font-figtree text-[11.5px] font-bold transition-all cursor-pointer text-center ${
                config.marginPreset === m.id
                  ? 'border-dark-black-900 bg-dark-black-900 text-lime-300 shadow-xs'
                  : 'border-dark-black-900/25 bg-white hover:border-dark-black-900 text-dark-black-900'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        {/* Input Margin Kustom (Atas, Bawah, Kiri, Kanan) */}
        {isCustomMargin && (
          <div className="grid grid-cols-4 gap-2 p-2.5 bg-white border-2 border-dark-black-900 rounded-[11px] shadow-xs">
            {[
              { id: 'top', label: 'Atas' },
              { id: 'bottom', label: 'Bawah' },
              { id: 'left', label: 'Kiri' },
              { id: 'right', label: 'Kanan' },
            ].map((side) => (
              <label key={side.id} className="flex flex-col text-center">
                <span className="font-figtree text-[10.5px] font-bold text-dark-black-900/70 mb-0.5">
                  {side.label}
                </span>
                <div className="flex items-center border border-dark-black-900 bg-vanilla-100 rounded-[6px] px-1.5">
                  <input
                    type="number"
                    min="0"
                    max="50"
                    value={config.margins?.[side.id] ?? 5}
                    onChange={(e) => {
                      const val = Math.max(0, Math.min(50, parseFloat(e.target.value) || 0))
                      update({ margins: { ...(config.margins || {}), [side.id]: val } })
                    }}
                    className="w-full py-1 font-geist font-bold text-[12px] text-center text-dark-black-900 focus:outline-none"
                  />
                  <span className="font-geist text-[9px] text-dark-black-900/40">mm</span>
                </div>
              </label>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
