import { z } from 'zod';

export const WorkflowCardTypeSchema = z.enum([
  'approval',
  'task',
  'agenda',
  'checklist',
  'poll',
]);
export type WorkflowCardType = z.infer<typeof WorkflowCardTypeSchema>;

export const WorkflowStatusSchema = z.enum([
  'pending',
  'in_progress',
  'approved',
  'rejected',
  'completed',
]);
export type WorkflowStatus = z.infer<typeof WorkflowStatusSchema>;

export const WorkflowActionHistorySchema = z.object({
  actionId: z.string().uuid(),
  actorWorkspaceId: z.string().uuid(),
  actorName: z.string(),
  action: z.string(),
  comment: z.string().optional(),
  timestamp: z.string().datetime(),
});

export type WorkflowActionHistory = z.infer<typeof WorkflowActionHistorySchema>;

export const WorkflowCardSchema = z.object({
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  creatorWorkspaceId: z.string().uuid(),
  creatorName: z.string(),
  cardType: WorkflowCardTypeSchema,
  title: z.string().min(1).max(120),
  description: z.string().max(1000).optional(),
  status: WorkflowStatusSchema.default('pending'),
  assigneeWorkspaceId: z.string().uuid().nullable().optional(),
  assigneeName: z.string().optional(),
  dueDate: z.string().datetime().nullable().optional(),
  options: z.array(z.object({
    id: z.string(),
    label: z.string(),
    votes: z.number().int().nonnegative().default(0),
    checked: z.boolean().default(false),
  })).optional(),
  history: z.array(WorkflowActionHistorySchema).default([]),
  /** Wave B — workflow record schema version (bumped on breaking shape changes). */
  schemaVersion: z.number().int().positive().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type WorkflowCard = z.infer<typeof WorkflowCardSchema>;

export const CreateWorkflowCardRequestSchema = z.object({
  cardType: WorkflowCardTypeSchema,
  title: z.string().min(1).max(120),
  description: z.string().max(1000).optional(),
  assigneeWorkspaceId: z.string().uuid().optional(),
  dueDate: z.string().datetime().optional(),
  options: z.array(z.object({
    id: z.string(),
    label: z.string(),
  })).optional(),
});

export type CreateWorkflowCardRequest = z.infer<typeof CreateWorkflowCardRequestSchema>;

export const UpdateWorkflowActionRequestSchema = z.object({
  action: z.enum(['approve', 'reject', 'complete', 'toggle_option', 'reassign']),
  comment: z.string().max(500).optional(),
  optionId: z.string().optional(),
  assigneeWorkspaceId: z.string().uuid().optional(),
});

export type UpdateWorkflowActionRequest = z.infer<typeof UpdateWorkflowActionRequestSchema>;

/** Wave B — execute a named action exposed by a workflow card definition. */
export const ExecuteWorkflowActionRequestSchema = z.object({
  actionId: z.string().min(1).max(64),
  payload: z.record(z.unknown()).optional(),
});

export type ExecuteWorkflowActionRequest = z.infer<typeof ExecuteWorkflowActionRequestSchema>;
