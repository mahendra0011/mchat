import { test } from 'node:test';
import assert from 'node:assert/strict';
import { logger } from './logger.js';
import { sanitizeTelemetryEvent } from './telemetry.js';
import { applyPreviewPrivacy, redactPushPayload } from './routes/notifications.js';

const SYNTHETIC_SECRET = 'sk_live_synthetic_51H9xQ2';
const SYNTHETIC_PASSWORD = 'correct-horse-battery-staple';
const SYNTHETIC_BODY = 'private message plaintext';

test('privacy: logger redacts synthetic secrets, tokens and credential fields', () => {
  const captured: string[] = [];
  const originalLog = console.log;
  const originalWarn = console.warn;
  console.log = (line?: unknown) => {
    captured.push(String(line));
  };
  console.warn = (line?: unknown) => {
    captured.push(String(line));
  };

  try {
    logger.warn('synthetic auth probe', {
      Authorization: `Bearer ${SYNTHETIC_SECRET}`,
      nested: { password: SYNTHETIC_PASSWORD },
      note: `token=${SYNTHETIC_SECRET}`,
      conversationId: 'conv_synthetic_1',
    });
    logger.error('synthetic provider failure', {
      apiKey: SYNTHETIC_SECRET,
      messageBody: SYNTHETIC_BODY,
    });
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
  }

  const output = captured.join('\n');
  assert.match(output, /conv_synthetic_1/, 'non-sensitive context is preserved');
  assert.match(output, /\[REDACTED\]/, 'redaction marker is present');
  assert.doesNotMatch(output, new RegExp(SYNTHETIC_SECRET));
  assert.doesNotMatch(output, new RegExp(SYNTHETIC_PASSWORD));
  assert.doesNotMatch(output, new RegExp(SYNTHETIC_BODY));
});

test('privacy: telemetry sanitizer drops content, secrets and long text', () => {
  const sanitized = sanitizeTelemetryEvent({
    event: 'login_failed',
    actorId: 'usr_synthetic_1',
    messageBody: SYNTHETIC_BODY,
    accessToken: SYNTHETIC_SECRET,
    nested: { query: 'private search terms' },
    longText: 'x'.repeat(200),
  });

  assert.equal(sanitized.event, 'login_failed');
  assert.equal(sanitized.actorId, 'usr_synthetic_1');
  assert.equal('messageBody' in sanitized, false);
  assert.equal('accessToken' in sanitized, false);
  assert.equal('nested' in sanitized, false);
  assert.equal('longText' in sanitized, false);
});

test('privacy: push payloads hide body by default and in sender-only mode', () => {
  const hidden = applyPreviewPrivacy(undefined, { title: 'Alex', body: SYNTHETIC_BODY });
  assert.deepEqual(hidden, { title: 'New message' });
  assert.equal(hidden.body, undefined);

  const senderOnly = applyPreviewPrivacy(
    { hideNotificationPreviews: false, previewDetail: 'sender_only' },
    { title: 'Alex', body: SYNTHETIC_BODY }
  );
  assert.equal(senderOnly.title, 'Alex');
  assert.equal(senderOnly.body, undefined);

  const full = applyPreviewPrivacy(
    { hideNotificationPreviews: false, previewDetail: 'full' },
    { title: 'Alex', body: SYNTHETIC_BODY }
  );
  assert.equal(full.body, SYNTHETIC_BODY);

  const redacted = redactPushPayload({ title: 'Alex', body: SYNTHETIC_BODY });
  assert.equal(redacted.redacted, true);
  assert.equal('body' in redacted, false);
});
