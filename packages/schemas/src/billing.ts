import { z } from 'zod';

export const BillingPlanTierSchema = z.enum([
  'personal_free',
  'personal_plus',
  'business_starter',
  'business_scale',
]);
export type BillingPlanTier = z.infer<typeof BillingPlanTierSchema>;

export const BillingStatusSchema = z.enum([
  'active',
  'grace_period',
  'past_due',
  'cancelled',
]);
export type BillingStatus = z.infer<typeof BillingStatusSchema>;

export const BillingEntitlementSchema = z.object({
  workspaceId: z.string(),
  plan: BillingPlanTierSchema,
  status: BillingStatusSchema,
  billingOwnerUserId: z.string(),
  seatsAllocated: z.number().int().positive(),
  seatsUsed: z.number().int().nonnegative(),
  storageQuotaBytes: z.number().nonnegative(),
  storageUsedBytes: z.number().nonnegative(),
  maxFileSizeMB: z.number().positive(),
  customThemesAllowed: z.boolean(),
  workflowCardsAllowed: z.boolean(),
  auditExportAllowed: z.boolean(),
  activeIntegrationsCount: z.number().int().nonnegative(),
  maxIntegrationsAllowed: z.number().int().positive(),
  renewalDate: z.string(),
  cancelAtPeriodEnd: z.boolean().optional(),
  metadata: z.record(z.unknown()).optional().default({}),
});
export type BillingEntitlement = z.infer<typeof BillingEntitlementSchema>;

export const InvoiceRecordSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  invoiceNumber: z.string(),
  amountCents: z.number().int().nonnegative(),
  currency: z.string().default('USD'),
  date: z.string(),
  status: z.enum(['paid', 'open', 'refunded']),
  description: z.string(),
});
export type InvoiceRecord = z.infer<typeof InvoiceRecordSchema>;
