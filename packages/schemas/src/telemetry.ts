import { z } from 'zod';

export const TelemetryEventNameSchema = z.enum([
  'signup_completed',
  'first_message_sent',
  'message_delivery_failed',
  'reconnect_succeeded',
  'workspace_switch_completed',
  'business_assignment_created',
  'export_completed',
  'settings_privacy_changed',
  'contact_request_sent',
  'contact_request_resolved',
  'integration_installed',
  'plan_upgraded',
]);
export type TelemetryEventName = z.infer<typeof TelemetryEventNameSchema>;

export const PrivacyTelemetryEventSchema = z.object({
  eventId: z.string(),
  eventName: TelemetryEventNameSchema,
  occurredAt: z.string(),
  actorType: z.enum(['personal_user', 'business_agent', 'admin', 'system']),
  // Non-revealing category tag (e.g. 'privacy_preset_high', 'theme_dark')
  anonymizedCategory: z.string(),
  clientPlatform: z.enum(['web', 'mobile_ios', 'mobile_android', 'api']),
});
export type PrivacyTelemetryEvent = z.infer<typeof PrivacyTelemetryEventSchema>;
