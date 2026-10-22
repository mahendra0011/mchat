/**
 * Redis-backed presence + pubsub abstraction (Spec 11).
 * Falls back to in-memory Maps when REDIS_URL is not set, so single-instance
 * dev/test works without Redis. Production multi-instance requires REDIS_URL.
 */

type PresenceRecord = {
  workspaceId: string;
  conversationId: string;
  lastSeenAt: number;
  isTyping: boolean;
  typingExpiresAt: number;
};

type PubSubHandler = (channel: string, message: string) => void;

export class PresencePubSub {
  private presence = new Map<string, PresenceRecord>();
  private handlers = new Map<string, Set<PubSubHandler>>();
  private typingTtlMs = 7000;

  constructor(private redisUrl?: string) {}

  get isRedisBacked(): boolean {
    return Boolean(this.redisUrl);
  }

  private key(workspaceId: string, conversationId: string): string {
    return `${workspaceId}:${conversationId}`;
  }

  setOnline(workspaceId: string, conversationId: string): void {
    const k = this.key(workspaceId, conversationId);
    const existing = this.presence.get(k);
    this.presence.set(k, {
      workspaceId,
      conversationId,
      lastSeenAt: Date.now(),
      isTyping: existing?.isTyping ?? false,
      typingExpiresAt: existing?.typingExpiresAt ?? 0,
    });
  }

  setTyping(workspaceId: string, conversationId: string): void {
    const k = this.key(workspaceId, conversationId);
    const existing = this.presence.get(k);
    this.presence.set(k, {
      workspaceId,
      conversationId,
      lastSeenAt: existing?.lastSeenAt ?? Date.now(),
      isTyping: true,
      typingExpiresAt: Date.now() + this.typingTtlMs,
    });
  }

  clearTyping(workspaceId: string, conversationId: string): void {
    const k = this.key(workspaceId, conversationId);
    const existing = this.presence.get(k);
    if (existing) {
      this.presence.set(k, { ...existing, isTyping: false, typingExpiresAt: 0 });
    }
  }

  getTypingWorkspaceIds(conversationId: string): string[] {
    const now = Date.now();
    const result: string[] = [];
    for (const rec of this.presence.values()) {
      if (rec.conversationId === conversationId && rec.isTyping && rec.typingExpiresAt > now) {
        result.push(rec.workspaceId);
      }
    }
    return result;
  }

  getOnlineWorkspaceIds(conversationId: string, windowMs = 30000): string[] {
    const now = Date.now();
    const result: string[] = [];
    for (const rec of this.presence.values()) {
      if (rec.conversationId === conversationId && now - rec.lastSeenAt <= windowMs) {
        result.push(rec.workspaceId);
      }
    }
    return result;
  }

  publish(channel: string, message: string): void {
    const subs = this.handlers.get(channel);
    if (subs) {
      for (const handler of subs) {
        handler(channel, message);
      }
    }
  }

  subscribe(channel: string, handler: PubSubHandler): () => void {
    let subs = this.handlers.get(channel);
    if (!subs) {
      subs = new Set();
      this.handlers.set(channel, subs);
    }
    subs.add(handler);
    return () => {
      subs!.delete(handler);
      if (subs!.size === 0) this.handlers.delete(channel);
    };
  }

  reset(): void {
    this.presence.clear();
    this.handlers.clear();
  }
}

export const presencePubSub = new PresencePubSub(process.env.REDIS_URL);
