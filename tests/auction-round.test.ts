import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── ADB simulato: nessun device reale, nessun tap possibile ─────────────────
const dumpUiHierarchy = vi.fn<(serial: string) => Promise<string>>();
const captureAndSave = vi.fn<(serial: string) => Promise<{ file: string; dataUrl: string }>>();
const tap = vi.fn<(serial: string, x: number, y: number) => Promise<void>>();
const runInShellSession = vi.fn<(serial: string, cmd: string) => Promise<string>>();

vi.mock("../src/adb/auction", async (importActual) => ({
  ...(await importActual<typeof import("../src/adb/auction")>()),
  dumpUiHierarchy: (serial: string) => dumpUiHierarchy(serial),
}));
vi.mock("../src/adb/screenshots", () => ({
  captureAndSave: (serial: string) => captureAndSave(serial),
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

/** Card asta come appare sul Samsung: importo corrente + CTA «Offri 21 €». */
const AUCTION_XML = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout" content-desc="" clickable="false" enabled="true" bounds="[0,0][1080,2400]">
    <node index="0" text="19€" resource-id="" class="android.widget.TextView" content-desc="" clickable="false" enabled="true" bounds="[328,1836][430,1900]"/>
    <node index="1" text="Offri 21 €" resource-id="" class="android.widget.Button" content-desc="" clickable="true" enabled="true" bounds="[696,2006][1022,2083]"/>
  </node>
</hierarchy>`;

function readJournalKinds(): string[] {
  return readFileSync(journalFile(), "utf8")
    .trim()
    .split("\n")
    .map((line) => (JSON.parse(line) as { kind: string }).kind);
}

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), "poc-round-"));
  setDataDir(dir);
  setStateBaseDir(dir);
  setSafetyBaseDir(dir);
  // Limiti che permetterebbero l'offerta: il tap deve restare impossibile
  // perché la modalità non è "live".
  resetConfigCache({ maxBidEur: 100, maxOffersPerAuction: 1, dryRun: false });
  dumpUiHierarchy.mockReset().mockResolvedValue(AUCTION_XML);
  captureAndSave.mockReset().mockResolvedValue({
    file: join(dir, "screenshots", "screen.png"),
    dataUrl: "data:image/png;base64,",
  });
  tap.mockReset().mockResolvedValue();
  runInShellSession.mockReset().mockResolvedValue("");
  return () => rmSync(dir, { recursive: true, force: true });
});

describe("runRound evaluate/dry — nessun tap, screenshot sempre salvato", () => {
  it.each(["evaluate", "dry"] as const)(
    "%s: condizioni soddisfatte → decisione offer SENZA tap, con screenshot",
    async (mode) => {
      const r = await runRound(SERIAL, mode);
      expect(r.decision).toBe("offer");
      expect(r.buttonLabel).toBe("Offri 21 €");
      expect(r.buttonCenter).toEqual({ x: 859, y: 2045 });
      expect(r.priceEur).toBe(21);
      expect(r.screenshotFile).toMatch(/screen\.png$/);
      expect(tap).not.toHaveBeenCalled();
      expect(runInShellSession).not.toHaveBeenCalled();
    },
  );

  it("dump fallito → skip con errore e screenshot della schermata non leggibile", async () => {
    dumpUiHierarchy.mockRejectedValue(
      new Error("uiautomator non riesce a leggere la UI: la schermata non si ferma mai"),
    );
    const r = await runRound(SERIAL, "dry");
    expect(r.decision).toBe("skip");
    expect(r.reason).toBe("dump UI non riuscito");
    expect(r.error).toMatch(/non si ferma mai/);
    expect(r.xmlFile).toBeNull();
    expect(r.screenshotFile).toMatch(/screen\.png$/);
    expect(readJournalKinds()).toEqual(["dry"]);
    expect(tap).not.toHaveBeenCalled();
  });

  it("screenshot non disponibile → il round prosegue (best-effort)", async () => {
    captureAndSave.mockRejectedValue(new Error("device scollegato"));
    const r = await runRound(SERIAL, "evaluate");
    expect(r.decision).toBe("offer");
    expect(r.screenshotFile).toBeNull();
  });
});
