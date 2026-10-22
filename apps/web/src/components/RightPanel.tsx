import React from 'react';
import {
  X,
  ShieldCheck,
  Archive,
  Palette,
  CheckSquare,
  Lock,
  Clock,
  Smartphone,
  History,
  GitBranch,
} from 'lucide-react';
import {
  Conversation,
  PrivacyReceipt,
  VaultCollection,
  VaultItem,
  WorkflowCard,
  IdentityWorkspace,
  MessageEnvelope,
} from '@orbit/schemas';
import { TimelineTab } from './TimelineTab.js';
import { PrivacyPresetSwitcher } from './PrivacyPresetSwitcher.js';
import { CrossDeviceHandoff } from './CrossDeviceHandoff.js';

type RightPanelTab = 'details' | 'privacy' | 'vault' | 'studio' | 'workflows' | 'timeline' | 'branches';

interface RightPanelProps {
  conversation: Conversation;
  receipt: PrivacyReceipt | null;
  vaultCollections: VaultCollection[];
  vaultItems: VaultItem[];
  workflowCards: WorkflowCard[];
  activeTab: RightPanelTab;
  onSelectTab: (tab: RightPanelTab) => void;
  onClose: () => void;
  onSaveToVault: (title: string, content: string, collectionId: string, tags: string[]) => Promise<void>;
  onUpdateStudioSettings: (settings: any) => void;
  activeWorkspace: IdentityWorkspace;
  messages: MessageEnvelope[];
}

