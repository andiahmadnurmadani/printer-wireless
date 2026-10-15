import {
  IconTable,
  IconOrientationLandscape,
  IconOrientationPortrait,
  IconMinus,
  IconPlus,
  IconCheck,
  IconCopy,
  IconMaximize,
  IconSliders,
  IconRotateCw,
} from '../ui/icons'

export const DEFAULT_EXCEL_CONFIG = {
  // 1. Orientasi & Ukuran
  orientation: 'Landscape',

  // 2. Penskalaan Lembar Excel (Fit Modes)
  scaleMode: 'fit', // 'fit' | 'fitSheet' | 'actual' | 'shrink' | 'custom'
  customScale: 100, // 25 - 200 (%)

  // 3. Margin Kertas Khusus Excel
  marginPreset: 'narrow', // 'narrow' (3mm) | 'default' (5mm) | 'none' (0mm) | 'custom'
  margins: { top: 3, bottom: 3, left: 3, right: 3 }, // mm

  // 4. Pemusatan Tabel di Kertas (Center on Page)
  centerHorizontal: true,
  centerVertical: false,

  // 5. Salinan & Rentang Halaman
  copies: 1,
  collate: true,
  pageRangeMode: 'all', // 'all' | 'current' | 'custom'
  customRange: '',
  pageSubset: 'all', // 'all' | 'odd' | 'even'
  reverseOrder: false,

  // 6. Duplex & Rotasi
  duplexMode: 'simplex',
  rotation: 0,
}

