import { EventEmitter } from 'node:events'
import { createWriteStream, type WriteStream } from 'node:fs'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { LogEntry, LogLevel, LogSource } from '../shared/types'

/**
 * Log operativo: buffer in memoria (per la dashboard) + append su file locale
 * (logs/activity.log). Mai dati sensibili: solo seriale, stato, comandi eseguiti.
 */

const REPO_ROOT = new URL('../../', import.meta.url)

export class LogBuffer extends EventEmitter {
  private entries: LogEntry[] = []
  private nextId = 1
  private stream: WriteStream | null = null

  constructor(
    private readonly cap = 500,
    filePath?: string,
  ) {
    super()
    if (filePath) {
      try {
        mkdirSync(dirname(filePath), { recursive: true })
        this.stream = createWriteStream(filePath, { flags: 'a' })
      } catch {
        // Il log su file è best-effort: se fallisce si continua solo in memoria
      }
    }
  }

  add(level: LogLevel, source: LogSource, message: string): LogEntry {
    const entry: LogEntry = {
      id: this.nextId++,
      ts: Date.now(),
      level,
      source,
      message,
    }
    this.entries.push(entry)
    if (this.entries.length > this.cap) {
      this.entries.splice(0, this.entries.length - this.cap)
    }
    this.stream?.write(`${JSON.stringify(entry)}\n`)
    this.emit('entry', entry)
    return entry
  }

  list(limit = 200): LogEntry[] {
    return this.entries.slice(-limit)
  }
}

/** Log condiviso dell'app (usato da server, adb layer, scrcpy e device manager). */
export const activityLog = new LogBuffer(500, new URL('logs/activity.log', REPO_ROOT).pathname)
