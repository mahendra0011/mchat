import { RealtimeEvent } from '@orbit/schemas';

export type EventHandler = (event: RealtimeEvent) => void;

export class OrbitRealtimeClient {
  private wsUrl: string;
  private ws: WebSocket | null = null;
  private token: string | null = null;
  private lastCursor: string | null = null;
  private handlers = new Map<string, Set<EventHandler>>();
  private reconnectAttempts = 0;
  private isManualClose = false;
  private reconnectTimer: any = null;
  private seenEventIds = new Set<string>();
  private maxSeenEventIds = 500;

  constructor(wsUrl = 'ws://localhost:4000/v1/realtime') {
    this.wsUrl = wsUrl;
  }

  connect(token: string, resumeCursor?: string): void {
    this.token = token;
    this.lastCursor = resumeCursor || this.lastCursor;
    this.isManualClose = false;

    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const urlWithCursor = this.lastCursor
      ? `${this.wsUrl}?cursor=${encodeURIComponent(this.lastCursor)}`
      : this.wsUrl;

    try {
      this.ws = new WebSocket(urlWithCursor);

      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        this.emitLocal('status.connected', { status: 'connected' });
        // Send initial auth envelope if required
        if (this.token && this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: 'auth', token: this.token }));
        }
      };

      this.ws.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data);
          // Dedup by eventId (Spec 12: replay may re-deliver already-seen events)
          if (parsed && parsed.eventId) {
            if (this.seenEventIds.has(parsed.eventId)) return;
            this.seenEventIds.add(parsed.eventId);
            if (this.seenEventIds.size > this.maxSeenEventIds) {
              const oldest = this.seenEventIds.values().next().value;
              if (oldest !== undefined) this.seenEventIds.delete(oldest);
            }
          }
          if (parsed && parsed.cursor) {
            this.lastCursor = parsed.cursor;
          }
          this.emit(parsed);
        } catch (err) {
          console.error('Failed to parse realtime event envelope:', err);
        }
      };

      this.ws.onclose = () => {
        this.emitLocal('status.disconnected', { status: 'disconnected' });
        if (!this.isManualClose) {
          this.scheduleReconnect();
        }
      };

      this.ws.onerror = (err) => {
        console.warn('Realtime connection error:', err);
      };
    } catch (err) {
      console.error('Failed to construct WebSocket:', err);
      this.scheduleReconnect();
    }
  }

  disconnect(): void {
    this.isManualClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  on(eventType: string, handler: EventHandler): () => void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }
    this.handlers.get(eventType)!.add(handler);

    return () => {
      this.handlers.get(eventType)?.delete(handler);
    };
  }

  private emit(event: RealtimeEvent): void {
    const specificHandlers = this.handlers.get(event.type);
    if (specificHandlers) {
      specificHandlers.forEach((h) => h(event));
    }
    const allHandlers = this.handlers.get('*');
    if (allHandlers) {
      allHandlers.forEach((h) => h(event));
    }
  }

  private emitLocal(type: string, payload: any): void {
    const syntheticEvent: RealtimeEvent = {
      eventId: 'local-event',
      type,
      schemaVersion: 1,
      workspaceId: '00000000-0000-0000-0000-000000000000',
      cursor: this.lastCursor || '0',
      occurredAt: new Date().toISOString(),
      payload,
    };
    this.emit(syntheticEvent);
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const delayMs = Math.min(1000 * Math.pow(1.5, this.reconnectAttempts) + Math.random() * 500, 15000);
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.token && !this.isManualClose) {
        this.connect(this.token, this.lastCursor || undefined);
      }
    }, delayMs);
  }
}
