import { describe, expect, it } from "vitest";
import { buildScrcpyArgs } from "../src/scrcpy/launcher";

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
});
