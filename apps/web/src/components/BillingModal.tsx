import { apiUrl } from '../config';
import React from 'react';
import {
  CreditCard,
  Check,
  X,
  Zap,
  HardDrive,
  Users,
  FileText,
  Download,
} from 'lucide-react';
import { BillingEntitlement, InvoiceRecord } from '@orbit/schemas';

interface BillingModalProps {
  isOpen: boolean;
  onClose: () => void;
  workspaceId: string;
  isBusiness: boolean;
}

export const BillingModal: React.FC<BillingModalProps> = ({
  isOpen,
  onClose,
  workspaceId,
  isBusiness,
}) => {
  const [entitlement, setEntitlement] = React.useState<BillingEntitlement | null>(null);
  const [invoices, setInvoices] = React.useState<InvoiceRecord[]>([]);
  const [activeTab, setActiveTab] = React.useState<'overview' | 'invoices'>('overview');
  const [isUpgrading, setIsUpgrading] = React.useState(false);
  const dialogRef = React.useRef<HTMLDivElement>(null);

  // Move focus into the dialog on open (Spec 15 focus management)
  React.useEffect(() => {
    if (!isOpen) return;
    dialogRef.current?.focus();
  }, [isOpen]);

  // Escape closes the dialog (Spec 06/15)
  React.useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  React.useEffect(() => {
    if (isOpen) {
      loadBillingData();
    }
  }, [isOpen, workspaceId]);

  const loadBillingData = async () => {
    try {
      const res = await fetch(apiUrl(`/v1/workspaces/${workspaceId}/billing/entitlements`));
      const data = await res.json();
      if (data?.data) {
        setEntitlement(data.data);
      }

      const invRes = await fetch(apiUrl(`/v1/workspaces/${workspaceId}/billing/invoices`));
      const invData = await invRes.json();
      if (invData?.data) {
        setInvoices(invData.data);
      }
    } catch (err) {
      console.error('Failed to load billing details', err);
    }
  };

  const handleUpgradePlan = async (targetPlan: string) => {
    setIsUpgrading(true);
    try {
      const res = await fetch(apiUrl(`/v1/workspaces/${workspaceId}/billing/upgrade`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: targetPlan }),
      });
      const data = await res.json();
      if (data?.data) {
        setEntitlement(data.data);
        alert(`Successfully transitioned plan to ${targetPlan}!`);
      }
    } catch (err) {
      console.error('Plan upgrade failed', err);
    } finally {
      setIsUpgrading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="billing-title"
      ref={dialogRef}
      tabIndex={-1}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'var(--overlay-scrim)',
        backdropFilter: 'blur(8px)',
        zIndex: 60,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
      }}
    >
      <div
        className="animate-scale-in"
        style={{
          width: '100%',
          maxWidth: '680px',
          backgroundColor: 'var(--surface)',
          borderRadius: '20px',
          border: '1px solid var(--border-subtle)',
          boxShadow: 'var(--shadow-xl)',
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
                background: 'var(--positive)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--accent-text)',
              }}
            >
              <CreditCard size={18} />
            </div>
            <div>
              <h2 id="billing-title" style={{ fontSize: '18px', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                Billing & Entitlements
              </h2>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                Server-enforced quotas, storage limits, and verified invoices
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

        {/* Tab Switcher */}
        <div
          style={{
            display: 'flex',
            padding: '8px 24px',
            borderBottom: '1px solid var(--border-subtle)',
            gap: '12px',
            backgroundColor: 'var(--surface-muted)',
          }}
        >
          <button
            onClick={() => setActiveTab('overview')}
            style={{
              padding: '8px 16px',
              borderRadius: '8px',
              fontSize: '13px',
              fontWeight: 600,
              border: 'none',
              cursor: 'pointer',
              backgroundColor: activeTab === 'overview' ? 'var(--surface)' : 'transparent',
              color: activeTab === 'overview' ? 'var(--brand-primary)' : 'var(--text-secondary)',
              boxShadow: activeTab === 'overview' ? 'var(--shadow-sm)' : 'none',
            }}
          >
            Plan & Quotas
          </button>
          <button
            onClick={() => setActiveTab('invoices')}
            style={{
              padding: '8px 16px',
              borderRadius: '8px',
              fontSize: '13px',
              fontWeight: 600,
              border: 'none',
              cursor: 'pointer',
              backgroundColor: activeTab === 'invoices' ? 'var(--surface)' : 'transparent',
              color: activeTab === 'invoices' ? 'var(--brand-primary)' : 'var(--text-secondary)',
              boxShadow: activeTab === 'invoices' ? 'var(--shadow-sm)' : 'none',
            }}
          >
            Invoices & Receipts ({invoices.length})
          </button>
        </div>

        {/* Body Content */}
        <div style={{ padding: '24px', overflowY: 'auto', flex: 1 }}>
          {activeTab === 'overview' && (
            <div>
              {/* Active Plan Card */}
              <div
                style={{
                  padding: '18px 20px',
                  borderRadius: '14px',
                  backgroundColor: 'var(--surface-muted)',
                  border: '1px solid var(--border-subtle)',
                  marginBottom: '20px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                    <span
                      style={{
                        fontSize: '11px',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        padding: '2px 8px',
                        borderRadius: '6px',
                        background: 'var(--brand-primary)',
                        color: 'var(--accent-text)',
                      }}
                    >
                      Active Plan
                    </span>
                    <strong style={{ fontSize: '16px', color: 'var(--text-primary)' }}>
                      {entitlement?.plan ? entitlement.plan.replace('_', ' ').toUpperCase() : 'PERSONAL FREE'}
                    </strong>
                  </div>
                  <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                    Renewal Date: {entitlement?.renewalDate ? new Date(entitlement.renewalDate).toLocaleDateString() : 'N/A'} &bull; Status: Active
                  </span>
                </div>

                {isBusiness && (
                  <button
                    onClick={() => handleUpgradePlan(entitlement?.plan === 'business_scale' ? 'business_starter' : 'business_scale')}
                    disabled={isUpgrading}
                    style={{
                      padding: '8px 16px',
                      borderRadius: '8px',
                      background: 'var(--brand-primary)',
                      color: 'var(--accent-text)',
                      border: 'none',
                      fontSize: '12px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                    }}
                  >
                    <Zap size={14} /> {entitlement?.plan === 'business_scale' ? 'Switch to Starter' : 'Upgrade to Scale'}
                  </button>
                )}
              </div>

              {/* Quota Progress Indicators */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '24px' }}>
                {/* Team Seats */}
                <div
                  style={{
                    padding: '14px 16px',
                    borderRadius: '12px',
                    backgroundColor: 'var(--surface-sunken)',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Users size={16} color="var(--brand-primary)" />
                      <strong style={{ fontSize: '13px', color: 'var(--text-primary)' }}>Team Seats</strong>
                    </div>
                    <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                      {entitlement?.seatsUsed || 1} / {entitlement?.seatsAllocated || 1}
                    </span>
                  </div>
                  <div style={{ height: '6px', backgroundColor: 'var(--border-subtle)', borderRadius: '9999px', overflow: 'hidden' }}>
                    <div
                      style={{
                        height: '100%',
                        width: `${Math.min(100, (((entitlement?.seatsUsed || 1) / (entitlement?.seatsAllocated || 1)) * 100))}%`,
                        backgroundColor: 'var(--brand-primary)',
                        borderRadius: '9999px',
                      }}
                    />
                  </div>
                </div>

                {/* Storage Quota */}
                <div
                  style={{
                    padding: '14px 16px',
                    borderRadius: '12px',
                    backgroundColor: 'var(--surface-sunken)',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <HardDrive size={16} color="var(--positive)" />
                      <strong style={{ fontSize: '13px', color: 'var(--text-primary)' }}>Encrypted Storage</strong>
                    </div>
                    <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                      {entitlement?.maxFileSizeMB || 25} MB max / file
                    </span>
                  </div>
                  <div style={{ height: '6px', backgroundColor: 'var(--border-subtle)', borderRadius: '9999px', overflow: 'hidden' }}>
                    <div
                      style={{
                        height: '100%',
                        width: '24%',
                        backgroundColor: 'var(--positive)',
                        borderRadius: '9999px',
                      }}
                    />
                  </div>
                </div>
              </div>

              {/* Feature Checklist */}
              <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 12px' }}>
                Entitlement Capabilities
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--text-primary)' }}>
                  <Check size={16} color="var(--positive)" /> End-to-end encrypted messaging & zero contact book uploads (All Tiers)
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--text-primary)' }}>
                  <Check size={16} color="var(--positive)" /> Multi-device session revocation & biometric lock
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: entitlement?.customThemesAllowed ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>
                  <Check size={16} color={entitlement?.customThemesAllowed ? 'var(--positive)' : 'var(--text-tertiary)'} /> Custom "Aurora Paper" Themes & Density
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: entitlement?.workflowCardsAllowed ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>
                  <Check size={16} color={entitlement?.workflowCardsAllowed ? 'var(--positive)' : 'var(--text-tertiary)'} /> Interactive Team Workflow Cards & Escalation Bot
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: entitlement?.auditExportAllowed ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>
                  <Check size={16} color={entitlement?.auditExportAllowed ? 'var(--positive)' : 'var(--text-tertiary)'} /> Tamper-evident Compliance Audit Export (Scale Tier)
                </div>
              </div>
            </div>
          )}

          {activeTab === 'invoices' && (
            <div>
              {invoices.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-secondary)', fontSize: '13px' }}>
                  No billing invoices issued yet.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {invoices.map((inv) => (
                    <div
                      key={inv.id}
                      style={{
                        padding: '14px 16px',
                        borderRadius: '12px',
                        border: '1px solid var(--border-subtle)',
                        backgroundColor: 'var(--surface-muted)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <FileText size={20} color="var(--brand-primary)" />
                        <div>
                          <strong style={{ fontSize: '13px', color: 'var(--text-primary)' }}>
                            {inv.invoiceNumber}
                          </strong>
                          <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                            {inv.description} &bull; {new Date(inv.date).toLocaleDateString()}
                          </div>
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <span style={{ fontWeight: 700, fontSize: '14px', color: 'var(--text-primary)' }}>
                          ${(inv.amountCents / 100).toFixed(2)}
                        </span>
                        <button
                          onClick={() => alert(`Downloading PDF for invoice ${inv.invoiceNumber}`)}
                          style={{
                            padding: '6px 10px',
                            borderRadius: '8px',
                            background: 'var(--surface)',
                            border: '1px solid var(--border-subtle)',
                            color: 'var(--text-primary)',
                            fontSize: '12px',
                            fontWeight: 600,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                          }}
                        >
                          <Download size={12} /> PDF
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
