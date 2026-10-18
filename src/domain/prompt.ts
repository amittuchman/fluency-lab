import { clozeBlank, clozeCount, clozePlain, hasCloze } from './cloze'
import { tokenize } from './checker'
import { tenseChoice } from './conjugator'
import { contentChunks, naturalKeyPhrase, vocabClozeExample, type Chunk } from './templates'
import type { Card, Note, Settings, TenseName } from './types'
import { seededRandom, shuffle } from './util'

/** Everything shown after the answer is revealed. */
export interface Reveal {
  answer: string
  full?: string
  definition?: string
  examples?: string[]
  collocations?: string[]
  he?: string
  rule?: string
  why?: string
  tense?: TenseName
  notes?: string
  original?: string
}

export interface Context {
  before: string
  after: string
}

interface PromptBase {
  instruction: string
  /** Main prompt text (above the input). */
  prompt?: string
  promptIsHebrew?: boolean
  /** Sentence with a blank. */
  context?: Context
  hint?: string
  reveal: Reveal
  /** Text to read aloud (Phase 4). */
  speak: string
}

export interface FlipPrompt extends PromptBase {
  kind: 'flip'
  front: string
  frontSub?: string
}

export interface TypedPrompt extends PromptBase {
  kind: 'typed'
  accepted: string[]
  typoTolerance: boolean
  multiline: boolean
  /** For tense cards: lets the UI explain a wrong tense. */
  tenseInfo?: { verb: string; tense: TenseName; before: string }
}

export interface ChoicePrompt extends PromptBase {
  kind: 'choice'
  options: string[]
  correctIndex: number
}

export type Prompt = FlipPrompt | TypedPrompt | ChoicePrompt

/** Split a sentence around a token chunk, moving edge punctuation out of the answer. */
export function blankChunk(text: string, chunk: Chunk): { context: Context; answer: string } {
  const tokens = tokenize(text)
  let answer = tokens.slice(chunk.start, chunk.end).join(' ')
  const lead = /^[^\p{L}\p{N}]+/u.exec(answer)?.[0] ?? ''
  const trail = /[^\p{L}\p{N}]+$/u.exec(answer)?.[0] ?? ''
  answer = answer.slice(lead.length, answer.length - trail.length)
  const before = tokens.slice(0, chunk.start).join(' ')
  const after = tokens.slice(chunk.end).join(' ')
  return {
    context: { before: (before ? before + ' ' : '') + lead, after: trail + (after ? ' ' + after : '') },
    answer,
  }
}

