import React from 'react';
import { X, BarChart3, Inbox, CheckCircle2, Clock, type LucideIcon } from 'lucide-react';
import { Conversation, MessageEnvelope } from '@orbit/schemas';
import { useI18n } from '../i18n-context.js';

interface BusinessAnalyticsModalProps {
  isOpen: boolean;
  onClose: () => void;
  conversations: Conversation[];
  messages: MessageEnvelope[];
  activeWorkspaceId: string;
}

interface DayBucket {
  label: string;
  count: number;
}

function buildBuckets(messages: MessageEnvelope[], days: number): DayBucket[] {
  const buckets: DayBucket[] = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const next = new Date(day.getTime() + 86_400_000);
    const count = messages.filter((m) => {
      const ts = Date.parse(m.createdAt);
      return ts >= day.getTime() && ts < next.getTime();
    }).length;
    buckets.push({
      label: day.toLocaleDateString([], { weekday: 'short' }),
      count,
    });
  }
  return buckets;
}

function averageFirstResponseMs(
  conversations: Conversation[],
  messages: MessageEnvelope[],
  activeWorkspaceId: string
): number | null {
  const deltas: number[] = [];
  for (const conv of conversations) {
    const convMessages = messages
      .filter((m) => m.conversationId === conv.id)
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    const firstInbound = convMessages.find((m) => m.senderWorkspaceId !== activeWorkspaceId);
    if (!firstInbound) continue;
    const firstReply = convMessages.find(
      (m) =>
        m.senderWorkspaceId === activeWorkspaceId &&
        Date.parse(m.createdAt) > Date.parse(firstInbound.createdAt)
    );
    if (!firstReply) continue;
    deltas.push(Date.parse(firstReply.createdAt) - Date.parse(firstInbound.createdAt));
  }
  if (deltas.length === 0) return null;
  return deltas.reduce((sum, d) => sum + d, 0) / deltas.length;
}

export const BusinessAnalyticsModal: React.FC<BusinessAnalyticsModalProps> = ({
  isOpen,
  onClose,
  conversations,
  messages,
  activeWorkspaceId,
}) => {
  const { t } = useI18n();

  const stats = React.useMemo(() => {
    const open = conversations.filter((c) => !c.isArchived).length;
    const resolved = conversations.filter((c) => c.isArchived).length;
    const buckets = buildBuckets(messages, 7);
    const maxCount = Math.max(1, ...buckets.map((b) => b.count));
    const avgMs = averageFirstResponseMs(conversations, messages, activeWorkspaceId);
    return { open, resolved, buckets, maxCount, avgMs };
  }, [conversations, messages, activeWorkspaceId]);

  if (!isOpen) return null;

  const kpiCards: Array<{ label: string; value: string; icon: LucideIcon }> = [
    { label: t('analytics.total'), value: String(conversations.length), icon: Inbox },
    { label: t('analytics.open'), value: String(stats.open), icon: BarChart3 },
    { label: t('analytics.resolved'), value: String(stats.resolved), icon: CheckCircle2 },
    {
      label: t('analytics.avgFirstResponse'),
      value: stats.avgMs === null ? '—' : `${Math.max(1, Math.round(stats.avgMs / 60_000))} ${t('analytics.minutes')}`,
      icon: Clock,
    },
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('analytics.title')}
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'var(--overlay-scrim)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '24px',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '640px',
          maxWidth: '100%',
          maxHeight: '90vh',
          overflowY: 'auto',
          backgroundColor: 'var(--surface)',
          borderRadius: '16px',
          border: '1px solid var(--border-subtle)',
          boxShadow: 'var(--shadow-xl)',
          padding: '24px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <BarChart3 size={18} style={{ color: 'var(--accent-primary)' }} />
            <h2 style={{ margin: 0, fontSize: '17px', fontWeight: 700, color: 'var(--text-primary)' }}>
              {t('analytics.title')}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-secondary)', display: 'flex' }}
          >
            <X size={20} />
          </button>
        </div>

        {conversations.length === 0 ? (
          <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{t('analytics.noData')}</p>
        ) : (
          <>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                gap: '10px',
                marginBottom: '24px',
              }}
            >
              {kpiCards.map((card) => {
                const Icon = card.icon;
                return (
                  <div
                    key={card.label}
                    style={{
                      padding: '14px',
                      borderRadius: '12px',
                      backgroundColor: 'var(--surface-muted)',
                      border: '1px solid var(--border-subtle)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                      <Icon size={14} color="var(--accent-primary)" />
                      <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>{card.label}</span>
                    </div>
                    <div style={{ fontSize: '20px', fontWeight: 700, color: 'var(--text-primary)' }}>{card.value}</div>
                  </div>
                );
              })}
            </div>

            <h3 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '12px' }}>
              {t('analytics.messagesPerDay')}
            </h3>
            <div
              role="img"
              aria-label={t('analytics.messagesPerDay')}
              style={{
                display: 'flex',
                alignItems: 'flex-end',
                gap: '10px',
                height: '140px',
                padding: '0 4px',
                borderBottom: '1px solid var(--border-subtle)',
              }}
            >
              {stats.buckets.map((bucket) => (
                <div key={bucket.label} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                  <span style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-muted)' }}>{bucket.count}</span>
                  <div
                    style={{
                      width: '100%',
                      height: `${Math.round((bucket.count / stats.maxCount) * 100)}%`,
                      minHeight: bucket.count > 0 ? '4px' : '0px',
                      borderRadius: '4px 4px 0 0',
                      backgroundColor: 'var(--accent-primary)',
                      transition: 'height 160ms ease',
                    }}
                  />
                  <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>{bucket.label}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
