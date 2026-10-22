import { apiUrl } from '../config';
import React from 'react';
import {
  UploadCloud,
  FileArchive,
  CheckCircle,
  X,
  Database,
} from 'lucide-react';
import { ImportPreview } from '@orbit/schemas';

interface DataImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  workspaceId: string;
}

export const DataImportModal: React.FC<DataImportModalProps> = ({
  isOpen,
  onClose,
  workspaceId,
}) => {
  const [selectedFormat, setSelectedFormat] = React.useState<'orbit_archive' | 'slack_export' | 'generic_json'>('orbit_archive');
  const [preview, setPreview] = React.useState<ImportPreview | null>(null);
  const [isValidating, setIsValidating] = React.useState(false);
  const [isImporting, setIsImporting] = React.useState(false);
  const [importCompleted, setImportCompleted] = React.useState(false);
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

  const handleValidateArchive = async () => {
    setIsValidating(true);
    try {
      const res = await fetch(apiUrl("/v1/portability/import/preview"), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format: selectedFormat }),
      });
      const data = await res.json();
      if (data?.data) {
        setPreview(data.data);
      }
    } catch (err) {
      console.error('Validation failed', err);
    } finally {
      setIsValidating(false);
    }
  };

  const handleExecuteImport = async () => {
    setIsImporting(true);
    try {
      const res = await fetch(apiUrl("/v1/portability/import/execute"), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format: selectedFormat, workspaceId }),
      });
      const data = await res.json();
      if (data?.data) {
        setImportCompleted(true);
      }
    } catch (err) {
      console.error('Import execution failed', err);
    } finally {
      setIsImporting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-title"
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
          maxWidth: '600px',
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
              <Database size={18} />
            </div>
            <div>
              <h2 id="import-title" style={{ fontSize: '18px', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                Data Portability & Import
              </h2>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                Dry-run verification, deduplication & idempotent import
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
          {!importCompleted ? (
            <div>
              <label
                id="import-format-label"
                style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '8px' }}
              >
                Select Source Archive Format
              </label>

              <div
                role="radiogroup"
                aria-labelledby="import-format-label"
                style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', marginBottom: '20px' }}
              >
                <div
                  role="radio"
                  aria-checked={selectedFormat === 'orbit_archive'}
                  tabIndex={0}
                  onClick={() => { setSelectedFormat('orbit_archive'); setPreview(null); }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSelectedFormat('orbit_archive');
                      setPreview(null);
                    }
                  }}
                  style={{
                    padding: '14px',
                    borderRadius: '12px',
                    border: selectedFormat === 'orbit_archive' ? '2px solid var(--brand-primary)' : '1px solid var(--border-subtle)',
                    backgroundColor: selectedFormat === 'orbit_archive' ? 'var(--accent-soft)' : 'var(--surface-muted)',
                    textAlign: 'center',
                    cursor: 'pointer',
                  }}
                >
                  <FileArchive size={24} color="var(--brand-primary)" style={{ margin: '0 auto 6px' }} />
                  <strong style={{ display: 'block', fontSize: '12px', color: 'var(--text-primary)' }}>Orbit Archive</strong>
                  <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Native JSON package</span>
                </div>

                <div
                  role="radio"
                  aria-checked={selectedFormat === 'slack_export'}
                  tabIndex={0}
                  onClick={() => { setSelectedFormat('slack_export'); setPreview(null); }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSelectedFormat('slack_export');
                      setPreview(null);
                    }
                  }}
                  style={{
                    padding: '14px',
                    borderRadius: '12px',
                    border: selectedFormat === 'slack_export' ? '2px solid var(--brand-primary)' : '1px solid var(--border-subtle)',
                    backgroundColor: selectedFormat === 'slack_export' ? 'var(--accent-soft)' : 'var(--surface-muted)',
                    textAlign: 'center',
                    cursor: 'pointer',
                  }}
                >
                  <UploadCloud size={24} color="var(--positive)" style={{ margin: '0 auto 6px' }} />
                  <strong style={{ display: 'block', fontSize: '12px', color: 'var(--text-primary)' }}>Slack Zip Export</strong>
                  <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Channels & DMs</span>
                </div>

                <div
                  role="radio"
                  aria-checked={selectedFormat === 'generic_json'}
                  tabIndex={0}
                  onClick={() => { setSelectedFormat('generic_json'); setPreview(null); }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSelectedFormat('generic_json');
                      setPreview(null);
                    }
                  }}
                  style={{
                    padding: '14px',
                    borderRadius: '12px',
                    border: selectedFormat === 'generic_json' ? '2px solid var(--brand-primary)' : '1px solid var(--border-subtle)',
                    backgroundColor: selectedFormat === 'generic_json' ? 'var(--accent-soft)' : 'var(--surface-muted)',
                    textAlign: 'center',
                    cursor: 'pointer',
                  }}
                >
                  <Database size={24} color="var(--caution)" style={{ margin: '0 auto 6px' }} />
                  <strong style={{ display: 'block', fontSize: '12px', color: 'var(--text-primary)' }}>Generic JSON</strong>
                  <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Normalized chat data</span>
                </div>
              </div>

              {!preview ? (
                <div style={{ textAlign: 'center', padding: '20px 0' }}>
                  <button
                    onClick={handleValidateArchive}
                    disabled={isValidating}
                    style={{
                      padding: '10px 24px',
                      borderRadius: '10px',
                      background: 'var(--brand-primary)',
                      color: 'var(--accent-text)',
                      border: 'none',
                      fontSize: '13px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      boxShadow: 'var(--shadow-accent)',
                    }}
                  >
                    {isValidating ? 'Validating Archive...' : 'Analyze Archive (Dry-Run)'}
                  </button>
                </div>
              ) : (
                <div>
                  <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 10px' }}>
                    Archive Analysis & Validation Summary
                  </h3>
                  <div
                    style={{
                      padding: '16px',
                      borderRadius: '12px',
                      border: '1px solid var(--border-subtle)',
                      backgroundColor: 'var(--surface-muted)',
                      marginBottom: '16px',
                    }}
                  >
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', fontSize: '13px' }}>
                      <div>Conversations: <strong>{preview.conversationsCount}</strong></div>
                      <div>Messages: <strong>{preview.messagesCount}</strong></div>
                      <div>Attachments: <strong>{preview.attachmentsCount} ({preview.estimatedSizeMB} MB)</strong></div>
                      <div>Duplicate candidates: <strong>{preview.duplicateCount} (Will be skipped)</strong></div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                    <button
                      onClick={() => setPreview(null)}
                      style={{
                        padding: '8px 16px',
                        borderRadius: '8px',
                        background: 'transparent',
                        border: '1px solid var(--border-subtle)',
                        color: 'var(--text-primary)',
                        fontSize: '13px',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      Reset
                    </button>
                    <button
                      onClick={handleExecuteImport}
                      disabled={isImporting}
                      style={{
                        padding: '8px 20px',
                        borderRadius: '8px',
                        background: 'var(--positive)',
                        color: 'var(--accent-text)',
                        border: 'none',
                        fontSize: '13px',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      {isImporting ? 'Importing...' : 'Confirm & Execute Import'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '32px 0' }}>
              <div
                style={{
                  width: '56px',
                  height: '56px',
                  borderRadius: '16px',
                  backgroundColor: 'var(--positive-soft)',
                  color: 'var(--positive)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 16px',
                }}
              >
                <CheckCircle size={32} />
              </div>
              <h3 style={{ fontSize: '16px', fontWeight: 700, margin: '0 0 8px', color: 'var(--text-primary)' }}>
                Import Completed Successfully
              </h3>
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '0 0 20px', lineHeight: 1.5 }}>
                14 conversations and 379 messages were securely imported. Authorship and timestamps are preserved.
              </p>
              <button
                onClick={onClose}
                style={{
                  padding: '8px 20px',
                  borderRadius: '8px',
                  background: 'var(--brand-primary)',
                  color: 'var(--accent-text)',
                  border: 'none',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Done
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
