import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/adb/client", () => ({
  execAdbText: vi.fn(),
  execAdbBinary: vi.fn(),
}));

import { execAdbBinary, execAdbText } from "../src/adb/client";
import {
  DEVICE_DUMPER_JAR,
  buildDumperShellCommand,
  dumpUiHierarchy,
  extractHierarchyXml,
} from "../src/adb/ui-dump";

const mockText = vi.mocked(execAdbText);
const mockBinary = vi.mocked(execAdbBinary);

const NO_IDLE_XML = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0" source="ui-dump-no-idle"><window index="0" type="1" layer="0" bounds="[0,0][1080,2400]"><node index="0" text="Offri" class="android.widget.Button" clickable="true" enabled="true" bounds="[700,2000][1000,2100]"/></window></hierarchy>`;
const UIAUTOMATOR_XML = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0"><node index="0" text="Home" bounds="[0,0][10,10]"/></hierarchy>`;

function fakeLocalJar(): string {
  const dir = mkdtempSync(join(tmpdir(), "ui-dumper-"));
  const jar = join(dir, "ui-dump.jar");
  writeFileSync(jar, "dex");
  return jar;
}

beforeEach(() => {
  mockText.mockReset();
  mockBinary.mockReset();
});

describe("extractHierarchyXml", () => {
  it("estrae l'XML anche se lo stdout ha righe di rumore prima e dopo", () => {
    const noisy = `WARNING: linker: qualcosa\n${NO_IDLE_XML}\nfine\n`;
    expect(extractHierarchyXml(noisy)).toBe(
      NO_IDLE_XML.slice(NO_IDLE_XML.indexOf("<hierarchy")),
    );
  });

  it("restituisce null se manca la gerarchia o non contiene nodi", () => {
    expect(extractHierarchyXml("UIDUMP-ERROR: java.lang.Boom")).toBeNull();
    expect(extractHierarchyXml("<hierarchy rotation=\"0\"></hierarchy>")).toBeNull();
  });
});

describe("buildDumperShellCommand", () => {
  it("è una costante: classpath di sistema + jar in /data/local/tmp, nessun input utente", () => {
    expect(buildDumperShellCommand()).toBe(
      `CLASSPATH=/system/framework/uiautomator.jar:${DEVICE_DUMPER_JAR} app_process /system/bin com.mellu98.uidump.UiDump`,
    );
  });
});

describe("dumpUiHierarchy", () => {
  it("con il jar disponibile usa il lettore senza idle e fa il push una sola volta per device", async () => {
    const jar = fakeLocalJar();
    mockText.mockResolvedValue("1 file pushed");
    mockBinary.mockResolvedValue(Buffer.from(NO_IDLE_XML, "utf8"));

    const first = await dumpUiHierarchy("SERIAL-A", jar);
    const second = await dumpUiHierarchy("SERIAL-A", jar);

    expect(first).toContain('text="Offri"');
    expect(second).toContain('source="ui-dump-no-idle"');
    const pushes = mockText.mock.calls.filter(([args]) => args.includes("push"));
    expect(pushes).toHaveLength(1);
    expect(pushes[0]?.[0]).toEqual(["-s", "SERIAL-A", "push", jar, DEVICE_DUMPER_JAR]);
    expect(mockBinary).toHaveBeenCalledWith(
      ["-s", "SERIAL-A", "exec-out", buildDumperShellCommand()],
      expect.objectContaining({ timeoutMs: expect.any(Number) }),
    );
  });

  it("se il lettore senza idle non restituisce nodi ripiega su uiautomator dump", async () => {
    const jar = fakeLocalJar();
    mockText.mockImplementation(async (args) =>
      args.includes("push")
        ? "1 file pushed"
        : "UI hierchary dumped to: /sdcard/window.xml",
    );
    mockBinary
      .mockResolvedValueOnce(Buffer.from("UIDUMP-ERROR: java.lang.NoSuchMethodError", "utf8"))
      .mockResolvedValueOnce(Buffer.from(UIAUTOMATOR_XML, "utf8"));

    const xml = await dumpUiHierarchy("SERIAL-B", jar);

    expect(xml).toBe(UIAUTOMATOR_XML);
    expect(mockText).toHaveBeenCalledWith(
      ["-s", "SERIAL-B", "shell", "uiautomator", "dump", "/sdcard/window.xml"],
      expect.objectContaining({ includeStderr: true }),
    );
  });

  it("senza jar configurato va diretto a uiautomator dump (comportamento precedente)", async () => {
    mockText.mockResolvedValue("UI hierchary dumped to: /sdcard/window.xml");
    mockBinary.mockResolvedValue(Buffer.from(UIAUTOMATOR_XML, "utf8"));

    const xml = await dumpUiHierarchy("SERIAL-C", "");

    expect(xml).toBe(UIAUTOMATOR_XML);
    expect(mockText.mock.calls.some(([args]) => args.includes("push"))).toBe(false);
  });

  it("riconosce 'could not get idle state' (arriva su stderr) e riporta entrambe le cause", async () => {
    const jar = fakeLocalJar();
    mockText.mockImplementation(async (args) =>
      args.includes("push") ? "1 file pushed" : "ERROR: could not get idle state.\n",
    );
    mockBinary.mockResolvedValue(Buffer.from("UIDUMP-ERROR: boom", "utf8"));

    await expect(dumpUiHierarchy("SERIAL-D", jar)).rejects.toThrow(
      /could not get idle state[\s\S]*lettore senza idle[\s\S]*UIDUMP-ERROR: boom/,
    );
  });
});
