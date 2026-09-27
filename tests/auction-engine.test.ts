import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, beforeEach } from "vitest";
import { parseAmountEur } from "../src/auction/price";
import { loadConfig, sanitizeConfig } from "../src/auction/config";
import {
  isEmergencyStopped,
  setEmergencyStop,
  setSafetyBaseDir,
} from "../src/auction/safety";
import {
  computeAuctionId,
  getOffersSpent,
  isDeviceBusy,
  recordOfferSpent,
  resetAuction,
  setStateBaseDir,
  withDeviceLock,
} from "../src/auction/state";

// Isola stato e safety in directory temporanee per ogni test:
// i contatori non devono accumularsi fra test né inquinare la repo.
beforeEach(() => {
  const stateDir = mkdtempSync(join(tmpdir(), "poc-state-"));
  const safetyDir = mkdtempSync(join(tmpdir(), "poc-safety-"));
  setStateBaseDir(stateDir);
  setSafetyBaseDir(safetyDir);
  return () => {
    // rimuove SOLO le due directory temporanee create qui sopra
    rmSync(stateDir, { recursive: true, force: true });
    rmSync(safetyDir, { recursive: true, force: true });
  };
});

describe("parseAmountEur", () => {
  it("parsa formati italiano e con simbolo", () => {
    expect(parseAmountEur("1.234 €")).toBe(1234);
    expect(parseAmountEur("€ 500")).toBe(500);
    expect(parseAmountEur("12,50 €")).toBe(12.5);
    expect(parseAmountEur("999€")).toBe(999);
    expect(parseAmountEur("nessun importo")).toBeNull();
  });

  it("€ davanti con punto delle migliaia: «€1.234» è 1234, non 1,23", () => {
    expect(parseAmountEur("€1.234")).toBe(1234);
    expect(parseAmountEur("€ 1.234,56")).toBe(1234.56);
    expect(parseAmountEur("€ 12,50")).toBe(12.5);
    expect(parseAmountEur("€1,234.56")).toBe(1234.56);
  });

  it("importi senza separatore delle migliaia non vengono troncati", () => {
    expect(parseAmountEur("1234 €")).toBe(1234);
    expect(parseAmountEur("12345€")).toBe(12345);
  });

  it("stringhe reali della card asta TikTok (Samsung, 27/09)", () => {
    expect(parseAmountEur("Offri 21 €")).toBe(21);
    expect(parseAmountEur("19€")).toBe(19);
    expect(parseAmountEur("2 € di spedizione")).toBe(2);
  });
});

describe("config — default sicuri e sanitizzazione", () => {
  it("default: maxBid 0, maxOffers 0, dryRun true → nessuna offerta possibile", () => {
    const cfg = sanitizeConfig(undefined);
    expect(cfg.maxBidEur).toBe(0);
    expect(cfg.maxOffersPerAuction).toBe(0);
    expect(cfg.dryRun).toBe(true);
  });

  it("clamp dei valori fuori intervallo", () => {
    const cfg = sanitizeConfig({
      maxBidEur: -50,
      maxOffersPerAuction: 100000,
      confidenceThreshold: 150,
    });
    expect(cfg.maxBidEur).toBe(0);
    expect(cfg.maxOffersPerAuction).toBe(999);
    expect(cfg.confidenceThreshold).toBe(100);
  });

  it("loadConfig ricade sui default con file assente/corrotto", () => {
    // usa la cwd dei test: nessun auction-config.json → default
    const cfg = loadConfig();
    expect(cfg.dryRun).toBe(true);
  });
});

describe("safety — arresto di emergenza persistente", () => {
  it("estop persiste attraverso letture multiple (simulazione riavvio)", () => {
    setEmergencyStop(true, "test");
    expect(isEmergencyStopped()).toBe(true);
    // ricarica dal disco (nuova lettura senza cache)
    expect(isEmergencyStopped()).toBe(true);
  });

  it("disarmo riabilita i tap", () => {
    setEmergencyStop(false);
    expect(isEmergencyStopped()).toBe(false);
  });
});

describe("state — contatori coerenti con retry e riavvii", () => {
  it("l'id dell'asta dipende solo dall'articolo, non dall'importo corrente", () => {
    expect(computeAuctionId("21- PORTAFOGLIO SECRET")).toBe(computeAuctionId("21- PORTAFOGLIO SECRET"));
    expect(computeAuctionId("21- PORTAFOGLIO SECRET")).not.toBe(computeAuctionId("27- BORSA BUBY CLOTH CL"));
  });

  it("recordOfferSpent incrementa e persistsa (rilettura dal disco)", () => {
    const id = computeAuctionId("21- PORTAFOGLIO SECRET");
    recordOfferSpent(id);
    recordOfferSpent(id);
    expect(getOffersSpent(id)).toBe(2);
  });

  it("aste diverse hanno contatori indipendenti", () => {
    const a = computeAuctionId("26- BORSA SAINT TROPE B");
    const b = computeAuctionId("27- BORSA BUBY CLOTH CL");
    recordOfferSpent(a);
    expect(getOffersSpent(a)).toBe(1);
    expect(getOffersSpent(b)).toBe(0);
  });

  it("reset azzera solo l'asta indicata", () => {
    const a = computeAuctionId("asta-x");
    const b = computeAuctionId("asta-y");
    recordOfferSpent(a);
    recordOfferSpent(b);
    resetAuction(a);
    expect(getOffersSpent(a)).toBe(0);
    expect(getOffersSpent(b)).toBe(1);
  });
});

describe("lock per device", () => {
  it("rifiuta round concorrenti sullo stesso device", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    let done = false;
    const first = withDeviceLock("SER", async () => {
      await gate;
      done = true;
      return "primo";
    });
    expect(isDeviceBusy("SER")).toBe(true); // lock attivo
    const second = await withDeviceLock("SER", async () => "secondo");
    expect(second).toBeNull(); // rifiutato, non accodato
    expect(done).toBe(false);
    release();
    await expect(first).resolves.toBe("primo");
  });

  it("device diversi non si bloccano a vicenda", async () => {
    const a = withDeviceLock("A", async () => "a");
    const b = withDeviceLock("B", async () => "b");
    await expect(a).resolves.toBe("a");
    await expect(b).resolves.toBe("b");
  });
});
