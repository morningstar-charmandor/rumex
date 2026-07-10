import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'

function fileFor(name: string): string {
  return join(app.getPath('userData'), name)
}

export function readJson<T>(name: string, fallback: T): T {
  try {
    const path = fileFor(name)
    if (!existsSync(path)) return fallback
    return JSON.parse(readFileSync(path, 'utf-8')) as T
  } catch {
    return fallback
  }
}

export function writeJson(name: string, data: unknown): void {
  const path = fileFor(name)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(data, null, 2))
}
