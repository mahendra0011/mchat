import React from 'react';
import {
  MessageSquare,
  Pencil,
  Trash2,
  UserCheck,
  CheckSquare,
  Phone,
  type LucideIcon,
} from 'lucide-react';
import { Conversation, MessageEnvelope, IdentityWorkspace, WorkflowCard } from '@orbit/schemas';
import { apiFetch } from '../lib/apiFetch.js';
import { useI18n } from '../i18n-context.js';
import { formatRelativeTime } from '../lib/time.js';

interface CallRecord {
  id: string;
  conversationId: string;
  kind: string;
  status: string;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number;
}

interface TimelineEvent {
  id: string;
  icon: LucideIcon;
  text: string;
  timestamp: string;
}

interface TimelineTabProps {
  conversation: Conversation;
  messages: MessageEnvelope[];
  activeWorkspace: IdentityWorkspace;
  workflowCards: WorkflowCard[];
}

export const TimelineTab: React.FC<TimelineTabProps> = ({
  conversation,
  messages,
  activeWorkspace,
  workflowCards,
}) => {
  const { t } = useI18n();
  const [calls, setCalls] = React.useState<CallRecord[]>([]);

  React.useEffect(() => {
    let cancelled = false;
    async function loadCalls() {
      try {
        const res = await apiFetch<{ data: CallRecord[] }>(
          `/v1/conversations/${conversation.id}/calls`,
          { workspaceId: activeWorkspace.id }
        );
        if (!cancelled) setCalls(Array.isArray(res?.data) ? res.data : []);
      } catch {
        if (!cancelled) setCalls([]);
      }
    }
    void loadCalls();
    return () => {
      cancelled = true;
    };
  }, [conversation.id, activeWorkspace.id]);

  const events = React.useMemo<TimelineEvent[]>(() => {
    const list: TimelineEvent[] = [];

    for (const msg of messages) {
      if (msg.isDeleted) {
        list.push({
          id: `del-${msg.id}`,
          icon: Trash2,
          text: t('timeline.deleted'),
          timestamp: msg.editedAt ?? msg.createdAt,
        });
        continue;
      }
      list.push({
        id: `msg-${msg.id}`,
        icon: MessageSquare,
        text: `${t('timeline.message')}: ${(msg.body || '').slice(0, 60)}`,
        timestamp: msg.createdAt,
      });
      if (msg.isEdited && msg.editedAt) {
        list.push({
          id: `edit-${msg.id}`,
          icon: Pencil,
          text: t('timeline.edited'),
          timestamp: msg.editedAt,
        });
      }
    }

    if (conversation.assignedAt) {
      list.push({
        id: `assign-${conversation.id}`,
        icon: UserCheck,
        text: conversation.assigneeUserId ? t('timeline.assigned') : t('timeline.unassigned'),
        timestamp: conversation.assignedAt,
      });
    }

    for (const card of workflowCards) {
      list.push({
        id: `wf-${card.id}`,
        icon: CheckSquare,
        text: `${t('timeline.workflow')}: ${card.title} (${card.status})`,
        timestamp: card.createdAt,
      });
      for (const entry of card.history ?? []) {
        list.push({
          id: `wfh-${entry.actionId}`,
          icon: CheckSquare,
          text: `${card.title} — ${entry.action} (${entry.actorName})`,
          timestamp: entry.timestamp,
        });
      }
    }

    for (const call of calls) {
      list.push({
        id: `call-${call.id}`,
        icon: Phone,
        text: `${t('timeline.call')} ${call.kind} — ${call.status}`,
        timestamp: call.startedAt,
      });
    }

    return list
      .filter((e) => Date.parse(e.timestamp) > 0)
      .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
      .slice(0, 80);
  }, [messages, conversation, workflowCards, calls, t]);

  if (events.length === 0) {
    return <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{t('timeline.empty')}</p>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
      {events.map((event) => {
        const Icon = event.icon;
        return (
          <div
            key={event.id}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '10px',
              padding: '8px 10px',
              borderRadius: '8px',
              backgroundColor: 'var(--surface-muted)',
              marginBottom: '4px',
            }}
          >
            <Icon size={14} style={{ color: 'var(--accent-primary)', marginTop: '2px', flexShrink: 0 }} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div
                style={{
                  fontSize: '12px',
                  color: 'var(--text-primary)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {event.text}
              </div>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                {formatRelativeTime(event.timestamp)}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};
