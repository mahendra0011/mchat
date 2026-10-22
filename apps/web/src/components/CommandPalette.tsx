import React from 'react';
import {
  Search,
  MessageSquare,
  Briefcase,
  Settings,
  Sun,
} from 'lucide-react';
import { Conversation, IdentityWorkspace } from '@orbit/schemas';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  conversations: Conversation[];
  workspaces: IdentityWorkspace[];
  onSelectConversation: (conv: Conversation) => void;
  onSelectWorkspace: (ws: IdentityWorkspace) => void;
  onOpenSettings: () => void;
  onToggleTheme: () => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onClose,
  conversations,
  workspaces,
  onSelectConversation,
  onSelectWorkspace,
  onOpenSettings,
  onToggleTheme,
}) => {
  const [query, setQuery] = React.useState('');

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        if (isOpen) onClose();
      }
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const filteredConversations = conversations.filter((c) =>
    (c.title || '').toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'var(--overlay-scrim)',
        backdropFilter: 'blur(6px)',
        zIndex: 120,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '15vh',
        animation: 'fadeIn 120ms ease-out forwards',
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '560px',
          maxWidth: '90%',
          backgroundColor: 'var(--surface-elevated)',
          borderRadius: 'var(--radius-xl)',
          boxShadow: 'var(--shadow-xl)',
          border: '1px solid var(--border-subtle)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search Input */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '14px 18px',
            borderBottom: '1px solid var(--border-subtle)',
            gap: '10px',
          }}
        >
          <Search size={18} color="var(--text-muted)" />
          <input
            autoFocus
            type="text"
            aria-label="Search commands and conversations"
            placeholder="Type a command or jump to conversation… (Esc to close)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{
              flex: 1,
              border: 'none',
              background: 'transparent',
              outline: 'none',
              fontSize: '15px',
              color: 'var(--text-primary)',
            }}
          />
        </div>

        {/* Results List */}
        <div style={{ maxHeight: '340px', overflowY: 'auto', padding: '8px' }}>
          {/* Quick Actions */}
          <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', padding: '6px 10px' }}>
            Actions
          </div>
          <button
            onClick={() => {
              onToggleTheme();
              onClose();
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              width: '100%',
              padding: '8px 12px',
              borderRadius: 'var(--radius-md)',
              border: 'none',
              backgroundColor: 'transparent',
              color: 'var(--text-primary)',
              fontSize: '13px',
              fontWeight: 500,
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            <Sun size={16} /> Toggle Theme (Light / Dark)
          </button>
          <button
            onClick={() => {
              onOpenSettings();
              onClose();
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              width: '100%',
              padding: '8px 12px',
              borderRadius: 'var(--radius-md)',
              border: 'none',
              backgroundColor: 'transparent',
              color: 'var(--text-primary)',
              fontSize: '13px',
              fontWeight: 500,
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            <Settings size={16} /> Open Settings
          </button>

          {/* Workspaces */}
          <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', padding: '8px 10px 4px' }}>
            Switch Workspace
          </div>
          {workspaces.map((ws) => (
            <button
              key={ws.id}
              onClick={() => {
                onSelectWorkspace(ws);
                onClose();
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                width: '100%',
                padding: '8px 12px',
                borderRadius: 'var(--radius-md)',
                border: 'none',
                backgroundColor: 'transparent',
                color: 'var(--text-primary)',
                fontSize: '13px',
                fontWeight: 500,
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <Briefcase size={16} color={ws.type === 'business' ? 'var(--business-badge)' : 'var(--accent-primary)'} />
              <span>{ws.displayName} (@{ws.handle})</span>
            </button>
          ))}

          {/* Conversations */}
          {filteredConversations.length > 0 && (
            <>
              <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', padding: '8px 10px 4px' }}>
                Conversations
              </div>
              {filteredConversations.map((conv) => (
                <button
                  key={conv.id}
                  onClick={() => {
                    onSelectConversation(conv);
                    onClose();
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-md)',
                    border: 'none',
                    backgroundColor: 'transparent',
                    color: 'var(--text-primary)',
                    fontSize: '13px',
                    fontWeight: 500,
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <MessageSquare size={16} />
                  <span>{conv.title || 'Direct Chat'}</span>
                </button>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
