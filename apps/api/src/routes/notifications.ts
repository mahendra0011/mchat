import { FastifyInstance } from 'fastify';
import { store } from '../store.js';
import { resolveRequestContext } from '../auth.js';

/**
 * In-app notification feed + push subscription management (Spec 02 P0).
 * Notifications are derived from message events scoped to the recipient workspace.
 */

export interface NotificationRecord {
  id: string;
  workspaceId: string;
  conversationId: string;
  type: 'message' | 'mention' | 'reaction' | 'system';
  title: string;
  body: string;
  /** Privacy-filtered projection for push/webhook delivery (never raw content when previews are off). */
  pushPayload?: { title: string; body?: string };
  read: boolean;
  /** Timestamp of the most recent read transition; null/absent while unread. */
  readAt?: string | null;
  createdAt: string;
}

export interface PushSubscription {
  id: string;
  workspaceId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  platform: 'web' | 'ios' | 'android';
  createdAt: string;
}

export interface NotificationPreviewSettings {
  /** Privacy section: hide message content from lock-screen/push previews. */
  hideNotificationPreviews?: boolean;
  /** Notifications section: how much of the message to include. */
  previewDetail?: 'full' | 'sender_only' | 'hidden';
}

export function redactPushPayload(payload: { title: string; body?: string }): { title: string; redacted: boolean } {
  return { title: payload.title, redacted: true };
}

export interface NotificationPushPayload {
  title: string;
  body?: string;
}

const GENERIC_PREVIEW_TITLE = 'New message';

/**
 * Spec 08/09 — notification preview privacy. When previews are hidden (or the
 * detail level is 'hidden'), the payload carries a generic title and no body;
 * 'sender_only' keeps the sender title but drops the message body.
 */
export function applyPreviewPrivacy(
  settings: NotificationPreviewSettings | undefined,
  payload: { title: string; body?: string }
): NotificationPushPayload {
  const hidePreviews = settings?.hideNotificationPreviews ?? true;
  const previewDetail = settings?.previewDetail ?? 'sender_only';
  if (hidePreviews || previewDetail === 'hidden') {
    return { title: GENERIC_PREVIEW_TITLE };
  }
  if (previewDetail === 'sender_only') {
    return { title: payload.title };
  }
  return { title: payload.title, body: payload.body };
}

/** Resolve the recipient workspace's stored settings and apply preview privacy. */
export function buildPushPayloadForWorkspace(
  workspaceId: string,
  payload: { title: string; body?: string }
): NotificationPushPayload {
  const stored = store.workspaceSettings.get(workspaceId) ?? {};
  const notificationsSection = (stored.notifications ?? {}) as Record<string, unknown>;
  const privacySection = (stored.privacy ?? {}) as Record<string, unknown>;
  return applyPreviewPrivacy(
    {
      hideNotificationPreviews:
        typeof privacySection.hideNotificationPreviews === 'boolean'
          ? privacySection.hideNotificationPreviews
          : undefined,
      previewDetail:
        notificationsSection.previewDetail === 'full' ||
        notificationsSection.previewDetail === 'sender_only' ||
        notificationsSection.previewDetail === 'hidden'
          ? (notificationsSection.previewDetail as 'full' | 'sender_only' | 'hidden')
          : undefined,
    },
    payload
  );
}

const notifications = new Map<string, NotificationRecord>();
const pushSubscriptions = new Map<string, PushSubscription>();