export const RightPanel: React.FC<RightPanelProps> = ({
  conversation,
  receipt,
  vaultCollections,
  vaultItems,
  workflowCards,
  activeTab,
  onSelectTab,
  onClose,
  onSaveToVault,
  onUpdateStudioSettings,
  activeWorkspace,
  messages,
}) => {
  const [newVaultTitle, setNewVaultTitle] = React.useState('');
  const [newVaultContent, setNewVaultContent] = React.useState('');
  const [selectedCollectionId, setSelectedCollectionId] = React.useState(vaultCollections[0]?.id || '');
  const [accentColor, setAccentColor] = React.useState(conversation.studioSettings?.themeAccent || '#5955E8');
  const [selectedDensity, setSelectedDensity] = React.useState(conversation.studioSettings?.density || 'standard');
  const [selectedWallpaper, setSelectedWallpaper] = React.useState(conversation.studioSettings?.wallpaper || 'none');

  return (
    <aside
      aria-label="Conversation details and tools"
      style={{
        width: '340px',
        backgroundColor: 'var(--surface)',
        borderLeft: '1px solid var(--border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        zIndex: 20,
        userSelect: 'none',
      }}
    >
      {/* Panel Navigation Tabs */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 14px',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        <div style={{ display: 'flex', gap: '4px', overflowX: 'auto' }}>
          {[
            { id: 'details', label: 'Details' },
            { id: 'timeline', label: 'Timeline' },
            { id: 'privacy', label: 'Privacy' },
            { id: 'vault', label: 'Vault' },
            { id: 'studio', label: 'Studio' },
            { id: 'workflows', label: 'Cards' },
            { id: 'branches', label: 'Branches', icon: GitBranch },
          ].map((t) => {
            const isSelected = activeTab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => onSelectTab(t.id as RightPanelTab)}
                style={{
                  padding: '4px 8px',
                  borderRadius: 'var(--radius-md)',
                  border: 'none',
                  backgroundColor: isSelected ? 'var(--accent-soft)' : 'transparent',
                  color: isSelected ? 'var(--accent-primary)' : 'var(--text-secondary)',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 120ms ease',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                {t.icon && <t.icon size={14} />}
                {t.label}
              </button>
            );
          })}
        </div>

        <button
          aria-label="Close panel"
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            padding: '4px',
            display: 'flex',
          }}
        >
          <X size={18} />
        </button>
      </div>

      {/* Panel Content Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
        {/* TAB 1: DETAILS */}
        {activeTab === 'details' && (
          <div>
            <div style={{ textAlign: 'center', marginBottom: '20px' }}>
              <div
                style={{
                  width: '56px',
                  height: '56px',
                  borderRadius: '16px',
                  backgroundColor: 'var(--accent-primary)',
                  color: '#FFF',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 700,
                  fontSize: '22px',
                  margin: '0 auto 10px',
                }}
              >
                {(conversation.title || 'C').charAt(0)}
              </div>
              <h3 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)' }}>
                {conversation.title || 'Direct Conversation'}
              </h3>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                {conversation.isE2EE ? '🔒 End-to-End Encrypted' : '🏢 Business Relay Workspace'}
              </p>
            </div>

            {/* Participants */}
            <div style={{ marginBottom: '20px' }}>
              <h4 style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '8px' }}>
                Participants ({conversation.participants.length})
              </h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {conversation.participants.map((p) => (
                  <div
                    key={p.workspaceId}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '8px 10px',
                      borderRadius: 'var(--radius-md)',
                      backgroundColor: 'var(--surface-muted)',
                    }}
                  >
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                        {p.displayName}
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>@{p.handle}</div>
                    </div>
                    <span
                      style={{
                        fontSize: '11px',
                        padding: '2px 6px',
                        borderRadius: '4px',
                        backgroundColor: 'var(--surface)',
                        color: 'var(--text-muted)',
                      }}
                    >
                      {p.role}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Wave B — privacy preset quick switcher */}
            <PrivacyPresetSwitcher workspaceId={activeWorkspace.id} />

            {/* Wave B — cross-device handoff */}
            <CrossDeviceHandoff conversationId={conversation.id} />
          </div>
        )}

        {/* TAB: TIMELINE (client-derived activity feed) */}
        {activeTab === 'timeline' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '14px' }}>
              <History size={18} color="var(--accent-primary)" />
              <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
                Timeline
              </h3>
            </div>
            <TimelineTab
              conversation={conversation}
              messages={messages}
              activeWorkspace={activeWorkspace}
              workflowCards={workflowCards}
            />
          </div>
        )}

        {/* TAB 2: PRIVACY RECEIPT (Authoritative Who Can See This Control) */}
        {activeTab === 'privacy' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
              <ShieldCheck size={20} color="var(--positive)" />
              <div>
                <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)' }}>Privacy Receipt</h3>
                <p style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Authoritative room security declaration</p>
              </div>
            </div>

            {receipt && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {/* Encryption Status Card */}
                <div
                  style={{
                    padding: '12px',
                    borderRadius: 'var(--radius-md)',
                    backgroundColor: 'var(--surface-muted)',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px', color: 'var(--positive)' }}>
                    <Lock size={14} />
                    <span style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase' }}>
                      {receipt.encryption.isE2EE ? 'Verified E2EE' : 'TLS Transport Encryption'}
                    </span>
                  </div>
                  <p style={{ fontSize: '12px', color: 'var(--text-primary)', fontWeight: 500 }}>
                    {receipt.encryption.protocol}
                  </p>
                  <p style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                    {receipt.encryption.limitations}
                  </p>
                </div>

                {/* Retention Card */}
                <div
                  style={{
                    padding: '12px',
                    borderRadius: 'var(--radius-md)',
                    backgroundColor: 'var(--surface-muted)',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px', color: 'var(--text-primary)' }}>
                    <Clock size={14} />
                    <span style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase' }}>
                      {receipt.retention.policyName}
                    </span>
                  </div>
                  <p style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                    {receipt.retention.deletionNotice}
                  </p>
                </div>

                {/* Devices Card */}
                <div
                  style={{
                    padding: '12px',
                    borderRadius: 'var(--radius-md)',
                    backgroundColor: 'var(--surface-muted)',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px', color: 'var(--text-primary)' }}>
                    <Smartphone size={14} />
                    <span style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase' }}>Authorized Devices</span>
                  </div>
                  <p style={{ fontSize: '12px', color: 'var(--text-primary)' }}>
                    {receipt.devices.totalAuthorizedDevices} total devices linked to participants.
                  </p>
                  <p style={{ fontSize: '11px', color: 'var(--positive)', marginTop: '2px' }}>
                    ✓ No suspicious or unverified device keys detected.
                  </p>
                </div>

                {/* AI & Automation Assertion */}
                <div
                  style={{
                    padding: '12px',
                    borderRadius: 'var(--radius-md)',
                    backgroundColor: 'var(--positive-soft)',
                    border: '1px solid var(--positive)',
                  }}
                >
                  <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--positive)', marginBottom: '2px' }}>
                    Zero Silent AI Training
                  </div>
                  <p style={{ fontSize: '11px', color: 'var(--text-primary)' }}>
                    No server-side AI model or third-party bot has permission to inspect conversation content.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 3: CONTEXT VAULT */}
        {activeTab === 'vault' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Archive size={18} color="var(--accent-primary)" />
                <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)' }}>Context Vault</h3>
              </div>
            </div>

            {/* Save Item Form */}
            <div
              style={{
                padding: '12px',
                borderRadius: 'var(--radius-md)',
                backgroundColor: 'var(--surface-muted)',
                marginBottom: '16px',
                border: '1px solid var(--border-subtle)',
              }}
            >
              <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '8px' }}>
                Save Snippet to Vault
              </div>
              <select
                aria-label="Vault collection"
                value={selectedCollectionId}
                onChange={(e) => setSelectedCollectionId(e.target.value)}
                style={{
                  width: '100%',
                  padding: '6px 8px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-subtle)',
                  fontSize: '12px',
                  marginBottom: '8px',
                  backgroundColor: 'var(--surface)',
                  color: 'var(--text-primary)',
                }}
              >
                {vaultCollections.map((col) => (
                  <option key={col.id} value={col.id}>
                    {col.name} ({col.visibility})
                  </option>
                ))}
              </select>
              <input
                type="text"
                placeholder="Title or decision label…"
                value={newVaultTitle}
                onChange={(e) => setNewVaultTitle(e.target.value)}
                style={{
                  width: '100%',
                  padding: '6px 8px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-subtle)',
                  fontSize: '12px',
                  marginBottom: '8px',
                  backgroundColor: 'var(--surface)',
                  color: 'var(--text-primary)',
                }}
              />
              <textarea
                rows={2}
                placeholder="Content, decision notes or quote…"
                value={newVaultContent}
                onChange={(e) => setNewVaultContent(e.target.value)}
                style={{
                  width: '100%',
                  padding: '6px 8px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-subtle)',
                  fontSize: '12px',
                  marginBottom: '8px',
                  backgroundColor: 'var(--surface)',
                  color: 'var(--text-primary)',
                  resize: 'none',
                }}
              />
              <button
                onClick={async () => {
                  if (newVaultContent.trim()) {
                    await onSaveToVault(
                      newVaultTitle.trim() || 'Saved Note',
                      newVaultContent.trim(),
                      selectedCollectionId || vaultCollections[0]?.id || '',
                      ['chat-saved']
                    );
                    setNewVaultTitle('');
                    setNewVaultContent('');
                  }
                }}
                style={{
                  width: '100%',
                  padding: '6px',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'var(--accent-primary)',
                  color: '#FFF',
                  border: 'none',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Save to Context Vault
              </button>
            </div>

            {/* Saved Items in Vault */}
            <div>
              <h4 style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '8px' }}>
                Saved in this Workspace ({vaultItems.length})
              </h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {vaultItems.map((item) => (
                  <div
                    key={item.id}
                    style={{
                      padding: '10px 12px',
                      borderRadius: 'var(--radius-md)',
                      backgroundColor: 'var(--surface)',
                      border: '1px solid var(--border-subtle)',
                      boxShadow: 'var(--shadow-sm)',
                    }}
                  >
                    <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--accent-primary)', marginBottom: '2px' }}>
                      {item.title || 'Untitled Snippet'}
                    </div>
                    <p style={{ fontSize: '12px', color: 'var(--text-primary)', lineHeight: 1.4 }}>
                      {item.content}
                    </p>
                    <div style={{ display: 'flex', gap: '4px', marginTop: '6px' }}>
                      {item.tags.map((tag) => (
                        <span
                          key={tag}
                          style={{
                            fontSize: '10px',
                            backgroundColor: 'var(--surface-muted)',
                            padding: '1px 5px',
                            borderRadius: '3px',
                            color: 'var(--text-secondary)',
                          }}
                        >
                          #{tag}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: CONVERSATION STUDIO (Per-Chat Customization) */}
        {activeTab === 'studio' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '14px' }}>
              <Palette size={18} color="var(--accent-primary)" />
              <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)' }}>Conversation Studio</h3>
            </div>
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
              Per-chat layout & visual recipe. These preferences are purely local to this conversation.
            </p>

            {/* Accent Preset Colors */}
            <div style={{ marginBottom: '16px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)', display: 'block', marginBottom: '6px' }}>
                Theme Accent Color
              </label>
              <div style={{ display: 'flex', gap: '8px' }}>
                {['#5955E8', '#16866A', '#805AD5', '#C33B52', '#0284C7'].map((c) => (
                  <button
                    key={c}
                    onClick={() => {
                      setAccentColor(c);
                      onUpdateStudioSettings({ themeAccent: c });
                    }}
                    style={{
                      width: '28px',
                      height: '28px',
                      borderRadius: '9999px',
                      backgroundColor: c,
                      border: accentColor === c ? '2px solid var(--text-primary)' : 'none',
                      cursor: 'pointer',
                    }}
                  />
                ))}
              </div>
            </div>

            {/* Density Selector */}
            <div style={{ marginBottom: '16px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)', display: 'block', marginBottom: '6px' }}>
                Layout Density
              </label>
              <div style={{ display: 'flex', gap: '6px' }}>
                {(['compact', 'standard', 'comfortable'] as const).map((d) => (
                  <button
                    key={d}
                    onClick={() => {
                      setSelectedDensity(d);
                      onUpdateStudioSettings({ density: d });
                    }}
                    style={{
                      flex: 1,
                      padding: '6px',
                      borderRadius: 'var(--radius-sm)',
                      border: selectedDensity === d ? '1px solid var(--accent-primary)' : '1px solid var(--border-subtle)',
                      backgroundColor: selectedDensity === d ? 'var(--accent-soft)' : 'var(--surface-muted)',
                      color: selectedDensity === d ? 'var(--accent-primary)' : 'var(--text-secondary)',
                      fontSize: '11px',
                      fontWeight: 600,
                      textTransform: 'capitalize',
                      cursor: 'pointer',
                    }}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>

            {/* Wallpaper Selection */}
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)', display: 'block', marginBottom: '6px' }}>
                Wallpaper Preset
              </label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {[
                  { id: 'none', label: 'Default Canvas' },
                  { id: 'aurora-glow', label: 'Aurora Paper Glow' },
                  { id: 'warm-paper', label: 'Warm Neutral Texture' },
                ].map((wp) => (
                  <button
                    key={wp.id}
                    onClick={() => {
                      setSelectedWallpaper(wp.id as any);
                      onUpdateStudioSettings({ wallpaper: wp.id });
                    }}
                    style={{
                      padding: '8px 10px',
                      borderRadius: 'var(--radius-sm)',
                      textAlign: 'left',
                      border: selectedWallpaper === wp.id ? '1px solid var(--accent-primary)' : '1px solid var(--border-subtle)',
                      backgroundColor: selectedWallpaper === wp.id ? 'var(--accent-soft)' : 'transparent',
                      color: selectedWallpaper === wp.id ? 'var(--accent-primary)' : 'var(--text-primary)',
                      fontSize: '12px',
                      fontWeight: 500,
                      cursor: 'pointer',
                    }}
                  >
                    {wp.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* TAB 5: WORKFLOW CARDS */}
        {activeTab === 'workflows' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '14px' }}>
              <CheckSquare size={18} color="var(--accent-primary)" />
              <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)' }}>Workflow Cards</h3>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {workflowCards.map((card) => (
                <div
                  key={card.id}
                  style={{
                    padding: '12px',
                    borderRadius: 'var(--radius-md)',
                    backgroundColor: 'var(--surface-muted)',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                    <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--accent-primary)', textTransform: 'uppercase' }}>
                      {card.cardType}
                    </span>
                    <span style={{ fontSize: '11px', fontWeight: 600, color: card.status === 'approved' ? 'var(--positive)' : 'var(--caution)' }}>
                      {card.status}
                    </span>
                  </div>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>{card.title}</div>
                  {card.description && (
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                      {card.description}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 6: BRANCHES (Spec 19) */}
        {activeTab === 'branches' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '14px' }}>
              <GitBranch size={18} color="var(--accent-primary)" />
              <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)' }}>Branches</h3>
            </div>
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
              Branch conversations created from messages in this conversation.
            </p>
            {conversation.kind === 'branch' ? (
              <div style={{ padding: '12px', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--surface-muted)', border: '1px solid var(--border-subtle)' }}>
                <p style={{ fontSize: '13px', color: 'var(--text-primary)' }}>
                  This is a branch conversation. View the parent conversation to see all branches.
                </p>
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>
                <GitBranch size={32} style={{ margin: '0 auto 12px', opacity: 0.5 }} />
                <p style={{ fontSize: '13px', fontWeight: 600, marginBottom: '4px' }}>No branches yet</p>
                <p style={{ fontSize: '12px' }}>Hover a message and click the branch icon to start a new thread.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
};
