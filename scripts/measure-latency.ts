/**
 * Misura delle latenze delle fasi dell'automazione su un device reale.
 *
 * Richiede: UN Samsung collegato e autorizzato (uiautomator). Senza device
 * lo script esce con un messaggio chiaro — nessuna stima viene stampata.
 *
 * Uso:
 *   npm run measure:latency                    → 5 round read-only
 *   npm run measure:latency --rounds 10
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

  const dump: number[] = [];
  const parse: number[] = [];
  const decide: number[] = [];

  for (let i = 1; i <= rounds; i++) {
    const r = await runRound(serial, "evaluate");
    if (r.error) {
      console.log(`round ${i}: ERRORE — ${r.error}`);
      continue;
    }
    if (!r.uiDumpAvailable) {
      console.log(
        `round ${i}: GERARCHIA UI NON DISPONIBILE su questa schermata (${r.reason})`,
      );
      continue;
    }
    dump.push(r.timings.dumpMs);
    parse.push(r.timings.parseMs);
    decide.push(r.timings.decideMs);
    console.log(
      `round ${i}: dump ${r.timings.dumpMs}ms · parse ${r.timings.parseMs}ms · decide ${r.timings.decideMs}ms · ${r.decision} (${r.reason})`,
    );
  }

  console.log("\n═══ RISULTATI ═══");
  console.log(`dump:   ${fmt(stats(dump))}`);
  console.log(`parse:  ${fmt(stats(parse))}`);
  console.log(`decide: ${fmt(stats(decide))}`);
  console.log(`tap:    n/a (read-only)`);
  console.log(`verify: n/a (read-only)`);
}

void main();
