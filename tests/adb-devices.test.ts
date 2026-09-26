import { describe, expect, it } from 'vitest'
import { normalizeState, parseAdbDevices, parseGetprop, propsToInfo } from '../src/adb/devices'

const SAMPLE_SAMSUNG = `* daemon not running; starting now at tcp:5037
List of devices attached
R58N30ABCD	device usb:1-1 product:e3qxxx model:SM_S928B device:e3q transport_id:3
`

const SAMPLE_UNAUTHORIZED = `List of devices attached
R58N30ABCD	unauthorized usb:1-1 transport_id:4
`

const SAMPLE_OFFLINE = `List of devices attached
R58N30ABCD	offline usb:1-1 transport_id:5
`

const SAMPLE_MULTI = `List of devices attached
R58N30ABCD	device usb:1-1 product:e3qxxx model:SM_S928B device:e3q transport_id:3
R1TT30WXYZ	unauthorized usb:2-1 transport_id:7
emulator-5554	device product:sdk_gphone64_arm64 model:sdk_gphone64_arm64 device:emu64xa transport_id:1
`

const SAMPLE_EMPTY = `List of devices attached

`

describe('parseAdbDevices', () => {
  it('estrae un Samsung autorizzato con i qualifier', () => {
    const devices = parseAdbDevices(SAMPLE_SAMSUNG)
    expect(devices).toHaveLength(1)
    expect(devices[0]).toMatchObject({
      serial: 'R58N30ABCD',
      state: 'device',
      model: 'SM_S928B',
      transportId: '3',
    })
  })

  it('gestisce unauthorized SENZA qualifier model/product', () => {
    const devices = parseAdbDevices(SAMPLE_UNAUTHORIZED)
    expect(devices).toHaveLength(1)
    expect(devices[0]?.state).toBe('unauthorized')
    expect(devices[0]?.model).toBeNull()
  })

  it('gestisce offline', () => {
    const devices = parseAdbDevices(SAMPLE_OFFLINE)
    expect(devices[0]?.state).toBe('offline')
  })

  it('gestisce più dispositivi contemporanei', () => {
    const devices = parseAdbDevices(SAMPLE_MULTI)
    expect(devices).toHaveLength(3)
    expect(devices.map((d) => d.state)).toEqual(['device', 'unauthorized', 'device'])
    expect(devices.map((d) => d.serial)).toEqual([
      'R58N30ABCD',
      'R1TT30WXYZ',
      'emulator-5554',
    ])
  })

  it('restituisce lista vuota se nessun device', () => {
    expect(parseAdbDevices(SAMPLE_EMPTY)).toEqual([])
  })

  it('restituisce lista vuota se output non riconosciuto', () => {
    expect(parseAdbDevices('error: device not found')).toEqual([])
  })
})

describe('normalizeState', () => {
  it('accetta gli stati noti', () => {
    expect(normalizeState('device')).toBe('device')
    expect(normalizeState('unauthorized')).toBe('unauthorized')
    expect(normalizeState('offline')).toBe('offline')
    expect(normalizeState('recovery')).toBe('recovery')
  })

  it('degrada a unknown per stati inattesi', () => {
    expect(normalizeState('sideload')).toBe('unknown')
    expect(normalizeState('')).toBe('unknown')
  })
})

describe('parseGetprop', () => {
  it('parsa il formato [chiave]: [valore]', () => {
    const props = parseGetprop(
      `[ro.product.manufacturer]: [samsung]
[ro.product.model]: [SM-S928B]
[ro.product.marketname]: [Galaxy S24 Ultra]
[ro.build.version.release]: [14]
[ro.build.version.sdk]: [34]
riga senza parentesi ignorata`,
    )
    expect(props['ro.product.model']).toBe('SM-S928B')
    expect(props['ro.product.marketname']).toBe('Galaxy S24 Ultra')
    expect(props['ro.build.version.sdk']).toBe('34')
    expect(props['ro.product.manufacturer']).toBe('samsung')
  })

  it('gestisce valori vuoti', () => {
    const props = parseGetprop('[ro.some.prop]: []')
    expect(props['ro.some.prop']).toBe('')
  })
})

describe('propsToInfo', () => {
  it('estrae i campi per la UI', () => {
    const info = propsToInfo({
      'ro.product.manufacturer': 'samsung',
      'ro.product.model': 'SM-A536B',
      'ro.product.marketname': 'Galaxy A53 5G',
      'ro.build.version.release': '14',
      'ro.build.version.sdk': '34',
    })
    expect(info).toEqual({
      manufacturer: 'samsung',
      model: 'SM-A536B',
      marketName: 'Galaxy A53 5G',
      androidVersion: '14',
      sdkVersion: '34',
    })
  })

  it('restituisce stringhe vuote per props mancanti (device unauthorized)', () => {
    const info = propsToInfo({})
    expect(info.model).toBe('')
    expect(info.androidVersion).toBe('')
  })
})
