import { useState, type ReactNode } from 'react'
import { validateContent } from '../../domain/parser'
import { ALL_TENSES, tenseLabel } from '../../domain/tags'
import { NOTE_TYPES, type NoteContent, type NoteType, type TenseName } from '../../domain/types'
import { emptyContent } from '../noteForm'

interface Props {
  content: NoteContent
  onChange: (c: NoteContent) => void
  /** Allow switching the type (Quick Add); fixed when editing an existing note. */
  typeEditable?: boolean
}

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="muted mt-1 block text-xs">{hint}</span>}
    </label>
  )
}

export function NoteFields({ content, onChange, typeEditable }: Props) {
  const set = (patch: Record<string, unknown>) => onChange({ ...content, fields: { ...content.fields, ...patch } } as NoteContent)
  const v = validateContent(content)

  return (
    <div className="space-y-3">
      {typeEditable && (
        <Field label="Type">
          <select className="input" value={content.type} onChange={(e) => onChange(emptyContent(e.target.value as NoteType))}>
            {NOTE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>
      )}

      {content.type === 'vocab' && (
        <>
          <Field label="Term">
            <input className="input" value={content.fields.term} onChange={(e) => set({ term: e.target.value })} autoFocus={typeEditable} />
          </Field>
          <Field label="Definition (English)">
            <input className="input" value={content.fields.definition} onChange={(e) => set({ definition: e.target.value })} />
          </Field>
          <Field label="Examples" hint="One per line. The first example that contains the term becomes a cloze card.">
            <textarea
              className="input min-h-16"
              value={content.fields.examples.join('\n')}
              onChange={(e) => set({ examples: e.target.value.split('\n') })}
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Hebrew (optional)">
              <input className="input he" dir="auto" value={content.fields.he ?? ''} onChange={(e) => set({ he: e.target.value })} />
            </Field>
            <Field label="Part of speech (optional)">
              <input className="input" value={content.fields.pos ?? ''} onChange={(e) => set({ pos: e.target.value })} />
            </Field>
          </div>
          <Field label="Collocations (optional)" hint="Separate with ;">
            <input
              className="input"
              value={(content.fields.collocations ?? []).join('; ')}
              onChange={(e) => set({ collocations: e.target.value.split(/\s*;\s*/) })}
            />
          </Field>
          <Field label="Notes / memory hook (optional)">
            <input className="input" value={content.fields.notes ?? ''} onChange={(e) => set({ notes: e.target.value })} />
          </Field>
        </>
      )}

      {content.type === 'sentence' && (
        <>
          <Field label="Sentence" hint="Optional: mark chunks to hide with {{…}}; otherwise content words are picked automatically.">
            <textarea className="input min-h-16" value={content.fields.text} onChange={(e) => set({ text: e.target.value })} autoFocus={typeEditable} />
          </Field>
          <Field label="Hebrew gloss (optional)" hint="Used as the prompt for full recall.">
            <input className="input he" dir="auto" value={content.fields.he ?? ''} onChange={(e) => set({ he: e.target.value })} />
          </Field>
          <Field label="Notes (optional)">
            <input className="input" value={content.fields.notes ?? ''} onChange={(e) => set({ notes: e.target.value })} />
          </Field>
        </>
      )}

      {content.type === 'fix' && (
        <>
          <Field label="Wrong">
            <input className="input" value={content.fields.wrong} onChange={(e) => set({ wrong: e.target.value })} autoFocus={typeEditable} />
          </Field>
          <Field label="Right" hint="Alternatives separated by //">
            <input className="input" value={content.fields.right} onChange={(e) => set({ right: e.target.value })} />
          </Field>
          <Field label="Rule">
            <input className="input" value={content.fields.rule} onChange={(e) => set({ rule: e.target.value })} />
          </Field>
        </>
      )}

      {content.type === 'natural' && (
        <>
          <Field label="My phrasing">
            <input className="input" value={content.fields.mine} onChange={(e) => set({ mine: e.target.value })} autoFocus={typeEditable} />
          </Field>
          <Field label="Natural version" hint="Optional: mark the key phrase with {{…}}.">
            <input className="input" value={content.fields.natural} onChange={(e) => set({ natural: e.target.value })} />
          </Field>
          <Field label="Note (optional)">
            <input className="input" value={content.fields.note ?? ''} onChange={(e) => set({ note: e.target.value })} />
          </Field>
        </>
      )}

      {content.type === 'tense' && (
        <>
          <Field label="Sentence" hint="Mark the verb: I {{have been working::work}} here.">
            <input className="input" value={content.fields.sentence} onChange={(e) => set({ sentence: e.target.value })} autoFocus={typeEditable} />
          </Field>
          <Field label="Tense">
            <select className="input" value={content.fields.tense} onChange={(e) => set({ tense: e.target.value as TenseName })}>
              {ALL_TENSES.map((t) => (
                <option key={t} value={t}>
                  {tenseLabel(t)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Why (optional)">
            <input className="input" value={content.fields.why ?? ''} onChange={(e) => set({ why: e.target.value })} />
          </Field>
        </>
      )}

      {content.type === 'cloze' && (
        <Field label="Text" hint="{{answer}}, {{answer::hint}}, alternatives with //. Each {{…}} is its own card.">
          <textarea className="input min-h-16" value={content.fields.text} onChange={(e) => set({ text: e.target.value })} autoFocus={typeEditable} />
        </Field>
      )}

      {(v.errors.length > 0 || v.warnings.length > 0) && (
        <ul className="space-y-0.5 text-sm">
          {v.errors.map((m) => (
            <li key={m} className="text-rose-700 dark:text-rose-300">
              {m}
            </li>
          ))}
          {v.warnings.map((m) => (
            <li key={m} className="text-amber-700 dark:text-amber-300">
              {m}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function TagsField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [focused, setFocused] = useState(false)
  return (
    <label className="block">
      <span className="label">Tags</span>
      <input
        className="input"
        value={value}
        placeholder="economics, natural-phrasing"
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
      {focused && <span className="muted mt-1 block text-xs">Comma or space separated. Saved lowercase and hyphenated.</span>}
    </label>
  )
}
