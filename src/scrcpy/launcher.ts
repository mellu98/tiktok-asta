import { spawn, type ChildProcess } from 'node:child_process'

/**
 * Launcher di scrcpy: avvia il binario ufficiale (dipendenza Homebrew, MAI
 * bundled nel repo) in finestra nativa SDL, uno per dispositivo.
 */

export interface ScrcpyHooks {
  onStarted(serial: string, pid: number): void
  onExit(serial: string, code: number | null): void
  onError(serial: string, message: string): void
}

/** Costruisce gli argomenti di scrcpy — isolata per essere testabile. */
export function buildScrcpyArgs(serial: string, windowTitle: string): string[] {
  return ['-s', serial, '--window-title', windowTitle]
}

class ScrcpyLauncher {
  private readonly procs = new Map<string, Set<ChildProcess>>()

  start(serial: string, windowTitle: string, hooks: ScrcpyHooks): number {
    const child = spawn('scrcpy', buildScrcpyArgs(serial, windowTitle), {
      stdio: 'ignore',
      env: process.env,
    })

    const set = this.procs.get(serial) ?? new Set<ChildProcess>()
    set.add(child)
    this.procs.set(serial, set)

    child.on('error', (err) => {
      this.remove(serial, child)
      const message =
        (err as NodeJS.ErrnoException).code === 'ENOENT'
          ? 'scrcpy non trovato — esegui: brew install scrcpy (oppure npm run setup)'
          : `Errore scrcpy: ${err.message}`
      hooks.onError(serial, message)
    })

    child.on('exit', (code) => {
      this.remove(serial, child)
      hooks.onExit(serial, code)
    })

    hooks.onStarted(serial, child.pid ?? -1)
    return child.pid ?? -1
  }

  /** true se c'è almeno un processo scrcpy attivo per il seriale dato. */
  isRunning(serial: string): boolean {
    return (this.procs.get(serial)?.size ?? 0) > 0
  }

  /** Termina tutte le finestre scrcpy aperte (usato allo shutdown del server). */
  stopAll(): void {
    for (const set of this.procs.values()) {
      for (const child of set) {
        child.kill('SIGTERM')
      }
    }
    this.procs.clear()
  }

  private remove(serial: string, child: ChildProcess): void {
    const set = this.procs.get(serial)
    if (!set) return
    set.delete(child)
    if (set.size === 0) this.procs.delete(serial)
  }
}

export const scrcpyLauncher = new ScrcpyLauncher()
