import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const PROJECT_ROOT = ROOT
export const DATA_DIR = path.join(ROOT, 'data')
export const TOOLS_FILE = path.join(DATA_DIR, 'tools.json')
export const RUNS_DIR = path.join(DATA_DIR, 'runs')
export const RECIPES_DIR = path.join(ROOT, 'recipes')

export function ensureDataDirs() {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.mkdirSync(RUNS_DIR, { recursive: true })
}
