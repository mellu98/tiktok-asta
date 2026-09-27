# Troubleshooting

## Il telefono non compare in dashboard / `adb devices` è vuoto

1. **Cavo**: prova una porta USB diversa e un cavo diverso. Molti cavi sono
   solo-di-carica: servono cavi **dati**.
2. **Modalità USB del telefono**: collega il telefono, apri la notifica
   «Ricarica USB tramite cavo» e scegli **Trasferimento file / MTP**.
3. **Debug USB** attivo? Impostazioni → Opzioni sviluppatore → Debug USB.
4. Riavvia il server ADB: pulsante **⟳ Riavvia ADB** in dashboard, oppure:

   ```bash
   adb kill-server && adb start-server && adb devices
   ```

5. Su macOS controlla che non compaia un prompt di permessi USB (raro).

## «unauthorized» / il telefono chiede di nuovo l'autorizzazione

1. Sblocca lo **schermo del telefono**.
2. Cerca la notifica **«Consentire debug USB?»** e tocca
   **«Consenti sempre da questo computer»** → **Consenti**.
3. Se la richiesta non c'è: Opzioni sviluppatore → **Revoca autorizzazioni
   debug USB**, poi scollega/ricollega il cavo.
4. Se persiste: `adb kill-server && adb start-server` e ricollega.

## «offline»

- Scollega e ricollega il cavo.
- Riavvia il server ADB (pulsante in dashboard o comando qui sopra).
- Su alcuni Samsung: disattiva e riattiva il Debug USB.

## «adb: no devices/emulators found» quando lanci un comando

Il dispositivo non è visibile ad adb: vedi primo punto di questa guida.

## «adb server version doesn't match; killing…»

Hai due versioni di adb in conflitto (es. Android Studio + Homebrew). Esegui:

```bash
which -a adb
```

Se ne vedi più di una, disinstalla quella extra o assicurati che il PATH metta
prima `/opt/homebrew/bin/adb`. Poi `adb kill-server && adb devices`.

## scrcpy: finestra nera / schermo spento

- Sblocca il telefono (scrcpy può specchiare anche a schermo spento: tocca
  la finestra per riaccendere).
- Prova: `scrcpy -s <SERIAL> --stay-awake` (mantiene il device sveglio via USB).
- Se il telefono ha il **blocco schermo con PIN**, devi sbloccarlo la prima volta
  direttamente sul telefono.

## scrcpy: «Could not find any ADB device»

Il telefono non è connesso/autorizzato: risolvi prima con adb (punti sopra).
scrcpy usa adb: se `adb devices` non mostra `device`, scrcpy non può funzionare.

## scrcpy: «Multiple devices»

Più dispositivi collegati: scrcpy ha bisogno del seriale — la nostra dashboard lo
passa già (`scrcpy -s SERIAL`), quindi questo errore non dovrebbe comparire usando
il pulsante **Avvia mirroring**. Da terminale manuale: `scrcpy -s <SERIAL>`.

## Analizza schermata: «uiautomator ERROR: could not get idle state» / gerarchia UI non disponibile

`uiautomator dump` legge la UI solo quando lo schermo è fermo. Su un **LIVE TikTok**
(video + commenti sempre in movimento) lo stato idle non arriva quasi mai: dopo
~12 s uiautomator rinuncia e l'analisi mostra «gerarchia UI non disponibile».
Verificato su Samsung SM-A057G / Android 15: quasi tutti i tentativi falliscono.
Anche quando il dump riesce, il prezzo non è esposto. Per questo i round
leggono la card con **screenshot + OCR** (vedi docs/ARCHITECTURE.md); il dump
resta solo come dettaglio facoltativo in «Analizza schermata».

## Round: «OCR: compilazione dell'helper non riuscita (serve swiftc)»

In dev l'helper OCR si compila al primo round da `tools/ocr/ocr.swift`.
Installa gli strumenti Xcode (`xcode-select --install`) e riprova. Nell'app
installata l'helper è già incluso.

## Homebrew: «command not found: brew» (Apple Silicon)

Su Mac M1/M2/M3/M4 Homebrew sta in `/opt/homebrew`. Se installato ma non trovato:

```bash
echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
eval "$(/opt/homebrew/bin/brew shellenv)"
```

## npm: «node: command not found»

Installa Node LTS: `brew install node` oppure da <https://nodejs.org> (serve ≥ 20).

## La dashboard non si apre / pagina bianca

- Controlla che il server sia su: il Terminale deve mostrare `Server POC avviato`.
- In dev apri **<http://localhost:5174>** (Vite), non la 5175.
- Se `npm run dev` fallisce subito: `rm -rf node_modules && npm install`.

## I comandi della dashboard restituiscono «Server non raggiungibile»

Il backend (porta 5175) non gira. Rilancia `npm run dev` e controlla gli errori
nel Terminale. Verifica che la porta non sia occupata:

```bash
lsof -i :5175
```

## Reset completo

```bash
npm run uninstall   # pulizia artefatti (+ opzionale scrcpy/adb)
npm install
npm run setup
npm run doctor
```

## «Android Device Control è danneggiato e non può essere aperto»

Accade con il DMG **0.2.0** (bundle non sigillato) su macOS 13+: scarica il
DMG **0.2.1 o successivo** dalle Releases, dove il bundle è firmato ad-hoc.

Con le versioni 0.2.1+ al primo avvio il blocco è normale (app non
notarizzata): passare da **Impostazioni di Sistema → Privacy e sicurezza →
«Apri comunque»**. Soluzione alternativa da Terminale (se preferita):

```bash
xattr -dr com.apple.quarantine "/Applications/Android Device Control.app"
```
