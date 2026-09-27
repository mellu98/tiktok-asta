import { spawn, type ChildProcess } from "node:child_process";

/**
 * Launcher di scrcpy: avvia il binario ufficiale in finestra nativa SDL, uno
 * per dispositivo. In dev il binario arriva dal PATH (Homebrew); nell'app
 * Tauri da POC_SCRCPY_BIN (tool bundled nell'app).
 */

export interface ScrcpyHooks {
  onStarted(serial: string, pid: number): void;
  /** detail: riga d'errore di scrcpy quando esce con codice ≠ 0. */
  onExit(serial: string, code: number | null, detail?: string): void;
  onError(serial: string, message: string): void;
}

const SCRCPY_BIN = process.env.POC_SCRCPY_BIN || "scrcpy";
const ADB_PATH = process.env.POC_ADB_BIN;
const OUTPUT_TAIL_CHARS = 4000;

/** Costruisce gli argomenti di scrcpy — isolata per essere testabile. */
export function buildScrcpyArgs(serial: string, windowTitle: string): string[] {
  return ["-s", serial, "--window-title", windowTitle];
}

/**
 * Ambiente di scrcpy. scrcpy NON ha un'opzione --adb (con --adb esce subito
 * con codice 1): il percorso di adb si passa con la variabile ADB.
 */
export function buildScrcpyEnv(
  baseEnv: NodeJS.ProcessEnv,
  adbPath: string | undefined,
): NodeJS.ProcessEnv {
  return adbPath ? { ...baseEnv, ADB: adbPath } : baseEnv;
}

/** Messaggio leggibile per un'uscita anomala: l'ultima riga d'errore di scrcpy. */
export function summarizeScrcpyFailure(code: number | null, output: string): string {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const errorLine = [...lines]
    .reverse()
    .find((line) => /error|unrecognized|not found|failed/i.test(line));
  const base = `scrcpy terminato con codice ${code ?? "?"}`;
  return errorLine ? `${base}: ${errorLine}` : base;
}

class ScrcpyLauncher {
  private readonly procs = new Map<string, Set<ChildProcess>>();

  start(serial: string, windowTitle: string, hooks: ScrcpyHooks): number {
    const child = spawn(SCRCPY_BIN, buildScrcpyArgs(serial, windowTitle), {
      stdio: ["ignore", "pipe", "pipe"],
      env: buildScrcpyEnv(process.env, ADB_PATH),
    });

    // Coda dell'output (letta di continuo, così la pipe non si riempie mai):
    // serve a spiegare un'uscita anomala invece di un codice muto.
    let outputTail = "";
    const collect = (chunk: Buffer): void => {
      outputTail = (outputTail + chunk.toString("utf8")).slice(-OUTPUT_TAIL_CHARS);
    };
    child.stdout?.on("data", collect);
    child.stderr?.on("data", collect);

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

    child.on("exit", (code) => {
      this.remove(serial, child);
      const failed = code !== null && code !== 0;
      hooks.onExit(serial, code, failed ? summarizeScrcpyFailure(code, outputTail) : undefined);
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
