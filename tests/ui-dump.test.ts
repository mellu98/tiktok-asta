import { beforeEach, describe, expect, it, vi } from "vitest";

// adb simulato: si verifica SOLO la politica di dump/retry, nessun device.
const execAdbText = vi.fn<(args: string[], opts?: { timeoutMs?: number }) => Promise<string>>();
vi.mock("../src/adb/client", () => ({
  execAdbText: (args: string[], opts?: { timeoutMs?: number }) => execAdbText(args, opts),
}));

const { dumpUiHierarchy } = await import("../src/adb/auction");

const XML = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0"><node index="0" text="" bounds="[0,0][1080,2400]" /></hierarchy>`;

beforeEach(() => {
  execAdbText.mockReset();
});

describe("dumpUiHierarchy — politica di retry", () => {
  it("dump riuscito → XML, una sola chiamata adb", async () => {
    execAdbText.mockResolvedValue(`UI hierchary dumped to: /sdcard/adc_ui_1.xml\n${XML}`);
    await expect(dumpUiHierarchy("R7AX711BSBV")).resolves.toBe(XML);
    expect(execAdbText).toHaveBeenCalledTimes(1);
  });

  it("LIVE (idle mai raggiunto) → errore subito, nessun retry inutile da ~12 s", async () => {
    execAdbText.mockResolvedValue("ERROR: could not get idle state.\n");
    await expect(dumpUiHierarchy("R7AX711BSBV")).rejects.toThrow(/non si ferma mai/);
    expect(execAdbText).toHaveBeenCalledTimes(1);
  });

  it("risposta vuota → un retry, poi errore", async () => {
    execAdbText.mockResolvedValue("");
    await expect(dumpUiHierarchy("R7AX711BSBV")).rejects.toThrow(/risposta inattesa/);
    expect(execAdbText).toHaveBeenCalledTimes(2);
  });
});
