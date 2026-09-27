import { execFile, spawn } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { execAdbBinary } from "../adb/client";
import type { OcrLine } from "../shared/types";

/**
 * Lettura dello schermo via screenshot + OCR (Vision, macOS).
 *
 * Perché non uiautomator: sulle LIVE TikTok lo stato idle non arriva quasi
 * mai (dump falliti o da 3-12 s) e la card asta non espone il prezzo
 * all'accessibilità. Lo screenshot raw costa ~1 s, l'OCR della metà bassa
 * ~0,3 s, e legge timer, prezzo, pulsante e articolo in ogni frame.
 *
 * L'helper è tools/ocr/ocr.swift: bundled accanto ad adb nell'app, compilato
 * al primo uso in dev (serve swiftc, incluso negli strumenti Xcode).
 */

const CAPTURE_TIMEOUT_MS = 15000;
const OCR_TIMEOUT_MS = 15000;
const BUILD_TIMEOUT_MS = 180000;
/** La card asta sta nella metà bassa: l'OCR parte dal 45% dell'altezza. */
const ROI_TOP = 0.45;

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const OCR_SOURCE = join(REPO_ROOT, "tools", "ocr", "ocr.swift");
const DEV_OCR_BIN = join(REPO_ROOT, ".cache", "ocr", "ocr");

export interface ScreenReading {
  width: number;
  height: number;
  lines: OcrLine[];
  captureMs: number;
  ocrMs: number;
  /** JPEG del frame letto (se richiesto). */
  imageFile: string | null;
}

/** Helper OCR già pronto: override esplicito o bundled accanto ad adb. */
export function resolveOcrBin(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.POC_OCR_BIN) return env.POC_OCR_BIN;
  if (env.POC_ADB_BIN) {
    const sibling = join(dirname(env.POC_ADB_BIN), "ocr");
    if (existsSync(sibling)) return sibling;
  }
  return null;
}

function isNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function toLine(raw: unknown): OcrLine {
  const r = raw as Record<string, unknown>;
  if (
    typeof r?.text !== "string" ||
    !isNumber(r.conf) || r.conf < 0 || r.conf > 1 ||
    !isNumber(r.x1) || !isNumber(r.y1) || !isNumber(r.x2) || !isNumber(r.y2)
  ) {
    throw new Error(`OCR: riga OCR non valida: ${JSON.stringify(raw).slice(0, 120)}`);
  }
  return {
    text: r.text,
    conf: Math.round(r.conf * 100),
    bounds: { x1: r.x1, y1: r.y1, x2: r.x2, y2: r.y2 },
    center: { x: Math.round((r.x1 + r.x2) / 2), y: Math.round((r.y1 + r.y2) / 2) },
  };
}

/** Valida l'output JSON dell'helper (dato esterno: mai fidarsi). */
export function parseOcrOutput(stdout: string): { width: number; height: number; lines: OcrLine[] } {
  const last = stdout.trim().split("\n").pop() ?? "";
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(last) as Record<string, unknown>;
  } catch {
    throw new Error(`OCR: output non valido: ${last.slice(0, 120) || "(vuoto)"}`);
  }
  const { w, h, lines } = parsed;
  if (!isNumber(w) || !isNumber(h) || w <= 0 || h <= 0) {
    throw new Error("OCR: dimensioni dell'immagine non valide");
  }
  if (!Array.isArray(lines)) throw new Error("OCR: elenco righe mancante");
  return { width: w, height: h, lines: lines.map(toLine) };
}

let devBuild: Promise<string> | null = null;

/** In dev compila l'helper dal sorgente (una volta, o se il sorgente è cambiato). */
function buildDevOcrBin(): Promise<string> {
  const fresh =
    existsSync(DEV_OCR_BIN) &&
    existsSync(OCR_SOURCE) &&
    statSync(DEV_OCR_BIN).mtimeMs >= statSync(OCR_SOURCE).mtimeMs;
  if (fresh) return Promise.resolve(DEV_OCR_BIN);
  if (!existsSync(OCR_SOURCE)) {
    return Promise.reject(
      new Error("OCR non disponibile: helper assente (imposta POC_OCR_BIN o esegui npm run app:fetch-tools)"),
    );
  }
  mkdirSync(dirname(DEV_OCR_BIN), { recursive: true });
  return new Promise((resolve, reject) => {
    execFile(
      "swiftc",
      ["-O", OCR_SOURCE, "-o", DEV_OCR_BIN],
      { timeout: BUILD_TIMEOUT_MS },
      (err, _stdout, stderr) => {
        if (err) {
          reject(new Error(`OCR: compilazione dell'helper non riuscita (serve swiftc): ${stderr.trim() || err.message}`));
          return;
        }
        resolve(DEV_OCR_BIN);
      },
    );
  });
}

export function ensureOcrBin(): Promise<string> {
  const ready = resolveOcrBin();
  if (ready) return Promise.resolve(ready);
  // Si condivide solo la compilazione in corso: a ogni lettura successiva il
  // controllo di freschezza riparte (sorgente modificato → ricompila).
  devBuild ??= buildDevOcrBin().finally(() => {
    devBuild = null;
  });
  return devBuild;
}

/** Esegue l'helper passando il frame raw su stdin. */
function runOcr(bin: string, args: string[], input: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("OCR: tempo scaduto"));
    }, OCR_TIMEOUT_MS);
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`OCR: avvio dell'helper non riuscito: ${err.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(`OCR fallito (codice ${code}): ${stderr.trim()}`));
    });
    child.stdin.on("error", () => {
      // l'helper può chiudersi prima di leggere tutto: l'errore arriva da "close"
    });
    child.stdin.end(input);
  });
}

/**
 * UNA lettura dello schermo: screenshot raw (formato screencap senza PNG,
 * ~2× più veloce) → OCR della metà bassa → righe con coordinate in pixel.
 */
export async function readScreen(
  serial: string,
  opts: { saveImage?: string } = {},
): Promise<ScreenReading> {
  const bin = await ensureOcrBin();
  const t0 = performance.now();
  const raw = await execAdbBinary(["-s", serial, "exec-out", "screencap"], {
    timeoutMs: CAPTURE_TIMEOUT_MS,
  });
  const t1 = performance.now();
  const args = ["--raw", "--roi-top", String(ROI_TOP)];
  if (opts.saveImage) {
    mkdirSync(dirname(opts.saveImage), { recursive: true });
    args.push("--save", opts.saveImage);
  }
  const parsed = parseOcrOutput(await runOcr(bin, args, raw));
  const t2 = performance.now();
  return {
    ...parsed,
    captureMs: Math.round(t1 - t0),
    ocrMs: Math.round(t2 - t1),
    imageFile: opts.saveImage ?? null,
  };
}
