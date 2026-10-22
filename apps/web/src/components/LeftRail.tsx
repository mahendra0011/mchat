import React from 'react';
import {
  MessageSquare,
  Users,
  Archive,
  Briefcase,
  Phone,
  Settings,
  Plus,
  Sun,
  Moon,
  ChevronDown,
  UserPlus,
  CreditCard,
  Puzzle,
  ShieldAlert,
  Sparkles,
  FolderInput,
  Fingerprint,
  ShieldCheck,
  BarChart3,
} from 'lucide-react';
import { IdentityWorkspace } from '@orbit/schemas';

interface LeftRailProps {
  workspaces: IdentityWorkspace[];
  activeWorkspace: IdentityWorkspace;
  onSelectWorkspace: (ws: IdentityWorkspace) => void;
  activeNav: string;
  onSelectNav: (nav: string) => void;
  onOpenQuickCreate: () => void;
  onOpenSettings: () => void;
  onOpenDiscovery: () => void;
  onOpenBilling: () => void;
  onOpenIntegrations: () => void;
  onOpenAdminConsole: () => void;
  onOpenOnboarding: () => void;
  onOpenImport: () => void;
  onOpenSessions?: () => void;
  onOpenE2EE?: () => void;
  onOpenAnalytics?: () => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
}

