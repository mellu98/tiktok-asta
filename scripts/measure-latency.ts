/**
 * Misura delle latenze delle fasi dell'automazione su un device reale.
 *
 * Richiede: UN Samsung collegato e autorizzato (uiautomator). WITHOUT a
 * device the script exits with a clear message — no estimates are printed.
 *
 * Uso:
 *   npm run measure:latency              → 5 round di valutazione (no tap)
 *   npm run measure:latency --rounds 10
 *   npm run measure:latency -- --tap     → misura anche il tap REALE
 *                                          (richiede conferma esplicita)
 *
 * Stampa min/avg/max per fase: dump, parse, decide, tap, verify.
 * NESSUN tap reale avviene senza il flag --tap.
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
  return s ? `min ${s.min}ms · avg ${s.avg}ms · max ${s.max}ms (n=${s.n})` : "—";
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const wantTap = args.includes("--tap");
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
  const serial = ready[0]?.serial as string;
  console.log(`Device: ${serial} · round: ${rounds} · tap reale: ${wantTap ? "SÌ" : "no"}`);

  if (wantTap) {
    console.log(
      "\n⚠ ATTENZIONE: con --tap il round 'live' può eseguire UN tap reale sul device.\n" +
        "  I limiti in configurazione (max bid, max offerte) restano applicati.\n",
    );
  }

  const dump: number[] = [];
  const parse: number[] = [];
  const decide: number[] = [];
  const tap: number[] = [];
  const verify: number[] = [];

  for (let i = 1; i <= rounds; i++) {
    const mode = wantTap ? "live" : "evaluate";
    const r = await runRound(serial, mode);
    if (r.error) {
      console.log(`round ${i}: ERRORE — ${r.error}`);
      continue;
    }
    dump.push(r.timings.dumpMs);
    parse.push(r.timings.parseMs);
    decide.push(r.timings.decideMs);
    if (r.timings.tapMs !== null) tap.push(r.timings.tapMs);
    if (r.timings.verifyMs !== null) verify.push(r.timings.verifyMs);
    console.log(
      `round ${i}: dump ${r.timings.dumpMs}ms · parse ${r.timings.parseMs}ms · decide ${r.timings.decideMs}ms · ${r.decision} (${r.reason})`,
    );
  }

  console.log("\n═══ RISULTATI ═══");
  console.log(`dump:   ${fmt(stats(dump))}`);
  console.log(`parse:  ${fmt(stats(parse))}`);
  console.log(`decide: ${fmt(stats(decide))}`);
  if (wantTap) {
    console.log(`tap:    ${fmt(stats(tap))}`);
    console.log(`verify: ${fmt(stats(verify))}`);
  } else {
    console.log("tap/verify: non misurati (serve --tap, esegue tap reali)");
  }
}

void main();
