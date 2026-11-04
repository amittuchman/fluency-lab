import { useEffect, useState } from 'react'

// ---------- text to speech ----------

export function ttsSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined'
}

function isEnglish(v: SpeechSynthesisVoice): boolean {
  return /^en[-_](US|GB)/i.test(v.lang)
}

/** English (US/GB) voices. They load asynchronously in Chrome, so this re-renders on `voiceschanged`. */
export function useVoices(): SpeechSynthesisVoice[] {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() => (ttsSupported() ? speechSynthesis.getVoices().filter(isEnglish) : []))
  useEffect(() => {
    if (!ttsSupported()) return
    const update = () => setVoices(speechSynthesis.getVoices().filter(isEnglish))
    update()
    speechSynthesis.addEventListener('voiceschanged', update)
    return () => speechSynthesis.removeEventListener('voiceschanged', update)
  }, [])
  return voices
}

export function hasEnglishVoice(): boolean {
  return ttsSupported() && speechSynthesis.getVoices().some(isEnglish)
}

/**
 * Speak `text`. Call it directly from a click/key handler: iOS only plays speech started by a user gesture.
 * Falls back to any en-US voice when the chosen voice is missing.
 */
export function speak(text: string, opts: { voiceURI: string | null; rate: number }): void {
  if (!ttsSupported() || !text.trim()) return
  speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(text)
  const voices = speechSynthesis.getVoices()
  const voice = voices.find((v) => v.voiceURI === opts.voiceURI) ?? voices.find((v) => /^en[-_]US/i.test(v.lang)) ?? voices.find(isEnglish)
  if (voice) u.voice = voice
  u.lang = voice?.lang ?? 'en-US'
  u.rate = opts.rate
  speechSynthesis.speak(u)
}

// ---------- speech recognition ----------

/** The parts of the (still prefixed in most browsers) Web Speech recognition API that we use. */
interface Recognizer {
  lang: string
  interimResults: boolean
  maxAlternatives: number
  continuous: boolean
  onresult: ((e: SpeechRecognitionEvent) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}
type RecognizerCtor = new () => Recognizer

function recognizerCtor(): RecognizerCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { SpeechRecognition?: RecognizerCtor; webkitSpeechRecognition?: RecognizerCtor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export function speechRecognitionSupported(): boolean {
  return recognizerCtor() !== null
}

const ERRORS: Record<string, string> = {
  'not-allowed': 'Microphone access was blocked. Allow it in the browser settings.',
  'service-not-allowed': 'Speech recognition is not allowed in this browser.',
  'no-speech': "Didn't hear anything. Try again a bit closer to the mic.",
  'audio-capture': 'No microphone found.',
  network: 'Speech recognition needs a network connection in this browser.',
  aborted: 'Stopped.',
}

export interface Listening {
  stop: () => void
}

/**
 * Listen once and return the recognizer's alternatives (best first). Results are approximate: the
 * recognizer "corrects" what it hears toward likely English.
 */
export function listen(handlers: { onResult: (alternatives: string[]) => void; onError: (message: string) => void; onEnd: () => void }): Listening | null {
  const Ctor = recognizerCtor()
  if (!Ctor) return null
  const r = new Ctor()
  r.lang = 'en-US'
  r.interimResults = false
  r.maxAlternatives = 3
  r.continuous = false
  r.onresult = (e) => {
    const res = e.results[0]
    if (!res) return
    const alts: string[] = []
    for (let i = 0; i < res.length; i++) alts.push(res[i]!.transcript)
    handlers.onResult(alts)
  }
  r.onerror = (e) => handlers.onError(ERRORS[e.error] ?? `Speech recognition error: ${e.error}`)
  r.onend = handlers.onEnd
  r.start()
  return { stop: () => r.stop() }
}

/**
 * Dictation into an answer field: runs until stopped, reporting text as it is heard (`onInterim`, replaced
 * as recognition goes on) and each newly final piece (`onFinal`, to append). Android Chrome repeats earlier
 * text in continuous mode, so there it listens one phrase at a time and restarts until stopped.
 */
export function dictate(handlers: {
  onInterim: (text: string) => void
  onFinal: (text: string) => void
  onError: (message: string) => void
  onEnd: () => void
}): Listening | null {
  const Ctor = recognizerCtor()
  if (!Ctor) return null
  const continuous = !/Android/i.test(navigator.userAgent)
  let stopped = false
  let current: Recognizer | null = null

  const start = () => {
    const r = new Ctor()
    current = r
    r.lang = 'en-US'
    r.interimResults = true
    r.maxAlternatives = 1
    r.continuous = continuous
    // Final text already passed on in this session: later events may repeat it.
    let applied = ''
    r.onresult = (e) => {
      let final = ''
      let interim = ''
      for (let i = 0; i < e.results.length; i++) {
        const res = e.results[i]!
        if (res.isFinal) final += res[0]!.transcript
        else interim += res[0]!.transcript
      }
      if (final !== applied) {
        const added = final.startsWith(applied) ? final.slice(applied.length) : final
        applied = final
        if (added.trim()) handlers.onFinal(added.trim())
      }
      handlers.onInterim(interim.trim())
    }
    r.onerror = (e) => {
      if (e.error === 'aborted' || (e.error === 'no-speech' && !continuous)) return
      stopped = true
      handlers.onError(ERRORS[e.error] ?? `Speech recognition error: ${e.error}`)
    }
    r.onend = () => {
      handlers.onInterim('')
      if (!stopped && !continuous) start()
      else handlers.onEnd()
    }
    r.start()
  }
  start()
  return {
    stop: () => {
      stopped = true
      current?.stop()
    },
  }
}

/** Add dictated text after what's already in the field, with one space between. */
export function appendTranscript(current: string, heard: string): string {
  const add = heard.trim()
  if (!add) return current
  if (!current.trim()) return add
  return /\s$/.test(current) ? current + add : `${current} ${add}`
}
