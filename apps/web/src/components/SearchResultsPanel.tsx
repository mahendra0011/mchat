import React from 'react';
import { MessageSquare, X } from 'lucide-react';
import { useI18n } from '../i18n-context.js';
import { formatRelativeTime } from '../lib/time.js';

export interface SearchResultItem {
  messageId: string;
  conversationId: string;
  conversationTitle: string;
  snippet: string;
  sentAt: number;
  score: number;
}

interface SearchResultsPanelProps {
  results: SearchResultItem[];
  onSelect: (conversationId: string, messageId: string) => void;
  onClose: () => void;
}

export const SearchResultsPanel: React.FC<SearchResultsPanelProps> = ({ results, onSelect, onClose }) => {
  const { t } = useI18n();

  return (
    <div
      role="listbox"
      aria-label={t('search.results')}
      style={{
        position: 'absolute',
        top: 'calc(100% + 6px)',
        left: 0,
        right: 0,
        zIndex: 50,
        backgroundColor: 'var(--surface)',
        border: '1px solid var(--border-subtle)',
        borderRadius: '12px',
        boxShadow: 'var(--shadow-lg)',
        padding: '8px',
        maxHeight: '320px',
        overflowY: 'auto',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '4px 8px 8px',
        }}
      >
        <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
          {t('search.results')} ({results.length})
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('common.close')}
          style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}
        >
          <X size={14} />
        </button>
      </div>

      {results.length === 0 ? (
        <p style={{ margin: 0, padding: '12px 8px', fontSize: '12px', color: 'var(--text-muted)' }}>
          {t('search.noResults')}
        </p>
      ) : (
        results.map((result) => (
          <button
            key={result.messageId}
            type="button"
            role="option"
            aria-selected={false}
            onClick={() => onSelect(result.conversationId, result.messageId)}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '8px',
              width: '100%',
              textAlign: 'left',
              padding: '8px 10px',
              borderRadius: '8px',
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
            }}
          >
            <MessageSquare size={14} style={{ color: 'var(--accent-primary)', marginTop: '2px', flexShrink: 0 }} />
            <span style={{ minWidth: 0, flex: 1 }}>
              <span
                style={{
                  display: 'block',
                  fontSize: '12px',
                  fontWeight: 600,
                  color: 'var(--text-primary)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {result.conversationTitle}
              </span>
              <span
                style={{
                  display: 'block',
                  fontSize: '11px',
                  color: 'var(--text-secondary)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {result.snippet}
              </span>
              <span style={{ display: 'block', fontSize: '10px', color: 'var(--text-muted)', marginTop: '2px' }}>
                {formatRelativeTime(new Date(result.sentAt).toISOString())}
              </span>
            </span>
          </button>
        ))
      )}
    </div>
  );
};
