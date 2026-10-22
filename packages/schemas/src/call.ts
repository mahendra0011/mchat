import { z } from 'zod';

export const CallKindSchema = z.enum(['audio', 'video']);
export const CallStatusSchema = z.enum(['ringing', 'active', 'ended', 'missed', 'declined', 'failed']);

export const CreateCallRequestSchema = z.object({
  conversationId: z.string().min(1),
  kind: CallKindSchema,
});
export type CreateCallRequest = z.infer<typeof CreateCallRequestSchema>;

export const CallSessionSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  callerWorkspaceId: z.string(),
  calleeWorkspaceIds: z.array(z.string()),
  kind: CallKindSchema,
  status: CallStatusSchema,
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  durationSeconds: z.number().int().nonnegative(),
  sdpOffer: z.string().nullable(),
  sdpAnswer: z.string().nullable(),
  iceCandidates: z.array(z.string()),
});
export type CallSession = z.infer<typeof CallSessionSchema>;

export const CallSignalTypeSchema = z.enum(['offer', 'answer', 'candidate', 'ice-candidate', 'hangup']);
export type CallSignalType = z.infer<typeof CallSignalTypeSchema>;

export const CallSignalSchema = z.object({
  callId: z.string(),
  type: CallSignalTypeSchema,
  /** SDP/ICE blob (string) or a small structured body (e.g. `{}` for hangup). */
  payload: z.union([z.string(), z.record(z.unknown())]).default(''),
  /**
   * Optional recipient. Clients pass the callee's workspace id here; omit to
   * broadcast the signal to every call participant.
   */
  targetUserId: z.string().optional(),
});
export type CallSignal = z.infer<typeof CallSignalSchema>;

/** A relayed signal as stored in the bounded per-call queue. */
export const CallQueuedSignalSchema = z.object({
  /** Monotonic per-call sequence number (poll cursor for GET .../signal?after=). */
  seq: z.number().int().nonnegative(),
  callId: z.string(),
  type: CallSignalTypeSchema,
  payload: z.union([z.string(), z.record(z.unknown())]),
  senderWorkspaceId: z.string(),
  /** Null when the signal was broadcast to all participants. */
  targetUserId: z.string().nullable(),
  /** Resolved workspace the signal was queued for; null when broadcast/unresolved. */
  targetWorkspaceId: z.string().nullable(),
  createdAt: z.string(),
});
export type CallQueuedSignal = z.infer<typeof CallQueuedSignalSchema>;
