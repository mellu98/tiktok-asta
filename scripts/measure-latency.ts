/**
 * Misura delle latenze delle fasi dell'automazione su un device reale.
 *
 * Richiede: UN Samsung collegato e autorizzato (uiautomator). WITHOUT a
 * device the script exits with a clear message — no estimates are printed.
 *
 * Uso:
 *   npm run measure:latency                       → 5 round di valutazione (no tap)
 *   npm run measure:latency -- --rounds 10
 *   npm run measure:latency -- --serial R7AX711BSBV  (obbligatorio con più device)
 *   npm run measure:latency -- --tap              → misura anche il tap REALE
 *                                                   (richiede conferma esplicita)
 *
 * Stampa min/avg/max per fase: cattura (screenshot raw), OCR, parse,
 * decisione, conferma (seconda lettura), totale; tap/verify solo con --tap.
 * NESSUN tap reale avviene senza il flag --tap.
 */

import { runRound } from "../src/auction/engine";
import { listDevices, selectReadySerial } from "../src/adb/devices";

interface Stats {
  min: number;
  avg: number;
  max: number;
  n: number;
}

function stats(values: number[]): Stats | null {
  if (values.length === 0) return null;
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  return {
    min: Math.min(...values),
    avg: Math.round(avg),
    max: Math.max(...values),
    n: values.length,
  };
}

function fmt(s: Stats | null): string {
  return s ? `min ${s.min}ms · avg ${s.avg}ms · max ${s.max}ms (n=${s.n})` : "—";
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const wantTap = args.includes("--tap");
  const roundsIdx = args.indexOf("--rounds");
  const rounds = roundsIdx !== -1 ? Number(args[roundsIdx + 1]) || 5 : 5;
  const serialIdx = args.indexOf("--serial");
  const requestedSerial = serialIdx !== -1 ? args[serialIdx + 1] : undefined;

  let serial: string;
  try {
    serial = selectReadySerial(await listDevices(), requestedSerial);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
  console.log(`Device: ${serial} · round: ${rounds} · tap reale: ${wantTap ? "SÌ" : "no"}`);

  if (wantTap) {
    console.log(
      "\n⚠ ATTENZIONE: con --tap il round 'live' può eseguire UN tap reale sul device.\n" +
        "  I limiti in configurazione (max bid, max offerte) restano applicati.\n",
    );
  }

  const capture: number[] = [];
  const ocr: number[] = [];
  const parse: number[] = [];
  const decide: number[] = [];
  const confirm: number[] = [];
  const total: number[] = [];
  const tap: number[] = [];
  const verify: number[] = [];

  for (let i = 1; i <= rounds; i++) {
    const mode = wantTap ? "live" : "evaluate";
    const r = await runRound(serial, mode);
    if (r.error) {
      console.log(`round ${i}: ERRORE — ${r.error}`);
      continue;
    }
    const t = r.timings;
    capture.push(t.captureMs);
    ocr.push(t.ocrMs);
    parse.push(t.parseMs);
    decide.push(t.decideMs);
    if (t.confirmMs !== null) confirm.push(t.confirmMs);
    total.push(t.captureMs + t.ocrMs + t.parseMs + t.decideMs + (t.confirmMs ?? 0));
    if (t.tapMs !== null) tap.push(t.tapMs);
    if (t.verifyMs !== null) verify.push(t.verifyMs);
    const card = [
      r.phase ?? "nessuna card",
      r.timerSec !== null ? `${r.timerSec}s` : null,
      r.currentPriceEur !== null ? `${r.currentPriceEur}€` : null,
      r.offerLabel ? `«${r.offerLabel}»` : null,
    ]
      .filter(Boolean)
      .join(" ");
    console.log(
      `round ${i}: cattura ${t.captureMs}ms · OCR ${t.ocrMs}ms · parse ${t.parseMs}ms · decisione ${t.decideMs}ms` +
        `${t.confirmMs !== null ? ` · conferma ${t.confirmMs}ms` : ""} · [${card}] → ${r.decision} (${r.reason})`,
    );
  }

  console.log("\n═══ RISULTATI ═══");
  console.log(`cattura:   ${fmt(stats(capture))}`);
  console.log(`OCR:       ${fmt(stats(ocr))}`);
  console.log(`parse:     ${fmt(stats(parse))}`);
  console.log(`decisione: ${fmt(stats(decide))}`);
  console.log(`conferma:  ${fmt(stats(confirm))}${confirm.length === 0 ? " (nessun round ha superato le guardie)" : ""}`);
  console.log(`totale:    ${fmt(stats(total))}`);
  if (wantTap) {
    console.log(`tap:       ${fmt(stats(tap))}`);
    console.log(`verifica:  ${fmt(stats(verify))}`);
  } else {
    console.log("tap/verifica: non misurati (serve --tap, esegue tap reali)");
  }
}

void main();
