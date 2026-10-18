import { createDexieRepos, FluencyDB } from './dexie'
import type { Repos } from './repos'

export const db = new FluencyDB()
export const repos: Repos = createDexieRepos(db)
