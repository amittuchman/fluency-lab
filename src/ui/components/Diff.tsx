import type { DiffOp } from '../../domain/checker'

/** Word-level diff: wrong words struck through with the expected word next to them. */
export function Diff({ ops }: { ops: DiffOp[] }) {
  return (
    <p className="text-base leading-8" aria-label="Your answer compared with the reference">
      {ops.map((op, i) => {
        const sep = i ? ' ' : ''
        switch (op.kind) {
          case 'equal':
            return <span key={i}>{sep + op.text}</span>
          case 'wrong':
            return (
              <span key={i}>
                {sep}
                <del className="rounded bg-rose-100 px-0.5 text-rose-800 dark:bg-rose-950 dark:text-rose-200" title="wrong">
                  {op.text}
                </del>{' '}
                <ins className="rounded bg-emerald-100 px-0.5 text-emerald-800 no-underline dark:bg-emerald-950 dark:text-emerald-200" title="expected">
                  {op.expected}
                </ins>
              </span>
            )
          case 'missing':
            return (
              <span key={i}>
                {sep}
                <ins className="rounded border border-dashed border-emerald-500 px-0.5 text-emerald-800 no-underline dark:text-emerald-200" title="missing">
                  {op.text}
                </ins>
              </span>
            )
          case 'extra':
            return (
              <span key={i}>
                {sep}
                <del className="rounded bg-rose-100 px-0.5 text-rose-800 dark:bg-rose-950 dark:text-rose-200" title="extra">
                  {op.text}
                </del>
              </span>
            )
        }
      })}
    </p>
  )
}

export function DiffLegend() {
  return (
    <p className="muted text-xs">
      <del className="text-rose-600">struck</del> = wrong or extra · <ins className="text-emerald-600 no-underline">green</ins> = expected ·{' '}
      <ins className="border border-dashed border-emerald-500 px-0.5 no-underline">dashed</ins> = missing
    </p>
  )
}
