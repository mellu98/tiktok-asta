/**
 * Misura delle latenze delle fasi dell'automazione su un device reale.
 *
 * Richiede: UN Samsung collegato e autorizzato. Senza device lo script esce
 * con un messaggio chiaro — nessuna stima viene stampata.
 *
 * Fasi misurate: cattura (screenshot raw), OCR, parse della card,
 * decisione, conferma (seconda lettura, solo se la prima passa le guardie).
 *
 * Uso:
 *   npm run measure:latency                    → 5 round read-only
 *   npm run measure:latency -- --rounds 10
 *   npm run measure:latency -- --serial XXX    → device esplicito
 *                                                (obbligatorio se >1 device)
 *
 * Modalità read-only: NON esegue tap reali. Le fasi tap/verify non sono
 * disponibili → stampate come "n/a" (non è un errore).
 */

import { runRound } from "../src/auction/engine";
import { listDevices } from "../src/adb/devices";

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
  return s
    ? `min ${s.min}ms · avg ${s.avg}ms · max ${s.max}ms (n=${s.n})`
    : "n/a";
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const serialIdx = args.indexOf("--serial");
  const serialArg = serialIdx !== -1 ? args[serialIdx + 1] : undefined;
  const roundsIdx = args.indexOf("--rounds");
  const rounds = roundsIdx !== -1 ? Number(args[roundsIdx + 1]) || 5 : 5;

  const devices = await listDevices();
  const ready = devices.filter((d) => d.state === "device");

  if (ready.length === 0) {
    console.error(
      "Nessun device autorizzato collegato. Collega il Samsung, accetta il debug USB e rilancia.",
    );
    process.exit(1);
  }

  let serial: string;
  if (serialArg) {
    if (!ready.some((d) => d.serial === serialArg)) {
      console.error(
        `Device ${serialArg} non trovato o non autorizzato. Dispositivi disponibili: ${ready.map((d) => d.serial).join(", ")}`,
      );
      process.exit(1);
    }
    serial = serialArg;
  } else if (ready.length === 1) {
    serial = ready[0]?.serial as string;
  } else {
    console.error(
      `Più dispositivi collegati (${ready.map((d) => d.serial).join(", ")}): specifica --serial <SERIAL>.`,
    );
    process.exit(1);
  }

  console.log(
    `Device: ${serial} · round: ${rounds} · modalità: read-only (nessun tap reale)`,
  );

  const capture: number[] = [];
  const ocr: number[] = [];
  const parse: number[] = [];
  const decide: number[] = [];
  const confirm: number[] = [];
  const total: number[] = [];

  for (let i = 1; i <= rounds; i++) {
    const r = await runRound(serial, "evaluate");
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
  console.log(`tap:       n/a (read-only)`);
  console.log(`verifica:  n/a (read-only)`);
}

void main();
