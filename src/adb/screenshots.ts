import { execAdbBinary } from './client'

/**
 * Screenshot via `adb exec-out screencap -p`.
 * exec-out (non shell) → stream binario pulito, nessun problema di conversioni CRLF.
 */
export async function takeScreenshot(serial: string): Promise<Buffer> {
  const png = await execAdbBinary(['-s', serial, 'exec-out', 'screencap', '-p'])
  if (png.length < 8 || png.subarray(1, 4).toString('ascii') !== 'PNG') {
    throw new Error('Lo screenshot ricevuto non è un PNG valido')
  }
  return png
}
