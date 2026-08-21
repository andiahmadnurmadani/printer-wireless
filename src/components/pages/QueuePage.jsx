import { useMemo, useState } from 'react'
import { useApp } from '../../context/AppContext'
import Button from '../ui/Button'
import Modal from '../ui/Modal'
import { FileTypeBadge } from '../ui/Badges'
import {
  IconPrinter, IconPlay, IconPause, IconTrash, IconDrag, IconQueue, IconAlert,
  IconChevronDown, IconChevronUp, IconEye, IconRefresh, IconCopy,
} from '../ui/icons'

const statusMeta = {
  printing: { label: 'Printing', cls: 'bg-lime-300 text-dark-black-900 border-dark-black-900' },
  queued: { label: 'Queued', cls: 'bg-sky-blue-100 text-dark-black-900 border-dark-black-900' },
  paused: { label: 'Paused', cls: 'bg-warn-100 text-warn-500 border-dark-black-900' },
  completed: { label: 'Completed', cls: 'bg-ok-100 text-ok-500 border-dark-black-900' },
  failed: { label: 'Failed', cls: 'bg-err-100 text-err-500 border-err-500' },
  cancelled: { label: 'Cancelled', cls: 'bg-surface-gray-300 text-dark-gray-600 border-dark-black-900' },
}

const priorityMeta = {
  1: { label: 'Low', cls: 'bg-vanilla-300 text-dark-black-900' },
  2: { label: 'Normal', cls: 'bg-sky-blue-100 text-dark-black-900' },
  3: { label: 'Normal', cls: 'bg-sky-blue-100 text-dark-black-900' },
  4: { label: 'High', cls: 'bg-warn-100 text-warn-500' },
  5: { label: 'Urgent', cls: 'bg-err-100 text-err-500' },
}

