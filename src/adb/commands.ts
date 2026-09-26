import type { HardwareKey } from "../shared/types";
import { execAdbText } from "./client";

/**
 * Comandi di input manuale verso il dispositivo.
 *
 * `adb shell input text` viene eseguito dalla shell DEL DEVICE: i caratteri
 * speciali ($ ; & | " ' ` \ ( ) < >) vengono interpretati lì. Per sicurezza
 * applichiamo una whitelist rigida + conversione spazio -> %s (convenzione
 * ufficiale di `input text`).
 */

const ALLOWED_TEXT_CHARS = /[^A-Za-z0-9 .,!?@#%*_+=:/-]/g;

export function sanitizeInputText(raw: string): string {
  return raw
    .replace(/\r?\n/g, " ")
    .replace(ALLOWED_TEXT_CHARS, "")
    .replace(/ /g, "%s")
    .slice(0, 500);
}

const KEY_CODES: Record<HardwareKey, string> = {
  BACK: "4", // KEYCODE_BACK
  HOME: "3", // KEYCODE_HOME
  ENTER: "66", // KEYCODE_ENTER
};

function clampInt(
  value: number,
  min: number,
  max: number,
  label: string,
): number {
  if (!Number.isFinite(value)) {
    throw new Error(`Valore non valido: ${label}`);
  }
  const int = Math.round(value);
  if (int < min || int > max) {
    throw new Error(`${label} fuori intervallo (${min}-${max})`);
  }
  return int;
}

export function parseCoordinate(value: unknown, label: string): number {
  const num = typeof value === "number" ? value : Number(value);
  return clampInt(num, 0, 20000, label);
}

export async function tap(serial: string, x: number, y: number): Promise<void> {
  const cx = parseCoordinate(x, "X");
  const cy = parseCoordinate(y, "Y");
  await execAdbText([
    "-s",
    serial,
    "shell",
    "input",
    "tap",
    String(cx),
    String(cy),
  ]);
}

export async function swipe(
  serial: string,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  durationMs = 300,
): Promise<void> {
  const d = clampInt(durationMs, 0, 10000, "Durata");
  const args = [
    "-s",
    serial,
    "shell",
    "input",
    "swipe",
    String(parseCoordinate(x1, "X1")),
    String(parseCoordinate(y1, "Y1")),
    String(parseCoordinate(x2, "X2")),
    String(parseCoordinate(y2, "Y2")),
  ];
  if (d > 0) args.push(String(d));
  await execAdbText(args);
}

export async function inputText(serial: string, text: string): Promise<string> {
  const safe = sanitizeInputText(text);
  if (!safe) {
    throw new Error("Testo vuoto dopo la pulizia dei caratteri non permessi");
  }
  await execAdbText(["-s", serial, "shell", "input", "text", safe]);
  return safe;
}

export async function pressKey(
  serial: string,
  key: HardwareKey,
): Promise<void> {
  await execAdbText([
    "-s",
    serial,
    "shell",
    "input",
    "keyevent",
    KEY_CODES[key],
  ]);
}
