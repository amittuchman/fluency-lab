# Fluency Lab — Plan

Personal, offline-first spaced-repetition PWA for spoken-English study. One user, all data local.

## Architecture

```
src/
  domain/      Pure TypeScript, no React, no Dexie. Fully unit-tested.
    types.ts       Note / Card / ReviewLog / Package / QuizResult / Settings
    parser.ts      Text + JSON import → ParsedLine[] (status, errors, note draft)
    cloze.ts       {{answer//alt::hint}} parsing and rendering
    tags.ts        Tag + tense normalization (12 canonical tenses)
    templates.ts   Note → card templates, content hashes, unlock chain
    checker.ts     Normalization, contractions, word diff, Levenshtein, verdict
    scheduler.ts   ts-fsrs wrapper, day rollover, interval labels
    queue.ts       Daily queue: limits, burying, interleaving
    drill.ts       Package/tag drill loop state machine
    conjugator.ts  12 tenses × person, ~200 irregulars (needed for tense MCQ)
    stats.ts       Retention, streak, maturity, per-tag accuracy
    backup.ts      Export/import format + validation
  data/        Persistence boundary
    repos.ts       NoteRepo, CardRepo, ReviewLogRepo, SettingsRepo, PackageRepo,
                   QuizRepo, MetaRepo interfaces
    dexie.ts       Dexie schema (versioned) + Dexie implementations
    services.ts    Use-cases that span repos (import, review, undo, edit, delete)
  ui/          React components, screens, hooks (only talk to services/repos)
samples/sample-package.txt
```

UI → services → repos (interfaces) → Dexie. A sync backend later replaces `data/dexie.ts` only.
Live UI updates come through one hook (`useRepoQuery`), currently backed by Dexie's `liveQuery`.

## Data model (Dexie v1)

| table      | key  | indexes                                   |
|------------|------|-------------------------------------------|
| notes      | id   | type, packageId, updatedAt, deletedAt, *tags |
| cards      | id   | noteId, due                               |
| reviewLogs | id   | cardId, timestamp                         |
| packages   | id   | createdAt                                 |
| quizzes    | id   | timestamp                                 |
| settings   | key  | (single row "settings")                   |
| meta       | key  | schemaVersion, lastBackupAt, sampleBannerDismissed |

Cards store FSRS state as plain numbers (dates as epoch ms). Each card stores a `contentHash`
of what it asks; editing a note resets only cards whose hash changed.

ReviewLog stores a full snapshot of the card before the review plus side effects
(siblings buried, templates unlocked) so undo is exact.

## Card templates and unlock chain

| type     | templates (in unlock order)                         |
|----------|-----------------------------------------------------|
| vocab    | recog → cloze-use (if example contains term) → produce → dictation (P4) |
| sentence | chunk-cloze → recall-full → speak (P4)               |
| fix      | which-is-right → correct-it                         |
| natural  | upgrade → natural-cloze                             |
| tense    | tense-choose → tense-fill                           |
| cloze    | cloze:1, cloze:2, … (independent, all unlocked)     |

Template *k+1* unlocks when template *k* reaches stability ≥ threshold[k] (2 / 5 / 14 days).

## Phases

1. Foundation — scaffold, schema, settings, parser, import UI + preview + packages, card generation,
   FSRS, study session (flip + typed cloze), checker, undo, basic Library, backup, sample data.
2. Core learning — all non-audio templates + gating + burying, tags/filters, Package Drill, Quiz,
   Weak Spots, basic Stats, leeches, PWA. **Pause for review.**
3. Tense Lab — grid, cheat-sheets, contrast drills, wrong-tense feedback.
4. Audio and speech.
5. Polish — charts, shortcuts overlay, a11y, 5k-note performance, README, final decisions.
