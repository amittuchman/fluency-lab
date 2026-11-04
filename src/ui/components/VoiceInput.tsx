import { useCallback, useEffect, useRef, useState } from 'react'
import { appendTranscript, dictate, speechRecognitionSupported, type Listening } from '../speech'
import { Kbd } from './ui'

const NOTE_SHOWN_KEY = 'voiceInputNoteShown'

/** Shown once per browser: true the first time it's asked, false after. */
function firstTimeUnsupported(): boolean {
  try {
    if (localStorage.getItem(NOTE_SHOWN_KEY)) return false
    localStorage.setItem(NOTE_SHOWN_KEY, '1')
  } catch {
    // Storage blocked (private mode): show the note; it's small.
  }
  return true
}

/**
 * Microphone button for an answer field: click (or Ctrl+M) to start dictating, again to stop. Live text
 * shows under the field; final text is appended to the field, never submitted. Hidden where the browser
 * has no speech recognition.
 */
export function VoiceInput({ value, onChange, disabled }: { value: string; onChange: (text: string) => void; disabled?: boolean }) {
  const [supported] = useState(speechRecognitionSupported)
  const [showNote] = useState(() => !supported && firstTimeUnsupported())
  const [recording, setRecording] = useState(false)
  const [interim, setInterim] = useState('')
  const [error, setError] = useState<string | null>(null)
  const session = useRef<Listening | null>(null)
  // The field may change while recording (typing, earlier results): always append to the latest text.
  const latest = useRef(value)
  latest.current = value
  const change = useRef(onChange)
  change.current = onChange

  const stop = useCallback(() => {
    session.current?.stop()
    session.current = null
  }, [])

  const toggle = useCallback(() => {
    if (session.current) {
      stop()
      return
    }
    setError(null)
    session.current = dictate({
      onInterim: setInterim,
      onFinal: (text) => {
        latest.current = appendTranscript(latest.current, text)
        change.current(latest.current)
      },
      onError: setError,
      onEnd: () => {
        session.current = null
        setRecording(false)
        setInterim('')
      },
    })
    setRecording(!!session.current)
  }, [stop])

  // Stop when the answer is checked or the card goes away.
  useEffect(() => {
    if (disabled) stop()
  }, [disabled, stop])
  useEffect(() => stop, [stop])

  useEffect(() => {
    if (!supported || disabled) return
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'm') {
        e.preventDefault()
        toggle()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [supported, disabled, toggle])

  if (!supported) {
    return showNote ? <p className="muted text-xs">Voice input isn't supported in this browser.</p> : null
  }
  if (disabled) return null
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          // Keep the focus (and the phone keyboard) on the answer field.
          onMouseDown={(e) => e.preventDefault()}
          onClick={toggle}
          aria-pressed={recording}
          aria-label={recording ? 'Stop voice input (Ctrl+M)' : 'Voice input (Ctrl+M)'}
          className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm font-medium ${
            recording
              ? 'animate-pulse border-rose-500 bg-rose-600 text-white'
              : 'border-slate-300 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800'
          }`}
        >
          {recording ? '■ Stop' : '🎤 Voice'}
          {/* Phones have no keyboard shortcut to show. */}
          <span className="hidden sm:inline">
            <Kbd>Ctrl+M</Kbd>
          </span>
        </button>
        {recording && (
          <span className="text-xs text-rose-600 dark:text-rose-400" role="status">
            Recording…
          </span>
        )}
      </div>
      {recording && interim && (
        <p className="muted text-sm italic" aria-live="polite">
          {interim}
        </p>
      )}
      {error && (
        <p className="text-xs text-rose-700 dark:text-rose-300" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
