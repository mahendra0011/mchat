import { FastifyInstance } from 'fastify';
import { WebSocket } from 'ws';
import { store } from './store.js';
import { accountHasWorkspaceAccess } from './auth.js';
import type { RealtimeEvent } from '@orbit/schemas';

interface ClientConnection {
  socketId: string;
  ws: WebSocket;
  accountId?: string;
  activeWorkspaceId?: string;
  isAlive: boolean;
  authenticated: boolean;
}

export const activeSockets = new Map<string, ClientConnection>();

/**
 * Spec 12/14 ??" scoped delivery. An event is delivered to a client only when:
 *  - the client is authenticated, AND
 *  - the client's account has access to the event's workspace, OR
 *    the client participates in the event's conversation (never for business.* events,
 *    which must stay inside the owning business workspace).
 */
function canReceive(client: ClientConnection, event: RealtimeEvent): boolean {
  if (!client.authenticated || !client.accountId) return false;
  if (accountHasWorkspaceAccess(client.accountId, event.workspaceId)) return true;
  if (event.type.startsWith('business.')) return false;
  if (event.conversationId) {
    const conv = store.conversations.get(event.conversationId);
    if (conv) {
      const inConv =
        conv.workspaceId !== undefined &&
        (conv.workspaceId === client.activeWorkspaceId ||
          conv.participants.some((p) => p.workspaceId === client.activeWorkspaceId));
      if (inConv) return true;
    }
  }
  return false;
}

