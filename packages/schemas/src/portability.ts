import { z } from 'zod';

export const ImportSourcePlatformSchema = z.enum([
  'orbit_archive',
  'slack_export',
  'generic_json',
]);
export type ImportSourcePlatform = z.infer<typeof ImportSourcePlatformSchema>;

export const ImportPreviewSchema = z.object({
  sourcePlatform: ImportSourcePlatformSchema,
  conversationsCount: z.number().int().nonnegative(),
  messagesCount: z.number().int().nonnegative(),
  attachmentsCount: z.number().int().nonnegative(),
  estimatedSizeMB: z.number().nonnegative(),
  duplicateCount: z.number().int().nonnegative(),
  conflictCount: z.number().int().nonnegative(),
  validated: z.boolean(),
});
export type ImportPreview = z.infer<typeof ImportPreviewSchema>;

export const ImportExecutionResultSchema = z.object({
  jobId: z.string(),
  importedConversations: z.number().int().nonnegative(),
  importedMessages: z.number().int().nonnegative(),
  skippedDuplicates: z.number().int().nonnegative(),
  status: z.enum(['completed', 'failed', 'partial']),
  completedAt: z.string(),
});
export type ImportExecutionResult = z.infer<typeof ImportExecutionResultSchema>;

/** Wave B — portable export bundle manifest (Spec 26). */
export const ExportManifestSchema = z.object({
  exportId: z.string(),
  exportedAt: z.string(),
  userId: z.string(),
  workspaceId: z.string(),
  counts: z.object({
    conversations: z.number().int().nonnegative(),
    messages: z.number().int().nonnegative(),
    files: z.number().int().nonnegative(),
  }),
  /** sha256 (hex) over the canonical JSON payload of the export bundle. */
  checksum: z.string().length(64),
});

export type ExportManifest = z.infer<typeof ExportManifestSchema>;

export const ExportBundleSchema = z.object({
  manifest: ExportManifestSchema,
  payload: z.record(z.unknown()),
});

export type ExportBundle = z.infer<typeof ExportBundleSchema>;
