import { useEffect, useRef, useState } from 'react'
import { listen, speechRecognitionSupported, type Listening } from '../speech'
import { Button } from './ui'

/**
 * Record one spoken answer with the browser's speech recognition. Shows errors (mic blocked, nothing
 * heard, offline) and always offers typing as a way out.
 */
export function SpeakControl({ onHeard, onTypeInstead }: { onHeard: (alternatives: string[]) => void; onTypeInstead?: () => void }) {
  const [listening, setListening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const session = useRef<Listening | null>(null)

  useEffect(() => () => session.current?.stop(), [])

  const toggle = () => {
    if (listening) {
      session.current?.stop()
      return
    }
    setError(null)
    session.current = listen({
      onResult: (alts) => onHeard(alts),
      onError: (msg) => setError(msg),
      onEnd: () => setListening(false),
    })
    setListening(!!session.current)
  }

  if (!speechRecognitionSupported()) return null
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant={listening ? 'danger' : 'primary'} size="lg" onClick={toggle} aria-pressed={listening}>
          {listening ? '■ Stop' : '🎤 Speak'}
        </Button>
        {listening && (
          <span className="text-sm text-rose-600" role="status">
            Listening…
          </span>
        )}
        {onTypeInstead && (
          <button type="button" className="text-sm text-sky-700 underline dark:text-sky-300" onClick={onTypeInstead}>
            Type instead
          </button>
        )}
      </div>
      {error && (
        <p className="text-sm text-rose-700 dark:text-rose-300" role="alert">
          {error}
        </p>
      )}
      <p className="muted text-xs">Some browsers (e.g. Chrome) send the audio to their speech service to recognize it.</p>
    </div>
  )
}