export function recordNotification(rec: Omit<NotificationRecord, 'id' | 'createdAt' | 'read' | 'pushPayload'>): NotificationRecord {
  const pushPayload = buildPushPayloadForWorkspace(rec.workspaceId, { title: rec.title, body: rec.body });
  const notification: NotificationRecord = {
    ...rec,
    id: `ntf_${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    pushPayload,
    read: false,
    readAt: null,
    createdAt: new Date().toISOString(),
  };
  notifications.set(notification.id, notification);
  return notification;
}

export async function notificationRoutes(fastify: FastifyInstance): Promise<void> {
  // List notifications for the active workspace
  fastify.get<{ Querystring: { unreadOnly?: string; limit?: string } }>(
    '/v1/notifications',
    { preHandler: resolveRequestContext },
    async (request, reply) => {
      const ctx = request.orbitContext!;
      const unreadOnly = request.query.unreadOnly === 'true';
      const limit = Math.min(Math.max(parseInt(request.query.limit ?? '50', 10) || 50, 1), 200);

      const items = Array.from(notifications.values())
        .filter((n) => n.workspaceId === ctx.activeWorkspace.id)
        .filter((n) => (unreadOnly ? !n.read : true))
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, limit);

      const unreadCount = Array.from(notifications.values()).filter(
        (n) => n.workspaceId === ctx.activeWorkspace.id && !n.read
      ).length;

      return reply.send({ data: items, unreadCount });
    }
  );

  // Mark notification as read
  fastify.post<{ Params: { notificationId: string } }>(
    '/v1/notifications/:notificationId/read',
    { preHandler: resolveRequestContext },
    async (request, reply) => {
      const { notificationId } = request.params;
      const ctx = request.orbitContext!;
      const n = notifications.get(notificationId);
      if (!n || n.workspaceId !== ctx.activeWorkspace.id) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Notification not found', requestId: request.id },
        });
      }
      n.read = true;
      n.readAt = new Date().toISOString();
      return reply.send({ success: true });
    }
  );

  // Per-notification read state (Spec 02 P0): PATCH /v1/notifications/:notificationId
  fastify.patch<{ Params: { notificationId: string } }>(
    '/v1/notifications/:notificationId',
    { preHandler: resolveRequestContext },
    async (request, reply) => {
      const { notificationId } = request.params;
      const ctx = request.orbitContext!;
      const body = request.body as { read?: unknown } | undefined;

      if (!body || typeof body.read !== 'boolean') {
        return reply.status(400).send({
          error: {
            code: 'INVALID_READ_STATE',
            message: 'Request body must include a boolean "read" field',
            requestId: request.id,
          },
        });
      }

      const n = notifications.get(notificationId);
      if (!n || n.workspaceId !== ctx.activeWorkspace.id) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Notification not found', requestId: request.id },
        });
      }

      n.read = body.read;
      n.readAt = body.read ? new Date().toISOString() : null;
      return reply.send({ success: true, notification: n });
    }
  );

  // Mark all notifications as read for the active workspace
  fastify.post(
    '/v1/notifications/read-all',
    { preHandler: resolveRequestContext },
    async (request, reply) => {
      const ctx = request.orbitContext!;
      let count = 0;
      for (const n of notifications.values()) {
        if (n.workspaceId === ctx.activeWorkspace.id && !n.read) {
          n.read = true;
          n.readAt = new Date().toISOString();
          count++;
        }
      }
      return reply.send({ success: true, markedCount: count });
    }
  );

  // Register a Web Push subscription
  fastify.post<{ Body: { endpoint: string; keys: { p256dh: string; auth: string }; platform?: string } }>(
    '/v1/notifications/push-subscriptions',
    { preHandler: resolveRequestContext },
    async (request, reply) => {
      const ctx = request.orbitContext!;
      const body = request.body as { endpoint?: string; keys?: { p256dh?: string; auth?: string }; platform?: string };
      if (!body?.endpoint || !body?.keys?.p256dh || !body?.keys?.auth) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_PUSH_SUBSCRIPTION',
            message: 'endpoint and keys.p256dh/keys.auth are required',
            requestId: request.id,
          },
        });
      }

      const sub: PushSubscription = {
        id: `push_${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        workspaceId: ctx.activeWorkspace.id,
        endpoint: body.endpoint,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
        platform: (body.platform as PushSubscription['platform']) ?? 'web',
        createdAt: new Date().toISOString(),
      };
      pushSubscriptions.set(sub.id, sub);

      if (store.db) {
        await store.sql(
          `INSERT INTO push_subscriptions (id, workspace_id, endpoint, p256dh, auth, platform, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (id) DO NOTHING`,
          [sub.id, sub.workspaceId, sub.endpoint, sub.p256dh, sub.auth, sub.platform, sub.createdAt]
        );
      }

      return reply.status(201).send({ data: { id: sub.id } });
    }
  );

  // Remove a push subscription
  fastify.delete<{ Params: { subscriptionId: string } }>(
    '/v1/notifications/push-subscriptions/:subscriptionId',
    { preHandler: resolveRequestContext },
    async (request, reply) => {
      const { subscriptionId } = request.params;
      pushSubscriptions.delete(subscriptionId);
      if (store.db) {
        await store.sql('DELETE FROM push_subscriptions WHERE id = $1', [subscriptionId]);
      }
      return reply.send({ success: true });
    }
  );
}
