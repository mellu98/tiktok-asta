import { spawn, type ChildProcess } from "node:child_process";

/**
 * Launcher di scrcpy: avvia il binario ufficiale in finestra nativa SDL, uno
 * per dispositivo. In dev il binario arriva dal PATH (Homebrew); nell'app
 * Tauri da POC_SCRCPY_BIN (tool bundled nell'app).
 *
 * scrcpy 4.x NON supporta `--adb`: per fargli usare il nostro adb bundled
 * imposta la variabile d'ambiente ADB (meccanismo ufficiale di scrcpy).
 * stderr viene catturato: se scrcpy termina subito, l'errore reale arriva
 * in dashboard/log invece di un generico "terminato".
 */

export interface ScrcpyHooks {
  onStarted(serial: string, pid: number): void;
  onExit(serial: string, code: number | null, stderrTail: string | null): void;
  onError(serial: string, message: string): void;
}

const SCRCPY_BIN = process.env.POC_SCRCPY_BIN || "scrcpy";
const ADB_PATH = process.env.POC_ADB_BIN;

/** Costruisce gli argomenti di scrcpy — isolata per essere testabile. */
export function buildScrcpyArgs(serial: string, windowTitle: string): string[] {
  return ["-s", serial, "--window-title", windowTitle];
}

const STDERR_TAIL_LINES = 15;

function makeStderrCollector(): {
  push: (line: string) => void;
  tail: () => string | null;
} {
  const lines: string[] = [];
  return {
    push: (line: string) => {
      lines.push(line);
      if (lines.length > STDERR_TAIL_LINES) lines.shift();
    },
    tail: () => (lines.length > 0 ? lines.join(" | ") : null),
  };
}

class ScrcpyLauncher {
  private readonly procs = new Map<string, Set<ChildProcess>>();

  start(serial: string, windowTitle: string, hooks: ScrcpyHooks): number {
    const child = spawn(SCRCPY_BIN, buildScrcpyArgs(serial, windowTitle), {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        // scrcpy individua adb dalla variabile ADB (meccanismo ufficiale)
        ...(ADB_PATH ? { ADB: ADB_PATH } : {}),
      },
    });

    const set = this.procs.get(serial) ?? new Set<ChildProcess>();
    set.add(child);
    this.procs.set(serial, set);

    const stderrCollector = makeStderrCollector();
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      for (const line of chunk.split(/\r?\n/)) {
        if (line.trim()) stderrCollector.push(line.trim());
      }
    });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      for (const line of chunk.split(/\r?\n/)) {
        if (line.trim()) stderrCollector.push(line.trim());
      }
    });

    child.on("error", (err) => {
      this.remove(serial, child);
      const message =
        (err as NodeJS.ErrnoException).code === "ENOENT"
          ? "scrcpy non trovato — in dev: brew install scrcpy (npm run setup)"
          : `Errore scrcpy: ${err.message}`;
      hooks.onError(serial, message);
    });

    child.on("exit", (code) => {
      this.remove(serial, child);
      const tail = stderrCollector.tail();
      if (code !== null && code !== 0) {
        // scrcpy terminato con errore: mostra il vero motivo, non un generico
        hooks.onError(
          serial,
          `scrcpy terminato con codice ${code}${tail ? ` — ${tail}` : ""}`,
        );
      }
      hooks.onExit(serial, code, tail);
    });

    hooks.onStarted(serial, child.pid ?? -1);
    return child.pid ?? -1;
  }

  /** true se c'è almeno un processo scrcpy attivo per il seriale dato. */
  isRunning(serial: string): boolean {
    return (this.procs.get(serial)?.size ?? 0) > 0;
  }

  /** Termina tutte le finestre scrcpy aperte (usato allo shutdown del server). */
  stopAll(): void {
    for (const set of this.procs.values()) {
      for (const child of set) {
        child.kill("SIGTERM");
      }
    }
    this.procs.clear();
  }

  private remove(serial: string, child: ChildProcess): void {
    const set = this.procs.get(serial);
    if (!set) return;
    set.delete(child);
    if (set.size === 0) this.procs.delete(serial);
  }
}

export const scrcpyLauncher = new ScrcpyLauncher();
