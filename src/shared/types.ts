/**
 * Tipi condivisi tra server (Node) e dashboard (React).
 * Non importare codice Node qui: questo file gira anche nel browser.
 */

/** Stato della connessione ADB di un dispositivo (output di `adb devices`). */
export type AdbState =
    | "device"
    | "unauthorized"
    | "offline"
    | "recovery"
    | "bootloader"
    | "unknown";

/** Riga grezza estratta da `adb devices -l`, prima dell'arricchimento con getprop. */
export interface ParsedAdbDevice {
    serial: string;
    state: AdbState;
    model: string | null;
    product: null | string;
    transportId: string | null;
}

/** Modello canonico di un dispositivo Android gestito dalla dashboard. */
export interface AndroidDevice {
    /** Identificativo univoco per la UI: coincide con il seriale ADB. */
    id: string;
    serial: string;
    manufacturer: string;
    model: string;
    androidVersion: string;
    sdkVersion: string;
    adbStatus: AdbState;
    /** true se presente nella lista `adb devices` (anche unauthorized). */
    connected: boolean;
    /** true solo se adbStatus === 'device' (debug USB autorizzato). */
    authorized: boolean;
    transportId: string | null;
    firstSeenAt: number;
    lastSeenAt: number;
}

export type LogLevel = "info" | "success" | "warn" | "error";
export type LogSource = "adb" | "scrcpy" | "device" | "server" | "input";

/** Voce del log operativo mostrato in dashboard. */
export interface LogEntry {
    id: number;
    ts: number;
    level: LogLevel;
    source: LogSource;
    message: string;
}

/** Messaggi inviati dal server alla dashboard via WebSocket. */
export type WsServerMessage =
    | { type: "hello"; port: number }
    | { type: "devices"; devices: AndroidDevice[]; updatedAt: number }
    | { type: "log"; entry: LogEntry }
    | {
          type: "scrcpy";
          serial: string;
          status: "starting" | "running" | "exited";
          code?: number | null;
      };

/** Chiavi di input hardware supportate dalla V0. */
export type HardwareKey = "BACK" | "HOME" | "ENTER";

/** Risposta di POST /api/devices/:serial/screenshot */
export interface ScreenshotResult {
    file: string;
    dataUrl: string;
}

/* ── Automazione asta TikTok ─────────────────────────────────────────── */

/** Configurazione limiti/modalità automazione (persistita lato server). */
export interface AuctionConfig {
  /** Prezzo massimo (€) della prossima offerta: sopra questo valore nessun tap. */
  maxBidEur: number;
  /** Numero massimo di offerte per singola asta. */
  maxOffersPerAuction: number;
  /** Confidenza OCR minima (0-100) sulla lettura del pulsante «Offri N €». */
  confidenceThreshold: number;
  /** Confidenza OCR minima (0-100) sulla lettura di prezzo attuale e timer. */
  priceConfidenceThreshold: number;
  /** true (default) = nessun tap reale, solo valutazione. */
  dryRun: boolean;
  /** ms fra i round in modalità automatica. 0 = auto OFF (default). */
  autoRoundMs: number;
}

/* ── Lettura dello schermo (screenshot + OCR) ──────────────────────── */

/** Riga di testo riconosciuta dall'OCR, in pixel dello schermo del device. */
export interface OcrLine {
    text: string;
    /** Confidenza dell'OCR, 0-100. */
    conf: number;
    bounds: { x1: number; y1: number; x2: number; y2: number };
    center: { x: number; y: number };
}

/**
 * Fasi della card asta osservate su TikTok LIVE:
 * coming (In arrivo) → running (timer MM:SS) → final (ultimi 10 s, "Ns";
 * ogni offerta riporta il timer a 10 s) → closing (0s, pulsante ancora
 * visibile anche per minuti) → sold (Offerta finale) → waiting (In attesa).
 * unknown = card presente ma timer non leggibile in modo affidabile.
 */
export type AuctionPhase =
    | "coming"
    | "running"
    | "final"
    | "closing"
    | "sold"
    | "waiting"
    | "unknown";

/** Card asta interpretata da una lettura OCR. */
export interface AuctionCard {
    phase: AuctionPhase;
    timerSec: number | null;
    timerText: string | null;
    timerConf: number | null;
    currentPriceEur: number | null;
    priceConf: number | null;
    /** "Offerta iniziale": nessuna offerta ancora, il pulsante vale il prezzo di partenza. */
    startingPrice: boolean;
    /** "ha fatto l'offerta più alta": c'è già almeno un'offerta. */
    hasBids: boolean;
    /** "Le offerte ripristinano l'asta" (ultimi secondi). */
    resetNotice: boolean;
    /** Pulsante «Offri N €» (sempre accanto a «Personalizzato»). */
    offer: {
        label: string;
        amountEur: number;
        conf: number;
        bounds: { x1: number; y1: number; x2: number; y2: number };
        center: { x: number; y: number };
    } | null;
    itemTitle: string | null;
    itemTitleConf: number | null;
    /** Titolo normalizzato: identità dell'articolo per il limite di offerte. */
    itemKey: string | null;
    /** "Offerta finale N €" (asta aggiudicata). */
    finalPriceEur: number | null;
}

