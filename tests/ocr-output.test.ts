import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseOcrOutput, resolveOcrBin } from "../src/vision/ocr";

const VALID = JSON.stringify({
  w: 1080,
  h: 2400,
  ms: 280,
  lines: [{ text: "Offri 14 €", conf: 1, x1: 766, y1: 2023, x2: 947, y2: 2062 }],
});

describe("parseOcrOutput — l'output dell'helper è dato esterno: validato", () => {
  it("converte confidenza in 0-100 e calcola il centro", () => {
    const r = parseOcrOutput(`${VALID}\n`);
    expect(r).toEqual({
      width: 1080,
      height: 2400,
      lines: [
        {
          text: "Offri 14 €",
          conf: 100,
          bounds: { x1: 766, y1: 2023, x2: 947, y2: 2062 },
          center: { x: 857, y: 2043 },
        },
      ],
    });
  });

  it("JSON non valido → errore esplicito", () => {
    expect(() => parseOcrOutput("ocr: boom")).toThrow(/OCR: output non valido/);
    expect(() => parseOcrOutput("")).toThrow(/OCR: output non valido/);
  });

  it("campi mancanti o fuori dominio → errore", () => {
    expect(() => parseOcrOutput(JSON.stringify({ w: 0, h: 2400, lines: [] }))).toThrow(/dimensioni/);
    expect(() =>
      parseOcrOutput(JSON.stringify({ w: 1080, h: 2400, lines: [{ text: 1, conf: 1 }] })),
    ).toThrow(/riga OCR non valida/);
    expect(() =>
      parseOcrOutput(
        JSON.stringify({ w: 1080, h: 2400, lines: [{ text: "x", conf: 7, x1: 0, y1: 0, x2: 1, y2: 1 }] }),
      ),
    ).toThrow(/riga OCR non valida/);
  });
});

describe("resolveOcrBin — dove trovare l'helper", () => {
  it("POC_OCR_BIN ha la precedenza", () => {
    expect(resolveOcrBin({ POC_OCR_BIN: "/x/ocr", POC_ADB_BIN: "/tools/adb" })).toBe("/x/ocr");
  });

  it("app impacchettata: accanto ad adb nella cartella tool", () => {
    const dir = mkdtempSync(join(tmpdir(), "poc-tools-"));
    try {
      writeFileSync(join(dir, "ocr"), "");
      expect(resolveOcrBin({ POC_ADB_BIN: join(dir, "adb") })).toBe(join(dir, "ocr"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("nessun helper disponibile → null (in dev si compila dal sorgente)", () => {
    expect(resolveOcrBin({ POC_ADB_BIN: "/non/esiste/adb" })).toBeNull();
    expect(resolveOcrBin({})).toBeNull();
  });
});
