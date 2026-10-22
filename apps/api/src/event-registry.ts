import { z } from 'zod';
import type { DbClient } from './db/client.js';

export const EventDefinitionSchema = z.object({
  name: z.string().min(1),
  productQuestion: z.string().min(1),
  trigger: z.string().min(1),
  properties: z.array(z.object({
    name: z.string(),
    type: z.enum(['string', 'number', 'boolean', 'object']),
    required: z.boolean(),
    description: z.string(),
  })).min(1),
  purpose: z.string().min(1),
  collectionLocation: z.enum(['client', 'server', 'both']),
  consentOptOut: z.boolean(),
  retentionDays: z.number().int().positive(),
  accessRoles: z.array(z.string()).min(1),
  deletionBehavior: z.enum(['hard_delete', 'anonymize', 'aggregate_only']),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  version: z.number().int().positive().default(1),
});
export type EventDefinition = z.infer<typeof EventDefinitionSchema>;

export interface EventRegistryEntry {
  definition: EventDefinition;
  eventCount: number;
  lastSeenAt: string | null;
}

export class EventRegistry {
  private static instance: EventRegistry;
  private events = new Map<string, EventRegistryEntry>();
  private db: DbClient | null = null;

  private constructor() {}

  static getInstance(): EventRegistry {
    if (!EventRegistry.instance) {
      EventRegistry.instance = new EventRegistry();
    }
    return EventRegistry.instance;
  }

  setDb(db: DbClient): void {
    this.db = db;
  }

  async loadFromDb(): Promise<void> {
    if (!this.db) return;
    const result = await this.db.query('SELECT * FROM event_registry');
    for (const row of result.rows) {
      const definition = row.definition as EventDefinition;
      this.events.set(definition.name, {
        definition,
        eventCount: Number(row.event_count ?? 0),
        lastSeenAt: row.last_seen_at ? String(row.last_seen_at) : null,
      });
    }
  }

  register(event: EventDefinition): { success: boolean; error?: string } {
    const parseResult = EventDefinitionSchema.safeParse(event);
    if (!parseResult.success) {
      return { success: false, error: parseResult.error.message };
    }
    const validated = parseResult.data;
    const existing = this.events.get(validated.name);
    const now = new Date().toISOString();
    const entry: EventRegistryEntry = {
      definition: { ...validated, updatedAt: now, version: (existing?.definition.version ?? 0) + 1 },
      eventCount: existing?.eventCount ?? 0,
      lastSeenAt: existing?.lastSeenAt ?? null,
    };
    this.events.set(validated.name, entry);
    this.persistToDb(entry).catch(() => {});
    return { success: true };
  }

  get(name: string): EventRegistryEntry | undefined {
    return this.events.get(name);
  }

  list(): EventRegistryEntry[] {
    return Array.from(this.events.values()).sort((a, b) => a.definition.name.localeCompare(b.definition.name));
  }

  validate(eventName: string, payload: Record<string, unknown>): { valid: boolean; errors: string[] } {
    const entry = this.events.get(eventName);
    if (!entry) {
      return { valid: false, errors: [`Event ${eventName} not registered`] };
    }
    const errors: string[] = [];
    for (const prop of entry.definition.properties) {
      const value = payload[prop.name];
      if (prop.required && (value === undefined || value === null)) {
        errors.push(`Required property '${prop.name}' is missing`);
        continue;
      }
      if (value !== undefined && value !== null) {
        const typeMatch = this.checkType(value, prop.type);
        if (!typeMatch) {
          errors.push(`Property '${prop.name}' expected type ${prop.type}, got ${typeof value}`);
        }
      }
    }
    return { valid: errors.length === 0, errors };
  }

  private checkType(value: unknown, expectedType: string): boolean {
    switch (expectedType) {
      case 'string': return typeof value === 'string';
      case 'number': return typeof value === 'number' && !Number.isNaN(value);
      case 'boolean': return typeof value === 'boolean';
      case 'object': return typeof value === 'object' && value !== null;
      default: return true;
    }
  }

