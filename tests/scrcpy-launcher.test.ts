import { describe, expect, it } from "vitest";
import {
  buildScrcpyArgs,
  buildScrcpyEnv,
  lastStderrLine,
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

  it("non passa mai --adb: scrcpy 4.1 non lo conosce ed esce con codice 1", () => {
    const args = buildScrcpyArgs("DEV-1", "Titolo");
    expect(args).not.toContain("--adb");
  });
});

describe("buildScrcpyEnv", () => {
  it("indica ad scrcpy l'adb incluso nell'app tramite la variabile ADB", () => {
    const env = buildScrcpyEnv({ PATH: "/usr/bin" }, "/App/tools/adb");
    expect(env).toEqual({ PATH: "/usr/bin", ADB: "/App/tools/adb" });
  });

  it("senza adb dedicato lascia l'ambiente invariato (dev: adb dal PATH)", () => {
    const base = { PATH: "/usr/bin" };
    expect(buildScrcpyEnv(base, undefined)).toEqual(base);
  });

  it("non modifica l'ambiente originale", () => {
    const base = { PATH: "/usr/bin" };
    buildScrcpyEnv(base, "/App/tools/adb");
    expect(base).toEqual({ PATH: "/usr/bin" });
  });
});

describe("lastStderrLine", () => {
  it("restituisce l'ultima riga non vuota (il motivo dell'uscita di scrcpy)", () => {
    const stderr =
      "scrcpy 4.1 <https://github.com/Genymobile/scrcpy>\nERROR: Could not find any ADB device\n\n";
    expect(lastStderrLine(stderr)).toBe("ERROR: Could not find any ADB device");
  });

  it("restituisce stringa vuota se scrcpy non ha scritto nulla", () => {
    expect(lastStderrLine("")).toBe("");
  });
});
