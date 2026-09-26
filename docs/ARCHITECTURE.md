# Architettura

## Panoramica

```text
┌────────────────────────────────────────────────────────────────┐
│ Dashboard React (Vite)                  http://localhost:5174  │
│  UI dark, zero librerie UI pesanti                             │
└──────────────┬─────────────────────────────┬───────────────────┘
        REST /api/*            WebSocket /ws (eventi live)
┌──────────────▼─────────────────────────────▼───────────────────┐
│ Server Node (Express + ws)              http://127.0.0.1:5175  │
│  src/server/routes.ts   → endpoint REST validati               │
│  src/server/ws.ts       → broadcast snapshot/log/scrcpy        │
│  src/server/logging.ts  → LogBuffer (memoria + logs/activity.log)│
├────────────────────────────────────────────────────────────────┤
│ DeviceManager (src/devices/device-manager.ts)                  │
│  · poll `adb devices -l` ogni 1.5s                             │
│  · diff stati → eventi (connesso/scollegato/autorizzato/…)     │
│  · Map<serial, Runtime> → niente seriali hardcodati            │
├────────────────────────────────────────────────────────────────┤
│ Command layer                                                  │
│  src/adb/client.ts       execFile('adb'), timeout, maxBuffer   │
│  src/adb/devices.ts      parsing devices -l + getprop          │
│  src/adb/commands.ts     tap / swipe / text / keyevent         │
│  src/adb/screenshots.ts  exec-out screencap -p                 │
│  src/adb/apps.ts         pm list packages, monkey launch       │
│  src/scrcpy/launcher.ts  spawn scrcpy -s SERIAL, tracciamento  │
└──────┬──────────────────────────────┬──────────────────────────┘
       │                              │
       ▼                              ▼
   adb (Homebrew)                scrcpy (Homebrew)
       │                              │
       └────────── USB ───────────────┴────► Samsung Android
```

## Scelte progettuali

### Perché un server Node locale (e non solo scrcpy)

- La dashboard deve **ragionare** sui dispositivi (stati, log, app, input): serve un processo
  che interroghi adb e pubblichi lo stato.
- scrcpy resta **tool esterno non toccato**: apriamo le sue finestre native SDL
  (`spawn scrcpy -s SERIAL`), che sono già performanti (decodifica hardware).

### Perché polling e non `adb track-devices`

Lo stream nativo `adb track-devices` è leggermente più "live" ma fragile (connessioni
mezze-chiuse, parsing di stream incrementale). Il polling ogni 1.5s di `adb devices -l`
è banale, robusto, e con il diff produce gli stessi eventi percepibili dall'utente.
Per una dashboard di controllo umano, 1.5s di latenza sono irrilevanti.

### Perché REST + WebSocket

- REST per i comandi (azione → risposta): semplice da testare, errori HTTP chiari.
- WebSocket per gli eventi (stato dispositivi, log, esiti scrcpy): la UI si aggiorna
  da sola quando colleghi/scolleghi/autorizzi il telefono, senza refresh.
- Il WS è broadcast-only (server→client): niente comandi via WS, superficie ridotta.

### Multi-device by design

- `DeviceManager` mantiene una `Map<serial, Runtime>`; ogni endpoint REST è
  namespaced per `:serial`. Nessun codice presume un solo dispositivo.
- La UI mostra una card per dispositivo e seleziona quello attivo.
- V1 (4+ dispositivi) richiederà UI (tab/griglia) e accodamento input, non refactoring.

### Sicurezza

- Server bindato su **127.0.0.1**: nessuna interfaccia di rete esterna.
- `execFile` senza shell: nessuna injection da input UI.
- Input testo verso il device: whitelist caratteri + `%s` per gli spazi.
- Package app validati con regex prima di `monkey -p`.
- Nessuna credenziale, nessuna porta ADB esposta (niente `adb tcpip`).

## Struttura monorepo (semplificata)

Il requisito originale prevedeva `apps/` + `packages/` (pnpm workspace). Per la V0
abbiamo scelto un **single package** con confini di cartella netti (`src/adb`,
`src/devices`, `src/scrcpy`, `src/server`, `src/shared`): stessa separazione logica,
zero complessità di tooling per il tester. La separazione in workspace pnpm è
meccanica quando servirá (i confini di import sono già puliti).

## Limiti noti V0

- Input manuale con coordinate: nessuna sovrapposizione click-on-screenshot.
- Lista app per nome package (etichette leggibili richiederebbero `aapt` on-device).
- `npm start` (build servita dal server) usa tsx: per la V0 è accettabile in locale.
