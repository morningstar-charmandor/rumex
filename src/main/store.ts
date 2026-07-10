import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'

function fileFor(name: string): string {
  return join(app.getPath('userData'), name)
}

export function readJsonFile<T>(absolutePath: string, fallback: T): T {
  try {
    if (!existsSync(absolutePath)) return fallback
    return JSON.parse(readFileSync(absolutePath, 'utf-8')) as T
  } catch {
    return fallback
  }
}

export function readJson<T>(name: string, fallback: T): T {
  return readJsonFile(fileFor(name), fallback)
}

export function writeJson(name: string, data: unknown): void {
  const path = fileFor(name)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(data, null, 2))
}