function firstLetters(text: string): string {
  return tokenize(text)
    .map((t) => t.replace(/\p{L}[\p{L}']*/gu, (w) => w[0]!))
    .join(' ')
}

export interface PromptOptions {
  promptLanguage: Settings['promptLanguage']
}

export function buildPrompt(note: Note, card: Card, opts: PromptOptions): Prompt {
  const rand = seededRandom(`${card.id}:${card.fsrs.reps}`)
  const t = card.template

  switch (note.type) {
    case 'vocab': {
      const f = note.fields
      const reveal: Reveal = {
        answer: f.term,
        definition: f.definition,
        examples: f.examples.map(clozePlain),
        ...(f.collocations ? { collocations: f.collocations } : {}),
        ...(f.he ? { he: f.he } : {}),
        ...(f.notes ? { notes: f.notes } : {}),
      }
      if (t === 'cloze-use') {
        const ex = vocabClozeExample(f)
        if (ex) {
          return {
            kind: 'typed',
            instruction: 'Fill in the missing word',
            context: { before: ex.match.before, after: ex.match.after },
            hint: f.definition,
            accepted: [ex.match.match],
            typoTolerance: true,
            multiline: false,
            reveal: { ...reveal, answer: ex.match.match, full: clozePlain(ex.example) },
            speak: clozePlain(ex.example),
          }
        }
      }
      if (t === 'produce' || t === 'cloze-use') {
        const hebrew = opts.promptLanguage === 'hebrew' && !!f.he
        return {
          kind: 'typed',
          instruction: 'Which word or phrase is this?',
          prompt: hebrew ? f.he : f.definition,
          promptIsHebrew: hebrew,
          ...(f.pos ? { hint: f.pos } : {}),
          accepted: [f.term],
          typoTolerance: true,
          multiline: false,
          reveal,
          speak: f.term,
        }
      }
      return {
        kind: 'flip',
        instruction: 'Do you know what this means?',
        front: f.term,
        ...(f.pos ? { frontSub: f.pos } : {}),
        reveal,
        speak: f.term,
      }
    }

    case 'sentence': {
      const f = note.fields
      const plain = clozePlain(f.text)
      const reveal: Reveal = { answer: plain, full: plain, ...(f.he ? { he: f.he } : {}), ...(f.notes ? { notes: f.notes } : {}) }
      if (t === 'recall-full') {
        return {
          kind: 'typed',
          instruction: f.he ? 'Say it in English, then type it' : 'Recall the sentence from its first letters',
          prompt: f.he ?? firstLetters(plain),
          promptIsHebrew: !!f.he,
          accepted: [plain],
          typoTolerance: true,
          multiline: true,
          reveal,
          speak: plain,
        }
      }
      // chunk-cloze: markup chunks if present, otherwise auto-picked content chunks; rotate by review count.
      let context: Context
      let accepted: string[]
      if (hasCloze(f.text)) {
        const n = (card.fsrs.reps % clozeCount(f.text)) + 1
        const b = clozeBlank(f.text, n)!
        context = { before: b.before, after: b.after }
        accepted = b.answers
      } else {
        const chunks = contentChunks(plain)
        const b = blankChunk(plain, chunks[card.fsrs.reps % chunks.length]!)
        context = b.context
        accepted = [b.answer]
      }
      return {
        kind: 'typed',
        instruction: 'Complete the sentence',
        context,
        accepted,
        typoTolerance: true,
        multiline: false,
        reveal: { ...reveal, answer: accepted[0]! },
        speak: plain,
      }
    }

    case 'fix': {
      const f = note.fields
      const right = f.right.split('//')[0]!.trim()
      const reveal: Reveal = { answer: right, original: f.wrong, ...(f.rule ? { rule: f.rule } : {}) }
      if (t === 'which-is-right') {
        const options = shuffle([right, f.wrong], rand)
        return {
          kind: 'choice',
          instruction: 'Which one is correct?',
          options,
          correctIndex: options.indexOf(right),
          reveal,
          speak: right,
        }
      }
      return {
        kind: 'typed',
        instruction: 'Correct the sentence',
        prompt: f.wrong,
        accepted: f.right.split('//').map((s) => s.trim()),
        typoTolerance: false,
        multiline: true,
        reveal,
        speak: right,
      }
    }

    case 'natural': {
      const f = note.fields
      const natural = clozePlain(f.natural)
      const reveal: Reveal = { answer: natural, full: natural, original: f.mine, ...(f.note ? { notes: f.note } : {}) }
      if (t === 'natural-cloze') {
        let context: Context | null = null
        let accepted: string[] = []
        if (hasCloze(f.natural)) {
          const b = clozeBlank(f.natural, 1)!
          context = { before: b.before, after: b.after }
          accepted = b.answers
        } else {
          const key = naturalKeyPhrase(f.mine, natural)
          if (key) {
            const b = blankChunk(natural, key)
            context = b.context
            accepted = [b.answer]
          }
        }
        if (context && accepted.length) {
          return {
            kind: 'typed',
            instruction: 'Complete the natural version',
            prompt: f.mine,
            context,
            accepted,
            typoTolerance: false,
            multiline: false,
            reveal: { ...reveal, answer: accepted[0]! },
            speak: natural,
          }
        }
      }
      return {
        kind: 'typed',
        instruction: 'Say it more naturally',
        prompt: f.mine,
        accepted: [natural],
        typoTolerance: false,
        multiline: true,
        reveal,
        speak: natural,
      }
    }

    case 'tense': {
      const f = note.fields
      const b = clozeBlank(f.sentence, 1)
      const full = clozePlain(f.sentence)
      const answers = b?.answers ?? []
      const verb = b?.hint ?? ''
      const reveal: Reveal = { answer: answers[0] ?? '', full, tense: f.tense, ...(f.why ? { why: f.why } : {}) }
      const context = { before: b?.before ?? '', after: b?.after ?? '' }
      if (t === 'tense-choose') {
        const choice = tenseChoice({ verb, tense: f.tense, answers, before: context.before })
        if (choice) {
          const options = shuffle(choice.options, rand)
          return {
            kind: 'choice',
            instruction: 'Choose the right form',
            context,
            ...(verb ? { hint: verb } : {}),
            options,
            correctIndex: options.indexOf(choice.options[choice.correctIndex]!),
            reveal,
            speak: full,
          }
        }
      }
      return {
        kind: 'typed',
        instruction: 'Fill in the verb in the right tense',
        context,
        ...(verb ? { hint: verb } : {}),
        accepted: answers,
        typoTolerance: false,
        multiline: false,
        reveal,
        speak: full,
        ...(verb ? { tenseInfo: { verb, tense: f.tense, before: context.before } } : {}),
      }
    }

    case 'cloze': {
      const text = note.fields.text
      const n = Number(t.split(':')[1] ?? 1)
      const b = clozeBlank(text, n) ?? clozeBlank(text, 1)
      const full = clozePlain(text)
      return {
        kind: 'typed',
        instruction: 'Fill in the blank',
        context: { before: b?.before ?? '', after: b?.after ?? '' },
        ...(b?.hint ? { hint: b.hint } : {}),
        accepted: b?.answers ?? [],
        typoTolerance: false,
        multiline: false,
        reveal: { answer: b?.answers[0] ?? '', full },
        speak: full,
      }
    }
  }
}
