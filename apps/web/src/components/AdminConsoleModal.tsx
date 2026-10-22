import { apiUrl } from '../config';
import React from 'react';
import { ShieldAlert, X } from 'lucide-react';
import { AdminRole } from '@orbit/schemas';
import { can } from '@orbit/domain';

interface AdminConsoleModalProps {
  isOpen: boolean;
  onClose: () => void;
  workspaceId: string;
  adminRole: AdminRole;
}

interface SupportArea {
  workspaceId: string;
  active: boolean;
  startTime?: Date;
}

export const AdminConsoleModal: React.FC<AdminConsoleModalProps> = ({ isOpen, onClose, workspaceId, adminRole }) => {
  const [activeTab, setActiveTab] = React.useState<'support' | 'trust_safety' | 'security_ops' | 'billing_support' | 'system_admin'>('support');
  const [support, setSupport] = React.useState<SupportArea | null>(null);
  const [reports, setReports] = React.useState<any[]>([]);
  const [actionNote, setActionNote] = React.useState('');
  const [accessGrants, setAccessGrants] = React.useState<any[]>([]);

  const capabilityMap: Record<string, boolean> = {
    support: can(adminRole, 'admin.support'),
    trust_safety: can(adminRole, 'admin.trust_safety'),
    security_ops: can(adminRole, 'admin.security_ops'),
    billing_support: can(adminRole, 'admin.billing_support'),
    system_admin: can(adminRole, 'admin.system'),
  };

  const loadAdminData = async () => {
    try {
      const repRes = await fetch(apiUrl("/v1/admin/reports"), {
        headers: { 'x-workspace-id': workspaceId },
      });
      const repData = await repRes.json();
      if (repData?.data) {
        setReports(repData.data);
      }

      const grantsRes = await fetch(apiUrl("/v1/admin/access-grants"), {
        headers: { 'x-workspace-id': workspaceId },
      });
      const grantsData = await grantsRes.json();
      if (grantsData?.data) {
        setAccessGrants(grantsData.data);
      }
    } catch (err) {
      console.error('Failed to load admin console data', err);
    }
  };

  const handleResolveReport = async (reportId: string, action: 'warning' | 'temporary_hold' | 'suspended' | 'none') => {
    try {
      await fetch(apiUrl(`/v1/admin/reports/${reportId}/resolve`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-workspace-id': workspaceId },
        body: JSON.stringify({
          action,
          note: actionNote || 'Reviewed against platform trust and safety community guidelines.',
        }),
      });
      alert(`Report marked as resolved with action: ${action}`);
      setActionNote('');
      loadAdminData();
    } catch (err) {
      console.error('Failed to resolve report', err);
    }
  };

  const startSupportView = async (targetWorkspaceId: string) => {
    try {
      await fetch(apiUrl('/v1/admin/access-grants'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-workspace-id': workspaceId },
        body: JSON.stringify({
          targetWorkspaceId,
          purpose: 'support_view',
          durationMinutes: 30,
          approverUserId: '',
        }),
      });
      setSupport({
        workspaceId: targetWorkspaceId,
        active: true,
        startTime: new Date(),
      });
      loadAdminData();
    } catch (err) {
      console.error('Failed to start support view', err);
    }
  };

  const endSupportView = () => {
    setSupport(null);
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="admin-title"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(16, 18, 27, 0.65)',
        backdropFilter: 'blur(8px)',
        zIndex: 60,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '900px',
          backgroundColor: 'var(--surface)',
          borderRadius: '20px',
          border: '1px solid var(--border-subtle)',
          boxShadow: '0 20px 40px rgba(0,0,0,0.25)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '85vh',
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
                background: 'linear-gradient(135deg, #DD6B20, #C53030)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
              }}
            >
              <ShieldAlert size={18} />
            </div>
            <div>
              <h2 id="admin-title" style={{ fontSize: '18px', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                Admin Console
              </h2>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                {adminRole} console — least-privilege compliance tools
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

        {/* Role-based Sidebar Tabs */}
        <div
          style={{
            display: 'flex',
            padding: '8px 24px',
            borderBottom: '1px solid var(--border-subtle)',
            gap: '12px',
            backgroundColor: 'var(--surface-muted)',
            flexShrink: 0,
          }}
        >
          {(['support', 'trust_safety', 'security_ops', 'billing_support', 'system_admin'] as const).map((tab) => {
            const showTab = capabilityMap[tab];
            const isActive = activeTab === tab;
            const tabLabels: Record<string, string> = {
              support: 'Support',
              trust_safety: 'Trust & Safety',
              security_ops: 'Security Ops',
              billing_support: 'Billing Support',
              system_admin: 'System Admin',
            };

            const badgeCounts: Record<string, number> = {
              support: 0,
              trust_safety: reports.length,
              security_ops: 0,
              billing_support: 0,
              system_admin: accessGrants.length,
            };

            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                style={{
                  padding: '8px 16px',
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontWeight: 600,
                  border: 'none',
                  cursor: 'pointer',
                  backgroundColor: isActive && showTab ? 'var(--surface)' : 'transparent',
                  color: isActive && showTab ? 'var(--brand-primary)' : 'var(--text-secondary)',
                  boxShadow: isActive && showTab ? 'var(--shadow-sm)' : 'none',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
                disabled={!showTab}
              >
                {tabLabels[tab]} {showTab && badgeCounts[tab] > 0 && (
                  <span style={{ fontSize: '11px', color: 'var(--caution)', fontWeight: 500 }}>
                    {badgeCounts[tab]}
                  </span>
                )}
                <span style={{ fontSize: '12px' }}>{tab === 'support' && capabilityMap.support ? '✓' : ''}</span>
              </button>
            );
          })}
        </div>

        {/* Body Content - Role-separated panels */}
        <div style={{ padding: '24px', overflowY: 'auto', flex: 1, gap: '24px' }}>
          {/* Support Area */}
          {activeTab === 'support' && capabilityMap.support && (
            <div>
              {/* Support Banner */}
              {support && (
                <div
                  style={{
                    padding: '16px 20px',
                    borderRadius: '12px',
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    border: '1px solid rgba(239, 68, 68, 0.3)',
                    marginBottom: '20px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                  }}
                >
                  <div
                    style={{
                      width: '12px',
                      height: '12px',
                      borderRadius: '50%',
                      backgroundColor: 'rgba(239, 68, 68, 0.5)',
                    }}
                  />
                  <span style={{ fontSize: '13px', fontWeight: 600, color: '#EF4444' }}>
                    SUPPORT VIEW ACTIVE — Read-only — Expires in
                  </span>
                  <span
                    id="support-expiry"
                    style={{
                      fontSize: '13px',
                      fontWeight: 600,
                      color: '#EF4444',
                    }}
                  >
                    30:00
                  </span>
                  <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                    — All actions logged to AdminAuditLog
                  </span>
                  <button
                    onClick={endSupportView}
                    style={{
                      marginLeft: 'auto',
                      padding: '6px 12px',
                      borderRadius: '6px',
                      background: 'rgba(239, 68, 68, 0.2)',
                      color: '#EF4444',
                      border: '1px solid rgba(239, 68, 68, 0.4)',
                      fontSize: '12px',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    End Support View
                  </button>
                </div>
              )}

              {/* Support Actions */}
              {!support && (
                <div style={{ marginBottom: '24px' }}>
                  <button
                    onClick={() => startSupportView(workspaceId)}
                    style={{
                      width: '100%',
                      padding: '12px',
                      borderRadius: '12px',
                      background: 'var(--primary)',
                      color: '#fff',
                      border: 'none',
                      fontSize: '14px',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Start Support View for Workspace
                  </button>
                </div>
              )}

              {support && (
                <div>
                  {/* User Lookup */}
                  <div style={{ marginBottom: '20px' }}>
                    <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '8px' }}>
                      User Lookup
                    </h3>
                    <input
                      type="text"
                      placeholder="Enter user handle or email"
                      style={{
                        width: '100%',
                        padding: '8px 12px',
                        borderRadius: '8px',
                        border: '1px solid var(--border-subtle)',
                        backgroundColor: 'var(--surface-muted)',
                        color: 'var(--text-primary)',
                        fontSize: '13px',
                        marginBottom: '12px',
                      }}
                    />
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        style={{
                          padding: '6px 12px',
                          borderRadius: '8px',
                          background: 'var(--surface)',
                          color: 'var(--text-primary)',
                          border: '1px solid var(--border-subtle)',
                          fontSize: '12px',
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        Lookup User
                      </button>
                      <button
                        style={{
                          padding: '6px 12px',
                          borderRadius: '8px',
                          background: 'var(--danger)',
                          color: '#fff',
                          border: 'none',
                          fontSize: '12px',
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        Revoke Sessions
                      </button>
                    </div>
                  </div>

                  {/* Session View */}
                  <div style={{ marginBottom: '20px' }}>
                    <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '8px' }}>
                      Active Sessions
                    </h3>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                      No active sessions loaded. Refreshing...
                    </div>
                  </div>

                  {/* Message Metadata */}
                  <div style={{ marginBottom: '20px' }}>
                    <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '8px' }}>
                      Message Metadata (Read-only)
                    </h3>
                    <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '0 0 8px 0' }}>
                      Preview first/last message, participants — NO message bodies
                    </p>
                    <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                      Metadata preview area - messages shown without content bodies
                    </div>
                  </div>

                  {/* Export Request Status */}
                  <div style={{ marginBottom: '20px' }}>
                    <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '8px' }}>
                      Export Request Status
                    </h3>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                      Pending requests will be processed within 30 days
                    </div>
                  </div>
                </div>
              )}

              {!support && (
                <div style={{ marginTop: '24px' }}>
                  <small style={{ color: 'var(--text-tertiary)' }}>
                    Support view is read-only: can view conversation list, message metadata, participant list, settings.
                    NO send/edit/delete/mute actions allowed.
                  </small>
                </div>
              )}
            </div>
          )}

          {/* Trust & Safety Area */}
          {activeTab === 'trust_safety' && capabilityMap.trust_safety && (
            <div>
              <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '8px' }}>
                Reports Queue
              </h3>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                Paginated queue by type - filtering by admin role permissions
              </div>
              <div style={{ marginTop: '16px' }}>
                {reports.map((rep: any) => (
                  <div
                    key={rep.id}
                    style={{
                      padding: '12px 16px',
                      borderRadius: '10px',
                      border: '1px solid var(--border-subtle)',
                      backgroundColor: 'var(--surface-muted)',
                      marginBottom: '8px',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                      <strong style={{ fontSize: '13px', color: 'var(--text-primary)' }}>
                        {rep.queueType || rep.reason}
                      </strong>
                      <span
        style={{ fontSize: '10px', fontWeight: 700, padding: '1px 6px', borderRadius: '4px', backgroundColor: 'var(--surface-sunken)', color: 'var(--text-secondary)' }}
      >
        {rep.status}
      </span>
                    </div>
                    <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                      Target: @{rep.targetHandle} &bull; {new Date(rep.createdAt).toLocaleDateString()}
                    </span>
                    {rep.queueType === 'urgent_safety' && (
                      <span style={{ fontSize: '10px', marginLeft: '8px', padding: '2px 6px', borderRadius: '4px', backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#EF4444' }}>
                        URGENT
                      </span>
                    )}
                    <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '4px' }}>
                      {rep.details || 'No details provided'}
                    </div>
                    {rep.status !== 'resolved' && rep.status !== 'dismissed' && (
                      <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
                        {(['warning', 'temporary_hold', 'suspended'] as const).map((action) => (
                          <button
                            key={action}
                            type="button"
                            onClick={() => {
                              void handleResolveReport(rep.id, action);
                            }}
                            style={{
                              padding: '4px 10px',
                              borderRadius: '6px',
                              border: '1px solid var(--border-subtle)',
                              backgroundColor: 'var(--surface)',
                              color: action === 'suspended' ? 'var(--danger)' : 'var(--text-primary)',
                              fontSize: '11px',
                              fontWeight: 600,
                              cursor: 'pointer',
                            }}
                          >
                            {action === 'warning' ? 'Warn' : action === 'temporary_hold' ? 'Hold' : 'Suspend'}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Security Ops Area */}
          {activeTab === 'security_ops' && capabilityMap.security_ops && (
            <div>
              <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '8px' }}>
                Device Audit
              </h3>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                List devices + key fingerprints for target workspace
              </div>
            </div>
          )}

          {/* Billing Support Area */}
          {activeTab === 'billing_support' && capabilityMap.billing_support && (
            <div>
              <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '8px' }}>
                Subscription View
              </h3>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                Invoice access, seat management, billing failure queue
              </div>
            </div>
          )}

          {/* System Admin Area */}
          {activeTab === 'system_admin' && capabilityMap.system_admin && (
            <div>
              <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '8px' }}>
                Feature Flags & Kill Switch
              </h3>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                System metrics dashboard, workspace suspension, migration status
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};