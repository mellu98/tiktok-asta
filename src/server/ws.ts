import { WebSocketServer, type WebSocket } from 'ws'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import type { WsServerMessage } from '../shared/types'

/**
 * WebSocket server: un solo canale /ws, broadcast-only (server → client).
 * Usato per: snapshot dispositivi, voci di log, stato scrcpy. Il polling lato
 * client è solo fallback.
 */
export class WsHub {
  private readonly wss: WebSocketServer
  private clients = new Set<WebSocket>()

  constructor() {
    this.wss = new WebSocketServer({ noServer: true })
  }

  /** Attacca l'upgrade handling a un server HTTP (solo path /ws). */
  attach(server: import('node:http').Server): void {
    server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      const { pathname } = new URL(req.url ?? '/', 'http://localhost')
      if (pathname === '/ws') {
        this.wss.handleUpgrade(req, socket, head, (ws) => {
          this.wss.emit('connection', ws, req)
        })
      } else {
        socket.destroy()
      }
    })

    this.wss.on('connection', (ws) => {
      this.clients.add(ws)
      ws.on('close', () => this.clients.delete(ws))
      ws.on('error', () => this.clients.delete(ws))
      this.send(ws, { type: 'hello', port: 0 })
    })
  }

  broadcast(message: WsServerMessage): void {
    for (const ws of this.clients) {
      if (ws.readyState === ws.OPEN) {
        this.send(ws, message)
      }
    }
  }

  clientCount(): number {
    return this.clients.size
  }

  private send(ws: WebSocket, message: WsServerMessage): void {
    try {
      ws.send(JSON.stringify(message))
    } catch {
      // Client già sparito: ignora
    }
  }
}
