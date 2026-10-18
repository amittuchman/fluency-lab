import { PageHeader } from '../components/ui'

const EXAMPLE = `# Package: 2026-10-19 – Economics debate
// Lines starting with // are comments; blank lines are ignored.
@vocab reluctant | unwilling and hesitant | He was reluctant to commit. | he: מסויג | pos: adj | #adjectives
@sentence The trade-off isn't as clear-cut as it looks. | he: … | #natural-phrasing
@fix I very agree with you. => I completely agree with you. | rule: "very" cannot modify a verb | #adverbs
@natural I think this solution is very good. => I think this approach makes a lot of sense. | #natural-phrasing
@tense I {{have been working::work}} here for five years. | tense: present perfect continuous | why: ongoing action up to now | #tenses
@cloze The central bank {{raised//put up::raise}} rates last week. | #economics`

const JSON_EXAMPLE = `{
  "package": "Economics debate",
  "items": [
    { "type": "vocab", "term": "reluctant", "definition": "unwilling and hesitant",
      "examples": ["He was reluctant to commit."], "he": "מסויג", "pos": "adj", "tags": ["adjectives"] },
    { "type": "fix", "wrong": "I very agree.", "right": "I completely agree.", "rule": "…" },
    { "type": "tense", "sentence": "I {{went::go}} home.", "tense": "past simple", "why": "…" }
  ]
}`

export function FormatHelp() {
  return (
    <div className="mx-auto max-w-3xl space-y-4 text-sm leading-6">
      <PageHeader title="Import format" />
      <section className="card space-y-2">
        <p>One item per line. Segments are separated by <code>|</code>. Start each line with its type.</p>
        <pre className="overflow-x-auto rounded-lg bg-slate-100 p-3 text-xs dark:bg-slate-800" dir="auto">
          {EXAMPLE}
        </pre>
      </section>
      <section className="card">
        <h2 className="mb-2 font-medium">Types</h2>
        <ul className="space-y-1.5">
          <li>
            <code>@vocab term | definition | example | example…</code>: un-keyed segments after the definition are examples.
          </li>
          <li>
            <code>@sentence text</code>: optionally mark chunks to hide with <code>{'{{…}}'}</code>.
          </li>
          <li>
            <code>@fix wrong =&gt; right | rule: …</code>: <code>-&gt;</code> works too.
          </li>
          <li>
            <code>@natural mine =&gt; natural | note: …</code>
          </li>
          <li>
            <code>@tense sentence with {'{{answer::base verb}}'} | tense: … | why: …</code>: the base verb powers the multiple choice.
          </li>
          <li>
            <code>@cloze text with {'{{…}}'}</code>: each <code>{'{{…}}'}</code> becomes its own card.
          </li>
        </ul>
      </section>
      <section className="card">
        <h2 className="mb-2 font-medium">Keys, tags and cloze</h2>
        <ul className="space-y-1.5">
          <li>
            Keyed segments: <code>he:</code> <code>pos:</code> <code>rule:</code> <code>note:</code> <code>tense:</code> <code>why:</code> <code>coll:</code> (collocations, separated by
            <code>;</code>).
          </li>
          <li>
            Tags start with <code>#</code>. They're saved lowercase and hyphenated. Tense names become <code>tense:present-perfect</code> etc.
          </li>
          <li>
            Cloze: <code>{'{{answer}}'}</code>, <code>{'{{answer::hint}}'}</code>, alternatives <code>{'{{raised//put up}}'}</code>.
          </li>
          <li>
            <code># Package: name</code> names the package (default: date and time).
          </li>
          <li>The 12 tenses: past / present / future × simple / continuous / perfect / perfect continuous.</li>
        </ul>
      </section>
      <section className="card space-y-2">
        <h2 className="font-medium">JSON</h2>
        <p>The same fields as a JSON array, or an object with <code>package</code> and <code>items</code>.</p>
        <pre className="overflow-x-auto rounded-lg bg-slate-100 p-3 text-xs dark:bg-slate-800" dir="auto">
          {JSON_EXAMPLE}
        </pre>
      </section>
    </div>
  )
}
