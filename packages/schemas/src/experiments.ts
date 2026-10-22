import { z } from 'zod';

export const ExperimentAudienceSchema = z.enum(['all', 'segment', 'percentage']);
export type ExperimentAudience = z.infer<typeof ExperimentAudienceSchema>;

export const RandomizationUnitSchema = z.enum(['account', 'workspace']);
export type RandomizationUnit = z.infer<typeof RandomizationUnitSchema>;

export const ExperimentStatusSchema = z.enum(['draft', 'running', 'paused', 'completed']);
export type ExperimentStatus = z.infer<typeof ExperimentStatusSchema>;

export const ExperimentVariantSchema = z.enum(['control', 'treatment']);
export type ExperimentVariant = z.infer<typeof ExperimentVariantSchema>;

export const ExperimentDefinitionSchema = z.object({
  id: z.string().min(1),
  hypothesis: z.string().min(1),
  audience: ExperimentAudienceSchema,
  audienceConfig: z.record(z.unknown()).default({}),
  randomizationUnit: RandomizationUnitSchema,
  primaryMetric: z.string().min(1),
  guardrailMetrics: z.array(z.string()).default([]),
  owner: z.string().min(1),
  rollbackThreshold: z.record(z.unknown()).default({}),
  status: ExperimentStatusSchema.default('draft'),
  startDate: z.string().datetime().nullable().optional(),
  endDate: z.string().datetime().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ExperimentDefinition = z.infer<typeof ExperimentDefinitionSchema>;

export const ExperimentAssignmentSchema = z.object({
  id: z.string().min(1),
  experimentId: z.string().min(1),
  unitId: z.string().min(1),
  unitType: RandomizationUnitSchema,
  variant: ExperimentVariantSchema,
  assignedAt: z.string().datetime(),
});
export type ExperimentAssignment = z.infer<typeof ExperimentAssignmentSchema>;

export const ResearchStudyStatusSchema = z.enum(['draft', 'recruiting', 'active', 'completed', 'archived']);
export type ResearchStudyStatus = z.infer<typeof ResearchStudyStatusSchema>;

export const ResearchParticipantStatusSchema = z.enum(['invited', 'consented', 'scheduled', 'completed', 'withdrawn']);
export type ResearchParticipantStatus = z.infer<typeof ResearchParticipantStatusSchema>;

export const ResearchStudySchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  tasks: z.array(z.object({
    id: z.string(),
    title: z.string(),
    description: z.string(),
    expectedDurationMinutes: z.number().int().positive(),
  })).default([]),
  targetAudience: z.record(z.unknown()).default({}),
  durationMinutes: z.number().int().positive(),
  compensation: z.string().nullable().optional(),
  status: ResearchStudyStatusSchema.default('draft'),
  recordingConsent: z.boolean().default(true),
  recordingRetentionDays: z.number().int().positive().default(90),
  createdBy: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ResearchStudy = z.infer<typeof ResearchStudySchema>;

export const ResearchParticipantSchema = z.object({
  id: z.string().min(1),
  studyId: z.string().min(1),
  userId: z.string().min(1),
  consentedAt: z.string().datetime(),
  status: ResearchParticipantStatusSchema.default('invited'),
  createdAt: z.string().datetime(),
});
export type ResearchParticipant = z.infer<typeof ResearchParticipantSchema>;

export const ResearchPoolSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  demographics: z.record(z.unknown()).default({}),
  incentives: z.array(z.object({
    type: z.enum(['monetary', 'credits', 'swag', 'early_access']),
    value: z.string(),
  })).default([]),
  createdBy: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ResearchPool = z.infer<typeof ResearchPoolSchema>;

export const AccessibilityScenarioSchema = z.enum([
  'keyboard_only',
  'screen_reader',
  'reduced_motion',
  'low_bandwidth',
  'small_screen',
  'low_end_device',
]);
export type AccessibilityScenario = z.infer<typeof AccessibilityScenarioSchema>;

export const PREDEFINED_ACCESSIBILITY_SCENARIOS: AccessibilityScenario[] = [
  'keyboard_only',
  'screen_reader',
  'reduced_motion',
  'low_bandwidth',
  'small_screen',
  'low_end_device',
];