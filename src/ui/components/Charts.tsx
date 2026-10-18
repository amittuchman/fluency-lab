import { useLayoutEffect, useRef, useState, type RefObject } from 'react'
import type { DayCount } from '../../domain/stats'

function dayLabel(day: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y!, m! - 1, d!).toLocaleDateString('en-GB', opts)
}

/** Reference blue ramp (sequential). Light and dark modes use their own steps. */
const BAR = 'fill-[#2a78d6] dark:fill-[#5598e7]'
const HEAT_LIGHT = ['#e8e8e4', '#86b6ef', '#3987e5', '#256abf', '#104281']
const HEAT_DARK = ['#2a2a28', '#184f95', '#256abf', '#3987e5', '#86b6ef']

function TableView({ rows, unit }: { rows: DayCount[]; unit: string }) {
  return (
    <details className="mt-2 text-xs">
      <summary className="muted cursor-pointer">Show as table</summary>
      <table className="mt-1">
        <tbody>
          {rows.map((r) => (
            <tr key={r.day}>
              <td className="pr-4">{dayLabel(r.day)}</td>
              <td className="text-right tabular-nums">
                {r.count} {unit}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  )
}

/** 14-day due forecast: one series, so no legend; hovering a bar shows its value. */
export function ForecastChart({ data }: { data: DayCount[] }) {
  const [hover, setHover] = useState<number | null>(null)
  const [box, W] = useWidth()
  const max = Math.max(1, ...data.map((d) => d.count))
  const H = 150
  const pad = { top: 8, bottom: 22, left: 28 }
  const slot = (W - pad.left) / data.length
  const barW = Math.max(6, slot - 6)
  const y = (v: number) => pad.top + (H - pad.top - pad.bottom) * (1 - v / max)
  const ticks = [0, Math.round(max / 2), max].filter((v, i, a) => a.indexOf(v) === i)
  const shown = hover ?? null

  const labelEvery = slot >= 40 ? 2 : 3
  return (
    <figure ref={box}>
      <p className="muted mb-1 h-5 text-xs tabular-nums" aria-live="polite">
        {shown !== null ? `${dayLabel(data[shown]!.day)}: ${data[shown]!.count} due` : `Peak: ${max} cards in a day`}
      </p>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block" role="img" aria-label={`Reviews due over the next ${data.length} days`} onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.left} x2={W} y1={y(t)} y2={y(t)} className="stroke-slate-200 dark:stroke-slate-800" strokeWidth={1} />
            <text x={pad.left - 6} y={y(t) + 3} textAnchor="end" className="fill-slate-500 text-[11px]">
              {t}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = pad.left + i * slot + (slot - barW) / 2
          const top = y(d.count)
          const h = H - pad.bottom - top
          return (
            <g key={d.day} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0} aria-label={`${dayLabel(d.day)}: ${d.count} due`}>
              {/* Hit target is the whole column, bigger than the mark. */}
              <rect x={pad.left + i * slot} y={pad.top} width={slot} height={H - pad.top - pad.bottom} fill="transparent" />
              {d.count > 0 && <path d={roundedTop(x, top, barW, h, Math.min(4, h))} className={`${BAR} ${hover !== null && hover !== i ? 'opacity-60' : ''}`} />}
              {i % labelEvery === 0 && (
                <text x={x + barW / 2} y={H - 6} textAnchor="middle" className="fill-slate-500 text-[11px]">
                  {i === 0 ? 'Today' : dayLabel(d.day, { day: 'numeric', month: 'short' })}
                </text>
              )}
            </g>
          )
        })}
      </svg>
      <TableView rows={data} unit="due" />
    </figure>
  )
}

/** Bar with 4px rounded data end, square at the baseline. */
function roundedTop(x: number, y: number, w: number, h: number, r: number): string {
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`
}

function bucket(count: number, max: number): number {
  if (count === 0) return 0
  return Math.min(4, 1 + Math.floor((count / Math.max(1, max)) * 3.999))
}

/** 90-day activity heatmap: weeks as columns, weekdays as rows. */
export function ActivityHeatmap({ data }: { data: DayCount[] }) {
  const [hover, setHover] = useState<DayCount | null>(null)
  const max = Math.max(1, ...data.map((d) => d.count))
  const [y0, m0, d0] = data[0]!.day.split('-').map(Number)
  const firstWeekday = (new Date(y0!, m0! - 1, d0!).getDay() + 6) % 7 // Monday = 0
  const cell = 12
  const gap = 2
  const weeks = Math.ceil((firstWeekday + data.length) / 7)
  const W = 24 + weeks * (cell + gap)
  const H = 7 * (cell + gap)
  const active = data.filter((d) => d.count > 0).length

  return (
    <figure>
      <p className="muted mb-1 h-5 text-xs tabular-nums" aria-live="polite">
        {hover ? `${dayLabel(hover.day)}: ${hover.count} answers` : `${active} active days in the last ${data.length}`}
      </p>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-xl" role="img" aria-label={`Answers per day over the last ${data.length} days`} onMouseLeave={() => setHover(null)}>
        {['Mon', 'Wed', 'Fri'].map((label, i) => (
          <text key={label} x={0} y={i * 2 * (cell + gap) + cell - 2} className="fill-slate-500 text-[8px]">
            {label}
          </text>
        ))}
        {data.map((d, i) => {
          const pos = firstWeekday + i
          const b = bucket(d.count, max)
          return (
            <g key={d.day} onMouseEnter={() => setHover(d)}>
              <rect x={24 + Math.floor(pos / 7) * (cell + gap)} y={(pos % 7) * (cell + gap)} width={cell} height={cell} rx={2} fill={HEAT_LIGHT[b]} className="dark:hidden" />
              <rect x={24 + Math.floor(pos / 7) * (cell + gap)} y={(pos % 7) * (cell + gap)} width={cell} height={cell} rx={2} fill={HEAT_DARK[b]} className="hidden dark:block" />
            </g>
          )
        })}
      </svg>
      <div className="muted mt-1 flex items-center gap-1 text-[10px]" aria-hidden>
        Less
        {HEAT_LIGHT.map((c, i) => (
          <span key={c} className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: c }}>
            <span className="hidden h-full w-full rounded-sm dark:block" style={{ background: HEAT_DARK[i] }} />
          </span>
        ))}
        More
      </div>
      <TableView rows={data.filter((d) => d.count > 0)} unit="answers" />
    </figure>
  )
}

/** Track an element's pixel width so SVG text stays at its real size. */
function useWidth(fallback = 320): [RefObject<HTMLElement | null>, number] {
  const ref = useRef<HTMLElement | null>(null)
  const [width, setWidth] = useState(fallback)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([entry]) => entry && setWidth(Math.max(200, Math.floor(entry.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width]
}
