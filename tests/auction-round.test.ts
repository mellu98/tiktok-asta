import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScreenReading } from "../src/vision/ocr";
import { loadOcrFixture, ocrLinesOf, withText, type OcrFixture } from "./helpers/ocr-fixtures";

// ── Lettura schermo e input simulati: nessun device reale, nessun tap vero ──
const readScreen = vi.fn<(serial: string, opts?: { saveImage?: string }) => Promise<ScreenReading>>();
const tap = vi.fn<(serial: string, x: number, y: number) => Promise<void>>();
const runInShellSession = vi.fn<(serial: string, cmd: string) => Promise<string>>();

vi.mock("../src/vision/ocr", async (importActual) => ({
  ...(await importActual<typeof import("../src/vision/ocr")>()),
  readScreen: (serial: string, opts?: { saveImage?: string }) => readScreen(serial, opts),
}));
vi.mock("../src/adb/commands", () => ({
  tap: (serial: string, x: number, y: number) => tap(serial, x, y),
}));
vi.mock("../src/adb/shell-session", () => ({
  runInShellSession: (serial: string, cmd: string) => runInShellSession(serial, cmd),
}));

const { runRound } = await import("../src/auction/engine");
const { setDataDir, journalFile } = await import("../src/auction/base-dir");
const { resetConfigCache } = await import("../src/auction/config");
const { setSafetyBaseDir } = await import("../src/auction/safety");
const { setStateBaseDir } = await import("../src/auction/state");

const SERIAL = "R7AX711BSBV";

function reading(fx: OcrFixture, imageFile: string | null = null): ScreenReading {
  return { width: fx.w, height: fx.h, lines: ocrLinesOf(fx), captureMs: 970, ocrMs: 290, imageFile };
}

/** Ogni chiamata a readScreen restituisce la prossima lettura della sequenza. */
function screens(...fixtures: OcrFixture[]): void {
  for (const fx of fixtures) {
    readScreen.mockImplementationOnce(async (_s, opts) => reading(fx, opts?.saveImage ?? null));
  }
}

function journalKinds(): string[] {
  return readFileSync(journalFile(), "utf8")
    .trim()
    .split("\n")
    .map((line) => (JSON.parse(line) as { kind: string }).kind);
}

const RUNNING = loadOcrFixture("running");

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), "poc-round-"));
  setDataDir(dir);
  setStateBaseDir(dir);
  setSafetyBaseDir(dir);
  resetConfigCache({ maxBidEur: 100, maxOffersPerAuction: 1, dryRun: true });
  readScreen.mockReset();
  tap.mockReset().mockResolvedValue();
  runInShellSession.mockReset().mockResolvedValue("");
  return () => rmSync(dir, { recursive: true, force: true });
});

describe("runRound — valutazione e dry-run: nessun tap", () => {
  it.each(["evaluate", "dry"] as const)(
    "%s: condizioni ok → decisione offer SENZA tap, dopo lettura + conferma",
    async (mode) => {
      screens(RUNNING, RUNNING);
      const r = await runRound(SERIAL, mode);
      expect(r.decision).toBe("offer");
      expect(r.phase).toBe("running");
      expect(r.timerSec).toBe(40);
      expect(r.currentPriceEur).toBe(13);
      expect(r.offerAmountEur).toBe(14);
      expect(r.offerCenter).toEqual({ x: 857, y: 2043 });
      expect(r.itemTitle).toBe("#2 21- PORTAFOGLIO SECRET...");
      expect(readScreen).toHaveBeenCalledTimes(2);
      expect(tap).not.toHaveBeenCalled();
      expect(runInShellSession).not.toHaveBeenCalled();
      // frame e righe OCR della lettura su cui si agisce (la conferma)
      expect(r.screenshotFile).toMatch(/_conferma\.jpg$/);
      expect(r.readingFile && existsSync(r.readingFile)).toBe(true);
      expect(r.timings.captureMs).toBe(970);
      expect(r.timings.ocrMs).toBe(290);
      expect(r.timings.confirmMs).not.toBeNull();
    },
  );

  it("live con dry-run attivo in configurazione → nessun tap", async () => {
    screens(RUNNING, RUNNING);
    const r = await runRound(SERIAL, "live");
    expect(r.decision).toBe("offer");
    expect(r.reason).toMatch(/dry-run attivo/);
    expect(tap).not.toHaveBeenCalled();
    expect(runInShellSession).not.toHaveBeenCalled();
  });

  it("fase non attiva (0s) → skip con UNA sola lettura", async () => {
    screens(loadOcrFixture("closing-0s"));
    const r = await runRound(SERIAL, "dry");
    expect(r.decision).toBe("skip");
    expect(r.reason).toMatch(/0s/);
    expect(readScreen).toHaveBeenCalledTimes(1);
    expect(journalKinds()).toEqual(["dry"]);
  });

  it("conferma fallita (pulsante cambiato) → skip", async () => {
    screens(RUNNING, withText(RUNNING, "Offri 14 €", "Offri 16 €"));
    const r = await runRound(SERIAL, "dry");
    expect(r.decision).toBe("skip");
    expect(r.reason).toMatch(/conferma/);
  });

  it("lettura dello schermo fallita → skip con errore", async () => {
    readScreen.mockRejectedValueOnce(new Error("OCR fallito: boom"));
    const r = await runRound(SERIAL, "evaluate");
    expect(r.decision).toBe("skip");
    expect(r.reason).toBe("lettura dello schermo non riuscita");
    expect(r.error).toMatch(/boom/);
  });
});

describe("runRound live (tap SIMULATO) — limite per articolo e verifica sul prezzo", () => {
  beforeEach(() => {
    resetConfigCache({ maxBidEur: 100, maxOffersPerAuction: 1, dryRun: false });
  });

  it("un tap al centro del pulsante, poi verifica: prezzo = importo → registrata", async () => {
    screens(RUNNING, RUNNING, withText(RUNNING, "13€", "14€"));
    const r = await runRound(SERIAL, "live");
    expect(runInShellSession).toHaveBeenCalledTimes(1);
    expect(runInShellSession).toHaveBeenCalledWith(SERIAL, "input tap 857 2043");
    expect(r.decision).toBe("offer");
    expect(r.offersSpent).toBe(1);
    expect(r.verifyOutcome).toBe("offerta a 14 € registrata come più alta");
    expect(r.uiChangedAfterTap).toBe(true);
    expect(journalKinds()).toEqual(["offer"]);
  });

  it("stesso articolo, importo diverso: il limite per articolo blocca il secondo tap", async () => {
    screens(RUNNING, RUNNING, RUNNING);
    await runRound(SERIAL, "live");
    const outbid = withText(RUNNING, "Offri 14 €", "Offri 16 €");
    screens(withText(outbid, "13€", "15€"));
    const second = await runRound(SERIAL, "live");
    expect(second.decision).toBe("skip");
    expect(second.reason).toMatch(/massimo di offerte/);
    expect(runInShellSession).toHaveBeenCalledTimes(1);
  });

  it("titolo letto con un carattere diverso: il limite per articolo tiene lo stesso", async () => {
    screens(RUNNING, RUNNING, RUNNING);
    await runRound(SERIAL, "live");
    const glitch = withText(
      RUNNING,
      "Prolungata • #2 21- PORTAFOGLIO SECRET...",
      "Prolungata • #2 21- PORTAFOGLIO SECRFT...",
    );
    screens(glitch);
    const second = await runRound(SERIAL, "live");
    expect(second.decision).toBe("skip");
    expect(second.reason).toMatch(/massimo di offerte/);
    expect(runInShellSession).toHaveBeenCalledTimes(1);
  });
});
