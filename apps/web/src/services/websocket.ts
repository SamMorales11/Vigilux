import type { WsMessage } from '@/types';

type MessageHandler<T = unknown> = (data: T) => void;

export class TelemetryWebSocketService {
  private socket: WebSocket | null = null;
  private url: string;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 20;
  private reconnectIntervalMs = 2000;
  private pingInterval: number | null = null;
  private handlers: Map<string, Set<MessageHandler<any>>> = new Map();
  private isExplicitlyClosed = false;

  constructor(url?: string) {
    if (url) {
      this.url = url;
    } else {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      this.url = `${protocol}//${window.location.host}/ws/telemetry/live`;
    }
  }

  public connect(): void {
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.isExplicitlyClosed = false;
    try {
      this.socket = new WebSocket(this.url);

      this.socket.onopen = () => {
        this.reconnectAttempts = 0;
        this.startHeartbeat();
        this.emit('_status', { status: 'connected' });
      };

      this.socket.onmessage = (event: MessageEvent) => {
        try {
          const payload: WsMessage = JSON.parse(event.data);
          if (payload.type === 'pong') return;
          this.emit(payload.type, payload.data);
          this.emit('*', payload);
        } catch (err) {
          console.warn('[TelemetryWebSocket] Failed to parse message JSON', err);
        }
      };

      this.socket.onclose = () => {
        this.cleanupHeartbeat();
        this.emit('_status', { status: 'disconnected' });
        if (!this.isExplicitlyClosed) {
          this.scheduleReconnect();
        }
      };

      this.socket.onerror = (err) => {
        this.emit('_status', { status: 'error', error: err });
      };
    } catch (err) {
      this.scheduleReconnect();
    }
  }

  public disconnect(): void {
    this.isExplicitlyClosed = true;
    this.cleanupHeartbeat();
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }

  public on<T = unknown>(type: string, handler: MessageHandler<T>): () => void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)!.add(handler);

    return () => {
      this.handlers.get(type)?.delete(handler);
    };
  }

  private emit(type: string, data: unknown): void {
    const listeners = this.handlers.get(type);
    if (listeners) {
      listeners.forEach((handler) => {
        try {
          handler(data);
        } catch (err) {
          console.error(`[TelemetryWebSocket] Error in handler for '${type}':`, err);
        }
      });
    }
  }

  private startHeartbeat(): void {
    this.cleanupHeartbeat();
    this.pingInterval = window.setInterval(() => {
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify({ type: 'ping' }));
      }
    }, 25000);
  }

  private cleanupHeartbeat(): void {
    if (this.pingInterval !== null) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      return;
    }
    const delay = Math.min(this.reconnectIntervalMs * Math.pow(1.5, this.reconnectAttempts), 15000);
    this.reconnectAttempts++;
    setTimeout(() => {
      this.connect();
    }, delay);
  }
}

export const wsService = new TelemetryWebSocketService();
