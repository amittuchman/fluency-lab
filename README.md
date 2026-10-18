# Fluency Lab

A personal, offline-first spaced-repetition app for spoken English. Paste the Study Package from a voice
session with an AI coach, drill it before the next session, and keep it long term with FSRS scheduling.
All data stays in your browser (IndexedDB).

## Run it

Requires Node 20+.

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production build in dist/
npm test           # unit + component tests
npm run check      # lint + typecheck + tests
```

## Daily use

1. **Add → Paste a package.** Paste the coach's package (or open a .txt / .json file), fix flagged lines in the
   preview, choose what to do with duplicates, press **Confirm and save**.
2. **Home → Drill this package** before your next voice session: each card loops until you answer it correctly
   twice in a row.
3. **Home → Start session** every day for scheduled reviews and new cards.

Keys in a session: `Enter` check / accept the suggested grade, `1`–`4` grade (Again/Hard/Good/Easy), `Space`
reveal, `Z` or `Ctrl+Z` undo, `E` edit the note, `S` suspend the card.

## Import format

One item per line, segments separated by ` | `. Blank lines and `//` comments are ignored.

```
# Package: 2026-10-19 – Economics debate
@vocab reluctant | unwilling and hesitant | He was reluctant to commit. | he: מסויג | pos: adj | #adjectives
@sentence The trade-off isn't as clear-cut as it looks. | he: … | #natural-phrasing
@fix I very agree with you. => I completely agree with you. | rule: "very" cannot modify a verb | #adverbs
@natural I think this solution is very good. => I think this approach makes a lot of sense. | #natural-phrasing
@tense I {{have been working::work}} here for five years. | tense: present perfect continuous | why: ongoing action up to now | #tenses
@cloze The central bank {{raised//put up::raise}} rates last week. | #economics
```

- `@vocab term | definition | example…`: further un-keyed segments are more examples.
- Keyed segments: `he:` `pos:` `rule:` `note:` `tense:` `why:` `coll:` (collocations, `;`-separated).
- `#tags` are saved lowercase and hyphenated; tense names become `tense:<name>`.
- Cloze: `{{answer}}`, `{{answer::hint}}`, alternatives `{{a//b}}`. Each `{{…}}` in an `@cloze` line is its own card.
- `->` works like `=>`; curly quotes are straightened.
- JSON: an array of objects with the same field names (`type`, `term`, `definition`, `examples`, `he`, `pos`,
  `collocations`, `notes`, `text`, `wrong`, `right`, `rule`, `mine`, `natural`, `note`, `sentence`, `tense`,
  `why`, `tags`), or `{ "package": "…", "items": [ … ] }`.

The in-app **Format reference** page has the same information.

## Backup

Settings → Backup → **Export backup** saves everything (notes, cards, review history, packages, quizzes,
settings) as one JSON file. **Restore from file** validates the file, shows what is in it, then merges or
replaces (replace asks for confirmation). Home shows a reminder after 7 days without a backup.

## Deploy (optional)

The build is static (`dist/`). Any static host works; nothing here deploys automatically.

- **Netlify:** new site from the repo, build command `npm run build`, publish directory `dist`.
- **Vercel:** import the repo, framework preset "Vite", output `dist`.
- **GitHub Pages:** build locally or in an Action and publish `dist/` to the `gh-pages` branch. The app uses
  relative paths and hash routing, so it works from `https://<user>.github.io/<repo>/`.

Data is per browser and per origin: moving to a new URL starts empty. Export a backup and restore it there.

## Project docs

- [PLAN.md](PLAN.md): architecture, data model, phases.
- [DECISIONS.md](DECISIONS.md): non-obvious choices and why.
