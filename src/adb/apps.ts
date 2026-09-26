import { execAdbText } from "./client";

/**
 * Gestione app di terze parti installate sul dispositivo.
 * - lista: `pm list packages -3`
 * - lancio: `monkey -p <pkg> -c android.intent.category.LAUNCHER 1`
 *   (non richiede di conoscere il nome dell'activity principale)
 */

const PACKAGE_NAME_RE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;

export function assertValidPackage(pkg: string): void {
  if (!PACKAGE_NAME_RE.test(pkg) || pkg.length > 200) {
    throw new Error(`Nome package non valido: ${pkg}`);
  }
}

/** Estrae i nomi package dall'output di `pm list packages`: righe "package:com.x.y". */
export function parsePackageList(output: string): string[] {
  const pkgs: string[] = [];
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("package:")) {
      const name = trimmed.slice("package:".length).trim();
      if (name) pkgs.push(name);
    }
  }
  return pkgs.sort((a, b) => a.localeCompare(b));
}

export async function listInstalledApps(serial: string): Promise<string[]> {
  const output = await execAdbText(
    ["-s", serial, "shell", "pm", "list", "packages", "-3"],
    {
      timeoutMs: 15000,
    },
  );
  return parsePackageList(output);
}

/** Verifica dall'output di monkey se l'app è stata effettivamente lanciata. */
export function monkeyLaunchSucceeded(output: string): boolean {
  return output.includes("Events injected: 1");
}

export async function launchApp(serial: string, pkg: string): Promise<void> {
  assertValidPackage(pkg);
  const output = await execAdbText(
    [
      "-s",
      serial,
      "shell",
      "monkey",
      "-p",
      pkg,
      "-c",
      "android.intent.category.LAUNCHER",
      "1",
    ],
    { timeoutMs: 15000 },
  );
  if (!monkeyLaunchSucceeded(output)) {
    throw new Error(
      `Impossibile lanciare ${pkg}: nessuna activity lanciabile trovata`,
    );
  }
}
