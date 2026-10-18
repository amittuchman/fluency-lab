# Fluency Lab

A personal, offline-first spaced-repetition app for spoken English. Paste the Study Package from a voice
session with an AI coach, drill it before the next session, and keep it long term with FSRS scheduling.
Everything lives in your browser (IndexedDB) and works offline. An account is optional: sign in with an
emailed code to sync between devices (Supabase); without one the app is local-only.

## Run it

Requires Node 20+.

```bash
npm install
npm run dev        # http://localhost:5173/fluency-lab/
npm run build      # production build in dist/
npm test           # unit + component tests (Vitest)
npm run test:e2e   # end-to-end test (Playwright, uses the installed Microsoft Edge)
npm run check      # lint + typecheck + unit tests
```

## Daily use

1. **Add → Paste a package.** Paste the coach's package (or open a .txt / .json file). Fix flagged lines in the
   preview, choose what to do with duplicates, press **Confirm and save**. **Copy import template** gives you a
   blank block to hand to the coach.
2. **Home → Drill this package** before your next voice session. Every card of the package loops until you
   answer it correctly twice in a row ("X/Y ready"). Drills ignore the daily limits and the unlock chain.
3. **Home → Start session** every day: due reviews first, then new cards (25/day by default).
4. **Tense Lab** for the 12 tenses: click a cell to drill one tense, or pick 2–3 for a contrast drill.
5. **Quiz**, **Weak spots**, **Speak** and **Stats** when you want to test yourself or see where you stand.

Each item becomes several cards that unlock as you learn it: recognize → fill the gap → produce → hear/say.

### Keys

| Key | In a session |
|---|---|
| `Enter` | check the answer, then accept the suggested grade |
| `Space` | reveal a flip card |
| `1`–`4` | grade (Again / Hard / Good / Easy), or pick a multiple-choice option before the reveal |
| `R` | play the audio again |
| `Z` or `Ctrl+Z` | undo the last review |
| `E` / `S` | edit the note / suspend the card |
| `?` | all shortcuts |

## Import format

One item per line, segments separated by ` | `. Blank lines and `//` comments are ignored.

```
# Package: 2026-10-19 – Economics debate
@vocab reluctant | unwilling and hesitant | He was reluctant to commit. | he: מסויג | pos: adj | #adjectives
@sentence The trade-off isn't as clear-cut as it looks. | he: … | #natural-phrasing
@fix I very agree with you. => I completely agree with you. | rule: "very" cannot modify a verb | #adverbs
@natural I think this solution is very good. => I think this approach makes a lot of sense. | note: … | #natural-phrasing
@tense I {{have been working::work}} here for five years. | tense: present-perfect-continuous | why: ongoing action up to now | #tenses
@cloze The central bank {{raised//put up::raise}} rates last week. | #economics
```

- `@vocab term | definition | example…`: further un-keyed segments are more examples.
- Keyed segments: `he:` `pos:` `rule:` `note:` `tense:` `why:` `coll:` (collocations, `;`-separated).
- Tense names: "present perfect continuous", "present-perfect-continuous", "Present Perfect Progressive"… all work.
- `#tags` are saved lowercase and hyphenated; tense names become `tense:<name>`.
- Cloze: `{{answer}}`, `{{answer::hint}}`, alternatives `{{a//b}}`. Each `{{…}}` in an `@cloze` line is its own card.
  On `@tense` lines put the base verb as the hint: `{{have been working::work}}`.
- `->` works like `=>`; curly quotes are straightened.
- JSON: an array of objects with the same field names (`type`, `term`, `definition`, `examples`, `he`, `pos`,
  `collocations`, `notes`, `text`, `wrong`, `right`, `rule`, `mine`, `natural`, `note`, `sentence`, `tense`,
  `why`, `tags`), or `{ "package": "…", "items": [ … ] }`.

The in-app **Format reference** page (Add → Format reference) has the same information.

