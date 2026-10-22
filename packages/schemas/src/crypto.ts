import { z } from 'zod';

export const KeyBundleSchema = z.object({
  accountId: z.string().uuid(),
  deviceId: z.string().min(1),
  identityKeyPub: z.string().min(32),
  signedPreKeyPub: z.string().min(32),
  signedPreKeySig: z.string().min(32),
  oneTimePreKeys: z.array(z.string().min(32)).min(1),
  registrationId: z.number().int().positive(),
  createdAt: z.string().datetime(),
});

export type KeyBundle = z.infer<typeof KeyBundleSchema>;

export const SafetyNumberSchema = z.object({
  numericCode: z.string().regex(/^\d{5}( \d{5}){11}$/),
  qrPayload: z.string().min(20),
  fingerprintA: z.string().length(64),
  fingerprintB: z.string().length(64),
  computedAt: z.string().datetime(),
});

export type SafetyNumber = z.infer<typeof SafetyNumberSchema>;

export const KeyVerificationRecordSchema = z.object({
  contactAccountId: z.string().uuid(),
  contactIdentityKeyPub: z.string().min(32),
  safetyNumber: z.string(),
  status: z.enum(['verified', 'unverified', 'key_change_detected']),
  verifiedAt: z.string().datetime().nullable(),
  previousIdentityKeyPub: z.string().nullable().optional(),
});

export type KeyVerificationRecord = z.infer<typeof KeyVerificationRecordSchema>;