  incrementCount(eventName: string): void {
    const entry = this.events.get(eventName);
    if (entry) {
      entry.eventCount++;
      entry.lastSeenAt = new Date().toISOString();
      this.persistToDb(entry).catch(() => {});
    }
  }

  private async persistToDb(entry: EventRegistryEntry): Promise<void> {
    if (!this.db) return;
    await this.db.query(
      `INSERT INTO event_registry (name, definition, event_count, last_seen_at, updated_at)
       VALUES ($1, $2::jsonb, $3, $4, $5)
       ON CONFLICT (name) DO UPDATE SET
         definition = EXCLUDED.definition,
         event_count = EXCLUDED.event_count,
         last_seen_at = EXCLUDED.last_seen_at,
         updated_at = EXCLUDED.updated_at`,
      [
        entry.definition.name,
        JSON.stringify(entry.definition),
        entry.eventCount,
        entry.lastSeenAt,
        entry.definition.updatedAt,
      ]
    );
  }

  static createInitialEvents(): EventDefinition[] {
    const now = new Date().toISOString();
    return [
      {
        name: 'signup_completed',
        productQuestion: 'How many users complete signup?',
        trigger: 'User completes the onboarding flow',
        properties: [
          { name: 'method', type: 'string', required: true, description: 'Signup method (email, passkey, etc.)' },
          { name: 'durationMs', type: 'number', required: true, description: 'Time to complete signup' },
        ],
        purpose: 'Measure signup completion rate and funnel drop-off',
        collectionLocation: 'client',
        consentOptOut: true,
        retentionDays: 30,
        accessRoles: ['system_admin', 'analyst'],
        deletionBehavior: 'anonymize',
        createdAt: now,
        updatedAt: now,
        version: 1,
      },
      {
        name: 'first_message_sent',
        productQuestion: 'How many users send their first message?',
        trigger: 'User sends their first message in any conversation',
        properties: [
          { name: 'conversationType', type: 'string', required: true, description: 'direct, group, or business' },
          { name: 'timeToFirstMessageMs', type: 'number', required: true, description: 'Time from signup to first message' },
        ],
        purpose: 'Track activation metric: time to first message',
        collectionLocation: 'client',
        consentOptOut: true,
        retentionDays: 30,
        accessRoles: ['system_admin', 'analyst'],
        deletionBehavior: 'anonymize',
        createdAt: now,
        updatedAt: now,
        version: 1,
      },
{
        name: 'release_deploy',
        productQuestion: 'What is the release deploy history and success rate?',
        trigger: 'A release is deployed to an environment',
        properties: [
          { name: 'env', type: 'string', required: true, description: 'Target environment (development, staging, production)' },
          { name: 'version', type: 'string', required: true, description: 'Deployed version string' },
          { name: 'durationMs', type: 'number', required: true, description: 'Duration of the deploy in ms' },
          { name: 'success', type: 'boolean', required: true, description: 'Whether the deploy succeeded' },
          { name: 'rollback', type: 'boolean', required: true, description: 'Whether the deploy was rolled back' },
        ],
        purpose: 'Track release deploy outcomes and reliability across environments',
        collectionLocation: 'server',
        consentOptOut: false,
        retentionDays: 90,
        accessRoles: ['system_admin', 'analyst'],
        deletionBehavior: 'aggregate_only',
        createdAt: now,
        updatedAt: now,
        version: 1,
      },
      {
        name: 'release_health',
        productQuestion: 'What is the current health state of each environment?',
        trigger: 'Periodic health check or deploy completion',
        properties: [
          { name: 'env', type: 'string', required: true, description: 'Environment name (development, staging, production)' },
          { name: 'version', type: 'string', required: true, description: 'Current running version' },
          { name: 'cpu', type: 'number', required: true, description: 'CPU usage percentage' },
          { name: 'memory', type: 'number', required: true, description: 'Memory usage MB' },
          { name: 'uptime', type: 'number', required: true, description: 'Uptime in seconds' },
          { name: 'activeConnections', type: 'number', required: true, description: 'Number of active connections' },
          { name: 'errorRate', type: 'number', required: true, description: 'Error rate percentage' },
        ],
        purpose: 'Monitor environment health metrics for release readiness',
        collectionLocation: 'server',
        consentOptOut: false,
        retentionDays: 90,
        accessRoles: ['system_admin', 'analyst'],
        deletionBehavior: 'aggregate_only',
        createdAt: now,
        updatedAt: now,
        version: 1,
      },
      {
        name: 'release_vulnerability',
        productQuestion: 'What new vulnerabilities are detected in the release pipeline?',
        trigger: 'A new vulnerability is identified in the release pipeline or dependencies',
        properties: [
          { name: 'cve', type: 'string', required: true, description: 'CVE identifier' },
          { name: 'severity', type: 'string', required: true, description: 'Severity (low, medium, high, critical)' },
          { name: 'status', type: 'string', required: true, description: 'Status (open, triaged, resolved, false_positive)' },
          { name: 'trackedSince', type: 'string', required: true, description: 'ISO timestamp when vulnerability was first tracked' },
        ],
        purpose: 'Track security vulnerabilities detected in the release pipeline',
        collectionLocation: 'server',
        consentOptOut: false,
        retentionDays: 365,
        accessRoles: ['system_admin', 'security_ops'],
        deletionBehavior: 'hard_delete',
        createdAt: now,
        updatedAt: now,
        version: 1,
      },
      {
        name: 'reconnect_succeeded',
        productQuestion: 'How often do clients successfully reconnect?',
        trigger: 'WebSocket reconnection completes',
        properties: [
          { name: 'durationMs', type: 'number', required: true, description: 'Reconnection duration' },
          { name: 'success', type: 'boolean', required: true, description: 'Whether reconnection succeeded' },
        ],
        purpose: 'Track reconnect reliability and recovery time',
        collectionLocation: 'client',
        consentOptOut: true,
        retentionDays: 30,
        accessRoles: ['system_admin', 'analyst'],
        deletionBehavior: 'anonymize',
        createdAt: now,
        updatedAt: now,
        version: 1,
      },
      {
        name: 'workspace_switch_completed',
        productQuestion: 'How often do users switch workspaces?',
        trigger: 'User switches active workspace',
        properties: [
          { name: 'fromType', type: 'string', required: true, description: 'Source workspace type' },
          { name: 'toType', type: 'string', required: true, description: 'Target workspace type' },
        ],
        purpose: 'Understand multi-workspace usage patterns',
        collectionLocation: 'client',
        consentOptOut: true,
        retentionDays: 30,
        accessRoles: ['system_admin', 'analyst'],
        deletionBehavior: 'anonymize',
        createdAt: now,
        updatedAt: now,
        version: 1,
      },
      {
        name: 'business_assignment_created',
        productQuestion: 'How often are business conversations assigned?',
        trigger: 'Conversation assigned to an agent',
        properties: [
          { name: 'conversationId', type: 'string', required: true, description: 'Conversation ID' },
          { name: 'timeToAssignMs', type: 'number', required: true, description: 'Time from creation to assignment' },
        ],
        purpose: 'Measure business workflow efficiency',
        collectionLocation: 'server',
        consentOptOut: false,
        retentionDays: 90,
        accessRoles: ['system_admin', 'analyst'],
        deletionBehavior: 'aggregate_only',
        createdAt: now,
        updatedAt: now,
        version: 1,
      },
      {
        name: 'export_completed',
        productQuestion: 'How many users export their data?',
        trigger: 'User completes a data export',
        properties: [
          { name: 'sizeBytes', type: 'number', required: true, description: 'Export file size' },
          { name: 'durationMs', type: 'number', required: true, description: 'Export generation time' },
          { name: 'success', type: 'boolean', required: true, description: 'Whether export succeeded' },
        ],
        purpose: 'Track data portability usage and performance',
        collectionLocation: 'server',
        consentOptOut: false,
        retentionDays: 90,
        accessRoles: ['system_admin', 'analyst'],
        deletionBehavior: 'aggregate_only',
        createdAt: now,
        updatedAt: now,
        version: 1,
      },
      {
        name: 'settings_privacy_changed',
        productQuestion: 'Which privacy settings do users change?',
        trigger: 'User modifies a privacy setting',
        properties: [
          { name: 'setting', type: 'string', required: true, description: 'Setting name' },
          { name: 'newValue', type: 'string', required: true, description: 'New setting value' },
        ],
        purpose: 'Understand privacy preference adoption',
        collectionLocation: 'client',
        consentOptOut: true,
        retentionDays: 30,
        accessRoles: ['system_admin', 'analyst'],
        deletionBehavior: 'anonymize',
        createdAt: now,
        updatedAt: now,
        version: 1,
      },
      {
        name: 'contact_request_sent',
        productQuestion: 'How many contact requests are initiated?',
        trigger: 'User sends a contact request',
        properties: [
          { name: 'method', type: 'string', required: true, description: 'Discovery method' },
        ],
        purpose: 'Measure stranger discovery adoption',
        collectionLocation: 'client',
        consentOptOut: true,
        retentionDays: 30,
        accessRoles: ['system_admin', 'analyst'],
        deletionBehavior: 'anonymize',
        createdAt: now,
        updatedAt: now,
        version: 1,
      },
      {
        name: 'contact_request_resolved',
        productQuestion: 'What is the contact request acceptance rate?',
        trigger: 'Contact request is accepted or ignored',
        properties: [
          { name: 'accepted', type: 'boolean', required: true, description: 'Whether request was accepted' },
        ],
        purpose: 'Track contact request conversion',
        collectionLocation: 'server',
        consentOptOut: false,
        retentionDays: 90,
        accessRoles: ['system_admin', 'analyst'],
        deletionBehavior: 'aggregate_only',
        createdAt: now,
        updatedAt: now,
        version: 1,
      },
      {
        name: 'integration_installed',
        productQuestion: 'Which integrations are most popular?',
        trigger: 'User installs an integration',
        properties: [
          { name: 'integrationId', type: 'string', required: true, description: 'Integration identifier' },
        ],
        purpose: 'Track integration adoption',
        collectionLocation: 'client',
        consentOptOut: true,
        retentionDays: 30,
        accessRoles: ['system_admin', 'analyst'],
        deletionBehavior: 'anonymize',
        createdAt: now,
        updatedAt: now,
        version: 1,
      },
      {
        name: 'plan_upgraded',
        productQuestion: 'What drives plan upgrades?',
        trigger: 'Workspace upgrades to a paid plan',
        properties: [
          { name: 'fromPlan', type: 'string', required: true, description: 'Previous plan' },
          { name: 'toPlan', type: 'string', required: true, description: 'New plan' },
        ],
        purpose: 'Measure monetization conversion',
        collectionLocation: 'server',
        consentOptOut: false,
        retentionDays: 365,
        accessRoles: ['system_admin', 'analyst'],
        deletionBehavior: 'aggregate_only',
        createdAt: now,
        updatedAt: now,
        version: 1,
      },
      // Reliability metrics
      {
        name: 'delivery_success',
        productQuestion: 'What is the message delivery success rate?',
        trigger: 'Message delivered successfully to recipient',
        properties: [
          { name: 'conversationId', type: 'string', required: true, description: 'Conversation ID' },
          { name: 'latencyMs', type: 'number', required: true, description: 'Delivery latency in ms' },
          { name: 'serverTimestamp', type: 'number', required: false, description: 'Server timestamp of delivery' },
        ],
        purpose: 'Track message delivery success rate and latency per conversation.',
        collectionLocation: 'server',
        consentOptOut: false,
        retentionDays: 90,
        accessRoles: ['system_admin', 'analyst'],
        deletionBehavior: 'aggregate_only',
        createdAt: now,
        updatedAt: now,
        version: 1,
      },
      {
        name: 'duplicate_send_rate',
        productQuestion: 'What is the duplicate message send rate?',
        trigger: 'Client detects a duplicate message send',
        properties: [
          { name: 'conversationId', type: 'string', required: true, description: 'Conversation ID' },
          { name: 'duplicateCount', type: 'number', required: true, description: 'Number of duplicates detected' },
          { name: 'timeWindowMs', type: 'number', required: true, description: 'Time window for detection' },
        ],
        purpose: 'Measure duplicate message send rate to detect client/server issues.',
        collectionLocation: 'client',
        consentOptOut: true,
        retentionDays: 90,
        accessRoles: ['system_admin', 'analyst'],
        deletionBehavior: 'aggregate_only',
        createdAt: now,
        updatedAt: now,
        version: 1,
      },
      {
        name: 'reconnect_recovery',
        productQuestion: 'How often do clients successfully recover after disconnect?',
        trigger: 'WebSocket reconnection completes with recovery',
        properties: [
          { name: 'durationMs', type: 'number', required: true, description: 'Reconnection and recovery duration' },
          { name: 'success', type: 'boolean', required: true, description: 'Whether recovery succeeded' },
        ],
        purpose: 'Track WebSocket reconnection success rate and recovery time.',
        collectionLocation: 'client',
        consentOptOut: true,
        retentionDays: 30,
        accessRoles: ['system_admin', 'analyst'],
        deletionBehavior: 'anonymize',
        createdAt: now,
        updatedAt: now,
        version: 1,
      },
      {
        name: 'crash_free_sessions',
        productQuestion: 'What percentage of sessions are crash-free?',
        trigger: 'Session ends without a crash',
        properties: [
          { name: 'sessionId', type: 'string', required: true, description: 'Session identifier' },
          { name: 'durationMs', type: 'number', required: true, description: 'Session duration before end' },
          { name: 'crashed', type: 'boolean', required: true, description: 'Whether session ended in a crash' },
        ],
        purpose: 'Measure crash-free session rate for reliability monitoring.',
        collectionLocation: 'client',
        consentOptOut: true,
        retentionDays: 30,
        accessRoles: ['system_admin', 'analyst'],
        deletionBehavior: 'anonymize',
        createdAt: now,
        updatedAt: now,
        version: 1,
      },
      {
        name: 'push_delivery_health',
        productQuestion: 'What is the push notification delivery health?',
        trigger: 'Push notification delivery attempt completes',
        properties: [
          { name: 'status', type: 'string', required: true, description: 'sent, delivered, or failed' },
          { name: 'platform', type: 'string', required: true, description: 'Platform (ios, android, web)' },
          { name: 'attemptLatencyMs', type: 'number', required: true, description: 'Delivery attempt latency' },
        ],
        purpose: 'Track push notification delivery health (sent/delivered/failed).',
        collectionLocation: 'server',
        consentOptOut: false,
        retentionDays: 90,
        accessRoles: ['system_admin', 'analyst'],
        deletionBehavior: 'aggregate_only',
        createdAt: now,
        updatedAt: now,
        version: 1,
      },
      // Performance metrics
      {
        name: 'app_startup',
        productQuestion: 'How long does app startup take?',
        trigger: 'Application starts up (cold or warm)',
        properties: [
          { name: 'startType', type: 'string', required: true, description: 'cold or warm' },
          { name: 'durationMs', type: 'number', required: true, description: 'Startup time in ms' },
          { name: 'success', type: 'boolean', required: true, description: 'Whether startup succeeded' },
        ],
        purpose: 'Measure application startup time (cold vs warm).',
        collectionLocation: 'client',
        consentOptOut: true,
        retentionDays: 30,
        accessRoles: ['system_admin', 'analyst'],
        deletionBehavior: 'anonymize',
        createdAt: now,
        updatedAt: now,
        version: 1,
      },
      {
        name: 'inbox_render',
        productQuestion: 'How fast does the inbox render?',
        trigger: 'Inbox page/panel becomes visible',
        properties: [
          { name: 'messageCount', type: 'number', required: true, description: 'Number of messages in inbox' },
          { name: 'renderDurationMs', type: 'number', required: true, description: 'Time to render in ms' },
          { name: 'success', type: 'boolean', required: true, description: 'Whether render succeeded' },
        ],
        purpose: 'Track inbox render performance with message count.',
        collectionLocation: 'client',
        consentOptOut: true,
        retentionDays: 30,
        accessRoles: ['system_admin', 'analyst'],
        deletionBehavior: 'anonymize',
        createdAt: now,
        updatedAt: now,
        version: 1,
      },
      {
        name: 'scroll_smoothness',
        productQuestion: 'Is the scroll experience smooth at 60fps?',
        trigger: 'User scrolls through conversation list or messages',
        properties: [
          { name: 'frameTimeMs', type: 'number', required: true, description: 'Frame render time in ms' },
          { name: 'jankCount', type: 'number', required: false, description: 'Number of jank frames detected' },
          { name: 'targetFPS', type: 'number', required: true, description: 'Target frame rate (typically 60)' },
        ],
        purpose: 'Measure scroll frame time for 60fps target.',
        collectionLocation: 'client',
        consentOptOut: true,
        retentionDays: 30,
        accessRoles: ['system_admin', 'analyst'],
        deletionBehavior: 'anonymize',
        createdAt: now,
        updatedAt: now,
        version: 1,
      },
      {
        name: 'search_latency',
        productQuestion: 'How fast are search results returned?',
        trigger: 'User executes a search query',
        properties: [
          { name: 'query', type: 'string', required: true, description: 'Search query text' },
          { name: 'resultCount', type: 'number', required: true, description: 'Number of results returned' },
          { name: 'latencyMs', type: 'number', required: true, description: 'Search latency in ms' },
        ],
        purpose: 'Track search query latency and result count.',
        collectionLocation: 'server',
        consentOptOut: false,
        retentionDays: 90,
        accessRoles: ['system_admin', 'analyst'],
        deletionBehavior: 'aggregate_only',
        createdAt: now,
        updatedAt: now,
        version: 1,
      },
      {
        name: 'upload_completion',
        productQuestion: 'Do file uploads complete successfully?',
        trigger: 'File upload finishes (success or failure)',
        properties: [
          { name: 'fileId', type: 'string', required: true, description: 'Uploaded file identifier' },
          { name: 'sizeBytes', type: 'number', required: true, description: 'Uploaded file size' },
          { name: 'durationMs', type: 'number', required: true, description: 'Upload duration in ms' },
          { name: 'success', type: 'boolean', required: true, description: 'Whether upload succeeded' },
        ],
        purpose: 'Measure file upload completion time and success rate.',
        collectionLocation: 'client',
        consentOptOut: true,
        retentionDays: 90,
        accessRoles: ['system_admin', 'analyst'],
        deletionBehavior: 'aggregate_only',
        createdAt: now,
        updatedAt: now,
        version: 1,
      },
      // Usability metrics
      {
        name: 'onboarding_completion',
        productQuestion: 'What percentage of users complete onboarding?',
        trigger: 'User completes onboarding flow',
        properties: [
          { name: 'stepsCompleted', type: 'number', required: true, description: 'Number of onboarding steps completed' },
          { name: 'totalSteps', type: 'number', required: true, description: 'Total number of onboarding steps' },
          { name: 'dropOffPoint', type: 'number', required: false, description: 'Step index where user dropped off' },
        ],
        purpose: 'Track onboarding step completion rates and duration.',
        collectionLocation: 'client',
        consentOptOut: true,
        retentionDays: 30,
        accessRoles: ['system_admin', 'analyst'],
        deletionBehavior: 'anonymize',
        createdAt: now,
        updatedAt: now,
        version: 1,
      },
      {
        name: 'contact_request_success',
        productQuestion: 'What is the contact request acceptance rate?',
        trigger: 'Contact request is successfully resolved',
        properties: [
          { name: 'method', type: 'string', required: true, description: 'Discovery method (handle_search, invite_link, qr_code, contact_match)' },
          { name: 'accepted', type: 'boolean', required: true, description: 'Whether request was accepted' },
        ],
        purpose: 'Measure contact request success rate by method.',
        collectionLocation: 'server',
        consentOptOut: false,
        retentionDays: 90,
        accessRoles: ['system_admin', 'analyst'],
        deletionBehavior: 'aggregate_only',
        createdAt: now,
        updatedAt: now,
        version: 1,
      },
      {
        name: 'privacy_control_discoverability',
        productQuestion: 'Can users find privacy controls?',
        trigger: 'User interacts with privacy settings UI',
        properties: [
          { name: 'controlName', type: 'string', required: true, description: 'Name of privacy control' },
          { name: 'found', type: 'boolean', required: true, description: 'Whether user found the control' },
        ],
        purpose: 'Track whether users can find privacy controls.',
        collectionLocation: 'client',
        consentOptOut: true,
        retentionDays: 30,
        accessRoles: ['system_admin', 'analyst'],
        deletionBehavior: 'anonymize',
        createdAt: now,
        updatedAt: now,
        version: 1,
      },
      {
        name: 'accessibility_defect',
        productQuestion: 'Was an accessibility defect found?',
        trigger: 'Accessibility test or audit identifies a defect',
        properties: [
          { name: 'defectType', type: 'string', required: true, description: 'Type of accessibility issue' },
          { name: 'severity', type: 'string', required: true, description: 'Severity (low, medium, high, critical)' },
          { name: 'elementId', type: 'string', required: false, description: 'DOM element ID where issue was found' },
        ],
        purpose: 'Log accessibility defects found during testing.',
        collectionLocation: 'client',
        consentOptOut: true,
        retentionDays: 30,
        accessRoles: ['system_admin', 'analyst'],
        deletionBehavior: 'anonymize',
        createdAt: now,
        updatedAt: now,
        version: 1,
      },
      // Business metrics
      {
        name: 'assignment_completion',
        productQuestion: 'How quickly are conversations assigned to agents?',
        trigger: 'Conversation is assigned to an agent',
        properties: [
          { name: 'conversationId', type: 'string', required: true, description: 'Conversation ID' },
          { name: 'timeToAssignMs', type: 'number', required: true, description: 'Time from creation to assignment in ms' },
          { name: 'assignmentMethod', type: 'string', required: true, description: 'Method used for assignment' },
        ],
        purpose: 'Track conversation assignment time-to-assign.',
        collectionLocation: 'server',
        consentOptOut: false,
        retentionDays: 90,
        accessRoles: ['system_admin', 'analyst'],
        deletionBehavior: 'aggregate_only',
        createdAt: now,
        updatedAt: now,
        version: 1,
      },
      {
        name: 'handoff_completion',
        productQuestion: 'Do human-to-human handoffs complete successfully?',
        trigger: 'Handoff process between agents completes',
        properties: [
          { name: 'handoffId', type: 'string', required: true, description: 'Handoff identifier' },
          { name: 'fromAgent', type: 'string', required: true, description: 'Starting agent handle' },
          { name: 'toAgent', type: 'string', required: true, description: 'Receiving agent handle' },
          { name: 'success', type: 'boolean', required: true, description: 'Whether handoff completed successfully' },
        ],
        purpose: 'Measure human-to-human handoff completion time.',
        collectionLocation: 'server',
        consentOptOut: false,
        retentionDays: 90,
        accessRoles: ['system_admin', 'analyst'],
        deletionBehavior: 'aggregate_only',
        createdAt: now,
        updatedAt: now,
        version: 1,
      },
      {
        name: 'response_time_distribution',
        productQuestion: 'What are the response time percentiles?',
        trigger: 'User receives a response in a conversation',
        properties: [
          { name: 'responseTimeMs', type: 'number', required: true, description: 'Response time in ms' },
          { name: 'conversationId', type: 'string', required: true, description: 'Conversation ID' },
        ],
        purpose: 'Track response time percentiles (p50, p95, p99).',
        collectionLocation: 'server',
        consentOptOut: false,
        retentionDays: 90,
        accessRoles: ['system_admin', 'analyst'],
        deletionBehavior: 'aggregate_only',
        createdAt: now,
        updatedAt: now,
        version: 1,
      },
      // Trust metrics
      {
        name: 'export_completion',
        productQuestion: 'How many users export their data?',
        trigger: 'User completes a data export',
        properties: [
          { name: 'sizeBytes', type: 'number', required: true, description: 'Export file size in bytes' },
          { name: 'durationMs', type: 'number', required: true, description: 'Export generation time in ms' },
          { name: 'success', type: 'boolean', required: true, description: 'Whether export succeeded' },
        ],
        purpose: 'Track data export completion rate and performance.',
        collectionLocation: 'server',
        consentOptOut: false,
        retentionDays: 90,
        accessRoles: ['system_admin', 'analyst'],
        deletionBehavior: 'aggregate_only',
        createdAt: now,
        updatedAt: now,
        version: 1,
      },
      {
        name: 'deletion_completion',
        productQuestion: 'Does data deletion complete successfully?',
        trigger: 'Data deletion request completes',
        properties: [
          { name: 'deletionType', type: 'string', required: true, description: 'Type of deletion (conversation, account, all_data)' },
          { name: 'status', type: 'string', required: true, description: 'completion status' },
          { name: 'durationMs', type: 'number', required: true, description: 'Deletion duration in ms' },
        ],
        purpose: 'Measure data deletion completion by type.',
        collectionLocation: 'server',
        consentOptOut: false,
        retentionDays: 90,
        accessRoles: ['system_admin', 'analyst'],
        deletionBehavior: 'hard_delete',
        createdAt: now,
        updatedAt: now,
        version: 1,
      },
      {
        name: 'session_revocation',
        productQuestion: 'Why are sessions being revoked?',
        trigger: 'User or system revokes a session',
        properties: [
          { name: 'reason', type: 'string', required: true, description: 'Revocation reason (suspicious_activity, user_request, admin_action, token_expired)' },
          { name: 'sessionId', type: 'string', required: true, description: 'Revoked session identifier' },
          { name: 'initiatedBy', type: 'string', required: true, description: 'who initiated revocation (user, admin, system)' },
        ],
        purpose: 'Track session revocation reasons.',
        collectionLocation: 'server',
        consentOptOut: false,
        retentionDays: 30,
        accessRoles: ['system_admin', 'analyst'],
        deletionBehavior: 'anonymize',
        createdAt: now,
        updatedAt: now,
        version: 1,
      },
      {
        name: 'report_handling_time',
        productQuestion: 'How long does it take to handle abuse reports?',
        trigger: 'Abuse report handling completes',
        properties: [
          { name: 'reportId', type: 'string', required: true, description: 'Report identifier' },
          { name: 'handlingDurationMs', type: 'number', required: true, description: 'Time to handle report in ms' },
          { name: 'outcome', type: 'string', required: true, description: 'outcome (resolved, dismissed, escalated)' },
        ],
        purpose: 'Measure abuse report handling time.',
        collectionLocation: 'server',
        consentOptOut: false,
        retentionDays: 90,
        accessRoles: ['system_admin', 'analyst'],
        deletionBehavior: 'aggregate_only',
        createdAt: now,
        updatedAt: now,
        version: 1,
      },
      {
        name: 'privacy_comprehension',
        productQuestion: 'Do users comprehend the privacy policy?',
        trigger: 'User completes privacy comprehension survey',
        properties: [
          { name: 'surveyId', type: 'string', required: true, description: 'Survey identifier' },
          { name: 'score', type: 'number', required: true, description: 'Comprehension score (0-100)' },
          { name: 'surveyVersion', type: 'string', required: true, description: 'Privacy policy version' },
        ],
        purpose: 'Track privacy policy comprehension survey scores.',
        collectionLocation: 'client',
        consentOptOut: true,
        retentionDays: 30,
        accessRoles: ['system_admin', 'analyst'],
        deletionBehavior: 'anonymize',
        createdAt: now,
        updatedAt: now,
        version: 1,
      },
      {
        name: 'internal_note_leak_count',
        productQuestion: 'Are internal notes being leaked in messages?',
        trigger: 'Potential internal note leakage detected',
        properties: [
          { name: 'leakDetected', type: 'boolean', required: true, description: 'Whether a leak was detected' },
          { name: 'source', type: 'string', required: true, description: 'Source of potential leak' },
          { name: 'conversationId', type: 'string', required: true, description: 'Conversation ID' },
        ],
        purpose: 'Count internal note leakage incidents.',
        collectionLocation: 'server',
        consentOptOut: false,
        retentionDays: 90,
        accessRoles: ['system_admin', 'analyst'],
        deletionBehavior: 'aggregate_only',
        createdAt: now,
        updatedAt: now,
        version: 1,
      },
    ];
  }
}

export const eventRegistry = EventRegistry.getInstance();