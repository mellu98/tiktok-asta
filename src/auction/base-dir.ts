/**
 * Percorsi canonici dell'applicazione: UNA sola fonte per dev e app Tauri.
 * Il bootstrap (server o shell Rust) imposta la data dir; tutto il resto è
 * derivato da qui — niente logiche divergenti per ambiente.
 */

import { join } from "node:path";

let dataDir = process.env.POC_DATA_DIR || process.cwd();

export function setDataDir(dir: string): void {
 dataDir = dir;
}

export function getDataDir(): string {
 return dataDir;
}

export function screenshotsDir(): string {
 return join(dataDir, "screenshots");
}

export function uiDumpsDir(): string {
 return join(dataDir, "ui-dumps");
}

export function logsDir(): string {
 return join(dataDir, "logs");
}

export function configFile(): string {
 return join(dataDir, "auction-config.json");
}

export function safetyFile(): string {
 return join(dataDir, "auction-safety.json");
}

export function stateFile(): string {
 return join(dataDir, "auction-state.json");
}

export function journalFile(): string {
 return join(logsDir(), "auction-journal.jsonl");
}

export function sessionFile(): string {
 return join(dataDir, "session.json");
}
