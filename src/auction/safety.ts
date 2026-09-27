/**
 * Arresto di emergenza: flag persistente che impedisce QUALUNQUE tap reale
 * finché non viene riarmato esplicitamente. Sopravvive ai riavvii dell'app.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { safetyFile, setDataDir } from "./base-dir";

interface SafetyState {
  estopEngaged: boolean;
  engagedAt: number | null;
  reason: string | null;
}

let cached: SafetyState | null = null;

/** Imposta la data dir e invalida la cache. */
export function setSafetyBaseDir(dir: string): void {
  setDataDir(dir);
  cached = null;
}

function loadSafetyState(): SafetyState {
  if (cached) return cached;
  try {
    const raw = JSON.parse(readFileSync(safetyFile(), "utf8")) as Partial<SafetyState>;
    cached = {
      estopEngaged: raw.estopEngaged === true,
      engagedAt: typeof raw.engagedAt === "number" ? raw.engagedAt : null,
      reason: typeof raw.reason === "string" ? raw.reason : null,
    };
  } catch {
    cached = { estopEngaged: false, engagedAt: null, reason: null };
  }
  return cached;
}

export function loadSafety(): SafetyState {
  return loadSafetyState();
}

export function setEmergencyStop(
  engaged: boolean,
  reason: string | null = null,
): SafetyState {
  const next: SafetyState = engaged
    ? { estopEngaged: true, engagedAt: Date.now(), reason: reason ?? "arresto di emergenza" }
    : { estopEngaged: false, engagedAt: null, reason: null };
  mkdirSync(dirname(safetyFile()), { recursive: true });
  writeFileSync(safetyFile(), `${JSON.stringify(next, null, 2)}\n`, "utf8");
  cached = next;
  return next;
}

/** Guardia fail-closed: true se i tap reali sono vietati in questo istante. */
export function isEmergencyStopped(): boolean {
  return loadSafetyState().estopEngaged === true;
}
