/**
 * Activation & Privacy-Preserving Telemetry (Spec 21)
 *
 * All events are content-free, documented with purpose, and have 30-day retention.
 * Events are sent to POST /v1/telemetry/events
 * Metrics are sent to POST /v1/telemetry/metrics (batched)
 */

import { apiUrl } from '../config';
import { getAccessToken } from './secure-storage.js';

export type TelemetryEventName =
  | 'onboarding_step_completed'
  | 'first_conversation_started'
  | 'discovery_to_acceptance'
  | 'permission_prompt_shown';

export interface TelemetryEventBase {
  eventId: string;
  eventName: TelemetryEventName;
  occurredAt: string;
  actorType: 'personal_user' | 'business_agent' | 'admin' | 'system';
  anonymizedCategory: string;
  clientPlatform: 'web' | 'mobile_ios' | 'mobile_android' | 'api';
}

export interface OnboardingStepCompletedEvent extends TelemetryEventBase {
  eventName: 'onboarding_step_completed';
  anonymizedCategory: 'onboarding';
  step: 'signin_method' | 'handle' | 'privacy_preset' | 'profile' | 'complete';
  durationMs: number;
}

export interface FirstConversationStartedEvent extends TelemetryEventBase {
  eventName: 'first_conversation_started';
  anonymizedCategory: 'activation';
  method: 'handle_search' | 'invite_link' | 'demo' | 'contact_match' | 'qr_code';
  timeToFirstMessageMs: number;
}

export interface DiscoveryToAcceptanceEvent extends TelemetryEventBase {
  eventName: 'discovery_to_acceptance';
  anonymizedCategory: 'discovery';
  method: 'handle_search' | 'invite_link' | 'qr_code' | 'contact_match';
  accepted: boolean;
  timeMs: number;
}

export interface PermissionPromptShownEvent extends TelemetryEventBase {
  eventName: 'permission_prompt_shown';
  anonymizedCategory: 'permissions';
  permission: 'contacts' | 'notifications' | 'camera' | 'microphone' | 'clipboard';
  accepted: boolean;
}

export type TelemetryEvent =
  | OnboardingStepCompletedEvent
  | FirstConversationStartedEvent
  | DiscoveryToAcceptanceEvent
  | PermissionPromptShownEvent;

export type MetricEventName =
  // Reliability
  | 'delivery_success'
  | 'duplicate_send_rate'
  | 'reconnect_recovery'
  | 'crash_free_sessions'
  | 'push_delivery_health'
  // Performance
  | 'app_startup'
  | 'inbox_render'
  | 'scroll_smoothness'
  | 'search_latency'
  | 'upload_completion'
  // Usability
  | 'onboarding_completion'
  | 'contact_request_success'
  | 'privacy_control_discoverability'
  | 'accessibility_defect'
  // Business
  | 'assignment_completion'
  | 'handoff_completion'
  | 'response_time_distribution'
  // Trust
  | 'export_completion'
  | 'deletion_completion'
  | 'session_revocation'
  | 'report_handling_time'
  | 'privacy_comprehension'
  | 'internal_note_leak_count';

export interface MetricEvent {
  name: MetricEventName;
  properties: Record<string, unknown>;
  timestamp: string;
}

const EVENT_PURPOSES: Record<TelemetryEventName, string> = {
  onboarding_step_completed: 'Measure onboarding funnel completion and step duration to identify drop-off points.',
  first_conversation_started: 'Track time-to-value: how long until a new user sends their first message.',
  discovery_to_acceptance: 'Measure discovery method effectiveness and acceptance rates.',
  permission_prompt_shown: 'Track permission prompt acceptance rates for UX optimization.',
};

const METRIC_PURPOSES: Record<MetricEventName, string> = {
  // Reliability
  delivery_success: 'Track message delivery success rate and latency per conversation.',
  duplicate_send_rate: 'Measure duplicate message send rate to detect client/server issues.',
  reconnect_recovery: 'Track WebSocket reconnection success rate and duration.',
  crash_free_sessions: 'Measure crash-free session rate for reliability monitoring.',
  push_delivery_health: 'Track push notification delivery health (sent/delivered/failed).',
  // Performance
  app_startup: 'Measure application startup time (cold vs warm).',
  inbox_render: 'Track inbox render performance with message count.',
  scroll_smoothness: 'Measure scroll frame time for 60fps target.',
  search_latency: 'Track search query latency and result count.',
  upload_completion: 'Measure file upload completion time and success rate.',
  // Usability
  onboarding_completion: 'Track onboarding step completion rates and duration.',
  contact_request_success: 'Measure contact request success rate by method.',
  privacy_control_discoverability: 'Track whether users can find privacy controls.',
  accessibility_defect: 'Log accessibility defects found during testing.',
  // Business
  assignment_completion: 'Track conversation assignment time-to-assign.',
  handoff_completion: 'Measure human-to-human handoff completion time.',
  response_time_distribution: 'Track response time percentiles (p50, p95, p99).',
  // Trust
  export_completion: 'Track data export completion rate and performance.',
  deletion_completion: 'Measure data deletion completion by type.',
  session_revocation: 'Track session revocation reasons.',
  report_handling_time: 'Measure abuse report handling time.',
  privacy_comprehension: 'Track privacy policy comprehension survey scores.',
  internal_note_leak_count: 'Count internal note leakage incidents.',
};

const EVENT_RETENTION_DAYS = 30;
const METRIC_RETENTION_DAYS = 90;

function generateEventId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

