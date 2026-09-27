/**
 * Artefatti di diagnosi di ogni lettura: frame JPEG in screenshots/ e righe
 * OCR + card interpretata in ui-dumps/. Servono a ricostruire, a posteriori,
 * su cosa si è deciso.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { screenshotsDir, uiDumpsDir } from "./base-dir";
import type { ScreenReading } from "../vision/ocr";
import type { AuctionCard } from "../shared/types";

function fileStamp(serial: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 23);
  return `${serial.replace(/[^A-Za-z0-9._-]/g, "_")}_${stamp}`;
}

/** Percorso del JPEG di un frame (es. round_…_decisione.jpg). */
export function framePath(serial: string, prefix: string, tag = ""): string {
  const suffix = tag ? `_${tag}` : "";
  return join(screenshotsDir(), `${prefix}_${fileStamp(serial)}${suffix}.jpg`);
}

/** Salva righe OCR + card interpretata; ritorna il percorso del JSON. */
export function saveReading(
  serial: string,
  reading: ScreenReading,
  card: AuctionCard | null,
): string {
  const dir = uiDumpsDir();
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `ocr_${fileStamp(serial)}.json`);
  const { width, height, lines, imageFile } = reading;
  writeFileSync(
    file,
    `${JSON.stringify({ serial, width, height, imageFile, card, lines }, null, 1)}\n`,
    "utf8",
  );
  return file;
}
