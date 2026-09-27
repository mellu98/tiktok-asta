import { existsSync } from "node:fs";
import { execAdbBinary, execAdbText } from "./client";

/**
 * Lettura della gerarchia UI del telefono (XML formato uiautomator).
 *
 * 1. Lettore SENZA idle (android-helper/UiDump, jar dex lanciato con app_process):
 *    `uiautomator dump` aspetta 1 s di quiete e nella live TikTok con asta
 *    (conto alla rovescia, commenti) non la trova mai → "could not get idle state".
 * 2. Ripiego su `uiautomator dump` se il jar non c'è o il lettore fallisce.
 *
 * Tutti i comandi passano dal client ADB esistente (execFile, args array);
 * il comando lanciato sul device è una costante, senza input utente.
 */

/** Jar locale: nell'app Tauri arriva da POC_UI_DUMPER_JAR (risorse tools/). */
export const UI_DUMPER_JAR = process.env.POC_UI_DUMPER_JAR ?? "";
export const DEVICE_DUMPER_JAR = "/data/local/tmp/ada-ui-dump.jar";

const SYSTEM_UIAUTOMATOR_JAR = "/system/framework/uiautomator.jar";
const DUMPER_MAIN_CLASS = "com.mellu98.uidump.UiDump";
const DUMPER_TIMEOUT_MS = 15000;
const PUSH_TIMEOUT_MS = 15000;

const DUMP_PATH = "/sdcard/window.xml";
const DUMP_TIMEOUT_MS = 20000; // uiautomator può metterci parecchi secondi
const DUMP_RETRY_DELAY_MS = 1500;

const HIERARCHY_OPEN = "<hierarchy";
const HIERARCHY_CLOSE = "</hierarchy>";

/** Seriali su cui il jar è già stato copiato in questa sessione del server. */
const dumperPushedTo = new Set<string>();

export function buildDumperShellCommand(): string {
  return `CLASSPATH=${SYSTEM_UIAUTOMATOR_JAR}:${DEVICE_DUMPER_JAR} app_process /system/bin ${DUMPER_MAIN_CLASS}`;
}

/** Isola l'XML dallo stdout (può contenere righe di log del linker ecc.). */
export function extractHierarchyXml(output: string): string | null {
  const start = output.indexOf(HIERARCHY_OPEN);
  const end = output.lastIndexOf(HIERARCHY_CLOSE);
  if (start < 0 || end < start) return null;
  const xml = output.slice(start, end + HIERARCHY_CLOSE.length);
  return xml.includes("<node") ? xml : null;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureDumperOnDevice(
  serial: string,
  localJar: string,
): Promise<void> {
  if (dumperPushedTo.has(serial)) return;
  await execAdbText(["-s", serial, "push", localJar, DEVICE_DUMPER_JAR], {
    timeoutMs: PUSH_TIMEOUT_MS,
  });
  dumperPushedTo.add(serial);
}

async function dumpWithoutIdle(
  serial: string,
  localJar: string,
): Promise<string> {
  await ensureDumperOnDevice(serial, localJar);
  const out = await execAdbBinary(
    ["-s", serial, "exec-out", buildDumperShellCommand()],
    { timeoutMs: DUMPER_TIMEOUT_MS },
  );
  const text = out.toString("utf8");
  const xml = extractHierarchyXml(text);
  if (xml) return xml;
  // Jar cancellato o corrotto sul device: al prossimo giro si ricopia
  dumperPushedTo.delete(serial);
  throw new Error(
    `nessun nodo letto. Dettaglio: ${text.trim().slice(0, 200) || "(output vuoto)"}`,
  );
}

/** `uiautomator dump` + lettura XML. Un solo retry se la UI non è idle. */
async function dumpWithUiautomator(serial: string): Promise<string> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    // L'errore "could not get idle state" arriva su stderr: va letto anche quello
    const out = await execAdbText(
      ["-s", serial, "shell", "uiautomator", "dump", DUMP_PATH],
      { timeoutMs: DUMP_TIMEOUT_MS, includeStderr: true },
    );
    // Nota: il messaggio di successo di Android contiene il typo "hierchary"
    if (/dumped to/i.test(out)) {
      const xml = await execAdbBinary(
        ["-s", serial, "exec-out", "cat", DUMP_PATH],
        { timeoutMs: DUMP_TIMEOUT_MS },
      );
      const text = xml.toString("utf8");
      if (text.includes("<node")) return text;
      lastError = new Error(
        "L'XML letto dal dispositivo non contiene nodi UI — riprova a schermo acceso e stabile",
      );
    } else if (/ERROR/i.test(out)) {
      // Tipico: "ERROR: could not get idle state." (UI in transizione continua)
      lastError = new Error(
        `uiautomator non riesce a leggere la UI (schermata in movimento o non idle). Dettaglio: ${out.trim().slice(0, 200)}`,
      );
    } else {
      lastError = new Error(
        `uiautomator dump: risposta inattesa: ${out.trim().slice(0, 200)}`,
      );
    }
    await sleep(DUMP_RETRY_DELAY_MS);
  }
  throw lastError ?? new Error("uiautomator dump non riuscito");
}

/** Legge l'albero UI: prima senza idle (se il jar c'è), poi uiautomator. */
export async function dumpUiHierarchy(
  serial: string,
  localJar: string = UI_DUMPER_JAR,
): Promise<string> {
  if (!localJar || !existsSync(localJar)) {
    return dumpWithUiautomator(serial);
  }

  let noIdleError: string;
  try {
    return await dumpWithoutIdle(serial, localJar);
  } catch (err) {
    noIdleError = errorMessage(err);
  }

  try {
    return await dumpWithUiautomator(serial);
  } catch (err) {
    throw new Error(
      `${errorMessage(err)} — e il lettore senza idle ha fallito: ${noIdleError}`,
    );
  }
}