export default function QueuePage() {
  const app = useApp()
  const { jobs, printers, cancelJob, pauseJob, resumeJob, reorderQueue, setJobPriority, clearQueue, toast } = app

  const [detail, setDetail] = useState(null)
  const [draggingId, setDraggingId] = useState(null)
  const [overId, setOverId] = useState(null)
  const [showAll, setShowAll] = useState(false)

  const activeJobs = useMemo(() => jobs.filter((j) => ['queued', 'printing', 'paused'].includes(j.status)), [jobs])
  const doneJobs = useMemo(() => jobs.filter((j) => ['completed', 'failed', 'cancelled'].includes(j.status)), [jobs])
  const displayed = showAll ? activeJobs : activeJobs.slice(0, 8)

  const printerOf = (id) => printers.find((p) => p.id === id)?.name || 'Unknown printer'

  const onDrop = (targetId) => {
    if (draggingId && draggingId !== targetId) reorderQueue(draggingId, targetId)
    setDraggingId(null)
    setOverId(null)
  }

  return (
    <div className="flex flex-col gap-7">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="w-[14px] h-[14px] bg-lime-300 border border-dark-black-900 rounded-[2px] inline-block" />
            <span className="font-geist text-[11px] uppercase tracking-widest text-dark-black-900/60 font-medium">Active jobs</span>
          </div>
          <h1 className="font-figtree font-semibold text-[36px] leading-tight text-dark-black-900">Print queue</h1>
          <p className="font-figtree font-light text-dark-black-900/60 text-[15px] mt-0.5">
            {activeJobs.length} active job{activeJobs.length !== 1 ? 's' : ''} — drag to reorder, adjust priority, or manage each job.
          </p>
        </div>
        {doneJobs.length > 0 && (
          <Button variant="vanilla" onClick={clearQueue} icon={<IconTrash size={16} />}>Clear finished</Button>
        )}
      </div>

      {activeJobs.length === 0 ? (
        <div className="border-2 border-dashed border-dark-black-900/40 rounded-[20px] py-20 flex flex-col items-center text-center bg-vanilla-100/50">
          <div className="w-16 h-16 rounded-[18px] border-2 border-dark-black-900 bg-vanilla-200 flex items-center justify-center text-dark-black-900/40 mb-4">
            <IconQueue size={30} />
          </div>
          <div className="font-figtree font-medium text-dark-black-900 text-[15px]">Queue is empty</div>
          <div className="font-figtree font-light text-dark-black-900/50 text-[13px] mt-1">All jobs have been processed — nice work!</div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {displayed.map((job) => {
            const meta = statusMeta[job.status]
            const printer = printers.find((p) => p.id === job.printerId)
            return (
              <div
                key={job.id}
                draggable
                onDragStart={() => setDraggingId(job.id)}
                onDragOver={(e) => { e.preventDefault(); setOverId(job.id) }}
                onDragLeave={() => setOverId(null)}
                onDrop={() => onDrop(job.id)}
                className={`relative bg-vanilla-200 border-2 rounded-[16px] p-4 transition-all duration-150 ${
                  overId === job.id ? 'border-sky-blue-500 bg-sky-blue-100/40 scale-[1.01]' : 'border-dark-black-900'
                } ${draggingId === job.id ? 'opacity-40' : ''}`}
              >
                <div className="flex items-center gap-4 flex-wrap lg:flex-nowrap">
                  {/* Drag handle */}
                  <div className="text-dark-black-900/30 cursor-grab active:cursor-grabbing shrink-0 hidden lg:block" title="Drag to reorder">
                    <IconDrag size={20} />
                  </div>

                  {/* Status icon */}
                  <div
                    className={`w-11 h-11 rounded-[12px] border-2 border-dark-black-900 flex items-center justify-center shrink-0 ${
                      job.status === 'printing' ? 'bg-lime-300' : job.status === 'paused' ? 'bg-warn-100' : job.status === 'failed' ? 'bg-err-100' : 'bg-vanilla-100'
                    }`}
                  >
                    {job.status === 'printing' ? <IconPlay size={18} /> : job.status === 'paused' ? <IconPause size={18} /> : job.status === 'failed' ? <IconAlert size={18} /> : <IconCopy size={18} />}
                  </div>

                  {/* File info */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <span className="font-figtree font-semibold text-[15px] text-dark-black-900 truncate">{job.name}</span>
                      <FileTypeBadge type={job.fileType} />
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full border text-[11px] font-semibold font-figtree ${meta.cls}`}>
                        {meta.label}
                      </span>
                    </div>
                    <div className="font-figtree font-light text-dark-black-900/55 text-[13px] mt-0.5 flex items-center gap-1.5 flex-wrap">
                      <span className="inline-flex items-center gap-1"><IconPrinter size={13} /> {printerOf(job.printerId)}</span>
                      <span>·</span>
                      <span>{job.pages} pages</span>
                      <span>·</span>
                      <span>{job.copies} copy{job.copies > 1 ? 'ies' : ''}</span>
                      <span>·</span>
                      <span>{job.paperSize}</span>
                      <span>·</span>
                      <span>{job.color ? 'Color' : 'Grayscale'}</span>
                      <span>·</span>
                      <span>{job.duplex ? 'Duplex' : 'Single-sided'}</span>
                      <span>·</span>
                      <span className="font-geist text-[11.5px]">{job.size}</span>
                    </div>
                  </div>

                  {/* Progress (printing) */}
                  {job.status === 'printing' && (
                    <div className="w-full lg:w-[180px] shrink-0">
                      <div className="flex justify-between text-[11px] font-figtree mb-1">
                        <span className="font-medium text-dark-black-900">Progress</span>
                        <span className="font-geist text-dark-black-900/60">{Math.round(job.progress)}%</span>
                      </div>
                      <div className="h-2 rounded-full bg-dark-black-900/10 border border-dark-black-900/20 overflow-hidden">
                        <div className="h-full bg-lime-400 rounded-full progress-stripes transition-all duration-700" style={{ width: `${job.progress}%` }} />
                      </div>
                    </div>
                  )}

                  {/* Priority */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="font-figtree text-[11px] font-medium text-dark-black-900/50 uppercase tracking-wide">Priority</span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setJobPriority(job.id, Math.max(1, (job.priority || 3) - 1))}
                        className="w-7 h-7 rounded-[8px] border border-dark-black-900 bg-vanilla-100 hover:bg-vanilla-300 flex items-center justify-center cursor-pointer"
                      >
                        <IconChevronDown size={14} />
                      </button>
                      <span className={`min-w-[34px] h-[26px] px-1.5 rounded-[8px] border border-dark-black-900 flex items-center justify-center text-[11px] font-bold font-geist ${priorityMeta[job.priority]?.cls || 'bg-vanilla-300'}`}>
                        {priorityMeta[job.priority]?.label || 'Normal'}
                      </span>
                      <button
                        onClick={() => setJobPriority(job.id, Math.min(5, (job.priority || 3) + 1))}
                        className="w-7 h-7 rounded-[8px] border border-dark-black-900 bg-vanilla-100 hover:bg-vanilla-300 flex items-center justify-center cursor-pointer"
                      >
                        <IconChevronUp size={14} />
                      </button>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => setDetail(job)}
                      className="w-9 h-9 rounded-[10px] border-2 border-dark-black-900 bg-vanilla-100 hover:bg-vanilla-300 flex items-center justify-center cursor-pointer"
                      title="Job details"
                    >
                      <IconEye size={16} />
                    </button>
                    {job.status === 'paused' ? (
                      <button
                        onClick={() => resumeJob(job.id)}
                        className="inline-flex items-center gap-1.5 px-3.5 h-9 rounded-[10px] border-2 border-dark-black-900 bg-lime-300 hover:bg-lime-500 font-figtree text-[12.5px] font-semibold text-dark-black-900 cursor-pointer"
                      >
                        <IconPlay size={14} /> Resume
                      </button>
                    ) : job.status === 'printing' || job.status === 'queued' ? (
                      <>
                        <button
                          onClick={() => pauseJob(job.id)}
                          className="inline-flex items-center gap-1.5 px-3.5 h-9 rounded-[10px] border-2 border-dark-black-900 bg-vanilla-100 hover:bg-warn-100 font-figtree text-[12.5px] font-semibold text-dark-black-900 cursor-pointer"
                        >
                          <IconPause size={14} /> Pause
                        </button>
                        <button
                          onClick={() => cancelJob(job.id)}
                          className="inline-flex items-center gap-1.5 px-3.5 h-9 rounded-[10px] border-2 border-err-500 bg-err-100 hover:bg-err-500 hover:text-white font-figtree text-[12.5px] font-semibold text-err-500 cursor-pointer"
                        >
                          <IconTrash size={14} /> Cancel
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>

                {/* Printer queue status line */}
                {printer && printer.status === 'paused' && (
                  <div className="mt-3 flex items-center gap-2 text-[12px] font-figtree font-medium text-warn-500 bg-warn-100 border border-dark-black-900 rounded-[9px] px-3 py-1.5">
                    <IconPause size={13} /> Printer "{printer.name}" is paused — this job will wait until it resumes.
                  </div>
                )}
                {printer && printer.status === 'offline' && job.status === 'queued' && (
                  <div className="mt-3 flex items-center gap-2 text-[12px] font-figtree font-medium text-err-500 bg-err-100 border border-err-500 rounded-[9px] px-3 py-1.5">
                    <IconAlert size={13} /> Printer "{printer.name}" is offline — job will retry when it comes back online.
                  </div>
                )}
              </div>
            )
          })}

          {activeJobs.length > 8 && (
            <button
              onClick={() => setShowAll(!showAll)}
              className="mx-auto mt-1 inline-flex items-center gap-2 px-5 py-2.5 rounded-[11px] border-2 border-dark-black-900 bg-vanilla-100 hover:bg-lime-300 transition-colors font-figtree font-semibold text-[13.5px] text-dark-black-900 cursor-pointer"
            >
              <IconRefresh size={15} className={showAll ? 'rotate-180 transition-transform' : 'transition-transform'} />
              {showAll ? 'Show less' : `Show all ${activeJobs.length} jobs`}
            </button>
          )}
        </div>
      )}

      {/* ── Job detail modal ── */}
      <Modal
        open={!!detail}
        onClose={() => setDetail(null)}
        title={detail?.name || 'Job'}
        subtitle={detail ? `${detail.fileType} document` : ''}
        size="md"
        footer={
          <>
            {detail?.status === 'paused' && <Button variant="lime" onClick={() => { resumeJob(detail.id); setDetail(null) }} icon={<IconPlay size={15} />}>Resume job</Button>}
            {(detail?.status === 'queued' || detail?.status === 'printing') && (
              <>
                <Button variant="vanilla" onClick={() => { pauseJob(detail.id); setDetail(null) }} icon={<IconPause size={15} />}>Pause</Button>
                <Button variant="danger" onClick={() => { cancelJob(detail.id); setDetail(null) }} icon={<IconTrash size={15} />}>Cancel job</Button>
              </>
            )}
            <Button variant="dark" onClick={() => setDetail(null)}>Close</Button>
          </>
        }
      >
        {detail && (
          <div className="flex flex-col gap-5">
            <div className="flex items-center gap-2">
              <FileTypeBadge type={detail.fileType} />
              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full border text-[11px] font-semibold font-figtree ${statusMeta[detail.status]?.cls}`}>
                {statusMeta[detail.status]?.label}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {[
                { label: 'Printer', value: printerOf(detail.printerId) },
                { label: 'Pages', value: String(detail.pages) },
                { label: 'Copies', value: String(detail.copies) },
                { label: 'Paper size', value: detail.paperSize },
                { label: 'Color', value: detail.color ? 'Color' : 'Grayscale' },
                { label: 'Duplex', value: detail.duplex ? 'Two-sided' : 'Single-sided' },
                { label: 'File size', value: detail.size || '—' },
                { label: 'Priority', value: priorityMeta[detail.priority]?.label || 'Normal' },
              ].map((row) => (
                <div key={row.label} className="p-3 rounded-[12px] border border-dark-black-900/20 bg-vanilla-100">
                  <div className="font-figtree text-[11px] font-medium text-dark-black-900/50 uppercase tracking-wide">{row.label}</div>
                  <div className="font-figtree text-[14px] font-medium text-dark-black-900 mt-0.5">{row.value}</div>
                </div>
              ))}
            </div>

            {detail.status === 'printing' && (
              <div>
                <div className="flex justify-between text-[12.5px] font-figtree mb-1.5">
                  <span className="font-medium text-dark-black-900">Printing progress</span>
                  <span className="font-geist text-dark-black-900/60">{Math.round(detail.progress)}%</span>
                </div>
                <div className="h-3 rounded-full bg-dark-black-900/10 border border-dark-black-900/20 overflow-hidden">
                  <div className="h-full bg-lime-400 rounded-full progress-stripes transition-all duration-700" style={{ width: `${detail.progress}%` }} />
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
