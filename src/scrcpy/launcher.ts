import { spawn, type ChildProcess } from "node:child_process";

/**
 * Launcher di scrcpy: avvia il binario ufficiale in finestra nativa SDL, uno
 * per dispositivo. In dev il binario arriva dal PATH (Homebrew); nell'app
 * Tauri da POC_SCRCPY_BIN (tool bundled nell'app).
 */

export interface ScrcpyHooks {
  onStarted(serial: string, pid: number): void;
  onExit(serial: string, code: number | null): void;
  onError(serial: string, message: string): void;
}

const SCRCPY_BIN = process.env.POC_SCRCPY_BIN || "scrcpy";
const ADB_PATH = process.env.POC_ADB_BIN;

/** Costruisce gli argomenti di scrcpy — isolata per essere testabile. */
export function buildScrcpyArgs(
  serial: string,
  windowTitle: string,
  adbPath?: string,
): string[] {
  const args = ["-s", serial, "--window-title", windowTitle];
  if (adbPath) {
    args.push("--adb", adbPath);
  }
  return args;
}

class ScrcpyLauncher {
  private readonly procs = new Map<string, Set<ChildProcess>>();

  start(serial: string, windowTitle: string, hooks: ScrcpyHooks): number {
    const child = spawn(SCRCPY_BIN, buildScrcpyArgs(serial, windowTitle, ADB_PATH), {
      stdio: "ignore",
      env: process.env,
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

    child.on("exit", (code) => {
      this.remove(serial, child);
      hooks.onExit(serial, code);
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
