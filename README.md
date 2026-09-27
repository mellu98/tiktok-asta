# Android Device Control — POC (tiktok-asta)

Controllo di dispositivi **Android** da **macOS**: rilevamento automatico via USB,
mirroring dello schermo con **scrcpy**, screenshot, gestione app, input manuale e
log operativo — tutto in una dashboard locale dark.

> **V0**: 1 Samsung collegato via USB. L'architettura è già multi-device
> (vedi [Roadmap](#roadmap)).

---

# App macOS installabile (.dmg) — per i tester

**Non serve Terminale, npm, Homebrew né installare adb/scrcpy**: tutto è incluso.

1. Vai su [GitHub Releases](https://github.com/mellu98/tiktok-asta/releases) e
   scarica il .dmg giusto per il tuo Mac:
   - `aarch64` → Apple Silicon (M1/M2/M3/M4)
   - `x86_64` → Intel
2. Apri il .dmg e trascina **Android Device Control** in Applicazioni.
3. **Primo avvio (macOS 15+)**: se al doppio clic l'app viene bloccata, apri
   **Impostazioni di Sistema → Privacy e sicurezza**, scorri in basso e premi
   **«Apri comunque»** accanto al messaggio su Android Device Control
   (l'app è firmata ad-hoc, non notarizzata — avviso normale per app non sul
   Mac App Store). Serve una sola volta.
4. Collega il Samsung via USB: l'app mostra una **guida integrata passo-passo**
   per attivare Opzioni sviluppatore, Debug USB e autorizzare il computer.

Screenshot e log dell'app finiscono in `~/Library/Application Support/com.mellu98.android-device-control/`
e `~/Library/Logs/com.mellu98.android-device-control/`.

---

# Test rapido Samsung su Mac (sviluppatore, da terminale)

```bash
git clone https://github.com/mellu98/tiktok-asta.git
cd tiktok-asta
npm install
npm run setup     # prepara il Mac (Homebrew/Node/adb/scrcpy, chiede conferma)
npm run doctor    # verifica che tutto sia pronto
npm run dev       # avvia la dashboard → http://localhost:5174
```

Poi:

1. sul telefono: **Impostazioni → Informazioni sul telefono → Informazioni software →
   Numero build** → tocca **7 volte** (attiva le Opzioni sviluppatore);
2. **Impostazioni → Opzioni sviluppatore → Debug USB → ON**;
3. collega il Samsung al Mac con un cavo USB dati;
4. sul telefono tocca **«Consenti sempre da questo computer»** nella richiesta
   **«Consentire debug USB?»**;
5. verifica con `npm run doctor` (devi leggere **READY**);
6. apri la dashboard su <http://localhost:5174>;
7. premi **▶ Avvia mirroring** → si apre la finestra scrcpy.

Guida per tester passo-passo: [docs/TESTER-MACOS.md](docs/TESTER-MACOS.md)

---

## Cosa fa la V0

| Funzione | Come |
| --- | --- |
| Rilevamento automatico dispositivi USB | poll `adb devices -l` + diff di stato (1.5s) |
| Stati chiari | `ONLINE` / `IN ATTESA AUTH` / `OFFLINE` con istruzioni |
| Info dispositivo | produttore, modello, seriale, versione Android, SDK, stato ADB |
| Mirroring + controllo | finestra nativa **scrcpy** (dipendenza esterna, mai modificata) |
| Screenshot | `adb exec-out screencap -p` → salvato in `screenshots/` + anteprima |
| Elenco app | app di terze parti con ricerca |
| Apri app | lancio diretto dal browser sul telefono |
| Input manuale | tap, swipe, testo, HOME, BACK, ENTER |
| Log operativo | live in dashboard + `logs/activity.log` |
| Multi-device ready | ogni operazione è namespaced per seriale |

## Comandi

| Comando | Effetto |
| --- | --- |
| `npm run app:build` | build completa dell'app macOS (.app + .dmg) |
| `npm run app:fetch-tools` | scarica adb/scrcpy ufficiali + compila il sidecar server |
| `npm run setup` | guida interattiva all'installazione (macOS) |
| `npm run doctor` | diagnostica completa ambiente + telefono |
| `npm run dev` | server + dashboard in modalità sviluppo |
| `npm run build` | build di produzione della dashboard |
| `npm start` | server che serve la dashboard buildata (<http://localhost:5175>) |
| `npm test` | test unitari (parsing ADB, DeviceManager, input) |
| `npm run uninstall` | pulizia artefatti (+ opzionale scrcpy/adb) |

## Struttura

```text
tiktok-asta/
├── src/
│   ├── adb/           command layer ADB (client, devices, commands, screenshots, apps)
│   ├── scrcpy/        launcher scrcpy (spawn per seriale, tracciamento)
│   ├── devices/       DeviceManager (poll, diff stati, eventi — multi-device)
│   ├── server/        Express + WebSocket, REST API, log
│   └── shared/        tipi condivisi server↔dashboard
├── dashboard/         React + Vite (UI dark)
├── scripts/           setup-macos.sh · doctor.sh · uninstall.sh
├── tests/             test unitari (nessun telefono richiesto)
├── docs/              ARCHITECTURE · TESTER-MACOS · TROUBLESHOOTING
└── .github/workflows/ CI (typecheck, lint, test, build su macOS)
```

Dettagli e motivazioni: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## Sicurezza

- Server bindato solo su `127.0.0.1`: nessuna porta esposta su Internet.
- Nessuna credenziale nel repository (vedi `.env.example` per le variabili opzionali).
- Comandi adb eseguiti con `execFile` (no shell) + input sanitizzato.
- Il progetto è una piattaforma di **controllo e test Android** che include un
  percorso di **analisi UI e dry-run** per schermate di asta (riconoscimento
  del pulsante Offri con punteggio di confidenza, stima prezzo, limiti
  economici, arresto di emergenza): il dry-run è il default, i tap reali
  richiedono conferma esplicita e sono **non ancora validati su hardware
  reale**. Non implementa automazioni di offerte/transazioni automatiche
  end-to-end, bypass di controlli anti-abuse, spoofing o mascheramento di attività.

## Roadmap

- **V0** — 1 Samsung su Mac, funzioni sopra ✔ (questa versione)
- **V0.5** — dashboard migliorata (screenshot click-to-tap, stream single-device)
- **V1** — 4 dispositivi contemporanei (griglia dispositivi, accodamento comandi)
- **V1.5** — gruppi di dispositivi e azioni di gruppo
- **V2** — bridge opzionale Mac remoto → dashboard cloud
- **V3** — Android virtualizzato (ReDroid) accanto ai fisici

## Requisiti

- macOS (Apple Silicon o Intel), Node ≥ 20
- Homebrew (per `adb` e `scrcpy`, installati da fonti ufficiali)
- Android ≥ 5.0 con Debug USB (scrcpy richiede API 21+)

## Licenza

MIT — vedi [LICENSE](LICENSE).
