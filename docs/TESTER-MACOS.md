# Guida tester — Mac + Samsung via USB

Questa guida è per chi deve **provare il POC** su un Mac con un Samsung Android fisico.

> **Via consigliata — senza Terminale**: scarica l'app da
> [GitHub Releases](https://github.com/mellu98/tiktok-asta/releases), trascinala
> in Applicazioni. Al primo avvio macOS blocca l'app (non è notarizzata):
> apri **Impostazioni di Sistema → Privacy e sicurezza**, scorri in basso e
> premi **«Apri comunque»**. Poi segui la guida integrata nell'app (ti
> accompagna passo-passo su Debug USB e autorizzazione).
> adb e scrcpy sono già dentro l'app: niente Homebrew, Node o comandi.
> Poi salta direttamente alla sezione **«Prova le funzioni»**.

Le sezioni seguenti descrivono la via da **Terminale** (per sviluppatori o debug).

## 0. Cosa ti serve

- Mac (Apple Silicon o Intel) con macOS aggiornato
- Cavo USB **dati** (quello della ricarica rapida va bene se trasferisce dati)
- Samsung Android con schermo funzionante
- ~10 minuti

## 1. Installa il progetto

Apri **Terminale** (Launchpad → Cerca "Terminale") e incolla:

```bash
git clone https://github.com/mellu98/tiktok-asta.git
cd tiktok-asta
npm install
```

## 2. Prepara il Mac (una volta sola)

```bash
npm run setup
```

Lo script controlla Homebrew, Node, ADB e scrcpy e ti chiede conferma
prima di installare ciò che manca (`s` + Invio per installare).

## 3. Prepara il Samsung

### 3a. Attiva le Opzioni sviluppatore

1. **Impostazioni** → **Informazioni sul telefono**
2. **Informazioni sul software**
3. Trova **Numero build** e **toccalo 7 volte di seguito**
4. Vedrai: «Modalità sviluppatore attivata»

### 3b. Attiva il Debug USB

1. **Impostazioni** → **Opzioni sviluppatore**
2. Cerca **Debug USB** → **ON**
3. (Consigliato) attiva anche **Sblocco OEM** se presente

### 3c. Collega il telefono al Mac

1. Collega il cavo USB
2. Sul telefono apparirà: **«Consentire debug USB?»**
3. Spunta **«Consenti sempre da questo computer»**
4. Tocca **Consenti**

> Non vedi la richiesta? Sblocca lo schermo del telefono e scollega/ricollega il cavo.

## 4. Verifica tutto

```bash
npm run doctor
```

Devi arrivare a leggere **READY** (o «AMBIENTE PRONTO»). Se qualche riga è rossa [✗],
lo script ti dice esattamente cosa fare. Guida completa dei problemi: vedi
[TROUBLESHOOTING.md](TROUBLESHOOTING.md).

## 5. Avvia la dashboard

```bash
npm run dev
```

Aspetta la riga `Local: http://localhost:5174/` e apri quell'indirizzo nel browser
(se non si apre da sola).

## 6. Cosa dovresti vedere

1. **Card del telefono** in alto: nome del modello, badge verde **ONLINE**,
   serial, «ADB: Authorized»
2. Quando colleghi/scolleghi il telefono, la card **appare/scompare da sola**
   e il log in basso registra l'evento

## 7. Prova le funzioni

| Pulsante | Cosa fa |
| --- | --- |
| **▶ Avvia mirroring** | Apre la finestra scrcpy: vedi e controlli lo schermo del telefono dal Mac |
| **📷 Screenshot** | Scatta una foto dello schermo e la mostra (salvata in `screenshots/`) |
| **📱 Elenco app** | Elenca le app installate, con ricerca |
| **▷ Apri app…** | Lancia un'app scelta sul telefono |
| **⌂ HOME / ↩ BACK** | Tasti hardware virtuali |
| **Tap / Swipe / Testo** | Input manuale (coordinate in pixel dello schermo del telefono) |
| **⟳ Riavvia ADB** | Utile se il telefono risulta «offline» |

## 8. Quando hai finito

Chiudi la finestra scrcpy, poi premi `Ctrl + C` nel Terminale per fermare la dashboard.

Per rimuovere tutto: `npm run uninstall` (ti chiede cosa rimuovere).

## Checklist veloce (via app .dmg — tester)

- [ ] .dmg scaricato da Releases (aarch64 = M1/M2/M3/M4, x86_64 = Intel)
- [ ] App trascinata in Applicazioni
- [ ] Primo avvio: Impostazioni di Sistema → Privacy e sicurezza → «Apri comunque»
- [ ] Guida integrata completata (Opzioni sviluppatore + Debug USB)
- [ ] Telefono collegato + «Consenti sempre da questo computer»
- [ ] Card del telefono verde ONLINE
- [ ] Avvia mirroring → finestra scrcpy funzionante
- [ ] Screenshot salvato
- [ ] Elenco app + apertura app OK
- [ ] HOME/BACK/tap/swipe/testo OK

## Checklist veloce (via Terminale — sviluppatore)

- [ ] `git clone` + `npm install` OK
- [ ] `npm run setup` → tutti [✓]
- [ ] Opzioni sviluppatore attivate (7 tap su Numero build)
- [ ] Debug USB ON
- [ ] Telefono collegato + «Consenti sempre da questo computer»
- [ ] `npm run doctor` → READY
- [ ] `npm run dev` → dashboard su <http://localhost:5174>
- [ ] Card del telefono verde ONLINE
- [ ] Avvia mirroring → finestra scrcpy funzionante
- [ ] Screenshot salvato
- [ ] Elenco app + apertura app OK
- [ ] HOME/BACK/tap/swipe/testo OK
