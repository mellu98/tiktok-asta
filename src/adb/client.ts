import { execFile, type ExecFileException } from 'node:child_process'

/**
 * Client ADB centralizzato: TUTTE le invocazioni del binario `adb` passano da qui.
 * - execFile (mai shell) → nessun rischio di injection da parte della UI.
 * - timeout sempre attivo → la UI non resta mai appesa su un device bloccato.
 */

const DEFAULT_TIMEOUT_MS = 8000
const BINARY_TIMEOUT_MS = 20000
const MAX_BUFFER = 64 * 1024 * 1024 // screenshot PNG possono superare il default di 1 MB

export class AdbError extends Error {
  constructor(
    message: string,
    readonly stderr = '',
  ) {
    super(message)
    this.name = 'AdbError'
  }
}

interface ExecOptions {
  timeoutMs?: number
}

/** Esegue adb e restituisce stdout come testo (utf-8). */
export function execAdbText(args: string[], opts: ExecOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'adb',
      args,
      { timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, maxBuffer: MAX_BUFFER, encoding: 'utf8' },
      (err, stdout, stderr) => {
        if (err) {
          reject(adbErrorFrom(err, stderr))
          return
        }
        resolve(stdout)
      },
    )
  })
}

/** Esegue adb e restituisce stdout come buffer binario (screenshot). */
export function execAdbBinary(args: string[], opts: ExecOptions = {}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(
      'adb',
      args,
      { timeout: opts.timeoutMs ?? BINARY_TIMEOUT_MS, maxBuffer: MAX_BUFFER, encoding: 'buffer' },
      (err, stdout, stderr) => {
        if (err) {
          reject(adbErrorFrom(err, stderr.toString()))
          return
        }
        resolve(stdout)
      },
    )
  })
}

function adbErrorFrom(err: ExecFileException, stderr: string): AdbError {
  if (err.code === 'ENOENT') {
    return new AdbError(
      'adb non trovato nel PATH — esegui: brew install android-platform-tools (oppure npm run setup)',
      stderr,
    )
  }
  if (err.killed || /ETIMEDOUT|timed?\s?out/i.test(String(err.message))) {
    return new AdbError('Comando adb scaduto (timeout) — dispositivo non raggiungibile?', stderr)
  }
  const detail = stderr.trim() || err.message
  return new AdbError(`Errore adb: ${detail}`, stderr)
}
