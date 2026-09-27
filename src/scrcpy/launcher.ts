import { spawn, type ChildProcess } from "node:child_process";

/**
 * Launcher di scrcpy: avvia il binario ufficiale in finestra nativa SDL, uno
 * per dispositivo. In dev il binario arriva dal PATH (Homebrew); nell'app
 * Tauri da POC_SCRCPY_BIN (tool bundled nell'app).
 */

export interface ScrcpyHooks {
  onStarted(serial: string, pid: number): void;
  /** detail: ultima riga di stderr di scrcpy (il motivo, se è uscito con errore). */
  onExit(serial: string, code: number | null, detail: string): void;
  onError(serial: string, message: string): void;
}

const SCRCPY_BIN = process.env.POC_SCRCPY_BIN || "scrcpy";
const ADB_PATH = process.env.POC_ADB_BIN;
const STDERR_TAIL_CHARS = 2000;

/** Costruisce gli argomenti di scrcpy — isolata per essere testabile. */
export function buildScrcpyArgs(serial: string, windowTitle: string): string[] {
  return ["-s", serial, "--window-title", windowTitle];
}

/**
 * scrcpy non ha un'opzione --adb (con --adb esce subito con codice 1):
 * il binario adb da usare si indica con la variabile d'ambiente ADB.
 */
export function buildScrcpyEnv(
  baseEnv: NodeJS.ProcessEnv,
  adbPath: string | undefined,
): NodeJS.ProcessEnv {
  return adbPath ? { ...baseEnv, ADB: adbPath } : { ...baseEnv };
}

/** Ultima riga non vuota di stderr: è lì che scrcpy scrive perché è uscito. */
export function lastStderrLine(stderr: string): string {
  const lines = stderr.split(/\r?\n/).map((l) => l.trim());
  return lines.filter((l) => l.length > 0).pop() ?? "";
}

class ScrcpyLauncher {
  private readonly procs = new Map<string, Set<ChildProcess>>();

  start(serial: string, windowTitle: string, hooks: ScrcpyHooks): number {
    const child = spawn(SCRCPY_BIN, buildScrcpyArgs(serial, windowTitle), {
      stdio: ["ignore", "ignore", "pipe"],
      env: buildScrcpyEnv(process.env, ADB_PATH),
    });

    let stderrTail = "";
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderrTail = (stderrTail + chunk).slice(-STDERR_TAIL_CHARS);
    });

    const set = this.procs.get(serial) ?? new Set<ChildProcess>();
    set.add(child);
    this.procs.set(serial, set);

    child.on("error", (err) => {
      this.remove(serial, child);
      const message =
        (err as NodeJS.ErrnoException).code === "ENOENT"
          ? "scrcpy non trovato — in dev: brew install scrcpy (npm run setup)"
          : `Errore scrcpy: ${err.message}`;
      hooks.onError(serial, message);
    });

    // "close" (non "exit"): stderr è già stato letto tutto
    child.on("close", (code) => {
      this.remove(serial, child);
      hooks.onExit(serial, code, lastStderrLine(stderrTail));
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
