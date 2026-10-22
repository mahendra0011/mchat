import React from 'react';
import { Calendar, CheckSquare } from 'lucide-react';
import { WorkflowCard } from '@orbit/schemas';
import { useI18n } from '../i18n-context.js';

interface WorkflowCardViewProps {
  card: WorkflowCard;
  disabled: boolean;
  error: string | null;
  onAction: (cardId: string, actionId: string, payload?: Record<string, unknown>) => void;
}

const CARD_ACTIONS: Record<WorkflowCard['cardType'], string[]> = {
  approval: ['approve', 'reject'],
  task: ['start', 'complete'],
  agenda: ['complete'],
  checklist: [],
  poll: [],
};

const ACTION_LABELS: Record<string, string> = {
  approve: 'workflow.approve',
  reject: 'workflow.reject',
  start: 'workflow.start',
  complete: 'workflow.complete',
};

export const WorkflowCardView: React.FC<WorkflowCardViewProps> = ({ card, disabled, error, onAction }) => {
  const { t } = useI18n();
  const actions = CARD_ACTIONS[card.cardType];

  return (
    <div
      role="region"
      aria-label={`Workflow card: ${card.title}`}
      style={{
        margin: '12px auto',
        width: '90%',
        maxWidth: '520px',
        backgroundColor: 'var(--surface)',
        border: '1px solid var(--border-subtle)',
        borderRadius: '14px',
        padding: '16px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <CheckSquare size={16} style={{ color: 'var(--accent-primary)' }} />
          <span style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text-primary)' }}>{card.title}</span>
        </div>
        <span
          style={{
            fontSize: '11px',
            fontWeight: 600,
            padding: '2px 8px',
            borderRadius: '10px',
            backgroundColor: card.status === 'completed' || card.status === 'approved' ? 'var(--positive-soft)' : 'var(--surface-muted)',
            color: card.status === 'completed' || card.status === 'approved' ? 'var(--positive)' : 'var(--text-secondary)',
            textTransform: 'uppercase',
          }}
        >
          {card.status}
        </span>
      </div>
      <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '0 0 12px' }}>{card.description}</p>
      {card.dueDate && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text-muted)' }}>
          <Calendar size={13} />
          <span>Due: {new Date(card.dueDate).toLocaleDateString()}</span>
        </div>
      )}

      {/* Poll / checklist options — data-driven, only rendered when present */}
      {card.options && card.options.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '10px' }}>
          {card.options.map((option) => (
            <button
              key={option.id}
              type="button"
              disabled={disabled}
              onClick={() => onAction(card.id, 'toggle_option', { optionId: option.id })}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 10px',
                borderRadius: '8px',
                border: option.checked ? '1px solid var(--accent-primary)' : '1px solid var(--border-subtle)',
                backgroundColor: option.checked ? 'var(--accent-soft)' : 'var(--surface-muted)',
                color: option.checked ? 'var(--accent-primary)' : 'var(--text-primary)',
                fontSize: '12px',
                fontWeight: 600,
                cursor: disabled ? 'not-allowed' : 'pointer',
                textAlign: 'left',
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: '14px',
                  height: '14px',
                  borderRadius: '4px',
                  border: '1px solid var(--border-subtle)',
                  backgroundColor: option.checked ? 'var(--accent-primary)' : 'transparent',
                  display: 'inline-block',
                  flexShrink: 0,
                }}
              />
              <span style={{ flex: 1 }}>{option.label}</span>
              {card.cardType === 'poll' && (
                <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>{option.votes ?? 0}</span>
              )}
            </button>
          ))}
        </div>
      )}

      {actions.length > 0 && (
        <div style={{ display: 'flex', gap: '8px', marginTop: '12px', justifyContent: 'flex-end' }}>
          {actions.map((actionId) => {
            const isPrimary = actionId === 'approve' || actionId === 'complete' || actionId === 'start';
            return (
              <button
                key={actionId}
                type="button"
                disabled={disabled}
                onClick={() => onAction(card.id, actionId)}
                style={{
                  padding: '6px 12px',
                  borderRadius: '8px',
                  border: isPrimary ? 'none' : '1px solid var(--border-subtle)',
                  backgroundColor: isPrimary ? 'var(--accent-primary)' : 'transparent',
                  color: isPrimary ? 'var(--accent-text)' : 'var(--text-secondary)',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: disabled ? 'not-allowed' : 'pointer',
                }}
              >
                {t(ACTION_LABELS[actionId] ?? actionId)}
              </button>
            );
          })}
        </div>
      )}

      {error && (
        <p role="alert" style={{ margin: '10px 0 0', fontSize: '12px', color: 'var(--danger)' }}>
          {error}
        </p>
      )}
    </div>
  );
};
