import type { ParsedAdbDevice } from '../shared/types'
import type { AndroidDevice } from '../shared/types'
import type { DeviceProps } from '../adb/devices'

/**
 * Contratto della fonte ADB: il DeviceManager dipende SOLO da questa interfaccia,
 * quindi nei test usiamo un fake senza adb reale.
 */
export interface AdbSource {
  listDevices(): Promise<ParsedAdbDevice[]>
  getProps(serial: string): Promise<DeviceProps>
}

export type DeviceEventMap = {
  /** Eseguito ad ogni poll quando lo snapshot cambia (o al primo poll). */
  change: (devices: AndroidDevice[], updatedAt: number) => void
  /** Voce di log generata dai cambiamenti di stato. */
  log: (level: LogLevel, message: string) => void
  /** Errore del poll (es. adb assente). */
  pollError: (message: string) => void
}

export type LogLevel = 'info' | 'success' | 'warn' | 'error'

export interface AndroidDeviceRuntime {
  serial: string
  adbStatus: ParsedAdbDevice['state']
  transportId: string | null
  manufacturer: string
  model: string
  marketName: string
  androidVersion: string
  sdkVersion: string
  connected: boolean
  authorized: boolean
  firstSeenAt: number
  lastSeenAt: number
}
