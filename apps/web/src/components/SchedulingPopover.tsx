import React from 'react';
import { Calendar, Clock, X } from 'lucide-react';
import { apiFetch, ApiRequestError } from '../lib/apiFetch.js';
import { useI18n } from '../i18n-context.js';
import { formatRelativeTime } from '../lib/time.js';

export interface ScheduledMessage {
  id: string;
  conversationId: string;
  workspaceId: string;
  senderName: string;
  body: string;
  scheduledFor: string;
  status: 'scheduled' | 'sent' | 'cancelled';
  createdAt: string;
  sentAt?: string;
}

interface SchedulingPopoverProps {
  conversationId: string;
  workspaceId: string;
  composerText: string;
  onScheduled: () => void;
  onClose: () => void;
}

/** Compute a quick-schedule target from a label ("tonight" | "tomorrow"). */
function quickTarget(kind: 'tonight' | 'tomorrow'): Date {
  const now = new Date();
  if (kind === 'tonight') {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 18, 0, 0, 0);
    if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
    return d;
  }
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0, 0, 0);
  return d;
}

export const SchedulingPopover: React.FC<SchedulingPopoverProps> = ({
  conversationId,
  workspaceId,
  composerText,
  onScheduled,
  onClose,
}) => {
  const { t } = useI18n();
  const [scheduled, setScheduled] = React.useState<ScheduledMessage[]>([]);
  const [customValue, setCustomValue] = React.useState('');
  const [status, setStatus] = React.useState<string | null>(null);
  const [isError, setIsError] = React.useState(false);
  const [isBusy, setIsBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      const res = await apiFetch<{ data: ScheduledMessage[] }>(
        `/v1/conversations/${conversationId}/scheduled`,
        { workspaceId }
      );
      setScheduled(Array.isArray(res?.data) ? res.data : []);
    } catch {
      setScheduled([]);
    }
  }, [conversationId, workspaceId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const schedule = async (when: Date) => {
    if (isBusy) return;
    const body = composerText.trim();
    if (!body) {
      setStatus(t('schedule.failed'));
      setIsError(true);
      return;
    }
    setIsBusy(true);
    setStatus(null);
    try {
      await apiFetch(`/v1/conversations/${conversationId}/messages/schedule`, {
        method: 'POST',
        workspaceId,
        body: { body, scheduledFor: when.toISOString() },
      });
      setCustomValue('');
      setStatus(t('schedule.success'));
      setIsError(false);
      onScheduled();
      await load();
    } catch (err) {
      setStatus(err instanceof ApiRequestError && err.status === 400 ? t('schedule.failed') : t('schedule.failed'));
      setIsError(true);
    } finally {
      setIsBusy(false);
    }
  };

  const cancel = async (scheduledId: string) => {
    try {
      await apiFetch(`/v1/conversations/${conversationId}/scheduled/${scheduledId}`, {
        method: 'DELETE',
        workspaceId,
      });
      await load();
    } catch {
      setStatus(t('schedule.cancelFailed'));
      setIsError(true);
    }
  };

  const quickOptions: Array<{ key: 'tonight' | 'tomorrow'; label: string }> = [
    { key: 'tonight', label: t('schedule.tonight') },
    { key: 'tomorrow', label: t('schedule.tomorrow') },
  ];

  return (
    <div
      role="dialog"
      aria-label={t('schedule.title')}
      data-canvas-popover="scheduling"
      style={{
        position: 'absolute',
        bottom: '72px',
        left: '20px',
        width: '320px',
        maxHeight: '420px',
        overflowY: 'auto',
        backgroundColor: 'var(--surface)',
        border: '1px solid var(--border-subtle)',
        borderRadius: '12px',
        boxShadow: 'var(--shadow-lg)',
        padding: '12px',
        zIndex: 60,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '10px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Clock size={15} style={{ color: 'var(--accent-primary)' }} />
          <strong style={{ fontSize: '13px', color: 'var(--text-primary)' }}>{t('schedule.title')}</strong>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('common.close')}
          style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}
        >
          <X size={16} />
        </button>
      </div>

      {composerText.trim() ? (
        <p
          style={{
            fontSize: '12px',
            color: 'var(--text-secondary)',
            margin: '0 0 10px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          “{composerText.trim()}”
        </p>
      ) : (
        <p style={{ fontSize: '12px', color: 'var(--caution)', margin: '0 0 10px' }}>
          {t('schedule.failed')}
        </p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '10px' }}>
        {quickOptions.map((opt) => (
          <button
            key={opt.key}
            type="button"
            disabled={isBusy || !composerText.trim()}
            onClick={() => void schedule(quickTarget(opt.key))}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 10px',
              borderRadius: '8px',
              border: '1px solid var(--border-subtle)',
              backgroundColor: 'var(--surface-muted)',
              color: 'var(--text-primary)',
              fontSize: '12px',
              fontWeight: 600,
              cursor: isBusy || !composerText.trim() ? 'not-allowed' : 'pointer',
              textAlign: 'left',
            }}
          >
            <Calendar size={14} style={{ color: 'var(--accent-primary)', flexShrink: 0 }} />
            {opt.label}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: '6px', marginBottom: '10px' }}>
        <input
          type="datetime-local"
          aria-label={t('schedule.pickTime')}
          value={customValue}
          onChange={(e) => setCustomValue(e.target.value)}
          style={{
            flex: 1,
            minWidth: 0,
            padding: '7px 8px',
            borderRadius: '8px',
            border: '1px solid var(--border-subtle)',
            backgroundColor: 'var(--surface-muted)',
            color: 'var(--text-primary)',
            fontSize: '12px',
          }}
        />
        <button
          type="button"
          disabled={isBusy || !customValue || !composerText.trim()}
          onClick={() => void schedule(new Date(customValue))}
          style={{
            padding: '7px 10px',
            borderRadius: '8px',
            border: 'none',
            backgroundColor: 'var(--accent-primary)',
            color: 'var(--accent-text)',
            fontSize: '12px',
            fontWeight: 600,
            cursor: isBusy || !customValue || !composerText.trim() ? 'not-allowed' : 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          {t('schedule.schedule')}
        </button>
      </div>

      {status && (
        <p
          role="status"
          style={{
            margin: '0 0 10px',
            fontSize: '12px',
            fontWeight: 600,
            color: isError ? 'var(--danger)' : 'var(--positive)',
          }}
        >
          {status}
        </p>
      )}

      <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '10px' }}>
        <div
          style={{
            fontSize: '11px',
            fontWeight: 700,
            color: 'var(--text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            marginBottom: '6px',
          }}
        >
          {t('schedule.title')} ({scheduled.length})
        </div>
        {scheduled.length === 0 ? (
          <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-muted)' }}>{t('schedule.empty')}</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {scheduled.map((item) => (
              <div
                key={item.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '8px',
                  padding: '6px 8px',
                  borderRadius: '8px',
                  backgroundColor: 'var(--surface-muted)',
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: '12px',
                      color: 'var(--text-primary)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {item.body}
                  </div>
                  <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                    {t('schedule.scheduledFor')} {formatRelativeTime(item.scheduledFor)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void cancel(item.id)}
                  style={{
                    border: 'none',
                    background: 'none',
                    cursor: 'pointer',
                    color: 'var(--danger)',
                    fontSize: '11px',
                    fontWeight: 600,
                    flexShrink: 0,
                  }}
                >
                  {t('schedule.cancel')}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
