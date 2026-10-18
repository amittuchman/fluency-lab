import sampleText from '../../samples/sample-package.txt?raw'
import { parseImport } from '../domain/parser'
import { META, type Repos } from './repos'
import { importPackage } from './services'

export { sampleText }

export async function loadSampleData(repos: Repos): Promise<void> {
  const parsed = parseImport(sampleText)
  await importPackage(repos, {
    name: parsed.packageName ?? 'Sample',
    sourceText: sampleText,
    items: parsed.items.filter((i) => i.content).map((i) => ({ content: i.content!, tags: i.tags, action: 'create' as const })),
  })
  await repos.meta.set(META.onboarding, 'done')
}
