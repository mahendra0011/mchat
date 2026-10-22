import { z } from 'zod';

export const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string(),
    retryable: z.boolean().default(false),
  }),
});

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

export const CursorPaginationQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export type CursorPaginationQuery = z.infer<typeof CursorPaginationQuerySchema>;

export const PaginatedResponseSchema = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.object({
    items: z.array(itemSchema),
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
  });

export const RealtimeEventSchema = z.object({
  eventId: z.string().uuid(),
  type: z.string(),
  schemaVersion: z.number().int().default(1),
  workspaceId: z.string().uuid(),
  conversationId: z.string().uuid().optional(),
  cursor: z.string(),
  occurredAt: z.string().datetime(),
  payload: z.record(z.any()),
});

export type RealtimeEvent = z.infer<typeof RealtimeEventSchema>;
