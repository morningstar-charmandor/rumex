import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs'
import { basename, dirname, join } from 'path'

let writeSequence = 0

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

export function writeJsonFile(absolutePath: string, data: unknown): void {
  const directory = dirname(absolutePath)
  mkdirSync(directory, { recursive: true })
  const serialized = JSON.stringify(data, null, 2)
  // Windows does not reliably replace an existing destination with rename.
  // Retain the established write behavior there instead of making saves fail.
  if (process.platform === 'win32') {
    writeFileSync(absolutePath, serialized)
    return
  }
  // A process interruption must leave either the old complete state or the
  // new complete state, never a truncated JSON document.
  const temporaryPath = join(
    directory,
    `.${basename(absolutePath)}.${process.pid}.${writeSequence++}.tmp`
  )
  try {
    writeFileSync(temporaryPath, serialized)
    renameSync(temporaryPath, absolutePath)
  } finally {
    rmSync(temporaryPath, { force: true })
  }
}

export function writeJson(name: string, data: unknown): void {
  writeJsonFile(fileFor(name), data)
}
