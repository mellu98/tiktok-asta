interface Props {
  serverReady: boolean;
}

/**
 * Guida all'autorizzazione USB mostrata finché nessun dispositivo è collegato.
 * I passi 1-2 sono manuali (sul telefono), i passi 3-4 riflettono lo stato
 * rilevato via ADB: appena il Samsung risulta autorizzato il pannello scompare
 * e appare la card del dispositivo.
 */
export function OnboardingPanel({ serverReady }: Props) {
  return (
    <div className="onboarding">
      <h3>Collega il tuo Samsung</h3>
      <ol className="steps">
        <li>
          <div className="step-head">
            <span className="step-num">1</span>
            <strong>Attiva le Opzioni sviluppatore</strong>
          </div>
          <p>
            Sul telefono: <em>Impostazioni → Informazioni sul telefono →
            Informazioni software</em>, poi tocca <strong>Numero build</strong>{" "}
            7 volte di seguito.
          </p>
        </li>
        <li>
          <div className="step-head">
            <span className="step-num">2</span>
            <strong>Attiva il Debug USB</strong>
          </div>
          <p>
            <em>Impostazioni → Opzioni sviluppatore → Debug USB → ON</em>.
          </p>
        </li>
        <li>
          <div className="step-head">
            <span className="step-num">3</span>
            <strong>Collega il cavo USB al Mac</strong>
            <span className={`step-state ${serverReady ? "wait" : "off"}`}>
              {serverReady ? "in attesa del dispositivo…" : "avvio interno…"}
            </span>
          </div>
          <p>
            Usa un cavo <strong>dati</strong> (i cavi solo-di-carica non
            funzionano). Se il telefono lo chiede, scegli «Trasferimento file».
          </p>
        </li>
        <li>
          <div className="step-head">
            <span className="step-num">4</span>
            <strong>Autorizza il computer</strong>
          </div>
          <p>
            Sullo schermo del telefono tocca <strong>«Consenti sempre da
            questo computer»</strong> nella richiesta «Consentire debug USB?».
            Non la vedi? Sblocca il telefono e scollega/ricollega il cavo.
          </p>
        </li>
      </ol>
      <p className="onboarding-note">
        Questa schermata scompare automaticamente appena il dispositivo viene
        rilevato e autorizzato.
      </p>
    </div>
  );
}