function logRevocation(targetType: 'user' | 'workspace', targetId: string, action: string): void {
  const entry = {
    id: `aud_socket_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    actorId: 'system',
    actorRole: 'system_admin' as const,
    action,
    targetType,
    targetId,
    justification: 'Socket revocation',
    ipHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    timestamp: new Date().toISOString(),
  };
  store.adminAuditLogs.push(entry as any);
  void store.persistAdminAuditLog?.(entry as any);
}

export function revokeSocket(socketId: string): void {
  const client = activeSockets.get(socketId);
  if (!client) return;
  activeSockets.delete(socketId);
  try {
    client.ws.close(4403, 'revoked');
  } catch {
    // ignore
  }
  const msg = JSON.stringify({ type: 'socket:revoked', socketId });
  for (const [id, c] of activeSockets) {
    if (id === socketId) continue;
    if (c.ws.readyState === WebSocket.OPEN) {
      try {
        c.ws.send(msg);
      } catch {
        // ignore
      }
    }
  }
  logRevocation('user', socketId, 'socket.revoked');
}

export function revokeSocketsForWorkspace(workspaceId: string): void {
  const ids = [...activeSockets.keys()].filter((id) => activeSockets.get(id)?.activeWorkspaceId === workspaceId);
  ids.forEach((id) => revokeSocket(id));
  if (ids.length > 0) {
    logRevocation('workspace', workspaceId, 'socket.workspace_revoked');
  }
}

export function revokeSocketsForUser(userId: string): void {
  const ids = [...activeSockets.keys()].filter((id) => activeSockets.get(id)?.accountId === userId);
  ids.forEach((id) => revokeSocket(id));
  if (ids.length > 0) {
    logRevocation('user', userId, 'socket.user_revoked');
  }
}

export function setupRealtimeGateway(fastify: FastifyInstance): void {
  const clients = activeSockets;

  // Periodically ping connections
  const interval = setInterval(() => {
    for (const [id, client] of clients) {
      if (!client.isAlive) {
        try {
          client.ws.terminate();
        } catch {
          // ignore
        }
        clients.delete(id);
        continue;
      }
      client.isAlive = false;
      try {
        client.ws.ping();
      } catch {
        // ignore
      }
    }
  }, 30000);

  fastify.addHook('onClose', (_instance, done) => {
    clearInterval(interval);
    clearInterval(flushInterval);
    done();
  });

  // Fastify WebSocket handler: socket is passed as the first parameter
  fastify.get('/v1/realtime', { websocket: true }, (socket: any, req) => {
    const ws: WebSocket = socket.socket ? socket.socket : socket;
    const socketId = `sock_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const client: ClientConnection = {
      socketId,
      ws,
      isAlive: true,
      authenticated: false,
    };
    clients.set(socketId, client);

    ws.on('pong', () => {
      client.isAlive = true;
    });

    // Enforce authentication (Spec 10: sockets must not sit unauthenticated).
    // Read the timeout at connection time so tests can override it via env.
    const authTimeoutMs = Number(process.env.ORBIT_WS_AUTH_TIMEOUT_MS ?? 5000);
    const authTimer = setTimeout(() => {
      if (!client.authenticated) {
        ws.send(JSON.stringify({ type: 'error', code: 'UNAUTHENTICATED', message: 'Authentication required' }));
        ws.close(4401, 'unauthenticated');
      }
    }, authTimeoutMs);

    // Handle initial replay if ?cursor= was supplied (scoped to the authenticated client)
    const query = req.query as { cursor?: string; token?: string };
    let pendingReplayCursor: string | undefined = query?.cursor;
    if (query?.token) {
      const session = store.sessions.get(query.token);
      if (session) {
        client.accountId = session.accountId;
        client.activeWorkspaceId = session.activeWorkspaceId;
        client.authenticated = true;
        clearTimeout(authTimer);
      }
    }

    const sendReplay = () => {
      if (!pendingReplayCursor || !client.authenticated) return;
      const cursorNum = parseInt(pendingReplayCursor, 10);
      if (isNaN(cursorNum)) return;
      const missedEvents = store.outboxEvents.filter((e) => {
        const eNum = parseInt(e.cursor, 10);
        return !isNaN(eNum) && eNum > cursorNum;
      });
      missedEvents.forEach((evt) => {
        if (canReceive(client, evt) && client.ws.readyState === WebSocket.OPEN) {
          client.ws.send(JSON.stringify(evt));
        }
      });
      pendingReplayCursor = undefined;
    };

    ws.on('message', (raw: Buffer | string) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'auth' && msg.token) {
          const session = store.sessions.get(msg.token);
          if (session) {
            client.accountId = session.accountId;
            client.activeWorkspaceId = session.activeWorkspaceId;
            client.authenticated = true;
            clearTimeout(authTimer);
            sendReplay();
          } else {
            ws.send(JSON.stringify({ type: 'error', code: 'INVALID_TOKEN', message: 'Invalid session token' }));
          }
        }
      } catch (err) {
        console.warn('Realtime message parse error:', err);
      }
    });

    ws.on('close', () => {
      clearTimeout(authTimer);
      clients.delete(socketId);
    });
  });

  // Intercept store outbox events and broadcast (scoped per client)
  const originalRecordEvent = store.recordEvent.bind(store);
  store.recordEvent = (workspaceId, conversationId, type, payload) => {
    const event = originalRecordEvent(workspaceId, conversationId, type, payload);
    const json = JSON.stringify(event);

    let recipients = 0;
    for (const client of clients.values()) {
      if (client.ws.readyState === WebSocket.OPEN && canReceive(client, event)) {
        client.ws.send(json);
        recipients++;
      }
    }
    store.markEventBroadcast(event.eventId, recipients);

    return event;
  };

  // Spec 10 ??" outbox delivery worker: flush persisted-undelivered events to live clients
  const flushOutbox = () => {
    void store.flushOutbox((event) => {
      const json = JSON.stringify(event);
      let recipients = 0;
      for (const client of clients.values()) {
        if (client.ws.readyState === WebSocket.OPEN && canReceive(client, event)) {
          client.ws.send(json);
          recipients++;
        }
      }
      return recipients;
    });
  };
  const flushInterval = setInterval(flushOutbox, 5000);
  fastify.addHook('onReady', () => {
    flushOutbox();
  });
}
