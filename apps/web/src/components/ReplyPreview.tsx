import React from 'react';
import { Reply, X } from 'lucide-react';

export interface ReplyPreviewProps {
  authorName: string;
  excerpt: string;
  onClose?: () => void;
  compact?: boolean;
}

export const ReplyPreview: React.FC<ReplyPreviewProps> = ({
  authorName,
  excerpt,
  onClose,
  compact,
}) => (
  <div
    role="status"
    aria-live="polite"
    className="animate-fade-in"
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      borderLeft: '3px solid var(--accent-primary)',
      borderRadius: '8px',
      backgroundColor: 'var(--surface-muted)',
      padding: compact ? '4px 8px' : '6px 10px',
      fontSize: '12px',
    }}
  >
    <Reply
      size={14}
      style={{ color: 'var(--accent-primary)', flexShrink: 0 }}
      aria-hidden="true"
    />
    <div style={{ flex: 1, minWidth: 0 }}>
      <div
        style={{
          fontWeight: 600,
          color: 'var(--text-secondary)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        Replying to {authorName}
      </div>
      <div
        style={{
          color: 'var(--text-muted)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {excerpt}
      </div>
    </div>
    {onClose && (
      <button
        type="button"
        onClick={onClose}
        aria-label="Cancel reply"
        title="Cancel reply"
        style={{
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '24px',
          height: '24px',
          borderRadius: '9999px',
          border: 'none',
          backgroundColor: 'transparent',
          color: 'var(--text-muted)',
          cursor: 'pointer',
          transition: 'background-color var(--duration-fast) var(--ease-standard)',
        }}
      >
        <X size={14} />
      </button>
    )}
  </div>
);
