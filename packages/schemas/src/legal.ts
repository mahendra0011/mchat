import { z } from 'zod';

export const LegalDocumentTypeSchema = z.enum([
  'tos',
  'privacy',
  'aup',
  'cookie',
  'business_terms',
  'dpa',
]);
export type LegalDocumentType = z.infer<typeof LegalDocumentTypeSchema>;

export const LegalDocumentSchema = z.object({
  id: z.string(),
  type: LegalDocumentTypeSchema,
  version: z.string(),
  contentMarkdown: z.string(),
  effectiveAt: z.string().datetime(),
  jurisdictions: z.array(z.string()).default([]),
  requiredConsent: z.boolean().default(true),
  createdAt: z.string().datetime(),
  createdBy: z.string(),
});
export type LegalDocument = z.infer<typeof LegalDocumentSchema>;

export const UserLegalConsentSchema = z.object({
  id: z.string(),
  userId: z.string(),
  documentId: z.string(),
  consentedAt: z.string().datetime(),
  version: z.string(),
  ipHash: z.string().optional(),
});
export type UserLegalConsent = z.infer<typeof UserLegalConsentSchema>;

export const CreateLegalDocumentRequestSchema = z.object({
  type: LegalDocumentTypeSchema,
  version: z.string(),
  contentMarkdown: z.string(),
  effectiveAt: z.string().datetime(),
  jurisdictions: z.array(z.string()).default([]),
  requiredConsent: z.boolean().default(true),
});
export type CreateLegalDocumentRequest = z.infer<typeof CreateLegalDocumentRequestSchema>;

export const LegalConsentRequestSchema = z.object({
  documentId: z.string(),
  consentedAt: z.string().datetime(),
});
export type LegalConsentRequest = z.infer<typeof LegalConsentRequestSchema>;

export const CurrentLegalDocumentsResponseSchema = z.object({
  data: z.record(LegalDocumentTypeSchema, LegalDocumentSchema),
});
export type CurrentLegalDocumentsResponse = z.infer<typeof CurrentLegalDocumentsResponseSchema>;