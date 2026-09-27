/**
 * Artefatti di diagnosi di ogni lettura: frame JPEG in screenshots/ e righe
 * OCR + card interpretata in ui-dumps/, con lo stesso runId del round (come
 * ui_<serial>_<runId>.xml e screen_<serial>_<runId>.png). Servono a
 * ricostruire, a posteriori, su cosa si è deciso.
 */

import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { screenshotsDir, uiDumpsDir } from "./base-dir";
import type { ScreenReading } from "../vision/ocr";
import type { AuctionCard } from "../shared/types";

/** ID di correlazione di un round (o di un'analisi). */
export function newRunId(): string {
  return randomBytes(4).toString("hex");
}

function safeSerial(serial: string): string {
  return serial.replace(/[^A-Za-z0-9._-]/g, "_");
}

/** Percorso del JPEG di un frame, es. round_<serial>_<runId>_conferma.jpg. */
export function framePath(serial: string, prefix: string, runId: string, tag = ""): string {
  const suffix = tag ? `_${tag}` : "";
  return join(screenshotsDir(), `${prefix}_${safeSerial(serial)}_${runId}${suffix}.jpg`);
}

/** Salva righe OCR + card interpretata; ritorna il percorso del JSON. */
export function saveReading(
  serial: string,
  runId: string,
  tag: string,
  reading: ScreenReading,
  card: AuctionCard | null,
): string {
  const dir = uiDumpsDir();
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `ocr_${safeSerial(serial)}_${runId}_${tag}.json`);
  const { width, height, lines, imageFile } = reading;
  writeFileSync(
    file,
    `${JSON.stringify({ serial, runId, width, height, imageFile, card, lines }, null, 1)}\n`,
    "utf8",
  );
  return file;
}
