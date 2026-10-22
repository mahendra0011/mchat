import React from 'react';
import {
  Search,
  Pin,
  Lock,
} from 'lucide-react';
import { Conversation, IdentityWorkspace } from '@orbit/schemas';
import { SearchResultsPanel, type SearchResultItem } from './SearchResultsPanel.js';

interface ConversationListProps {
  conversations: Conversation[];
  activeConversationId: string | null;
  onSelectConversation: (conv: Conversation) => void;
  activeWorkspace: IdentityWorkspace;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  /** Local (on-device) message-search matches by conversation id (Spec 10/26). */
  messageMatches?: Record<string, { count: number; snippet: string }>;
  /** Wave B — ranked semantic search results (body/author/attachment weighted). */
  searchResults?: SearchResultItem[];
  showSearchResults?: boolean;
  onOpenSearchResult?: (conversationId: string, messageId: string) => void;
  onCloseSearchResults?: () => void;
}

export const ConversationList: React.FC<ConversationListProps> = ({
  conversations,
  activeConversationId,
  onSelectConversation,
  activeWorkspace,
  searchQuery,
  onSearchChange,
  messageMatches,
  searchResults,
  showSearchResults,
  onOpenSearchResult,
  onCloseSearchResults,
}) => {
  const isBusiness = activeWorkspace.type === 'business';
  const [filter, setFilter] = React.useState<string>('all');

  // Reset filter when workspace switches
  React.useEffect(() => {
    setFilter('all');
  }, [activeWorkspace.id]);

  const businessTabs = ['all', 'open', 'assigned', 'waiting', 'resolved'] as const;
  const personalTabs = ['all', 'direct', 'groups', 'unread'] as const;
  const currentTabs = isBusiness ? businessTabs : personalTabs;

  const filtered = conversations.filter((c) => {
    // Search query filter (title/snippet server-side state + local message index)
    if (searchQuery.trim()) {
      const matchTitle = (c.title || '').toLowerCase().includes(searchQuery.toLowerCase());
      const matchSnippet = (c.lastMessageSnippet || '').toLowerCase().includes(searchQuery.toLowerCase());
      const matchLocalMessage = Boolean(messageMatches?.[c.id]);
      if (!matchTitle && !matchSnippet && !matchLocalMessage) return false;
    }

    // Business filters (Spec 04 UX Section 64)
    if (isBusiness) {
      if (filter === 'open') return c.unreadCount > 0 || c.intentMode === 'support';
      if (filter === 'assigned') return c.participants.some((p) => p.workspaceId === activeWorkspace.id);
      if (filter === 'waiting') return c.unreadCount === 0;
      if (filter === 'resolved') return c.isArchived;
      return true;
    }

    // Personal tab filters
    if (filter === 'direct') return c.kind === 'direct';
    if (filter === 'groups') return c.kind === 'group';
    if (filter === 'unread') return c.unreadCount > 0;
    return true;
  });

  return (
    <section
      aria-label="Conversation list"
      style={{
        width: '320px',
        backgroundColor: 'var(--surface)',
        borderRight: '1px solid var(--border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        userSelect: 'none',
      }}
    >
      {/* Header with Workspace Label */}
      <div style={{ padding: '16px 16px 12px', borderBottom: '1px solid var(--border-subtle)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
          <div>
            <h1
              style={{
                fontSize: '17px',
                fontWeight: 700,
                color: 'var(--text-primary)',
                letterSpacing: '-0.01em',
              }}
            >
              {isBusiness ? 'Business Inbox' : 'Messages'}
            </h1>
            <div
              style={{
                fontSize: '12px',
                color: isBusiness ? 'var(--business-badge)' : 'var(--text-secondary)',
                fontWeight: 500,
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
              }}
            >
              <span
                style={{
                  width: '6px',
                  height: '6px',
                  borderRadius: '9999px',
                  backgroundColor: isBusiness ? 'var(--business-badge)' : 'var(--accent-primary)',
                }}
              />
              @{activeWorkspace.handle}
            </div>
          </div>

          {isBusiness && (
            <span
              style={{
                backgroundColor: 'var(--internal-note-bg)',
                color: 'var(--internal-note-text)',
                border: '1px solid var(--internal-note-border)',
                borderRadius: 'var(--radius-full)',
                padding: '2px 8px',
                fontSize: '11px',
                fontWeight: 600,
              }}
            >
              Team Relay
            </span>
          )}
        </div>

        {/* Search Field with Scope */}
        <div style={{ position: 'relative' }}>
          <Search
            size={16}
            style={{
              position: 'absolute',
              left: '10px',
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--text-muted)',
            }}
          />
          <input
            id="chat-search-input"
            type="text"
            aria-label="Search conversations"
            placeholder={`Search in @${activeWorkspace.handle}…`}
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            style={{
              width: '100%',
              padding: '8px 12px 8px 32px',
              backgroundColor: 'var(--surface-muted)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
              fontSize: '13px',
              color: 'var(--text-primary)',
              outline: 'none',
              transition: 'border-color 120ms ease',
            }}
          />
          {showSearchResults && searchResults && onOpenSearchResult && (
            <SearchResultsPanel
              results={searchResults}
              onSelect={(conversationId, messageId) => onOpenSearchResult(conversationId, messageId)}
              onClose={() => onCloseSearchResults?.()}
            />
          )}
        </div>

        {/* Filter Pills */}
        <div
          role="group"
          aria-label="Filter conversations"
          style={{ display: 'flex', gap: '6px', marginTop: '10px', overflowX: 'auto' }}
        >
          {currentTabs.map((tab) => {
            const isSelected = filter === tab;
            return (
              <button
                key={tab}
                type="button"
                onClick={() => setFilter(tab)}
                aria-pressed={isSelected}
                style={{
                  padding: '4px 10px',
                  borderRadius: 'var(--radius-full)',
                  border: 'none',
                  backgroundColor: isSelected ? 'var(--accent-primary)' : 'var(--surface-muted)',
                  color: isSelected ? 'var(--accent-text)' : 'var(--text-secondary)',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  textTransform: 'capitalize',
                  transition: 'all 120ms ease',
                  whiteSpace: 'nowrap',
                }}
              >
                {tab}
              </button>
            );
          })}
        </div>
      </div>

      {/* Conversation Items List */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '6px' }}>
        {filtered.length === 0 ? (
          <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--text-muted)' }}>
            <p style={{ fontSize: '13px', fontWeight: 500 }}>No conversations found</p>
            <p style={{ fontSize: '12px', marginTop: '4px' }}>Try adjusting your search or filters</p>
          </div>
        ) : (
          filtered.map((conv) => {
            const isSelected = conv.id === activeConversationId;
            const counterpart = conv.participants.find((p) => p.workspaceId !== activeWorkspace.id);
            const isOnline = counterpart?.isOnline ?? false;

            return (
              <div
                key={conv.id}
                role="button"
                tabIndex={0}
                onClick={() => onSelectConversation(conv)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    onSelectConversation(conv);
                  }
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '10px 12px',
                  borderRadius: 'var(--radius-md)',
                  backgroundColor: isSelected ? 'var(--accent-soft)' : 'transparent',
                  cursor: 'pointer',
                  marginBottom: '2px',
                  position: 'relative',
                  transition: 'background-color 100ms ease',
                  border: isSelected ? '1px solid var(--accent-primary)' : '1px solid transparent',
                }}
              >
                {/* Avatar with Presence Ring */}
                <div style={{ position: 'relative', flexShrink: 0 }}>
                  <div
                    style={{
                      width: '42px',
                      height: '42px',
                      borderRadius: '12px',
                      background: isBusiness
                        ? 'linear-gradient(135deg, var(--accent-primary), var(--business-badge))'
                        : 'linear-gradient(135deg, var(--accent-primary), var(--positive))',
                      color: 'var(--accent-text)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 600,
                      fontSize: '15px',
                    }}
                  >
                    {(conv.title || counterpart?.displayName || 'C').charAt(0)}
                  </div>
                  {isOnline && (
                    <span
                      style={{
                        position: 'absolute',
                        bottom: '-2px',
                        right: '-2px',
                        width: '10px',
                        height: '10px',
                        borderRadius: '9999px',
                        backgroundColor: 'var(--positive)',
                        border: '2px solid var(--surface)',
                      }}
                      title="Online"
                    />
                  )}
                </div>

                {/* Conversation Details */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', minWidth: 0 }}>
                      <span
                        style={{
                          fontSize: '14px',
                          fontWeight: conv.unreadCount > 0 ? 700 : 600,
                          color: isSelected ? 'var(--accent-primary)' : 'var(--text-primary)',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {conv.title || counterpart?.displayName || 'Direct Chat'}
                      </span>
                      {conv.isE2EE && (
                        <span title="End-to-End Encrypted" style={{ display: 'inline-flex', alignItems: 'center' }}>
                          <Lock size={12} style={{ color: 'var(--positive)', flexShrink: 0 }} />
                        </span>
                      )}
                    </div>

                    <span style={{ fontSize: '11px', color: 'var(--text-muted)', flexShrink: 0 }}>
                      {conv.lastMessageAt ? new Date(conv.lastMessageAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                    </span>
                  </div>

                  {/* Snippet + Badges */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                    <p
                      style={{
                        fontSize: '12px',
                        color: conv.unreadCount > 0 ? 'var(--text-primary)' : 'var(--text-secondary)',
                        fontWeight: conv.unreadCount > 0 ? 500 : 400,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        flex: 1,
                      }}
                    >
                      {messageMatches?.[conv.id]
                        ? messageMatches[conv.id].snippet
                        : conv.lastMessageSnippet || 'No messages yet'}
                    </p>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      {conv.isPinned && <Pin size={12} style={{ color: 'var(--accent-primary)' }} />}
                      {isBusiness && (
                        <span
                          style={{
                            fontSize: '9px',
                            fontWeight: 700,
                            padding: '1px 5px',
                            borderRadius: '4px',
                            backgroundColor: 'var(--accent-soft)',
                            color: 'var(--business-badge)',
                            textTransform: 'uppercase',
                          }}
                        >
                          Customer
                        </span>
                      )}
                      {conv.intentMode && conv.intentMode !== 'standard' && (
                        <span
                          style={{
                            fontSize: '9px',
                            fontWeight: 700,
                            padding: '1px 5px',
                            borderRadius: '4px',
                            backgroundColor: 'var(--surface-muted)',
                            color: 'var(--text-secondary)',
                            textTransform: 'uppercase',
                          }}
                        >
                          {conv.intentMode}
                        </span>
                      )}
                      {conv.unreadCount > 0 && (
                        <span
                          style={{
                            backgroundColor: 'var(--accent-primary)',
                            color: 'var(--accent-text)',
                            borderRadius: '9999px',
                            padding: '1px 6px',
                            fontSize: '10px',
                            fontWeight: 700,
                          }}
                        >
                          {conv.unreadCount}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
};
