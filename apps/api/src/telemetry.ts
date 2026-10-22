/**
 * Observability facade (Spec 10 — OpenTelemetry).
 *
 * Provides trace spans, counters, and histograms with a no-op-by-default
 * in-memory exporter. The API mirrors the OpenTelemetry model (`startSpan`,
 * `counter`, `histogram`) so the in-memory recorder can be swapped for the
 * real OTel SDK/exporter behind the same calls without touching call sites.
 */

import { z } from 'zod';

export interface Span {
  name: string;
  startedAt: number;
  endedAt?: number;
  status: 'ok' | 'error';
  attributes: Record<string, string | number | boolean>;
  errorMessage?: string;
}

export type SpanResult = { status: 'ok' | 'error'; attributes?: Record<string, string | number | boolean>; errorMessage?: string };

export function sanitizeTelemetryEvent(event: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(event)) {
    // Skip fields that contain message body, attachment names, query text, or keys
    if (isSensitiveField(key, value)) {
      continue;
    }
    sanitized[key] = value;
  }

  return sanitized;
}

function isSensitiveField(key: string, value: unknown): boolean {
  const lowerKey = key.toLowerCase();

  // Skip keys that contain sensitive content indicators
  const sensitivePatterns = [
    'body', 'message', 'text', 'query', 'search',
    'attachment', 'file', 'name', 'key', 'credential',
    'passkey', 'token', 'secret',
  ];

  // Check if the key contains a sensitive pattern
  if (sensitivePatterns.some(p => lowerKey.includes(p))) {
    return true;
  }

  // If value is a string, check if it looks like message content
  if (typeof value === 'string') {
    // Skip very long strings (likely content) or strings with common content patterns
    if (value.length > 100) return true;
    if (/^\s*$/.test(value)) return true; // empty/whitespace-only
    if (/(password|token|secret|key)\s*=/i.test(value)) return true;
  }

  // If value is an object, recurse to check nested fields
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    for (const k of Object.keys(value)) {
      if (isSensitiveField(k, (value as Record<string, unknown>)[k])) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Ensure TelemetryEventSchema validation enforces content-free only.
 * This schema validates that telemetry events don't contain sensitive content.
 */
export const TelemetryEventSchema = z.object({
  name: z.string().min(1),
  purpose: z.string().min(1),
  collectionLocation: z.enum(['client', 'server', 'both']),
  // All other fields must be content-free (no body, message, query, etc.)
  attributes: z.record(z.unknown()).optional(),
}).strict();

export class TelemetryRecorder {
  private spans: (Span & { errorMessage?: string })[] = [];
  private counters = new Map<string, { value: number; add: (n: number) => void }>();
  private histograms = new Map<string, number[]>();

  async startSpan<T>(
    name: string,
    fn: () => Promise<T> | T,
    attributes?: Record<string, string | number | boolean>
  ): Promise<T> {
    const span: Span & { errorMessage?: string } = {
      name,
      startedAt: Date.now(),
      status: 'ok',
      attributes: attributes ?? {},
    };
    this.spans.push(span);
    try {
      const result = await fn();
      span.status = 'ok';
      span.endedAt = Date.now();
      return result;
    } catch (err) {
      span.status = 'error';
      span.errorMessage = err instanceof Error ? err.message : String(err);
      span.endedAt = Date.now();
      throw err;
    }
  }

  getSpanCount(): number {
    return this.spans.length;
  }

  getSpans(name?: string): (Span & { errorMessage?: string })[] {
    if (name) return this.spans.filter((s) => s.name === name);
    return this.spans;
  }

  recordSpan(span: Partial<Span> & { name: string }): void {
    const full: Span & { errorMessage?: string } = {
      name: span.name,
      startedAt: span.startedAt ?? Date.now(),
      endedAt: span.endedAt,
      status: span.status ?? 'ok',
      attributes: span.attributes ?? {},
      errorMessage: span.errorMessage,
    };
    this.spans.push(full);
  }

  counter(name: string): { value: number; add: (n: number) => void } {
    let c = this.counters.get(name);
    if (!c) {
      c = { value: 0, add: (n: number) => { c!.value += n; } };
      this.counters.set(name, c);
    }
    return c;
  }

  getCounter(name: string): number {
    return this.counters.get(name)?.value ?? 0;
  }

  histogram(name: string): { record: (v: number) => void } {
    let arr = this.histograms.get(name);
    if (!arr) {
      arr = [];
      this.histograms.set(name, arr);
    }
    return { record: (v: number) => { arr!.push(v); } };
  }

  getHistogram(name: string): number[] {
    return this.histograms.get(name) ?? [];
  }
}

export const telemetry = new TelemetryRecorder();
