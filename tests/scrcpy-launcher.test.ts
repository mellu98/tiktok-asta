import { describe, expect, it } from "vitest";
import {
  buildScrcpyArgs,
  buildScrcpyEnv,
  summarizeScrcpyFailure,
} from "../src/scrcpy/launcher";

describe("buildScrcpyArgs", () => {
  it("usa -s per selezionare il dispositivo e imposta il titolo finestra", () => {
    const args = buildScrcpyArgs("R58N30ABCD", "Galaxy S24 Ultra (R58N30ABCD)");
    expect(args).toEqual([
      "-s",
      "R58N30ABCD",
      "--window-title",
      "Galaxy S24 Ultra (R58N30ABCD)",
    ]);
  });

  it("non include mai opzioni pericolose o selettori multipli", () => {
    const args = buildScrcpyArgs("DEV-1", "Titolo");
    expect(args.join(" ")).not.toMatch(/--serial/);
    expect(args.filter((a) => a === "-s")).toHaveLength(1);
  });

  it("non passa mai --adb: scrcpy 4.1 non lo riconosce ed esce con codice 1", () => {
    const args = buildScrcpyArgs("R7AX711BSBV", "SM-A057G (R7AX711BSBV)");
    expect(args).not.toContain("--adb");
  });
});

describe("buildScrcpyEnv", () => {
  it("con adb bundled imposta la variabile ADB (il modo supportato da scrcpy)", () => {
    const env = buildScrcpyEnv({ PATH: "/usr/bin" }, "/Apps/tools/adb");
    expect(env.ADB).toBe("/Apps/tools/adb");
    expect(env.PATH).toBe("/usr/bin");
  });

  it("senza adb bundled lascia l'ambiente invariato (dev: adb dal PATH)", () => {
    const base = { PATH: "/usr/bin" };
    expect(buildScrcpyEnv(base, undefined)).toEqual(base);
  });

  it("non modifica l'oggetto ambiente ricevuto", () => {
    const base = { PATH: "/usr/bin" };
    buildScrcpyEnv(base, "/Apps/tools/adb");
    expect(base).toEqual({ PATH: "/usr/bin" });
  });
});

describe("summarizeScrcpyFailure", () => {
  it("riporta la riga d'errore reale invece di un codice muto", () => {
    const stderr =
      "scrcpy: unrecognized option `--adb'\nscrcpy 4.1 <https://github.com/Genymobile/scrcpy>\n";
    expect(summarizeScrcpyFailure(1, stderr)).toBe(
      "scrcpy terminato con codice 1: scrcpy: unrecognized option `--adb'",
    );
  });

  it("preferisce l'ultimo errore (quello fatale) agli avvisi iniziali", () => {
    const stderr = [
      "ERROR: Could not open icon image: /x/scrcpy.png",
      "INFO: ADB device found:",
      "ERROR: Server connection failed",
    ].join("\n");
    expect(summarizeScrcpyFailure(1, stderr)).toMatch(/Server connection failed$/);
  });

  it("stderr vuoto → solo il codice", () => {
    expect(summarizeScrcpyFailure(2, "")).toBe("scrcpy terminato con codice 2");
  });
});
