import { FastifyInstance } from 'fastify';
import {
  SECTION_SCHEMAS,
  ALL_SETTINGS_SECTIONS,
  validateSettingsUpdate,
  type SettingsSection,
} from '@orbit/schemas';
import { resolveRequestContext } from '../auth.js';
import { store } from '../store.js';

/**
 * Persisted workspace settings (Spec 09 + Spec 14 safety settings).
 * Settings are scoped to the active workspace and stored per-section.
 */
export async function settingsRoutes(fastify: FastifyInstance): Promise<void> {
  // Get all settings for the active workspace, merged over schema defaults.
  fastify.get('/v1/settings', { preHandler: resolveRequestContext }, async (request, reply) => {
    const ctx = request.orbitContext!;
    const stored = store.workspaceSettings.get(ctx.activeWorkspace.id) ?? {};
    const merged: Record<string, unknown> = {};
    for (const section of ALL_SETTINGS_SECTIONS) {
      const schema = SECTION_SCHEMAS[section];
      const defaults = schema.parse({});
      merged[section] = { ...defaults, ...((stored[section] as object) ?? {}) };
    }
    return reply.send({ data: merged });
  });

  // Update a single settings section (validated against its schema).
  fastify.put<{ Params: { section: string } }>(
    '/v1/settings/:section',
    { preHandler: resolveRequestContext },
    async (request, reply) => {
      const ctx = request.orbitContext!;
      const { section } = request.params;
      const result = validateSettingsUpdate(section, request.body);
      if (!result.ok) {
        return reply.status(400).send({
          error: { code: 'INVALID_SETTINGS', message: result.error, requestId: request.id },
        });
      }
      const stored = store.workspaceSettings.get(ctx.activeWorkspace.id) ?? {};
      const next = { ...stored, [section as SettingsSection]: result.data };
      store.workspaceSettings.set(ctx.activeWorkspace.id, next);
      await store.persistWorkspaceSettings(ctx.activeWorkspace.id, next);
      return reply.send({ data: { [section]: result.data } });
    }
  );
}
