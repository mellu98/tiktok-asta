/**
 * Journal delle decisioni: una riga JSONL per ogni ROUND di automazione
 * (valutazione o offerta), con tutto ciò che serve per ricostruire perché
 * il bot ha agito o si è fermato. Nessun dato sensibile: solo seriale,
 * identificativo asta, importi e percorsi dei file diagnostici.
 */

import { mkdirSync, appendFileSync, readFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import type { JournalEntry } from "../shared/types";
import { journalFile } from "./base-dir";

export type { JournalEntry };

export function journalFilePath(): string {
  return journalFile();
}

export function appendJournal(entry: JournalEntry): void {
  const file = journalFilePath();
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(entry)}\n`, "utf8");
}

export function readJournal(limit = 50): JournalEntry[] {
  const file = journalFilePath();
  if (!existsSync(file)) return [];
  const lines = readFileSync(file, "utf8").split("\n").filter((l) => l.trim());
  return lines
    .slice(-limit)
    .map((l) => {
      try {
        return JSON.parse(l) as JournalEntry;
      } catch {
        return null;
      }
    })
    .filter((e): e is JournalEntry => e !== null)
    .sort((a, b) => b.ts - a.ts);
}
