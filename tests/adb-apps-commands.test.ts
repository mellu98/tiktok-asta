import { describe, expect, it } from "vitest";
import {
  assertValidPackage,
  monkeyLaunchSucceeded,
  parsePackageList,
} from "../src/adb/apps";
import { sanitizeInputText } from "../src/adb/commands";

describe("parsePackageList", () => {
  it("estrae i package di terze parti", () => {
    const pkgs = parsePackageList(`package:com.whatsapp
package:org.mozilla.firefox
package:com.zhiliaoapp.musically
invalid line
`);
    // la funzione ordina alfabeticamente
    expect(pkgs).toEqual([
      "com.whatsapp",
      "com.zhiliaoapp.musically",
      "org.mozilla.firefox",
    ]);
  });

  it("ordina alfabeticamente", () => {
    const pkgs = parsePackageList("package:com.zeta\npackage:com.alfa");
    expect(pkgs).toEqual(["com.alfa", "com.zeta"]);
  });

  it("lista vuota", () => {
    expect(parsePackageList("")).toEqual([]);
  });
});

describe("assertValidPackage", () => {
  it("accetta nomi validi", () => {
    expect(() => assertValidPackage("com.whatsapp")).not.toThrow();
    expect(() => assertValidPackage("com.zhiliaoapp.musically")).not.toThrow();
    expect(() => assertValidPackage("org.mozilla.firefox")).not.toThrow();
  });

  it("rifiuta injection e nomi malformati", () => {
    expect(() => assertValidPackage("com.foo; rm -rf /")).toThrow();
    expect(() => assertValidPackage("")).toThrow();
    expect(() => assertValidPackage("noth巧ing")).toThrow();
    expect(() => assertValidPackage("com.foo && reboot")).toThrow();
    expect(() => assertValidPackage(".com.foo")).toThrow();
  });
});

describe("monkeyLaunchSucceeded", () => {
  it("riconosce un lancio riuscito", () => {
    expect(
      monkeyLaunchSucceeded("Events injected: 1\n## Network stats: elapsed"),
    ).toBe(true);
  });

  it("rifiuta un fallimento (app senza launcher)", () => {
    expect(
      monkeyLaunchSucceeded("** Error: Injection Failed not sure why."),
    ).toBe(false);
  });
});

describe("sanitizeInputText", () => {
  it("converte gli spazi in %s", () => {
    expect(sanitizeInputText("hello world")).toBe("hello%sworld");
  });

  it("rimuove i caratteri pericolosi per la shell del device", () => {
    // ; | & $ ` " ' ( ) < > \ ! non devono passare
    expect(sanitizeInputText("a;b|c&d$e`f\"g'h(i)j<k>l\\m")).toBe(
      "abcdefghijklm",
    );
  });

  it("mantiene punteggiatura utile", () => {
    // "%" letterale è gestito da input text; gli spazi diventano %s
    expect(sanitizeInputText("Ciao, come stai? Tutto bene! 100% ok.")).toBe(
      "Ciao,%scome%sstai?%sTutto%sbene!%s100%%sok.",
    );
  });

  it("converte newline in spazio", () => {
    expect(sanitizeInputText("riga1\nriga2")).toBe("riga1%sriga2");
  });

  it("trunca testi molto lunghi", () => {
    expect(sanitizeInputText("a".repeat(1000))).toHaveLength(500);
  });

  it("testo con soli caratteri vietati → vuoto", () => {
    expect(sanitizeInputText(";;;;")).toBe("");
  });
});