function getActorType(): TelemetryEventBase['actorType'] {
  return 'personal_user';
}

function getClientPlatform(): TelemetryEventBase['clientPlatform'] {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('iphone') || ua.includes('ipad')) return 'mobile_ios';
  if (ua.includes('android')) return 'mobile_android';
  return 'web';
}

async function sendEvent(event: TelemetryEvent): Promise<boolean> {
  try {
    const token = await getAccessToken();
    const res = await fetch(apiUrl('/v1/telemetry/events'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(event),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// Metrics batching
const METRICS_BATCH_SIZE = 10;
const METRICS_FLUSH_INTERVAL_MS = 5000;
let metricsBuffer: MetricEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

async function flushMetrics(): Promise<void> {
  if (metricsBuffer.length === 0) return;
  const batch = metricsBuffer.splice(0, METRICS_BATCH_SIZE);
  try {
    const token = await getAccessToken();
    await Promise.all(batch.map(event =>
      fetch(apiUrl('/v1/telemetry/metrics'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ name: event.name, properties: event.properties }),
      })
    ));
  } catch {
    // Best effort
  }
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushMetrics();
  }, METRICS_FLUSH_INTERVAL_MS);
}

export function recordMetric(name: MetricEventName, properties: Record<string, unknown>): void {
  const event: MetricEvent = {
    name,
    properties,
    timestamp: new Date().toISOString(),
  };
  metricsBuffer.push(event);
  if (metricsBuffer.length >= METRICS_BATCH_SIZE) {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    flushMetrics();
  } else {
    scheduleFlush();
  }
}

export function trackOnboardingStepCompleted(
  step: OnboardingStepCompletedEvent['step'],
  durationMs: number
): void {
  const event: OnboardingStepCompletedEvent = {
    eventId: generateEventId(),
    eventName: 'onboarding_step_completed',
    occurredAt: new Date().toISOString(),
    actorType: getActorType(),
    anonymizedCategory: 'onboarding',
    clientPlatform: getClientPlatform(),
    step,
    durationMs,
  };
  void sendEvent(event);
}

export function trackFirstConversationStarted(
  method: FirstConversationStartedEvent['method'],
  timeToFirstMessageMs: number
): void {
  const event: FirstConversationStartedEvent = {
    eventId: generateEventId(),
    eventName: 'first_conversation_started',
    occurredAt: new Date().toISOString(),
    actorType: getActorType(),
    anonymizedCategory: 'activation',
    clientPlatform: getClientPlatform(),
    method,
    timeToFirstMessageMs,
  };
  void sendEvent(event);
}

export function trackDiscoveryToAcceptance(
  method: DiscoveryToAcceptanceEvent['method'],
  accepted: boolean,
  timeMs: number
): void {
  const event: DiscoveryToAcceptanceEvent = {
    eventId: generateEventId(),
    eventName: 'discovery_to_acceptance',
    occurredAt: new Date().toISOString(),
    actorType: getActorType(),
    anonymizedCategory: 'discovery',
    clientPlatform: getClientPlatform(),
    method,
    accepted,
    timeMs,
  };
  void sendEvent(event);
}

export function trackPermissionPromptShown(
  permission: PermissionPromptShownEvent['permission'],
  accepted: boolean
): void {
  const event: PermissionPromptShownEvent = {
    eventId: generateEventId(),
    eventName: 'permission_prompt_shown',
    occurredAt: new Date().toISOString(),
    actorType: getActorType(),
    anonymizedCategory: 'permissions',
    clientPlatform: getClientPlatform(),
    permission,
    accepted,
  };
  void sendEvent(event);
}

export function getEventPurpose(eventName: TelemetryEventName): string {
  return EVENT_PURPOSES[eventName] ?? 'Unknown event';
}

export function getMetricPurpose(metricName: MetricEventName): string {
  return METRIC_PURPOSES[metricName] ?? 'Unknown metric';
}

export function getEventRetentionDays(): number {
  return EVENT_RETENTION_DAYS;
}

export function getMetricRetentionDays(): number {
  return METRIC_RETENTION_DAYS;
}

export function getAllEventDefinitions(): Array<{ name: TelemetryEventName; purpose: string; retentionDays: number }> {
  return (Object.keys(EVENT_PURPOSES) as TelemetryEventName[]).map((name) => ({
    name,
    purpose: EVENT_PURPOSES[name],
    retentionDays: EVENT_RETENTION_DAYS,
  }));
}

export function getAllMetricDefinitions(): Array<{ name: MetricEventName; purpose: string; retentionDays: number }> {
  return (Object.keys(METRIC_PURPOSES) as MetricEventName[]).map((name) => ({
    name,
    purpose: METRIC_PURPOSES[name],
    retentionDays: METRIC_RETENTION_DAYS,
  }));
}

// Hook for React components
export function useTelemetry() {
  return {
    trackOnboardingStepCompleted,
    trackFirstConversationStarted,
    trackDiscoveryToAcceptance,
    trackPermissionPromptShown,
    recordMetric,
    getEventPurpose,
    getMetricPurpose,
    getEventRetentionDays,
    getMetricRetentionDays,
    getAllEventDefinitions,
    getAllMetricDefinitions,
  };
}

// Flush on page unload
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    if (metricsBuffer.length > 0) {
      navigator.sendBeacon(
        apiUrl('/v1/telemetry/metrics'),
        JSON.stringify(metricsBuffer.map(e => ({ name: e.name, properties: e.properties })))
      );
    }
  });
}