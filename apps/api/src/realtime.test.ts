// Auth timeout override (read at connection time by the gateway, so this is safe even after imports).
process.env.ORBIT_WS_AUTH_TIMEOUT_MS = '1500';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { WebSocket } from 'ws';
import { buildApp } from './app.js';
import { store } from './store.js';
import { FIXTURE_IDS } from '@orbit/test-fixtures';

interface WsMessage {
  type?: string;
  eventId?: string;
  code?: string;
  [key: string]: unknown;
}

/**
 * Opens a realtime socket and attaches a persistent collector at connect time,
 * so no event can be missed between connect and assertion (avoids emit/listen races).
 */
function connectWithCollector(url: string): Promise<{ ws: WebSocket; messages: WsMessage[] }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const messages: WsMessage[] = [];
    ws.on('message', (raw: Buffer | string) => {
      try {
        messages.push(JSON.parse(raw.toString()));
      } catch {
        /* ignore non-JSON frames (pongs etc.) */
      }
    });
    ws.on('open', () => resolve({ ws, messages }));
    ws.on('error', reject);
  });
}

function waitForClose(ws: WebSocket, timeoutMs = 6000): Promise<number> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for socket close')), timeoutMs);
    ws.on('close', (code: number) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('Realtime gateway scoping (Spec 12/14)', () => {
  const app = buildApp();
  let baseUrl = '';

  before(async () => {
    await app.ready();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    baseUrl = `ws://127.0.0.1:${port}`;
  });

  after(async () => {
    await app.close();
  });

  it('authenticated client receives events scoped to its conversation, not others', async () => {
    const { ws, messages } = await connectWithCollector(`${baseUrl}/v1/realtime?token=test-session-alex`);
    // Allow the server to register/authenticate the client before we emit.
    await sleep(150);

    // Event in a conversation Alex participates in → should be delivered.
    const scopedEvent = store.recordEvent(
      FIXTURE_IDS.wsPersonalAlex,
      FIXTURE_IDS.convPersonalAlexMaya,
      'message.created',
      { messageId: 'msg-scoped-test' }
    );
    // Poll until the scoped event arrives (or timeout).
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline && !messages.some((m) => m.eventId === scopedEvent.eventId)) {
      await sleep(25);
    }
    const received = messages.find((m) => m.eventId === scopedEvent.eventId);
    assert.ok(received, 'scoped event must be delivered to the authenticated participant');
    assert.strictEqual(received.type, 'message.created');

    // Event in an unrelated workspace/conversation → must NOT be delivered.
    const unrelatedEvent = store.recordEvent(
      FIXTURE_IDS.wsPersonalMaya,
      'conv-unrelated-xyz',
      'message.created',
      { messageId: 'msg-unrelated' }
    );
    await sleep(400);
    const leaked = messages.some((m) => m.eventId === unrelatedEvent.eventId);
    assert.strictEqual(leaked, false, 'unrelated workspace event must not leak to this client');

    ws.close();
  });

  it('business.* internal events are never delivered to non-workspace clients', async () => {
    // Maya owns wsPersonalMaya only — she is a *participant* of the business conversation
    // but NOT a member/owner of wsBusinessAcme. A business.* event must never reach her,
    // even though the conversation-participant rule would otherwise match.
    store.sessions.set('test-session-maya', {
      sessionId: 'test-session-maya',
      accountId: FIXTURE_IDS.accountMaya,
      activeWorkspaceId: FIXTURE_IDS.wsPersonalMaya,
      deviceLabel: 'Test Client',
      platform: 'web',
      createdAt: '2026-01-01T10:00:00Z',
      lastActiveAt: new Date().toISOString(),
      isCurrentSession: true,
    });

    const { ws, messages } = await connectWithCollector(`${baseUrl}/v1/realtime?token=test-session-maya`);
    await sleep(150);

    const businessEvent = store.recordEvent(
      FIXTURE_IDS.wsBusinessAcme,
      FIXTURE_IDS.convBusinessCustomerMaya,
      'business.internal_note_created',
      { note: { id: 'note-leak-test', body: 'INTERNAL: refund approved' } }
    );

    await sleep(400);
    const leaked = messages.some((m) => m.eventId === businessEvent.eventId);
    assert.strictEqual(leaked, false, 'business.* event must never leak to a non-workspace client');

    ws.close();
  });

  it('unauthenticated socket is closed with 4401 after auth timeout', async () => {
    // Auth timeout is short (ORBIT_WS_AUTH_TIMEOUT_MS=1500, read at connection time).
    const ws = new WebSocket(`${baseUrl}/v1/realtime`);
    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => resolve());
      ws.on('error', reject);
    });

    const closeCode = await waitForClose(ws, 3000);
    assert.strictEqual(closeCode, 4401, 'unauthenticated clients must be closed with 4401');
  });
});
