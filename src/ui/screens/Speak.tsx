import { useMemo, useState } from 'react'
import { repos } from '../../data'
import { checkSpeech, type SpeechCheck } from '../../domain/checker'
import { clozePlain } from '../../domain/cloze'
import type { Note } from '../../domain/types'
import { shuffle } from '../../domain/util'
import { Diff } from '../components/Diff'
import { SpeakControl } from '../components/SpeakControl'
import { Button, Empty, PageHeader } from '../components/ui'
import { useRepoQuery, useSettings } from '../hooks'
import { speak, speechRecognitionSupported, useVoices } from '../speech'

interface SpeakItem {
  id: string
  target: string
  /** What to show in speaking-recall mode. */
  cue: string
  cueIsHebrew: boolean
}

/** Sentences worth saying aloud: key sentences, natural versions, corrections, vocab examples. */
function itemsFrom(notes: Note[]): SpeakItem[] {
  const out: SpeakItem[] = []
  for (const n of notes) {
    switch (n.type) {
      case 'sentence':
        out.push({ id: n.id, target: clozePlain(n.fields.text), cue: n.fields.he ?? '', cueIsHebrew: !!n.fields.he })
        break
      case 'natural':
        out.push({ id: n.id, target: clozePlain(n.fields.natural), cue: `Say it naturally: ${n.fields.mine}`, cueIsHebrew: false })
        break
      case 'fix':
        out.push({ id: n.id, target: n.fields.right.split('//')[0]!.trim(), cue: `Correct it: ${n.fields.wrong}`, cueIsHebrew: false })
        break
      case 'vocab':
        n.fields.examples.slice(0, 1).forEach((e, i) => out.push({ id: `${n.id}:${i}`, target: clozePlain(e), cue: `Use “${n.fields.term}”: ${n.fields.definition}`, cueIsHebrew: false }))
        break
      default:
        break
    }
  }
  return out
}

type Mode = 'shadow' | 'recall'

export function Speak() {
  const settings = useSettings()
  const audioOn = useVoices().length > 0
  const [mode, setMode] = useState<Mode>('shadow')
  const [packageId, setPackageId] = useState('')
  const [index, setIndex] = useState(0)
  const [result, setResult] = useState<SpeechCheck | null>(null)
  const [attempts, setAttempts] = useState<number[]>([])
  const [showText, setShowText] = useState(true)

  const data = useRepoQuery(async () => {
    const [notes, packages] = await Promise.all([repos.notes.all(), repos.packages.all()])
    return { notes: notes.filter((n) => !n.suspended), packages }
  }, [])
  // Shuffle once per source, not on every live-query update.
  const noteKey = data?.notes.map((n) => n.id).join(',')
  const items = useMemo(
    () => (data ? shuffle(itemsFrom(packageId ? data.notes.filter((n) => n.packageId === packageId) : data.notes)) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reshuffle only when the set of notes changes
    [noteKey, packageId],
  )

  if (!speechRecognitionSupported()) {
    return (
      <div className="mx-auto max-w-2xl">
        <PageHeader title="Speak" />
        <Empty title="Speech recognition isn't available in this browser.">Speak mode works in Chrome, Edge and Safari.</Empty>
      </div>
    )
  }
  if (!data) return <p className="muted">Loading…</p>

  const item = items[index % Math.max(1, items.length)]
  const play = () => item && speak(item.target, { voiceURI: settings.ttsVoiceURI, rate: settings.ttsRate })
  const next = () => {
    setResult(null)
    setIndex((i) => i + 1)
  }
  const avg = attempts.length ? Math.round((attempts.reduce((a, b) => a + b, 0) / attempts.length) * 100) : null

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader title="Speak">
        {avg !== null && (
          <span className="muted text-sm">
            {attempts.length} tries · {avg}% average match
          </span>
        )}
      </PageHeader>
      <p className="muted text-sm">Practice only: nothing here changes your schedule. Matching is approximate, because speech recognition auto-corrects what it hears.</p>

      <div className="card flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-lg border border-slate-300 p-0.5 dark:border-slate-700" role="tablist">
          {(['shadow', 'recall'] as const).map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              onClick={() => {
                setMode(m)
                setResult(null)
              }}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${mode === m ? 'bg-sky-600 text-white' : 'muted hover:bg-slate-100 dark:hover:bg-slate-800'}`}
            >
              {m === 'shadow' ? 'Shadowing' : 'Speaking recall'}
            </button>
          ))}
        </div>
        <select
          className="input w-auto"
          value={packageId}
          onChange={(e) => {
            setPackageId(e.target.value)
            setIndex(0)
            setResult(null)
          }}
          aria-label="Package"
        >
          <option value="">All material</option>
          {data.packages.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {mode === 'shadow' && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={showText} onChange={(e) => setShowText(e.target.checked)} />
            Show text
          </label>
        )}
      </div>

      {!item ? (
        <Empty title="No sentences to practice yet." />
      ) : (
        <div className="card space-y-4">
          <p className="muted text-sm">{mode === 'shadow' ? 'Listen, then repeat it with the same rhythm.' : 'Say it in English, without reading.'}</p>
          {mode === 'shadow' ? (
            <>
              {audioOn ? (
                <Button variant="primary" onClick={play}>
                  🔊 Listen
                </Button>
              ) : (
                <p className="text-sm text-amber-700 dark:text-amber-300">No English voice available: read the sentence and say it.</p>
              )}
              {(showText || !audioOn || result) && <p className="text-xl">{item.target}</p>}
            </>
          ) : (
            <p className={`text-xl ${item.cueIsHebrew ? 'he' : ''}`} dir="auto" lang={item.cueIsHebrew ? 'he' : undefined}>
              {item.cue || '(no prompt: say the sentence you remember)'}
            </p>
          )}

          {!result ? (
            <SpeakControl
              onHeard={(alts) => {
                const r = checkSpeech(alts, item.target)
                setResult(r)
                setAttempts((a) => [...a, r.similarity])
              }}
            />
          ) : (
            <div className="space-y-2 border-t border-slate-200 pt-3 dark:border-slate-800" aria-live="polite">
              <p className={`font-semibold ${result.verdict === 'correct' ? 'text-emerald-700 dark:text-emerald-300' : result.verdict === 'almost' ? 'text-amber-700 dark:text-amber-300' : 'text-rose-700 dark:text-rose-300'}`}>
                {Math.round(result.similarity * 100)}% match
              </p>
              <p className="text-sm">
                <span className="muted">Heard: </span>“{result.transcript}”
              </p>
              {result.verdict !== 'correct' && <Diff ops={result.diff} />}
              {mode === 'recall' && <p>{item.target}</p>}
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => setResult(null)}>Try again</Button>
                {audioOn && <Button onClick={play}>🔊 Listen</Button>}
                <Button variant="primary" onClick={next}>
                  Next
                </Button>
              </div>
            </div>
          )}
          <p className="muted text-xs">
            {(index % items.length) + 1} / {items.length}
          </p>
        </div>
      )}
    </div>
  )
}