export const LeftRail: React.FC<LeftRailProps> = ({
  workspaces,
  activeWorkspace,
  onSelectWorkspace,
  activeNav,
  onSelectNav,
  onOpenQuickCreate,
  onOpenSettings,
  onOpenDiscovery,
  onOpenBilling,
  onOpenIntegrations,
  onOpenAdminConsole,
  onOpenOnboarding,
  onOpenImport,
  onOpenSessions,
  onOpenE2EE,
  onOpenAnalytics,
  theme,
  onToggleTheme,
}) => {
  const [showWorkspaceMenu, setShowWorkspaceMenu] = React.useState(false);
  const isBusiness = activeWorkspace.type === 'business';

  return (
    <aside
      aria-label="Primary Navigation"
      style={{
        width: '68px',
        backgroundColor: 'var(--surface)',
        borderRight: '1px solid var(--border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '12px 0',
        zIndex: 30,
        position: 'relative',
        userSelect: 'none',
      }}
    >
      {/* Workspace Switcher Trigger */}
      <div style={{ position: 'relative', marginBottom: '14px' }}>
        <button
          id="workspace-switcher-button"
          aria-label={`Switch workspace. Current: ${activeWorkspace.displayName} (${activeWorkspace.type})`}
          onClick={() => setShowWorkspaceMenu(!showWorkspaceMenu)}
          style={{
            width: '44px',
            height: '44px',
            borderRadius: '14px',
            background: isBusiness
              ? 'linear-gradient(135deg, var(--business-badge), var(--accent-primary))'
              : 'linear-gradient(135deg, var(--accent-primary), var(--accent-hover))',
            color: 'var(--accent-text)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 700,
            fontSize: '16px',
            border: 'none',
            cursor: 'pointer',
            boxShadow: 'var(--shadow-sm)',
            position: 'relative',
            transition: 'transform 150ms ease',
          }}
          title={`${activeWorkspace.displayName} (${activeWorkspace.type})`}
        >
          {isBusiness ? <Briefcase size={20} /> : activeWorkspace.displayName.charAt(0)}
          <span
            style={{
              position: 'absolute',
              bottom: '-3px',
              right: '-3px',
              background: 'var(--surface)',
              borderRadius: '9999px',
              padding: '2px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <ChevronDown size={10} color="var(--text-secondary)" />
          </span>
        </button>

        {/* Workspace Switcher Menu */}
        {showWorkspaceMenu && (
          <div
            role="menu"
            style={{
              position: 'absolute',
              top: '52px',
              left: '8px',
              width: '260px',
              backgroundColor: 'var(--surface-elevated)',
              borderRadius: 'var(--radius-lg)',
              boxShadow: 'var(--shadow-lg)',
              border: '1px solid var(--border-subtle)',
              padding: '8px',
              zIndex: 50,
              animation: 'fadeIn 120ms ease-out forwards',
            }}
          >
            <div
              style={{
                fontSize: '11px',
                fontWeight: 600,
                color: 'var(--text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                padding: '6px 10px',
              }}
            >
              Your Workspaces
            </div>

            {workspaces.map((ws) => {
              const active = ws.id === activeWorkspace.id;
              const isBiz = ws.type === 'business';
              return (
                <button
                  key={ws.id}
                  role="menuitem"
                  onClick={() => {
                    onSelectWorkspace(ws);
                    setShowWorkspaceMenu(false);
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    width: '100%',
                    padding: '8px 10px',
                    borderRadius: 'var(--radius-md)',
                    border: 'none',
                    backgroundColor: active ? 'var(--accent-soft)' : 'transparent',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'background 120ms ease',
                  }}
                >
                  <div
                    style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: '10px',
                      backgroundColor: isBiz ? 'var(--business-badge)' : 'var(--accent-primary)',
                      color: 'var(--accent-text)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 600,
                      fontSize: '13px',
                      flexShrink: 0,
                    }}
                  >
                    {isBiz ? <Briefcase size={16} /> : ws.displayName.charAt(0)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: '13px',
                        fontWeight: 600,
                        color: active ? 'var(--accent-primary)' : 'var(--text-primary)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {ws.displayName}
                    </div>
                    <div
                      style={{
                        fontSize: '11px',
                        color: 'var(--text-secondary)',
                        textTransform: 'capitalize',
                      }}
                    >
                      {ws.type} Workspace
                    </div>
                  </div>
                  {active && (
                    <span
                      style={{
                        width: '6px',
                        height: '6px',
                        borderRadius: '9999px',
                        backgroundColor: 'var(--accent-primary)',
                      }}
                    />
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Quick Create Action */}
      <button
        id="quick-create-button"
        aria-label="New message or conversation"
        onClick={onOpenQuickCreate}
        style={{
          width: '38px',
          height: '38px',
          borderRadius: '12px',
          backgroundColor: 'var(--surface-muted)',
          color: 'var(--accent-primary)',
          border: '1px solid var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          marginBottom: '16px',
          transition: 'all 150ms ease',
        }}
        title="Start new conversation"
      >
        <Plus size={18} />
      </button>

      {/* Navigation Icons */}
      <nav style={{ display: 'flex', flexDirection: 'column', gap: '6px', flex: 1, width: '100%', alignItems: 'center' }}>
        {[
          { id: 'inbox', label: 'Inbox', icon: MessageSquare },
          { id: 'people', label: 'People', icon: Users },
          { id: 'vault', label: 'Context Vault', icon: Archive },
          ...(isBusiness ? [{ id: 'business', label: 'Business Hub', icon: Briefcase }] : []),
          { id: 'calls', label: 'Calls', icon: Phone },
        ].map((item) => {
          const isActive = activeNav === item.id;
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              id={`nav-${item.id}`}
              aria-label={item.label}
              onClick={() => onSelectNav(item.id)}
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: 'none',
                backgroundColor: isActive ? 'var(--accent-soft)' : 'transparent',
                color: isActive ? 'var(--accent-primary)' : 'var(--text-secondary)',
                cursor: 'pointer',
                transition: 'all 120ms ease',
                position: 'relative',
              }}
              title={item.label}
            >
              <Icon size={19} />
              {isActive && (
                <span
                  style={{
                    position: 'absolute',
                    left: '0px',
                    width: '3px',
                    height: '20px',
                    borderRadius: '0 4px 4px 0',
                    backgroundColor: 'var(--accent-primary)',
                  }}
                />
              )}
            </button>
          );
        })}

        {/* Separator */}
        <div style={{ width: '28px', height: '1px', backgroundColor: 'var(--border-subtle)', margin: '4px 0' }} />

        {/* Contact Discovery & Invite */}
        <button
          id="nav-discovery"
          aria-label="Find People & Connections"
          onClick={onOpenDiscovery}
          style={{
            width: '40px',
            height: '40px',
            borderRadius: '12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: 'none',
            backgroundColor: 'transparent',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
          }}
          title="Find People & Requests (Spec 21)"
        >
          <UserPlus size={19} />
        </button>

        {/* Billing & Entitlements */}
        <button
          id="nav-billing"
          aria-label="Billing & Entitlements"
          onClick={onOpenBilling}
          style={{
            width: '40px',
            height: '40px',
            borderRadius: '12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: 'none',
            backgroundColor: 'transparent',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
          }}
          title="Billing & Entitlements (Spec 22)"
        >
          <CreditCard size={19} />
        </button>

        {/* Integrations & Bots */}
        <button
          id="nav-integrations"
          aria-label="Integrations & Bots"
          onClick={onOpenIntegrations}
          style={{
            width: '40px',
            height: '40px',
            borderRadius: '12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: 'none',
            backgroundColor: 'transparent',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
          }}
          title="Integrations & Modules (Spec 24)"
        >
          <Puzzle size={19} />
        </button>

        {/* Admin Console & Moderation (for business or admin role) */}
        <button
          id="nav-admin"
          aria-label="Trust & Safety Admin Console"
          onClick={onOpenAdminConsole}
          style={{
            width: '40px',
            height: '40px',
            borderRadius: '12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: 'none',
            backgroundColor: 'transparent',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
          }}
          title="Trust & Safety Admin Console (Spec 23)"
        >
          <ShieldAlert size={19} />
        </button>

        {/* Data Portability / Import */}
        <button
          id="nav-import"
          aria-label="Data Portability & Import"
          onClick={onOpenImport}
          style={{
            width: '40px',
            height: '40px',
            borderRadius: '12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: 'none',
            backgroundColor: 'transparent',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
          }}
          title="Data Portability & Import (Spec 26)"
        >
          <FolderInput size={19} />
        </button>

        {/* Device & Session Security (Spec 30) */}
        {onOpenSessions && (
          <button
            id="nav-sessions"
            aria-label="Device & Session Security"
            onClick={onOpenSessions}
            style={{
              width: '40px',
              height: '40px',
              borderRadius: '12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: 'none',
              backgroundColor: 'transparent',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
            }}
            title="Device & Session Security (Spec 30)"
          >
            <Fingerprint size={19} />
          </button>
        )}

        {/* E2EE Safety Numbers & Verification (Spec 31) */}
        {onOpenE2EE && (
          <button
            id="nav-e2ee-verify"
            aria-label="E2EE Safety Numbers & Verification"
            onClick={onOpenE2EE}
            style={{
              width: '40px',
              height: '40px',
              borderRadius: '12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: 'none',
              backgroundColor: 'transparent',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
            }}
            title="E2EE Key Verification & Safety Numbers (Spec 31)"
          >
            <ShieldCheck size={19} />
          </button>
        )}
      </nav>

      {/* Bottom Controls: Onboarding Guide, Theme Toggle & Settings */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'center' }}>
        {onOpenAnalytics && (
          <button
            id="nav-analytics"
            aria-label="Business analytics"
            onClick={onOpenAnalytics}
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '12px',
              backgroundColor: 'var(--accent-soft)',
              color: 'var(--accent-primary)',
              border: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
            }}
            title="Business analytics"
          >
            <BarChart3 size={17} />
          </button>
        )}

        <button
          id="onboarding-guide-button"
          aria-label="Welcome & Privacy Presets"
          onClick={onOpenOnboarding}
          style={{
            width: '36px',
            height: '36px',
            borderRadius: '12px',
            backgroundColor: 'var(--accent-soft)',
            color: 'var(--brand-primary)',
            border: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
          }}
          title="Welcome Guide & Privacy Presets"
        >
          <Sparkles size={17} />
        </button>

        <button
          id="theme-toggle-button"
          aria-label={`Toggle theme (currently ${theme})`}
          onClick={onToggleTheme}
          style={{
            width: '36px',
            height: '36px',
            borderRadius: '12px',
            backgroundColor: 'transparent',
            color: 'var(--text-secondary)',
            border: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            transition: 'color 120ms ease',
          }}
          title={`Switch to ${theme === 'light' ? 'Dark' : 'Light'} Mode`}
        >
          {theme === 'light' ? <Moon size={17} /> : <Sun size={17} />}
        </button>

        <button
          id="settings-button"
          aria-label="Settings"
          onClick={onOpenSettings}
          style={{
            width: '36px',
            height: '36px',
            borderRadius: '12px',
            backgroundColor: 'transparent',
            color: 'var(--text-secondary)',
            border: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
          }}
          title="Settings"
        >
          <Settings size={17} />
        </button>

        {/* User Avatar with Presence */}
        <div style={{ position: 'relative', marginTop: '2px' }}>
          <div
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '9999px',
              backgroundColor: 'var(--accent-primary)',
              color: 'var(--accent-text)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 700,
              fontSize: '12px',
            }}
          >
            {activeWorkspace.displayName.charAt(0)}
          </div>
          <span
            style={{
              position: 'absolute',
              bottom: '0px',
              right: '0px',
              width: '9px',
              height: '9px',
              borderRadius: '9999px',
              backgroundColor: 'var(--positive)',
              border: '2px solid var(--surface)',
            }}
            title="Online"
          />
        </div>
      </div>
    </aside>
  );
};