/** Voce del journal delle decisioni (una riga JSONL per round). */
export interface JournalEntry {
  ts: number;
  serial: string;
  /** ID di correlazione del round (frame JPEG + righe OCR dello stesso round). */
  runId: string | null;
  auctionId: string | null;
  kind: "evaluate" | "dry" | "offer";
  decision: "offer" | "skip";
  reason: string;
  phase: AuctionPhase | null;
  timerSec: number | null;
  itemTitle: string | null;
  currentPriceEur: number | null;
  offerAmountEur: number | null;
  offerCenter: { x: number; y: number } | null;
  limits: {
    maxBidEur: number;
    maxOffersPerAuction: number;
    offersSpent: number;
    confidenceThreshold: number;
  };
  readingFile: string | null;
  screenshotFile: string | null;
  commandError: string | null;
  verifyOutcome: string | null;
  timings?: RoundTimings;
}

export interface RoundTimings {
    /** Screenshot raw via adb. */
    captureMs: number;
    /** OCR della metà bassa dello schermo. */
    ocrMs: number;
    parseMs: number;
    decideMs: number;
    /** Seconda lettura di conferma (solo se la prima passa le guardie). */
    confirmMs: number | null;
    tapMs: number | null;
    verifyMs: number | null;
}

/** Esito di un round di automazione (valutazione, dry-run o live). */
export interface RoundResult {
    serial: string;
    mode: "evaluate" | "dry" | "live";
    /** ID di correlazione: stesso id per frame JPEG e righe OCR del round. */
    runId: string;
    auctionId: string | null;
    decision: "offer" | "skip";
    reason: string;
    phase: AuctionPhase | null;
    timerSec: number | null;
    itemTitle: string | null;
    currentPriceEur: number | null;
    offerAmountEur: number | null;
    offerLabel: string | null;
    offerCenter: { x: number; y: number } | null;
    /** Confidenza OCR minima fra pulsante, prezzo e timer (0-100). */
    ocrConfidence: number | null;
    offersSpent: number;
    limits: {
        maxBidEur: number;
        maxOffersPerAuction: number;
        confidenceThreshold: number;
        priceConfidenceThreshold: number;
        dryRun: boolean;
        estopEngaged: boolean;
    };
    /** Righe OCR della lettura su cui si è deciso (JSON). */
    readingFile: string | null;
    /** Frame su cui si è deciso (JPEG). */
    screenshotFile: string | null;
    verifyOutcome: string | null;
    uiChangedAfterTap: boolean | null;
    error: string | null;
    timings: RoundTimings;
}

/* ── Diagnostica asta TikTok (uiautomator) ─────────────────────────────── */

/** Nodo dell'albero UI estratto da `uiautomator dump`. */
export interface UiNode {
    text: string;
    contentDesc: string;
    resourceId: string;
    className: string;
    clickable: boolean;
    enabled: boolean;
    bounds: { x1: number; y1: number; x2: number; y2: number };
    /** Centro dei bounds: pronto per `input tap`. */
    center: { x: number; y: number };
    /** Indice nel documento (ordine dell'albero, per tie-break deterministici). */
    order: number;
}

/** Risposta di POST /api/devices/:serial/auction/analyze */
export interface AuctionAnalysis {
    screenshot: ScreenshotResult;
    /** ID di correlazione (frame, righe OCR ed eventuale XML). */
    runId?: string;
    /** Card asta letta via OCR (null = nessuna card sullo schermo). */
    card: AuctionCard | null;
    /** Righe OCR della metà bassa dello schermo. */
    ocrLines: OcrLine[];
    /** Percorso delle righe OCR salvate (JSON). */
    readingFile: string;
    /** false = gerarchia UI non disponibile (es. uiautomator non idle su TikTok LIVE). */
    uiDumpAvailable?: boolean;
    /** Dettaglio dell'errore di dump quando uiDumpAvailable è false. */
    dumpError?: string;
    /** Percorso dell'XML uiautomator (null se il dump non è disponibile). */
    xmlFile: string | null;
    nodeCount: number;
    /** Nodi che contengono keyword dell'asta (Offri, €, prezzo…). */
    matches: UiNode[];
    /** Tutti i nodi clickabili (riassunto di cosa espone la schermata). */
    clickableNodes: UiNode[];
    /** Risoluzione stimata dello schermo (max bounds osservati). */
    screenSize: { width: number; height: number };
}

/** Risposta di POST /api/devices/:serial/auction/click-offer */
export interface ClickOfferResult {
    status: "dry-run" | "tapped" | "not-found" | "ambiguous";
    center?: { x: number; y: number };
    node?: UiNode;
    /** Tutti i candidati “Offri” visti nel dump (per diagnosi). */
    candidates?: UiNode[];
    /** Firma dell'albero UI prima e dopo il tap (solo live). */
    before?: { nodeCount: number; signature: string };
    after?: { nodeCount: number; signature: string };
    screenshotAfter?: ScreenshotResult;
}
