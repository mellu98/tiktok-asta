import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, beforeEach } from "vitest";
import { evaluateOfferButton, scoreOfferButton } from "../src/auction/button";
import { estimateNextBid, parseAmountEur } from "../src/auction/price";
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
import type { UiNode } from "../src/shared/types";

function mk(
  order: number,
  text: string,
  bounds: [number, number, number, number],
  opts: {
    clickable?: boolean;
    enabled?: boolean;
    contentDesc?: string;
    className?: string;
  } = {},
): UiNode {
  return {
    text,
    contentDesc: opts.contentDesc ?? "",
    resourceId: `com.example:id/n${order}`,
    className: opts.className ?? "android.widget.Button",
    clickable: opts.clickable ?? true,
    enabled: opts.enabled ?? true,
    bounds: { x1: bounds[0], y1: bounds[1], x2: bounds[2], y2: bounds[3] },
    center: {
      x: Math.round((bounds[0] + bounds[2]) / 2),
      y: Math.round((bounds[1] + bounds[3]) / 2),
    },
    order,
  };
}

const SCREEN = mk(0, "", [0, 0, 1080, 2400], {
  clickable: false,
  className: "android.widget.FrameLayout",
});

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

describe("scoreOfferButton — falsi positivi più pericolosi", () => {
  it("«Non offrire» (contiene offri) viene scartato", () => {
    const n = mk(1, "Non offrire", [0, 0, 400, 100]);
    expect(scoreOfferButton(n, [SCREEN]).score).toBe(0);
  });

  it("testo informativo «Offri» NON clickable viene pesantemente penalizzato", () => {
    const n = mk(1, "Offri", [0, 0, 400, 100], { clickable: false });
    const { score } = scoreOfferButton(n, [SCREEN]);
    expect(score).toBeLessThan(70); // sotto la soglia di default
  });

  it("pulsante disabilitato scende sotto la soglia di default", () => {
    const n = mk(1, "Offri", [340, 2100, 740, 2280], { enabled: false });
    const { score } = scoreOfferButton(n, [SCREEN]);
    expect(score).toBeLessThan(70);
  });

  it("pulsante con bounds fuori schermo viene scartato", () => {
    const n = mk(1, "Offri", [0, 0, 4000, 3000]);
    expect(scoreOfferButton(n, [SCREEN]).score).toBe(0);
  });

  it("«Offri» esatto + clickable + enabled supera la soglia di default", () => {
    const n = mk(1, "Offri", [340, 2100, 740, 2280]);
    const { score, reasons } = scoreOfferButton(n, [SCREEN]);
    expect(score).toBeGreaterThanOrEqual(70);
    expect(reasons.join(" ")).toContain("esatto");
  });

  it("«Offri» come content-desc conta quanto il testo", () => {
    const n = mk(1, "", [340, 2100, 740, 2280], { contentDesc: "Offri" });
    expect(scoreOfferButton(n, [SCREEN]).score).toBeGreaterThanOrEqual(70);
  });
});

describe("evaluateOfferButton — soglia e selezione deterministica", () => {
  it("sceglie il miglior candidato e scarta gli altri sotto soglia", () => {
    const nodes = [
      SCREEN,
      mk(1, "Offri", [0, 0, 1080, 200]), // testata, full-width, NON è un CTA? è clickable → punteggio alto ma area enorme
      mk(2, "Offri", [340, 2100, 740, 2280]),
    ];
    const result = evaluateOfferButton(nodes, 70);
    expect(result.node?.order).toBe(2);
    expect(result.rejected.some((r) => r.node.order === 1)).toBe(true);
  });

  it("fail-closed: nessun nodo sopra soglia → node null", () => {
    const nodes = [
      SCREEN,
      mk(1, "Offri", [0, 0, 400, 100], { clickable: false }), // solo informativo
    ];
    const result = evaluateOfferButton(nodes, 70);
    expect(result.node).toBeNull();
  });

  it("testo «Offri» in un nodo di ALTRA scheda (lontano) compete comunque: serve il prezzo per il contesto", () => {
    // due pulsanti Offri identici: aree diverse → vince l'area minore
    const nodes = [
      SCREEN,
      mk(1, "Offri", [0, 0, 540, 200]),
      mk(2, "Offri", [600, 2200, 1080, 2400]),
    ];
    const result = evaluateOfferButton(nodes, 70);
    expect(result.node?.order).toBe(2); // area minore vince il tie-break
  });
});

describe("parseAmountEur / estimateNextBid", () => {
  it("parsa formati italiano e con simbolo", () => {
    expect(parseAmountEur("1.234 €")).toBe(1234);
    expect(parseAmountEur("€ 500")).toBe(500);
    expect(parseAmountEur("12,50 €")).toBe(12.5);
    expect(parseAmountEur("999€")).toBe(999);
    expect(parseAmountEur("nessun importo")).toBeNull();
  });

  it("stima il prezzo come importo massimo visibile", () => {
    const nodes = [
      SCREEN,
      mk(1, "1.234 €", [200, 400, 880, 500], { clickable: false }),
      mk(2, "Offri", [340, 2100, 740, 2280]),
    ];
    const est = estimateNextBid(nodes, nodes[2] as UiNode, 60);
    expect(est?.amountEur).toBe(1234);
  });

  it("importi multipli DIVERSI abbassano la confidenza (ambiguità)", () => {
    const nodes = [
      SCREEN,
      mk(1, "1.234 €", [200, 400, 880, 500], { clickable: false }),
      mk(2, "2.000 €", [200, 520, 880, 620], { clickable: false }),
      mk(3, "Offri", [340, 2100, 740, 2280]),
    ];
    const est = estimateNextBid(nodes, nodes[3] as UiNode, 100);
    expect(est?.confidence).toBeLessThan(100);
  });

  it("niente importi → nessuna stima (fail-closed)", () => {
    const nodes = [SCREEN, mk(1, "Offri", [340, 2100, 740, 2280])];
    expect(estimateNextBid(nodes, nodes[1] as UiNode, 60)).toBeNull();
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
  it("recordOfferSpent incrementa e persistsa (rilettura dal disco)", () => {
    const id = computeAuctionId("firma-test", [100]);
    recordOfferSpent(id);
    recordOfferSpent(id);
    expect(getOffersSpent(id)).toBe(2);
  });

  it("aste diverse hanno contatori indipendenti", () => {
    const a = computeAuctionId("asta-a", [100]);
    const b = computeAuctionId("asta-b", [200]);
    recordOfferSpent(a);
    expect(getOffersSpent(a)).toBe(1);
    expect(getOffersSpent(b)).toBe(0);
  });

  it("reset azzera solo l'asta indicata", () => {
    const a = computeAuctionId("asta-x", [1]);
    const b = computeAuctionId("asta-y", [2]);
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