export default function ExcelLayoutControls({
  config = DEFAULT_EXCEL_CONFIG,
  onChange,
  totalPages = 1,
  currentPage = 1,
  paperDim,
  orientation = 'Landscape',
  onChangeOrientation,
  copies = 1,
  onChangeCopies,
  collate = true,
  onChangeCollate,
  canDuplex = false,
  duplex = false,
  onToggleDuplex,
}) {
  const update = (patch) => {
    onChange({ ...config, ...patch })
  }

  const isCustomScale = config.scaleMode === 'custom'
  const isCustomMargin = config.marginPreset === 'custom'

  const handleScaleStep = (delta) => {
    const next = Math.max(25, Math.min(200, (config.customScale || 100) + delta))
    update({ scaleMode: 'custom', customScale: next })
  }

  const handleCopiesChange = (delta) => {
    if (!onChangeCopies) return
    const next = Math.max(1, Math.min(999, copies + delta))
    onChangeCopies(next)
  }

  return (
    <div className="flex flex-col gap-4 bg-vanilla-100/95 border-2 border-dark-black-900 p-4 sm:p-5 rounded-[16px] shadow-[3px_3px_0_0_rgba(56,56,56,1)]">
      {/* ── Header Strip: Khusus Excel / Spreadsheet ── */}
      <div className="flex items-center justify-between border-b-2 border-dark-black-900/15 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-[9px] bg-emerald-600 text-white flex items-center justify-center border border-dark-black-900 shadow-xs">
            <IconTable size={18} />
          </div>
          <div>
            <h3 className="font-figtree font-bold text-[14.5px] text-dark-black-900 tracking-tight leading-tight flex items-center gap-2">
              <span>Pengaturan Lembar Excel</span>
              <span className="font-geist text-[9.5px] font-extrabold uppercase tracking-wider bg-emerald-100 text-emerald-800 border border-emerald-700/30 px-1.5 py-0.2 rounded-[4px]">
                Spreadsheet
              </span>
            </h3>
            <span className="font-geist text-[11px] font-medium text-dark-black-900/60">
              Format dialog cetak khusus tabel & lembar kerja Excel
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

      {/* ── Info Hint Card khusus Pengguna Excel ── */}
      <div className="bg-emerald-50/80 border border-emerald-600/30 rounded-[10px] p-2.5 flex items-start gap-2">
        <div className="text-emerald-700 mt-0.5 shrink-0">
          <IconTable size={14} />
        </div>
        <p className="font-figtree text-[11.5px] text-emerald-900/80 leading-relaxed">
          <strong>Tips Tata Letak Excel:</strong> Gunakan <strong>Landscape</strong> dan <strong>Margin Sempit</strong> untuk tabel yang memiliki banyak kolom agar tidak terpotong dan tercetak leluasa.
        </p>
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
                className={`flex items-center gap-2 px-3 py-2 rounded-[9px] border transition-all cursor-pointer ${
                  copies > 1 && collate
                    ? 'border-dark-black-900 bg-lime-300/20 shadow-xs'
                    : 'border-dark-black-900/30 bg-white hover:border-dark-black-900'
                }`}
              >
                <span
                  className={`w-4 h-4 rounded-[4px] border-2 border-dark-black-900 flex items-center justify-center transition-colors ${
                    collate ? 'bg-dark-black-900 text-lime-300' : 'bg-white'
                  }`}
                >
                  {collate && <IconCheck size={11} />}
                </span>
                <div className="flex flex-col text-left">
                  <span className="font-figtree text-[12px] font-bold text-dark-black-900 flex items-center gap-1.5">
                    <span>Urutkan (Collate)</span>
                    {copies > 1 && (
                      <span className="font-geist text-[9.5px] font-bold px-1.5 py-0.2 rounded-[4px] bg-dark-black-900 text-lime-300">
                        {collate ? 'Per Bundel' : 'Per Halaman'}
                      </span>
                    )}
                  </span>
                  <span className="font-geist text-[10px] text-dark-black-900/70">
                    {copies <= 1
                      ? 'Aktif saat salinan > 1 (1 bundel)'
                      : collate
                        ? 'Cetak per bundel (1,2,3... 1,2,3...)'
                        : 'Cetak per halaman (1,1... 2,2...)'}
                  </span>
                </div>
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── SEKSI 2: Orientasi Lembar Kertas (Landscape / Portrait) ── */}
      <div className="flex flex-col gap-2">
        <label className="font-figtree text-[12.5px] font-bold text-dark-black-900 flex items-center justify-between">
          <span>Orientasi Kertas Cetak</span>
          <span className="font-geist text-[11px] font-medium text-dark-black-900/50">
            Aktif: {orientation}
          </span>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => {
              if (onChangeOrientation) onChangeOrientation('Landscape')
              update({ orientation: 'Landscape' })
            }}
            className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-[10px] border-2 font-figtree text-[12.5px] font-bold transition-all cursor-pointer ${
              orientation === 'Landscape'
                ? 'border-dark-black-900 bg-dark-black-900 text-lime-300 shadow-[2px_2px_0_0_rgba(56,56,56,1)]'
                : 'border-dark-black-900/30 bg-white hover:border-dark-black-900 text-dark-black-900'
            }`}
          >
            <IconOrientationLandscape size={16} />
            <span>Landscape (Mendatar)</span>
          </button>
          <button
            type="button"
            onClick={() => {
              if (onChangeOrientation) onChangeOrientation('Portrait')
              update({ orientation: 'Portrait' })
            }}
            className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-[10px] border-2 font-figtree text-[12.5px] font-bold transition-all cursor-pointer ${
              orientation === 'Portrait'
                ? 'border-dark-black-900 bg-dark-black-900 text-lime-300 shadow-[2px_2px_0_0_rgba(56,56,56,1)]'
                : 'border-dark-black-900/30 bg-white hover:border-dark-black-900 text-dark-black-900'
            }`}
          >
            <IconOrientationPortrait size={16} />
            <span>Portrait (Tegak)</span>
          </button>
        </div>
      </div>

      {/* ── SEKSI 2: Penskalaan Tabel Excel (Excel Fit Modes) ── */}
      <div className="flex flex-col gap-2 border-t-2 border-dark-black-900/10 pt-3">
        <label className="font-figtree text-[12.5px] font-bold text-dark-black-900 flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <IconMaximize size={14} />
            <span>Penskalaan Tabel Excel</span>
          </span>
          <span className="font-geist text-[11px] font-bold text-dark-black-900/60">
            {config.scaleMode === 'custom' ? `${config.customScale}%` : config.scaleMode === 'actual' ? '100% Asli' : config.scaleMode === 'fitSheet' ? '1 Lembar Penuh' : config.scaleMode === 'shrink' ? 'Kecilkan' : 'Paskan Halaman'}
          </span>
        </label>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
          {[
            { id: 'fit', label: 'Paskan Halaman', hint: 'Paskan tabel proporsional di dalam batas kertas' },
            { id: 'fitSheet', label: '1 Lembar Penuh', hint: 'Kecilkan seluruh isi lembar kerja agar muat dalam 1 halaman' },
            { id: 'actual', label: 'Ukuran 100%', hint: 'Ukuran sel 100% tanpa pengubahan skala' },
            { id: 'custom', label: 'Skala Kustom', hint: 'Atur persentase skala sendiri' },
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
              className={`py-2 px-1 rounded-[9px] border-2 font-figtree text-[11.5px] font-bold transition-all cursor-pointer text-center ${
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

        {/* Panel Pengatur Skala Kustom */}
        {isCustomScale && (
          <div className="flex flex-col gap-2 p-3 bg-white border-2 border-dark-black-900 rounded-[11px] shadow-xs mt-1">
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
                    className="w-12 text-center font-geist font-bold text-[12px] outline-none"
                  />
                  <span className="font-geist text-[11px] text-dark-black-900/50 font-bold">%</span>
                </div>
                <button
                  type="button"
                  onClick={() => handleScaleStep(5)}
                  className="w-7 h-7 rounded-[6px] border border-dark-black-900 bg-vanilla-100 hover:bg-lime-300 flex items-center justify-center font-bold text-[12px] cursor-pointer"
                  title="Tambah 5%"
                >
                  <IconPlus size={12} />
                </button>
              </div>
            </div>
            <input
              type="range"
              min="25"
              max="200"
              step="5"
              value={config.customScale || 100}
              onChange={(e) => update({ customScale: parseInt(e.target.value) || 100 })}
              className="w-full accent-dark-black-900 cursor-pointer"
            />
          </div>
        )}
      </div>

      {/* ── SEKSI 3: Margin Kertas Khusus Excel (Margins) ── */}
      <div className="flex flex-col gap-2 border-t-2 border-dark-black-900/10 pt-3">
        <label className="font-figtree text-[12.5px] font-bold text-dark-black-900 flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <IconSliders size={14} />
            <span>Margin Kertas Lembar Kerja</span>
          </span>
          <span className="font-geist text-[11px] text-dark-black-900/50 font-semibold">
            {config.marginPreset === 'narrow' ? 'Sempit 3mm' : config.marginPreset === 'default' ? 'Standar 5mm' : config.marginPreset === 'none' ? '0mm' : 'Kustom'}
          </span>
        </label>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
          {[
            { id: 'narrow', label: 'Sempit (3 mm)', hint: 'Direkomendasikan untuk Excel agar kolom tabel muat lebih luas' },
            { id: 'default', label: 'Standar (5 mm)', hint: 'Margin seimbang batas aman printer' },
            { id: 'none', label: 'Tanpa Margin (0 mm)', hint: 'Tepi penuh ke batas fisik kertas' },
            { id: 'custom', label: 'Kustom mm', hint: 'Tentukan margin atas/bawah/kiri/kanan sendiri' },
          ].map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => {
                const patch = { marginPreset: m.id }
                if (m.id === 'narrow') patch.margins = { top: 3, bottom: 3, left: 3, right: 3 }
                if (m.id === 'default') patch.margins = { top: 5, bottom: 5, left: 5, right: 5 }
                if (m.id === 'none') patch.margins = { top: 0, bottom: 0, left: 0, right: 0 }
                update(patch)
              }}
              className={`py-2 px-1 rounded-[9px] border-2 font-figtree text-[11px] font-bold transition-all cursor-pointer text-center ${
                config.marginPreset === m.id
                  ? 'border-dark-black-900 bg-dark-black-900 text-lime-300 shadow-[1px_1px_0_0_rgba(56,56,56,1)]'
                  : 'border-dark-black-900/25 bg-white hover:border-dark-black-900 text-dark-black-900'
              }`}
              title={m.hint}
            >
              {m.label}
            </button>
          ))}
        </div>

        {/* Panel Margin Kustom */}
        {isCustomMargin && (
          <div className="grid grid-cols-4 gap-2 p-2.5 bg-white border-2 border-dark-black-900 rounded-[11px] shadow-xs mt-1">
            {['top', 'right', 'bottom', 'left'].map((side) => (
              <label key={side} className="flex flex-col gap-1 text-center">
                <span className="font-figtree text-[10px] uppercase font-bold text-dark-black-900/60">
                  {side === 'top' ? 'Atas' : side === 'right' ? 'Kanan' : side === 'bottom' ? 'Bawah' : 'Kiri'}
                </span>
                <div className="flex items-center justify-center border border-dark-black-900 rounded-[6px] px-1 py-0.5">
                  <input
                    type="number"
                    min="0"
                    max="50"
                    step="1"
                    value={config.margins?.[side] ?? 5}
                    onChange={(e) => {
                      const val = Math.max(0, Math.min(50, parseInt(e.target.value) || 0))
                      update({
                        margins: { ...config.margins, [side]: val },
                      })
                    }}
                    className="w-8 text-center font-geist font-bold text-[11.5px] outline-none"
                  />
                  <span className="text-[10px] text-dark-black-900/50">mm</span>
                </div>
              </label>
            ))}
          </div>
        )}
      </div>

      {/* ── SEKSI 4: Pemusatan di Kertas (Center on Page) ── */}
      <div className="flex flex-col gap-2 border-t-2 border-dark-black-900/10 pt-3">
        <label className="font-figtree text-[12.5px] font-bold text-dark-black-900">
          Pemusatan Tabel di Lembar Kertas
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => update({ centerHorizontal: !config.centerHorizontal })}
            className={`inline-flex items-center gap-2 px-3 py-2 rounded-[9px] border font-figtree text-[12px] font-bold transition-all cursor-pointer ${
              config.centerHorizontal
                ? 'border-dark-black-900 bg-dark-black-900 text-lime-300 shadow-xs'
                : 'border-dark-black-900/30 bg-white text-dark-black-900/80 hover:border-dark-black-900'
            }`}
          >
            <span
              className={`w-4 h-4 rounded-[3px] border border-dark-black-900 flex items-center justify-center ${
                config.centerHorizontal ? 'bg-lime-300 text-dark-black-900' : 'bg-white'
              }`}
            >
              {config.centerHorizontal && <IconCheck size={10} />}
            </span>
            <span>Rata Tengah Horisontal</span>
          </button>

          <button
            type="button"
            onClick={() => update({ centerVertical: !config.centerVertical })}
            className={`inline-flex items-center gap-2 px-3 py-2 rounded-[9px] border font-figtree text-[12px] font-bold transition-all cursor-pointer ${
              config.centerVertical
                ? 'border-dark-black-900 bg-dark-black-900 text-lime-300 shadow-xs'
                : 'border-dark-black-900/30 bg-white text-dark-black-900/80 hover:border-dark-black-900'
            }`}
          >
            <span
              className={`w-4 h-4 rounded-[3px] border border-dark-black-900 flex items-center justify-center ${
                config.centerVertical ? 'bg-lime-300 text-dark-black-900' : 'bg-white'
              }`}
            >
              {config.centerVertical && <IconCheck size={10} />}
            </span>
            <span>Rata Tengah Vertikal</span>
          </button>
        </div>
      </div>

      {/* ── SEKSI 5: Salinan (Copies) & Rentang Halaman ── */}
      <div className="flex flex-col gap-2 border-t-2 border-dark-black-900/10 pt-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
          {/* Stepper Jumlah Salinan */}
          <div className="flex items-center justify-between bg-white border border-dark-black-900 rounded-[10px] p-1.5 px-3">
            <span className="font-figtree text-[12px] font-bold text-dark-black-900 flex items-center gap-1.5">
              <IconCopy size={13} />
              <span>Salinan (Copies)</span>
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => handleCopiesChange(-1)}
                className="w-7 h-7 rounded-[6px] border border-dark-black-900 bg-vanilla-100 hover:bg-lime-300 flex items-center justify-center font-bold text-[13px] cursor-pointer"
                title="Kurang 1"
              >
                <IconMinus size={13} />
              </button>
              <input
                type="number"
                min="1"
                max="999"
                value={copies}
                onChange={(e) => {
                  if (onChangeCopies) {
                    onChangeCopies(Math.max(1, Math.min(999, parseInt(e.target.value) || 1)))
                  }
                }}
                className="w-12 text-center font-geist font-bold text-[13px] outline-none"
              />
              <button
                type="button"
                onClick={() => handleCopiesChange(1)}
                className="w-7 h-7 rounded-[6px] border border-dark-black-900 bg-vanilla-100 hover:bg-lime-300 flex items-center justify-center font-bold text-[13px] cursor-pointer"
                title="Tambah 1"
              >
                <IconPlus size={13} />
              </button>
            </div>
          </div>

          {/* Rotasi Cepat Dokumen */}
          <div className="flex items-center justify-between bg-white border border-dark-black-900 rounded-[10px] p-1.5 px-3">
            <span className="font-figtree text-[12px] font-bold text-dark-black-900 flex items-center gap-1.5">
              <IconRotateCw size={13} />
              <span>Rotasi Lembar</span>
            </span>
            <button
              type="button"
              onClick={() => {
                const nextRot = ((config.rotation || 0) + 90) % 360
                update({ rotation: nextRot })
              }}
              className="px-2.5 py-1 rounded-[6px] border border-dark-black-900 bg-vanilla-100 hover:bg-lime-300 font-figtree text-[12px] font-bold cursor-pointer transition-colors"
            >
              {config.rotation || 0}°
            </button>
          </div>
        </div>

        {/* Pilihan Rentang Halaman */}
        <div className="flex items-center justify-between gap-2 pt-1 flex-wrap">
          <div className="flex items-center gap-1 bg-white border border-dark-black-900 rounded-[9px] p-0.5">
            {[
              { id: 'all', label: 'Semua Lembar' },
              { id: 'current', label: `Halaman ${currentPage}` },
              { id: 'custom', label: 'Kustom' },
            ].map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => update({ pageRangeMode: r.id })}
                className={`px-2.5 py-1 rounded-[6px] font-figtree text-[11px] font-semibold transition-colors cursor-pointer ${
                  config.pageRangeMode === r.id
                    ? 'bg-dark-black-900 text-lime-300 font-bold'
                    : 'text-dark-black-900/70 hover:text-dark-black-900'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>

          {config.pageRangeMode === 'custom' && (
            <input
              type="text"
              value={config.customRange || ''}
              onChange={(e) => update({ customRange: e.target.value })}
              placeholder="Contoh: 1-3, 5"
              className="flex-1 min-w-[130px] border border-dark-black-900 rounded-[8px] bg-white px-2.5 py-1 font-geist text-[11.5px] outline-none"
            />
          )}
        </div>
      </div>
    </div>
  )
}
