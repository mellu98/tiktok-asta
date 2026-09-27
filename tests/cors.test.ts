import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TAURI_WEBVIEW_ORIGIN, webviewCors } from "../src/server/cors";

/**
 * La webview dell'app (.dmg) gira su tauri://localhost e chiama il sidecar su
 * http://127.0.0.1:5175: ogni fetch è cross-origin e — per il Content-Type JSON —
 * preceduta da un preflight OPTIONS. Senza questi header WebKit blocca tutto.
 */

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use("/api", webviewCors);
  app.get("/api/ping", (_req, res) => {
    res.json({ ok: true });
  });
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function preflight(origin: string): Promise<Response> {
  return fetch(`${baseUrl}/api/ping`, {
    method: "OPTIONS",
    headers: {
      Origin: origin,
      "Access-Control-Request-Method": "GET",
      "Access-Control-Request-Headers": "content-type",
    },
  });
}

describe("webviewCors", () => {
  it("risponde al preflight della webview Tauri con 204 e gli header CORS", async () => {
    const res = await preflight(TAURI_WEBVIEW_ORIGIN);

    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(
      TAURI_WEBVIEW_ORIGIN,
    );
    expect(res.headers.get("access-control-allow-methods")).toBe(
      "GET, POST, OPTIONS",
    );
    expect(res.headers.get("access-control-allow-headers")).toBe(
      "Content-Type",
    );
    expect(res.headers.get("vary")).toMatch(/origin/i);
  });

  it("aggiunge Allow-Origin alle richieste reali della webview Tauri", async () => {
    const res = await fetch(`${baseUrl}/api/ping`, {
      headers: { Origin: TAURI_WEBVIEW_ORIGIN },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(
      TAURI_WEBVIEW_ORIGIN,
    );
    expect(await res.json()).toEqual({ ok: true });
  });

  it("non concede CORS a un sito web qualunque (il server comanda il telefono)", async () => {
    const pre = await preflight("https://evil.example");
    const real = await fetch(`${baseUrl}/api/ping`, {
      headers: { Origin: "https://evil.example" },
    });

    expect(pre.headers.get("access-control-allow-origin")).toBeNull();
    expect(real.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("lascia invariate le richieste senza Origin (curl, proxy Vite in dev)", async () => {
    const res = await fetch(`${baseUrl}/api/ping`);

    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});
