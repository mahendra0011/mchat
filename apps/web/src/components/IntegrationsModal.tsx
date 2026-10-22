import { apiUrl } from '../config';
import React from 'react';
import {
  Puzzle,
  X,
  ShieldAlert,
  ShieldCheck,
  Bot,
  MessageSquare,
  History,
  Send,
  Info,
} from 'lucide-react';
import { IntegrationManifest } from '@orbit/schemas';
import { IntegrationE2EEClient } from '../lib/integrations';

interface ConversationGrant {
  id: string;
  integrationId: string;
  conversationId: string;
  scopes: string[];
  botPermissions: { canJoin: boolean; canReadHistory: boolean; canSend: boolean };
  grantedBy: string;
  grantedAt: string;
}

interface ConversationSummary {
  id: string;
  title: string | null;
  isE2EE: boolean;
  kind: 'direct' | 'group' | 'branch';
}

interface IntegrationsModalProps {
  isOpen: boolean;
  onClose: () => void;
  workspaceId: string;
}

export const IntegrationsModal: React.FC<IntegrationsModalProps> = ({
  isOpen,
  onClose,
  workspaceId,
}) => {
  const [integrations, setIntegrations] = React.useState<IntegrationManifest[]>([]);
  const [grants, setGrants] = React.useState<Record<string, ConversationGrant[]>>({});
  const [conversations, setConversations] = React.useState<ConversationSummary[]>([]);
  const [expandedGrant, setExpandedGrant] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (isOpen) {
      loadIntegrations();
      loadConversations();
    }
  }, [isOpen, workspaceId]);

  const loadIntegrations = async () => {
    try {
      const res = await fetch(apiUrl('/v1/integrations'), {
        headers: { 'x-workspace-id': workspaceId },
      });
      const data = await res.json();
      if (data?.data) {
        setIntegrations(data.data);
        await loadAllGrants(data.data);
      }
    } catch (err) {
      console.error('Failed to load integrations', err);
    }
  };

  const loadAllGrants = async (integrations: IntegrationManifest[]) => {
    const allGrants: Record<string, ConversationGrant[]> = {};
    for (const int of integrations) {
      if (int.status === 'installed') {
        try {
          const res = await fetch(apiUrl(`/v1/integrations/${int.id}/grants/conversations`), {
            headers: { 'x-workspace-id': workspaceId },
          });
          const data = await res.json();
          if (data?.data) {
            allGrants[int.id] = data.data;
          }
        } catch (err) {
          console.error(`Failed to load grants for ${int.id}`, err);
        }
      }
    }
    setGrants(allGrants);
  };

  const loadConversations = async () => {
    try {
      const res = await fetch(apiUrl('/v1/conversations'), {
        headers: { 'x-workspace-id': workspaceId },
      });
      const data = await res.json();
      if (data?.data) {
        setConversations(
          data.data.map((c: { id: string; title: string | null; isE2EE: boolean; kind: string }) => ({
            id: c.id,
            title: c.title,
            isE2EE: c.isE2EE,
            kind: c.kind as 'direct' | 'group' | 'branch',
          }))
        );
      }
    } catch (err) {
      console.error('Failed to load conversations', err);
    }
  };

  const handleToggleInstall = async (id: string, currentStatus: string) => {
    const endpoint = currentStatus === 'installed' ? 'revoke' : 'install';
    try {
      const res = await fetch(apiUrl(`/v1/integrations/${id}/${endpoint}`), {
        method: 'POST',
        headers: { 'x-workspace-id': workspaceId },
      });
      const data = await res.json();
      if (data?.data) {
        setIntegrations((prev) =>
          prev.map((item) => (item.id === id ? { ...item, status: data.data.status } : item))
        );
      }
    } catch (err) {
      console.error('Failed to toggle integration', err);
    }
  };

  const handleCreateGrant = async (integrationId: string, conversationId: string, scopes: string[]) => {
    setLoading(true);
    try {
      const integration = integrations.find((i) => i.id === integrationId);
      if (!integration) return;

      const res = await fetch(apiUrl(`/v1/integrations/${integrationId}/grants/conversations`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-workspace-id': workspaceId },
        body: JSON.stringify({ conversationId, scopes }),
      });
      const data = await res.json();
      if (data?.data) {
        setGrants((prev) => ({
          ...prev,
          [integrationId]: [...(prev[integrationId] || []), data.data],
        }));
      }
    } catch (err) {
      console.error('Failed to create grant', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteGrant = async (integrationId: string, conversationId: string) => {
    setLoading(true);
    try {
      const res = await fetch(apiUrl(`/v1/integrations/${integrationId}/grants/conversations/${conversationId}`), {
        method: 'DELETE',
        headers: { 'x-workspace-id': workspaceId },
      });
      if (res.ok) {
        setGrants((prev) => ({
          ...prev,
          [integrationId]: (prev[integrationId] || []).filter((g) => g.conversationId !== conversationId),
        }));
      }
    } catch (err) {
      console.error('Failed to delete grant', err);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateBotPermissions = async (
    integrationId: string,
    conversationId: string,
    permissions: { canJoin: boolean; canReadHistory: boolean; canSend: boolean }
  ) => {
    // This would require a PATCH endpoint; for now we update locally
    setGrants((prev) => ({
      ...prev,
      [integrationId]: (prev[integrationId] || []).map((g) =>
        g.conversationId === conversationId ? { ...g, botPermissions: permissions } : g
      ),
    }));
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="integrations-title"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(16, 18, 27, 0.65)',
        backdropFilter: 'blur(8px)',
        zIndex: 60,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '720px',
          backgroundColor: 'var(--surface)',
          borderRadius: '20px',
          border: '1px solid var(--border-subtle)',
          boxShadow: '0 20px 40px rgba(0,0,0,0.25)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '90vh',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '20px 24px 16px',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '10px',
                background: 'linear-gradient(135deg, #805AD5, #5955E8)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
              }}
            >
              <Puzzle size={18} />
            </div>
            <div>
              <h2 id="integrations-title" style={{ fontSize: '18px', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                Integrations & Developer Platform
              </h2>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                Permissioned chat modules, verified bots & webhook endpoints
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close modal"
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-secondary)',
              padding: '6px',
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div style={{ padding: '24px', overflowY: 'auto', flex: 1 }}>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '0 0 16px', lineHeight: 1.5 }}>
            Each module displays its explicit permission manifest. Integrations never have access to private E2EE plaintext or cross-workspace data.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {integrations.map((item) => {
              const isRevoked = item.status === 'revoked';
              const integrationGrants = grants[item.id] || [];
              const integrationE2EEBadge = item.scopes.includes('messages.read_scoped') && conversations.some((c) => c.isE2EE);

              return (
                <div
                  key={item.id}
                  style={{
                    padding: '16px',
                    borderRadius: '14px',
                    border: isRevoked ? '1px solid var(--danger)' : '1px solid var(--border-subtle)',
                    backgroundColor: isRevoked ? 'rgba(229,62,62,0.06)' : 'var(--surface-muted)',
                  }}
                >
                  {isRevoked && (
                    <div
                      role="alert"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        padding: '8px 10px',
                        borderRadius: '8px',
                        backgroundColor: 'rgba(229,62,62,0.12)',
                        border: '1px solid var(--danger)',
                        marginBottom: '12px',
                        color: 'var(--danger)',
                        fontSize: '12px',
                        fontWeight: 600,
                      }}
                    >
                      <ShieldAlert size={14} />
                      <span>Module signature invalid — disabled</span>
                    </div>
                  )}

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <div
                        style={{
                          width: '40px',
                          height: '40px',
                          borderRadius: '10px',
                          backgroundColor: 'var(--surface-sunken)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '20px',
                        }}
                      >
                        {item.botIdentity?.avatar || '🤖'}
                      </div>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <strong style={{ fontSize: '14px', color: 'var(--text-primary)' }}>
                            {item.name}
                          </strong>
                          {item.botIdentity && (
                            <span
                              style={{
                                fontSize: '10px',
                                fontWeight: 700,
                                backgroundColor: 'rgba(89, 85, 232, 0.15)',
                                color: 'var(--brand-primary)',
                                padding: '1px 6px',
                                borderRadius: '4px',
                              }}
                            >
                              {item.botIdentity.badge}
                            </span>
                          )}
                        </div>
                        <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                          {item.description}
                        </span>
                      </div>
                    </div>

                    <button
                      onClick={() => handleToggleInstall(item.id, item.status)}
                      disabled={isRevoked}
                      style={{
                        padding: '6px 14px',
                        borderRadius: '8px',
                        fontSize: '12px',
                        fontWeight: 600,
                        cursor: isRevoked ? 'not-allowed' : 'pointer',
                        opacity: isRevoked ? 0.5 : 1,
                        border: item.status === 'installed' ? '1px solid #E53E3E' : 'none',
                        backgroundColor: item.status === 'installed' ? 'transparent' : 'var(--brand-primary)',
                        color: item.status === 'installed' ? '#E53E3E' : '#fff',
                      }}
                    >
                      {item.status === 'installed' ? 'Revoke' : isRevoked ? 'Revoked' : 'Install'}
                    </button>
                  </div>

                  {/* E2EE Notice Badge */}
                  {integrationE2EEBadge && (
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        padding: '8px 12px',
                        borderRadius: '8px',
                        backgroundColor: 'rgba(34, 197, 94, 0.1)',
                        border: '1px solid rgba(34, 197, 94, 0.3)',
                        marginBottom: '12px',
                        color: 'var(--positive)',
                        fontSize: '12px',
                        fontWeight: 500,
                      }}
                    >
                      <ShieldCheck size={14} />
                      <span>E2EE: This integration cannot access private conversations</span>
                    </div>
                  )}

                  {/* Scopes Manifest */}
                  <div style={{ marginTop: '12px', paddingTop: '10px', borderTop: '1px solid var(--border-subtle)' }}>
                    <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
                      Requested Scopes & Permissions:
                    </span>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                      {item.scopes.map((scope) => (
                        <span
                          key={scope}
                          style={{
                            fontSize: '11px',
                            padding: '2px 8px',
                            borderRadius: '6px',
                            backgroundColor: 'var(--surface-sunken)',
                            color: 'var(--text-primary)',
                            fontFamily: 'monospace',
                          }}
                        >
                          {scope}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Per-Conversation Grants Section */}
                  {item.status === 'installed' && item.botIdentity && (
                    <div style={{ marginTop: '16px', paddingTop: '12px', borderTop: '1px solid var(--border-subtle)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <Bot size={16} style={{ color: 'var(--accent-primary)' }} />
                          <strong style={{ fontSize: '13px', color: 'var(--text-primary)' }}>Per-Conversation Bot Controls</strong>
                        </div>
                        <button
                          onClick={() => setExpandedGrant(item.id)}
                          style={{
                            padding: '4px 10px',
                            borderRadius: '6px',
                            border: '1px solid var(--border-subtle)',
                            backgroundColor: 'var(--surface)',
                            color: 'var(--text-secondary)',
                            fontSize: '11px',
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          {expandedGrant === item.id ? 'Hide' : 'Configure'}
                        </button>
                      </div>

                      {expandedGrant === item.id && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                          {conversations.map((conv) => {
                            const grant = integrationGrants.find((g) => g.conversationId === conv.id);
                            const isGranted = !!grant;
                            const e2eeBadge = IntegrationE2EEClient.getE2EEBadgeLabel(conv);

                            return (
                              <div
                                key={conv.id}
                                style={{
                                  padding: '12px',
                                  borderRadius: '10px',
                                  border: '1px solid var(--border-subtle)',
                                  backgroundColor: 'var(--surface)',
                                }}
                              >
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <div
                                      style={{
                                        width: '28px',
                                        height: '28px',
                                        borderRadius: conv.kind === 'direct' ? '9999px' : '8px',
                                        backgroundColor: 'var(--accent-primary)',
                                        color: '#fff',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        fontSize: '11px',
                                        fontWeight: 700,
                                      }}
                                    >
                                      {(conv.title || conv.id).charAt(0)}
                                    </div>
                                    <div>
                                      <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                                        {conv.title || `Conversation ${conv.id.slice(0, 8)}`}
                                      </div>
                                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                                        {conv.kind} • {e2eeBadge}
                                      </div>
                                    </div>
                                  </div>

                                  {!isGranted ? (
                                    <button
                                      onClick={() => handleCreateGrant(item.id, conv.id, ['messages.read_scoped', 'messages.send'])}
                                      disabled={loading}
                                      style={{
                                        padding: '4px 12px',
                                        borderRadius: '6px',
                                        border: 'none',
                                        backgroundColor: 'var(--brand-primary)',
                                        color: '#fff',
                                        fontSize: '11px',
                                        fontWeight: 600,
                                        cursor: loading ? 'wait' : 'pointer',
                                      }}
                                    >
                                      Grant Access
                                    </button>
                                  ) : (
                                    <span
                                      style={{
                                        fontSize: '11px',
                                        fontWeight: 600,
                                        color: 'var(--positive)',
                                        padding: '2px 8px',
                                        borderRadius: '4px',
                                        backgroundColor: 'rgba(34, 197, 94, 0.1)',
                                      }}
                                    >
                                      Active
                                    </span>
                                  )}
                                </div>

                                {isGranted && (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '4px' }}>
                                      {grant.scopes.map((scope) => (
                                        <span
                                          key={scope}
                                          style={{
                                            fontSize: '10px',
                                            padding: '1px 6px',
                                            borderRadius: '4px',
                                            backgroundColor: 'var(--surface-sunken)',
                                            color: 'var(--text-primary)',
                                            fontFamily: 'monospace',
                                          }}
                                        >
                                          {scope}
                                        </span>
                                      ))}
                                    </div>

                                    {/* Bot Behavior Controls */}
                                    <div style={{ padding: '8px', borderRadius: '8px', backgroundColor: 'var(--surface-muted)' }}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                                        <Info size={13} style={{ color: 'var(--text-secondary)' }} />
                                        <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                                          Bot Behavior Controls
                                        </span>
                                      </div>

                                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                        <label
                                          style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'space-between',
                                            fontSize: '12px',
                                            color: 'var(--text-primary)',
                                            cursor: 'pointer',
                                          }}
                                        >
                                          <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                            <MessageSquare size={13} style={{ color: 'var(--text-secondary)' }} />
                                            Can bot join this conversation?
                                          </span>
                                          <button
                                            role="switch"
                                            aria-checked={grant.botPermissions.canJoin}
                                            onClick={() =>
                                              handleUpdateBotPermissions(item.id, conv.id, {
                                                ...grant.botPermissions,
                                                canJoin: !grant.botPermissions.canJoin,
                                              })
                                            }
                                            style={{
                                              width: '36px',
                                              height: '20px',
                                              borderRadius: '9999px',
                                              border: 'none',
                                              backgroundColor: grant.botPermissions.canJoin
                                                ? 'var(--brand-primary)'
                                                : 'var(--border-subtle)',
                                              position: 'relative',
                                              cursor: 'pointer',
                                            }}
                                          >
                                            <span
                                              style={{
                                                position: 'absolute',
                                                top: '2px',
                                                left: grant.botPermissions.canJoin ? '18px' : '2px',
                                                width: '16px',
                                                height: '16px',
                                                borderRadius: '9999px',
                                                backgroundColor: '#fff',
                                                boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                                                transition: 'left 150ms ease',
                                              }}
                                            />
                                          </button>
                                        </label>

                                        <label
                                          style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'space-between',
                                            fontSize: '12px',
                                            color: 'var(--text-primary)',
                                            cursor: 'pointer',
                                          }}
                                        >
                                          <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                            <History size={13} style={{ color: 'var(--text-secondary)' }} />
                                            Can bot read message history?
                                          </span>
                                          <button
                                            role="switch"
                                            aria-checked={grant.botPermissions.canReadHistory}
                                            onClick={() =>
                                              handleUpdateBotPermissions(item.id, conv.id, {
                                                ...grant.botPermissions,
                                                canReadHistory: !grant.botPermissions.canReadHistory,
                                              })
                                            }
                                            style={{
                                              width: '36px',
                                              height: '20px',
                                              borderRadius: '9999px',
                                              border: 'none',
                                              backgroundColor: grant.botPermissions.canReadHistory
                                                ? 'var(--brand-primary)'
                                                : 'var(--border-subtle)',
                                              position: 'relative',
                                              cursor: 'pointer',
                                            }}
                                          >
                                            <span
                                              style={{
                                                position: 'absolute',
                                                top: '2px',
                                                left: grant.botPermissions.canReadHistory ? '18px' : '2px',
                                                width: '16px',
                                                height: '16px',
                                                borderRadius: '9999px',
                                                backgroundColor: '#fff',
                                                boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                                                transition: 'left 150ms ease',
                                              }}
                                            />
                                          </button>
                                        </label>

                                        <label
                                          style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'space-between',
                                            fontSize: '12px',
                                            color: 'var(--text-primary)',
                                            cursor: 'pointer',
                                          }}
                                        >
                                          <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                            <Send size={13} style={{ color: 'var(--text-secondary)' }} />
                                            Can bot send messages?
                                          </span>
                                          <button
                                            role="switch"
                                            aria-checked={grant.botPermissions.canSend}
                                            onClick={() =>
                                              handleUpdateBotPermissions(item.id, conv.id, {
                                                ...grant.botPermissions,
                                                canSend: !grant.botPermissions.canSend,
                                              })
                                            }
                                            style={{
                                              width: '36px',
                                              height: '20px',
                                              borderRadius: '9999px',
                                              border: 'none',
                                              backgroundColor: grant.botPermissions.canSend
                                                ? 'var(--brand-primary)'
                                                : 'var(--border-subtle)',
                                              position: 'relative',
                                              cursor: 'pointer',
                                            }}
                                          >
                                            <span
                                              style={{
                                                position: 'absolute',
                                                top: '2px',
                                                left: grant.botPermissions.canSend ? '18px' : '2px',
                                                width: '16px',
                                                height: '16px',
                                                borderRadius: '9999px',
                                                backgroundColor: '#fff',
                                                boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                                                transition: 'left 150ms ease',
                                              }}
                                            />
                                          </button>
                                        </label>
                                      </div>

                                      <div
                                        style={{
                                          marginTop: '8px',
                                          padding: '6px 8px',
                                          borderRadius: '6px',
                                          backgroundColor: 'rgba(89, 85, 232, 0.1)',
                                          border: '1px solid rgba(89, 85, 232, 0.2)',
                                        }}
                                      >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--accent-primary)' }}>
                                          <Info size={12} />
                                          <span>Bot messages will be labeled with a "BOT" badge and distinct styling</span>
                                        </div>
                                      </div>
                                    </div>

                                    <button
                                      onClick={() => handleDeleteGrant(item.id, conv.id)}
                                      style={{
                                        marginTop: '8px',
                                        padding: '4px 10px',
                                        borderRadius: '6px',
                                        border: '1px solid var(--danger)',
                                        backgroundColor: 'transparent',
                                        color: 'var(--danger)',
                                        fontSize: '11px',
                                        fontWeight: 600,
                                        cursor: 'pointer',
                                      }}
                                    >
                                      Revoke Grant
                                    </button>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};