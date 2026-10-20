/**
 * WebSocket Connection Manager & Broadcast Hub for Real-time Sensor Telemetry.
 *
 * Provides thread-safe, memory-leak-free real-time streaming of telemetry updates
 * and incident notifications to all connected frontend clients via WS /ws/telemetry/live.
 */

import type { FastifyRequest } from 'fastify';
import { WebSocket } from 'ws';

export interface WsClientMeta {
  ip: string;
  connectedAt: Date;
  isAlive: boolean;
}

export interface WsMessage<T = unknown> {
  type: 'TELEMETRY_UPDATE' | 'INCIDENT_ALERT' | 'CONNECTION_ACK' | 'PONG' | string;
  payload: T;
  timestamp: string;
}

export class TelemetryWebSocketHub {
  private readonly clients = new Map<WebSocket, WsClientMeta>();
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private readonly heartbeatPeriodMs: number;

  constructor(heartbeatPeriodMs = 30_000) {
    this.heartbeatPeriodMs = heartbeatPeriodMs;
    this.startHeartbeat();
  }

  /**
   * Register a newly established WebSocket connection.
   * Attaches event listeners for close, error, and pong, and sends initial connection ack.
   */
  public handleConnection(socket: WebSocket, request: FastifyRequest): void {
    const ip = request.ip || request.socket.remoteAddress || 'unknown';
    const meta: WsClientMeta = {
      ip,
      connectedAt: new Date(),
      isAlive: true,
    };

    this.clients.set(socket, meta);
    request.log.info({ ip, totalClients: this.clients.size }, '🔌 WebSocket client connected to /ws/telemetry/live');

    // Heartbeat listener
    socket.on('pong', () => {
      const clientMeta = this.clients.get(socket);
      if (clientMeta) {
        clientMeta.isAlive = true;
      }
    });

    // Handle incoming client messages (e.g. client ping or subscribe)
    socket.on('message', (data) => {
      try {
        const text = data.toString();
        const parsed = JSON.parse(text) as { type?: string };
        if (parsed.type === 'PING') {
          this.sendToClient(socket, {
            type: 'PONG',
            payload: { serverTime: new Date().toISOString() },
            timestamp: new Date().toISOString(),
          });
        }
      } catch {
        // Ignore unparseable client messages
      }
    });

    // Clean up on disconnect
    socket.on('close', (code, reason) => {
      this.removeClient(socket);
      request.log.info(
        { ip, code, reason: reason.toString(), remaining: this.clients.size },
        '🔌 WebSocket client disconnected'
      );
    });

    // Clean up on socket error
    socket.on('error', (error) => {
      request.log.warn({ ip, error: error.message }, '⚠️ WebSocket client error encountered');
      this.removeClient(socket);
      try {
        socket.terminate();
      } catch {
        // Ignore termination error
      }
    });

    // Send connection acknowledgement
    this.sendToClient(socket, {
      type: 'CONNECTION_ACK',
      payload: {
        message: 'Connected to Vigilux Real-Time Telemetry Stream',
        protocolVersion: '1.0',
        activeClients: this.clients.size,
      },
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Safely broadcast telemetry JSON update to all currently connected clients.
   * Returns count of active clients that received the transmission.
   */
  public broadcastTelemetry<T>(telemetryData: T): number {
    return this.broadcast('TELEMETRY_UPDATE', telemetryData);
  }

  /**
   * Safely broadcast an anomaly incident notification to all connected clients.
   */
  public broadcastIncident<T>(incidentData: T): number {
    return this.broadcast('INCIDENT_ALERT', incidentData);
  }

  /**
   * Generic broadcast mechanism with dead socket cleanup.
   */
  public broadcast<T>(type: string, payload: T): number {
    if (this.clients.size === 0) {
      return 0;
    }

    const message: WsMessage<T> = {
      type,
      payload,
      timestamp: new Date().toISOString(),
    };

    const serialized = JSON.stringify(message);
    let successfulTransmissions = 0;

    for (const socket of this.clients.keys()) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(serialized, (err) => {
          if (err) {
            this.removeClient(socket);
          }
        });
        successfulTransmissions++;
      } else if (
        socket.readyState === WebSocket.CLOSED ||
        socket.readyState === WebSocket.CLOSING
      ) {
        this.removeClient(socket);
      }
    }

    return successfulTransmissions;
  }

  /**
   * Direct message helper to a single socket.
   */
  private sendToClient<T>(socket: WebSocket, message: WsMessage<T>): boolean {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message), (err) => {
        if (err) {
          this.removeClient(socket);
        }
      });
      return true;
    }
    return false;
  }

  /**
   * Remove a client socket and drop references to avoid memory leaks.
   */
  private removeClient(socket: WebSocket): void {
    if (this.clients.has(socket)) {
      this.clients.delete(socket);
      socket.removeAllListeners();
    }
  }

  /**
   * Periodic ping-pong heartbeat loop to detect stale/dead connections and free memory.
   */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      for (const [socket, meta] of this.clients.entries()) {
        if (!meta.isAlive) {
          // Client failed to respond to previous ping
          this.removeClient(socket);
          try {
            socket.terminate();
          } catch {
            // Ignore
          }
          continue;
        }

        // Mark as unverified until pong response arrives
        meta.isAlive = false;
        try {
          socket.ping();
        } catch {
          this.removeClient(socket);
        }
      }
    }, this.heartbeatPeriodMs);

    // Prevent heartbeat interval from holding the Node.js event loop open during shutdown
    if (this.heartbeatInterval.unref) {
      this.heartbeatInterval.unref();
    }
  }

  /**
   * Get count of currently active WebSocket clients.
   */
  public get clientCount(): number {
    return this.clients.size;
  }

  /**
   * Graceful shutdown: close all connections and terminate background timers.
   */
  public dispose(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    for (const [socket] of this.clients.entries()) {
      try {
        socket.close(1001, 'Server shutting down');
      } catch {
        try {
          socket.terminate();
        } catch {
          // Ignore
        }
      }
      socket.removeAllListeners();
    }

    this.clients.clear();
  }
}

// Global singleton instance for use across server modules
export const wsHub = new TelemetryWebSocketHub();