## Backup

Settings → Backup → **Export backup** saves everything (notes, cards, review history, packages, quizzes,
settings, cheat-sheet edits) as one JSON file; in Chrome/Edge you choose where to save it. **Restore from file**
validates the file, shows what is in it, then merges or replaces (replace asks for confirmation). Home shows a
reminder after 7 days without a backup.

Data belongs to one browser on one device and one web address. To move it (e.g. laptop → phone), export on one
and restore on the other.

## Sync between devices (optional)

**Settings → Sync between devices**: type your email, then the 6-digit code from the email. Do the same on
each device (the installed phone app has its own storage, which is why it's a code and not a link).

- The device's own database stays the source of truth; sync copies changes both ways in the background: on
  start, when the connection returns, when the app comes back to the foreground, after every session and quiz,
  ~20 s after other changes, and every 5 minutes. **Sync now** forces it. The badge shows Synced / Syncing… /
  Offline / Sync error / Local only.
- Conflicts: notes, packages and settings keep the most recent edit; a card keeps the state with the most recent
  review; review history and quiz results are only ever added (an undo removes the one review). Deleting moves
  things to Trash on every device; nothing is hard-deleted in the cloud.
- The first sign-in on a device **merges**: if the device and the account both have data, you get both.
- Signing out keeps everything on the device; changes made while signed out upload at the next sign-in.
- JSON backups still work exactly as before and are independent of sync.

### Supabase setup (one time)

1. **SQL Editor → New query**, paste [`supabase/schema.sql`](supabase/schema.sql), **Run**. It creates the six
   tables (`notes`, `cards`, `review_logs`, `packages`, `quiz_results`, `settings`) with Row Level Security:
   each user can read and write only their own rows, anonymous visitors nothing, and rows can't be hard-deleted.
2. **Authentication → Emails (Templates)**: in both **Magic Link** and **Confirm signup**, show the code
   (`{{ .Token }}`) instead of the link.
3. **Authentication → URL Configuration**: Site URL `https://amittuchman.github.io/fluency-lab/`; redirect URLs
   `https://amittuchman.github.io/fluency-lab/**`, `http://localhost:5173/**`, `http://localhost:4173/**`.

The app uses only the project URL and the **publishable** key (`src/sync/config.ts`, overridable with
`VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY`). These are public by design; Row Level Security protects
the data. Never put a secret or service-role key in the app or the repo.

## Deploy to GitHub Pages (use it on your phone)

The repository includes `.github/workflows/deploy.yml`, which builds and publishes the app on every push to `main`.

1. Create an empty repository on github.com (e.g. `fluency-lab`). Private repositories need a paid plan for
   Pages; a public repository is fine because your data never leaves your browser.
2. In this folder:
   ```bash
   git remote add origin https://github.com/<your-user>/fluency-lab.git
   git push -u origin main
   ```
3. On GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
4. Open the **Actions** tab and wait for "Deploy to GitHub Pages" to finish (re-run it once if it ran before
   step 3). The site is at `https://<your-user>.github.io/fluency-lab/`.
5. On the phone, open that address once while online, then install it: **Android Chrome:** menu → *Add to
   Home screen / Install app*. **iPhone Safari:** Share → *Add to Home Screen*. After that it works offline.
6. Move your data: sign in to sync on both devices (above), or laptop **Settings → Export backup**, send the
   file to the phone, phone **Settings → Restore from file**.

Other static hosts work too (build command `npm run build`, output `dist`): **Netlify** (new site from the
repo) or **Vercel** (framework preset "Vite"). The build is configured for the `/fluency-lab/` sub-path
(`base` in `vite.config.ts`); set it to `'/'` for a domain root. Hash routing means no rewrite rules are needed.

## Project docs

- [PLAN.md](PLAN.md): architecture, data model, phases.
- [DECISIONS.md](DECISIONS.md): non-obvious choices and why.
