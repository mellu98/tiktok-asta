import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { screenshotsDir } from "../auction/base-dir";
import { execAdbBinary } from "./client";

/**
 * Screenshot via `adb exec-out screencap -p`.
 * exec-out (non shell) → stream binario pulito, nessun problema di conversioni CRLF.
 */
export async function takeScreenshot(serial: string): Promise<Buffer> {
  const png = await execAdbBinary(["-s", serial, "exec-out", "screencap", "-p"]);
  if (png.length < 8 || png.subarray(1, 4).toString("ascii") !== "PNG") {
    throw new Error("Lo screenshot ricevuto non è un PNG valido");
  }
  return png;
}

export interface SavedScreenshot {
  file: string;
  dataUrl: string;
}

/**
 * Salva lo screenshot nella cartella canonica (data dir dell'app / del repo
 * in dev) e ritorna percorso + data URL per la UI.
 */
export function saveScreenshotFile(serial: string, png: Buffer): SavedScreenshot {
  mkdirSync(screenshotsDir(), { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const safeSerial = serial.replace(/[^A-Za-z0-9._-]/g, "_");
  const file = join(screenshotsDir(), `screen_${safeSerial}_${stamp}.png`);
  writeFileSync(file, png);
  return {
    file,
    dataUrl: `data:image/png;base64,${png.toString("base64")}`,
  };
}

/** Screenshot + salvataggio in una sola chiamata. */
export async function captureAndSave(serial: string): Promise<SavedScreenshot> {
  const png = await takeScreenshot(serial);
  return saveScreenshotFile(serial, png);
}
