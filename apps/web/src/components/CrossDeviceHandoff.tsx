import React from 'react';
import { Smartphone, Copy, Check } from 'lucide-react';
import { useI18n } from '../i18n-context.js';

interface CrossDeviceHandoffProps {
  conversationId: string;
}

function randomToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function toBase64Url(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = '';
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export const CrossDeviceHandoff: React.FC<CrossDeviceHandoffProps> = ({ conversationId }) => {
  const { t } = useI18n();
  const [code, setCode] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  const generate = () => {
    const payload = {
      conversationId,
      ts: new Date().toISOString(),
      token: randomToken(),
    };
    setCode(toBase64Url(JSON.stringify(payload)));
    setCopied(false);
  };

  const copy = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      // Clipboard may be unavailable (permissions) — the code is still selectable.
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={{ marginBottom: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
        <Smartphone size={15} style={{ color: 'var(--accent-primary)' }} />
        <h4
          style={{
            fontSize: '12px',
            fontWeight: 600,
            color: 'var(--text-muted)',
            textTransform: 'uppercase',
            margin: 0,
          }}
        >
          {t('handoff.title')}
        </h4>
      </div>

      <button
        type="button"
        onClick={generate}
        style={{
          width: '100%',
          padding: '8px',
          borderRadius: '8px',
          border: 'none',
          backgroundColor: 'var(--accent-primary)',
          color: 'var(--accent-text)',
          fontSize: '12px',
          fontWeight: 600,
          cursor: 'pointer',
          marginBottom: '8px',
        }}
      >
        {t('handoff.generate')}
      </button>

      {code && (
        <div
          style={{
            padding: '10px',
            borderRadius: '8px',
            border: '1px solid var(--border-subtle)',
            backgroundColor: 'var(--surface-muted)',
          }}
        >
          <code
            style={{
              display: 'block',
              fontSize: '10px',
              color: 'var(--text-primary)',
              wordBreak: 'break-all',
              lineHeight: 1.5,
              maxHeight: '90px',
              overflowY: 'auto',
            }}
          >
            {code}
          </code>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '8px' }}>
            <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{t('handoff.note')}</span>
            <button
              type="button"
              onClick={() => void copy()}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                padding: '4px 8px',
                borderRadius: '6px',
                border: '1px solid var(--border-subtle)',
                background: 'transparent',
                color: copied ? 'var(--positive)' : 'var(--accent-primary)',
                fontSize: '11px',
                fontWeight: 600,
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
              {copied ? t('handoff.copied') : t('handoff.copy')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
