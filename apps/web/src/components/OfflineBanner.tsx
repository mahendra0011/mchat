import React from 'react';
import { WifiOff, RefreshCw } from 'lucide-react';
import { QueuedMessage } from '@orbit/api-client';

interface OfflineBannerProps {
  isOffline: boolean;
  queuedMessages: QueuedMessage[];
  onRetryAll: () => void;
}

export const OfflineBanner: React.FC<OfflineBannerProps> = ({
  isOffline,
  queuedMessages,
  onRetryAll,
}) => {
  if (!isOffline && queuedMessages.length === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        backgroundColor: 'var(--caution-soft)',
        color: 'var(--caution)',
        borderBottom: '1px solid var(--border-subtle)',
        padding: '6px 16px',
        fontSize: '12px',
        fontWeight: 600,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        zIndex: 40,
        boxShadow: 'var(--shadow-sm)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <WifiOff size={14} />
        <span>
          {isOffline
            ? 'You are currently working offline. Inbound updates paused.'
            : 'Reconnected.'}{' '}
          {queuedMessages.length > 0 && (
            <span>
              ({queuedMessages.length} outbound message{queuedMessages.length > 1 ? 's' : ''} queued in offline buffer)
            </span>
          )}
        </span>
      </div>

      {queuedMessages.length > 0 && (
        <button
          onClick={onRetryAll}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--caution)',
            fontWeight: 700,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            fontSize: '12px',
          }}
        >
          <RefreshCw size={12} /> Retry Now
        </button>
      )}
    </div>
  );
};
