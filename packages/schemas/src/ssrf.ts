import { z } from 'zod';

export const DestinationCategorySchema = z.enum([
  'PUBLIC_SAFE',
  'BLOCKED_PRIVATE_RANGE',
  'BLOCKED_LOOPBACK',
  'BLOCKED_CLOUD_METADATA',
  'BLOCKED_NON_HTTPS',
  'BLOCKED_MALFORMED',
]);

export type DestinationCategory = z.infer<typeof DestinationCategorySchema>;

export const SafeUrlValidationRequestSchema = z.object({
  url: z.string().url(),
  context: z.enum(['link_preview', 'webhook_egress', 'data_import']).default('link_preview'),
});

export type SafeUrlValidationRequest = z.infer<typeof SafeUrlValidationRequestSchema>;

export const SafeUrlValidationResultSchema = z.object({
  isAllowed: z.boolean(),
  normalizedUrl: z.string(),
  destinationCategory: DestinationCategorySchema,
  resolvedIp: z.string().optional(),
  reason: z.string(),
});

export type SafeUrlValidationResult = z.infer<typeof SafeUrlValidationResultSchema>;
