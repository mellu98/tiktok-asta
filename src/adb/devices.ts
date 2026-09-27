import type { AdbState, ParsedAdbDevice } from "../shared/types";
import { execAdbText } from "./client";

/**
 * Parsing e interrogazione della lista dispositivi.
 *
 * Formato `adb devices -l` (esempi reali):
 *
 *   List of devices attached
 *   R58N30ABCD	device usb:1-1 product:e3qx model:SM_S928B device:e3q transport_id:3
 *   R58N30ABCD	unauthorized usb:1-1 transport_id:4     <- nessun qualifier quando unauthorized!
 *   R58N30ABCD	offline usb:1-1 transport_id:5
 */

const VALID_STATES: readonly AdbState[] = [
  "device",
  "unauthorized",
  "offline",
  "recovery",
  "bootloader",
];

export function normalizeState(raw: string): AdbState {
  return (VALID_STATES as readonly string[]).includes(raw)
    ? (raw as AdbState)
    : "unknown";
}

export function parseAdbDevices(output: string): ParsedAdbDevice[] {
  const lines = output.split(/\r?\n/);
  const headerIdx = lines.findIndex((l) =>
    l.startsWith("List of devices attached"),
  );
  if (headerIdx === -1) return [];

  const devices: ParsedAdbDevice[] = [];
  for (const line of lines.slice(headerIdx + 1)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const parts = trimmed.split(/\s+/);
    const serial = parts[0];
    const state = normalizeState(parts[1] ?? "unknown");
    if (!serial || state === "unknown") continue;

    let model: string | null = null;
    let product: string | null = null;
    let transportId: string | null = null;
    for (const token of parts.slice(2)) {
      const sep = token.indexOf(":");
      if (sep === -1) continue;
      const key = token.slice(0, sep);
      const value = token.slice(sep + 1);
      if (key === "model") model = value;
      else if (key === "product") product = value;
      else if (key === "transport_id") transportId = value;
    }

    devices.push({ serial, state, model, product, transportId });
  }
  return devices;
}

export async function listDevices(): Promise<ParsedAdbDevice[]> {
  const output = await execAdbText(["devices", "-l"]);
  return parseAdbDevices(output);
}

export type DeviceProps = Record<string, string>;

/** Parsing dell'output completo di `adb shell getprop`: `[chiave]: [valore]`. */
export function parseGetprop(output: string): DeviceProps {
  const props: DeviceProps = {};
  for (const line of output.split(/\r?\n/)) {
    const match = /^\[(.+?)\]:\s*\[(.*)\]$/.exec(line.trim());
    if (match) {
      props[match[1] as string] = match[2] as string;
    }
  }
  return props;
}

export async function getProps(serial: string): Promise<DeviceProps> {
  const output = await execAdbText(["-s", serial, "shell", "getprop"]);
  return parseGetprop(output);
}

/** Fonte ADB reale usata dal DeviceManager (sostituibile nei test). */
export const adbSource = {
  listDevices,
  getProps,
};

/** Estrae i campi utili per la UI dalle props del dispositivo. */
export function propsToInfo(props: DeviceProps): {
  manufacturer: string;
  model: string;
  marketName: string;
  androidVersion: string;
  sdkVersion: string;
} {
  return {
    manufacturer: props["ro.product.manufacturer"] ?? "",
    model: props["ro.product.model"] ?? "",
    marketName: props["ro.product.marketname"] ?? "",
    androidVersion: props["ro.build.version.release"] ?? "",
    sdkVersion: props["ro.build.version.sdk"] ?? "",
  };
}
