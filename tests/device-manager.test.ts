import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeviceManager } from "../src/devices/device-manager";
import type { AdbSource, LogLevel } from "../src/devices/types";
import type { AndroidDevice, ParsedAdbDevice } from "../src/shared/types";

/** Fake della fonte ADB: nessun binario reale, risposta controllata dai test. */
class FakeAdb implements AdbSource {
  rows: ParsedAdbDevice[] = [];
  props: Record<string, string> = {};
  propsCalls: string[] = [];

  async listDevices(): Promise<ParsedAdbDevice[]> {
    return this.rows;
  }

  async getProps(serial: string): Promise<Record<string, string>> {
    this.propsCalls.push(serial);
    return this.props;
  }
}

const SAMSUNG_PROPS = {
  "ro.product.manufacturer": "samsung",
  "ro.product.model": "SM-S928B",
  "ro.product.marketname": "Galaxy S24 Ultra",
  "ro.build.version.release": "14",
  "ro.build.version.sdk": "34",
};

function row(serial: string, state: ParsedAdbDevice["state"]): ParsedAdbDevice {
  return {
    serial,
    state,
    model: null,
    product: null,
    transportId: `${serial}-t`,
  };
}

describe("DeviceManager", () => {
  let adb: FakeAdb;
  let manager: DeviceManager;
  let logs: { level: LogLevel; message: string }[];

  beforeEach(() => {
    vi.useFakeTimers();
    adb = new FakeAdb();
    adb.props = SAMSUNG_PROPS;
    manager = new DeviceManager(adb, 1000);
    logs = [];
    manager.on("log", (level, message) => logs.push({ level, message }));
    manager.start();
  });

  afterEach(() => {
    manager.stop();
    vi.useRealTimers();
  });

  async function tick(times = 1) {
    for (let i = 0; i < times; i++) {
      await vi.advanceTimersByTimeAsync(1000);
    }
  }

  it("al primo poll registra la connessione del dispositivo", async () => {
    adb.rows = [row("SERIAL1", "device")];
    await tick();

    const devices = manager.list();
    expect(devices).toHaveLength(1);
    expect(devices[0]).toMatchObject({
      serial: "SERIAL1",
      connected: true,
      authorized: true,
      adbStatus: "device",
      model: "Galaxy S24 Ultra", // marketname ha priorità
      manufacturer: "samsung",
      androidVersion: "14",
    });
    expect(logs.some((l) => l.message.includes("Dispositivo connesso"))).toBe(
      true,
    );
    expect(adb.propsCalls).toContain("SERIAL1");
  });

  it("device unauthorized: nessuna getprop, messaggio con istruzioni", async () => {
    adb.rows = [row("SERIAL1", "unauthorized")];
    await tick();

    expect(manager.list()[0]?.authorized).toBe(false);
    expect(adb.propsCalls).toHaveLength(0);
    expect(
      logs.some(
        (l) => l.level === "warn" && l.message.includes("NON autorizzato"),
      ),
    ).toBe(true);
  });

  it("traccia la transizione unauthorized → device (autorizzazione RSA)", async () => {
    adb.rows = [row("SERIAL1", "unauthorized")];
    await tick();

    adb.rows = [row("SERIAL1", "device")];
    await tick();

    expect(
      logs.some(
        (l) =>
          l.level === "success" &&
          l.message.includes("Autorizzazione ADB concessa"),
      ),
    ).toBe(true);
    expect(adb.propsCalls).toContain("SERIAL1");
    expect(manager.list()[0]?.authorized).toBe(true);
  });

  it("traccia lo scollegamento e riparte da zero al ricollegamento", async () => {
    adb.rows = [row("SERIAL1", "device")];
    await tick();
    expect(manager.list()).toHaveLength(1);

    adb.rows = [];
    await tick();
    expect(manager.list()).toHaveLength(0);
    expect(logs.some((l) => l.message.includes("Dispositivo scollegato"))).toBe(
      true,
    );

    adb.rows = [row("SERIAL1", "device")];
    await tick();
    expect(manager.list()).toHaveLength(1);
    // firstSeenAt aggiornato: nuovo "connected"
    expect(
      logs.filter((l) => l.message.includes("Dispositivo connesso")),
    ).toHaveLength(2);
  });

  it("gestisce dispositivi offline conservando i dati noti", async () => {
    adb.rows = [row("SERIAL1", "device")];
    await tick();
    const knownModel = manager.list()[0]?.model;

    adb.rows = [row("SERIAL1", "offline")];
    await tick();

    const d = manager.list()[0];
    expect(d?.adbStatus).toBe("offline");
    expect(d?.authorized).toBe(false);
    expect(d?.connected).toBe(true);
    expect(d?.model).toBe(knownModel); // cache preservata
    expect(logs.some((l) => l.message.includes("Dispositivo offline"))).toBe(
      true,
    );
  });

  it("supporta più dispositivi in parallelo (multi-device)", async () => {
    adb.rows = [
      row("DEV-A", "device"),
      row("DEV-B", "device"),
      row("DEV-C", "unauthorized"),
    ];
    await tick();

    const devices = manager.list();
    expect(devices).toHaveLength(3);
    expect(new Set(devices.map((d) => d.serial))).toEqual(
      new Set(["DEV-A", "DEV-B", "DEV-C"]),
    );
    expect(devices.filter((d) => d.authorized)).toHaveLength(2);
  });

  it("emette change solo quando qualcosa cambia (o al primo poll)", async () => {
    let changes = 0;
    manager.on("change", () => changes++);

    adb.rows = [row("SERIAL1", "device")];
    await tick();
    const afterFirst = changes;
    expect(afterFirst).toBeGreaterThan(0);

    await tick(3); // nessun cambiamento
    expect(changes).toBe(afterFirst);

    adb.rows = [row("SERIAL1", "device"), row("SERIAL2", "device")];
    await tick();
    expect(changes).toBe(afterFirst + 2); // nuovo device + enrich props
  });

  it("riporta errori adb senza fermare il polling", async () => {
    const errors: string[] = [];
    manager.on("pollError", (message) => errors.push(message));
    adb.listDevices = async () => {
      throw new Error("adb non trovato");
    };

    await tick();
    expect(errors).toHaveLength(1);

    // Ripristina: il polling continua
    Object.defineProperty(adb, "listDevices", {
      value: async () => [row("SERIAL1", "device")],
    });
    await tick();
    expect(manager.list()).toHaveLength(1);
  });
});

describe("snapshot conforme al modello condiviso AndroidDevice", () => {
  it("id == serial e tutti i campi del modello presentes", async () => {
    vi.useFakeTimers();
    const adb2 = new FakeAdb();
    adb2.props = SAMSUNG_PROPS;
    const mgr = new DeviceManager(adb2, 1000);
    adb2.rows = [row("XYZ", "device")];
    mgr.on("log", () => {});
    mgr.start();
    await vi.advanceTimersByTimeAsync(1000);

    const snapshot: AndroidDevice[] = mgr.list();
    const d = snapshot[0];
    expect(d).toBeDefined();
    expect(d?.id).toBe("XYZ");
    expect(d?.serial).toBe("XYZ");
    for (const key of [
      "id",
      "serial",
      "manufacturer",
      "model",
      "androidVersion",
      "sdkVersion",
      "adbStatus",
      "connected",
      "authorized",
      "transportId",
      "firstSeenAt",
      "lastSeenAt",
    ] as const) {
      expect(d).toHaveProperty(key);
    }
    mgr.stop();
    vi.useRealTimers();
  });
});
