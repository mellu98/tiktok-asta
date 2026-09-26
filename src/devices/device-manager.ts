import { EventEmitter } from "node:events";
import { propsToInfo } from "../adb/devices";
import type { AndroidDevice, ParsedAdbDevice } from "../shared/types";
import type {
  AdbSource,
  AndroidDeviceRuntime,
  DeviceEventMap,
  LogLevel,
} from "./types";

/**
 * DeviceManager — cuore multi-device del POC.
 *
 * - Polling di `adb devices -l` (robusto e senza dipendenze: lo stream nativo
 *   `adb track-devices` è più fragile; 1.5s sono più che sufficienti per la V0).
 * - Diff dello snapshot precedente → eventi di connesso/scollegato/autorizzato.
 * - Le props (modello ecc.) vengono lette via getprop SOLO quando il device
 *   risulta autorizzato, e conservate in cache quando passa offline/unauthorized.
 * - Nessun seriale hardcoded: tutto passa per mappa per-serial.
 */

const POLL_INTERVAL_MS = 1500;

export class DeviceManager extends EventEmitter {
  private readonly devices = new Map<string, AndroidDeviceRuntime>();
  private timer: NodeJS.Timeout | null = null;
  private polling = false;
  private lastErrorMessage: string | null = null;

  constructor(
    private readonly adb: AdbSource,
    private readonly pollIntervalMs = POLL_INTERVAL_MS,
  ) {
    super();
  }

  override on<Event extends keyof DeviceEventMap>(
    event: Event,
    listener: DeviceEventMap[Event],
  ): this {
    return super.on(event, listener);
  }

  start(): void {
    if (this.timer) return;
    void this.poll();
    this.timer = setInterval(() => void this.poll(), this.pollIntervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Snapshot corrente per la UI. */
  list(): AndroidDevice[] {
    return [...this.devices.values()].map(toAndroidDevice);
  }

  private async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      const parsed = await this.adb.listDevices();
      this.lastErrorMessage = null;
      this.applyDiff(parsed, Date.now());
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message !== this.lastErrorMessage) {
        this.lastErrorMessage = message;
        this.emit("pollError", message);
      }
    } finally {
      this.polling = false;
    }
  }

  /** Puro e testabile: applica una lista `adb devices` allo stato interno. */
  applyDiff(parsed: ParsedAdbDevice[], now: number): void {
    const seen = new Set<string>();
    let changed = false;

    for (const row of parsed) {
      seen.add(row.serial);
      const prev = this.devices.get(row.serial);
      const authorized = row.state === "device";

      if (!prev) {
        // Nuovo dispositivo collegato
        const runtime: AndroidDeviceRuntime = {
          serial: row.serial,
          adbStatus: row.state,
          transportId: row.transportId,
          manufacturer: "",
          model: row.model ?? "",
          marketName: "",
          androidVersion: "",
          sdkVersion: "",
          connected: true,
          authorized,
          firstSeenAt: now,
          lastSeenAt: now,
        };
        this.devices.set(row.serial, runtime);
        changed = true;
        if (authorized) {
          this.emit(
            "log",
            "info",
            `Dispositivo connesso: ${describe(runtime)} (${row.serial})`,
          );
          void this.enrich(runtime);
        } else if (row.state === "unauthorized") {
          this.emit(
            "log",
            "warn",
            `Dispositivo rilevato ma NON autorizzato (${row.serial}) — controlla lo schermo del telefono`,
          );
        } else {
          this.emit(
            "log",
            "warn",
            `Dispositivo in stato ${row.state} (${row.serial})`,
          );
        }
        continue;
      }

      // Già noto: aggiorna stato/transport
      prev.lastSeenAt = now;
      prev.transportId = row.transportId;
      if (prev.adbStatus !== row.state) {
        changed = true;
        prev.adbStatus = row.state;
        prev.authorized = authorized;
        if (row.state === "device") {
          this.emit(
            "log",
            "success",
            `Autorizzazione ADB concessa: ${describe(prev)} (${row.serial})`,
          );
          void this.enrich(prev);
        } else if (row.state === "unauthorized") {
          this.emit(
            "log",
            "warn",
            `Autorizzazione ADB revocata / in attesa (${row.serial})`,
          );
        } else if (row.state === "offline") {
          this.emit("log", "error", `Dispositivo offline: ${row.serial}`);
        } else {
          this.emit(
            "log",
            "warn",
            `Dispositivo in stato ${row.state}: ${row.serial}`,
          );
        }
      }
    }

    // Dispositivi scomparsi
    for (const serial of this.devices.keys()) {
      if (!seen.has(serial)) {
        this.devices.delete(serial);
        changed = true;
        this.emit("log", "warn", `Dispositivo scollegato: ${serial}`);
      }
    }

    if (changed) {
      // Broadcast SOLO su cambiamenti reali: niente spam a ogni poll
      this.emit("change", this.list(), now);
    }
  }

  /** Legge le props via getprop e aggiorna il record (solo device autorizzati). */
  private async enrich(runtime: AndroidDeviceRuntime): Promise<void> {
    try {
      const props = await this.adb.getProps(runtime.serial);
      const info = propsToInfo(props);
      runtime.manufacturer = info.manufacturer;
      runtime.model = info.model || runtime.model;
      runtime.marketName = info.marketName;
      runtime.androidVersion = info.androidVersion;
      runtime.sdkVersion = info.sdkVersion;
      this.emit("change", this.list(), Date.now());
    } catch {
      // Props non leggibili (device appena collegato, schermo bloccato...): si riproverà
      // al prossimo cambio di stato. Il device resta comunque visibile.
    }
  }
}

function describe(d: AndroidDeviceRuntime): string {
  return d.marketName || d.model || "Dispositivo Android";
}

function toAndroidDevice(d: AndroidDeviceRuntime): AndroidDevice {
  return {
    id: d.serial,
    serial: d.serial,
    manufacturer: d.manufacturer,
    model: d.marketName || d.model || "Dispositivo Android",
    androidVersion: d.androidVersion,
    sdkVersion: d.sdkVersion,
    adbStatus: d.adbStatus,
    connected: d.connected,
    authorized: d.authorized,
    transportId: d.transportId,
    firstSeenAt: d.firstSeenAt,
    lastSeenAt: d.lastSeenAt,
  };
}

export function logLevelOk(level: LogLevel): boolean {
  return level === "info" || level === "success";
}
