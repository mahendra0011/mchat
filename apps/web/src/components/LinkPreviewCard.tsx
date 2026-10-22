import React from 'react';
import { AlertTriangle, Link2 } from 'lucide-react';
import { API_BASE_URL } from '../config';
import { getAccessToken } from '../lib/secure-storage.js';

/**
 * Link preview card (Spec 04/14).
 *
 * Renders below a message bubble when its body contains a URL. The card is
 * purely presentational: a favicon from the domain's icon service plus the
 * hostname, optionally enriched by the hardened unfurl endpoint
 * (POST /v1/link-previews) which also reports server-side suspicion.
 */
export interface LinkPreviewCardProps {
  url: string;
  enabled?: boolean;
}

interface UnfurledPreview {
  title?: string;
  description?: string;
  siteName?: string;
  suspicious?: boolean;
}

const SHORTENER_HOSTS = new Set([
  'bit.ly',
  'tinyurl.com',
  't.co',
  'goo.gl',
  'is.gd',
  'ow.ly',
  'buff.ly',
  'rebrand.ly',
  'cutt.ly',
  'tiny.cc',
  'bl.ink',
]);

/** Bound unfurl traffic — the endpoint is rate limited (30/min per workspace). */
const MAX_SESSION_FETCHES = 6;
let sessionFetchCount = 0;

const previewCache = new Map<string, UnfurledPreview | null>();

export const extractFirstUrl = (text: string): string | null => {
  const match = /https?:\/\/[^\s<>"')\]]+/i.exec(text);
  return match ? match[0] : null;
};

export const getHostname = (url: string): string | null => {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
};

/** Client-side suspicion heuristic (IP host, shortener, over-labelled domain). */
export const isSuspiciousUrl = (url: string): boolean => {
  const hostname = getHostname(url);
  if (!hostname) return true;
  const normalized = hostname.toLowerCase().replace(/^www\./, '');
  if (SHORTENER_HOSTS.has(normalized)) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(normalized)) return true;
  if (normalized.includes(':')) return true;
  const labels = normalized.split('.');
  if (labels.length >= 4) return true;
  if (labels.some((label) => label.length > 30)) return true;
  const hyphens = (normalized.match(/-/g) ?? []).length;
  if (hyphens >= 4) return true;
  return false;
};

const authHeaders = async (): Promise<Record<string, string>> => {
  const token = await getAccessToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
};

const WARNING_TEXT = '\u26A0 This link may be unsafe';

export const LinkPreviewCard: React.FC<LinkPreviewCardProps> = ({ url, enabled = true }) => {
  const hostname = getHostname(url);
  const [preview, setPreview] = React.useState<UnfurledPreview | null>(() => previewCache.get(url) ?? null);
  const [faviconFailed, setFaviconFailed] = React.useState(false);

  React.useEffect(() => {
    if (!enabled || !hostname) return;
    if (previewCache.has(url)) {
      setPreview(previewCache.get(url) ?? null);
      return;
    }
    if (sessionFetchCount >= MAX_SESSION_FETCHES) return;
    sessionFetchCount += 1;
    let cancelled = false;
    const loadPreview = async () => {
      try {
        const headers = await authHeaders();
        const res = await fetch(`${API_BASE_URL}/v1/link-previews`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ url }),
        });
        if (!res.ok) throw new Error('unfurl failed');
        const body = (await res.json()) as { data?: UnfurledPreview };
        const data = body.data ?? null;
        previewCache.set(url, data);
        if (!cancelled) setPreview(data);
      } catch {
        previewCache.set(url, null);
        if (!cancelled) setPreview(null);
      }
    };
    void loadPreview();
    return () => {
      cancelled = true;
    };
  }, [url, enabled, hostname, preview]);

  if (!hostname) return null;

  const suspicious = preview?.suspicious ?? isSuspiciousUrl(url);
  const title = preview?.title;
  const description = preview?.description;
  const iconSrc = faviconFailed
    ? null
    : `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=32`;

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer nofollow"
      aria-label={`Open link ${hostname}`}
      className="animate-fade-in"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        maxWidth: '340px',
        marginTop: '6px',
        padding: '8px 10px',
        borderRadius: '10px',
        border: '1px solid var(--border-subtle)',
        backgroundColor: 'var(--surface-muted)',
        textDecoration: 'none',
        color: 'inherit',
        cursor: 'pointer',
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
        {iconSrc ? (
          <img
            src={iconSrc}
            alt=""
            width={16}
            height={16}
            loading="lazy"
            onError={() => setFaviconFailed(true)}
            style={{ width: '16px', height: '16px', flexShrink: 0, borderRadius: '3px' }}
          />
        ) : (
          <Link2 size={14} style={{ flexShrink: 0, color: 'var(--text-muted)' }} aria-hidden="true" />
        )}
        <span
          style={{
            fontSize: '12px',
            fontWeight: 600,
            color: 'var(--text-secondary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {preview?.siteName ?? hostname}
        </span>
      </span>
      {title && (
        <span
          style={{
            fontSize: '12px',
            fontWeight: 600,
            color: 'var(--text-primary)',
            overflow: 'hidden',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
          }}
        >
          {title}
        </span>
      )}
      {description && (
        <span
          style={{
            fontSize: '11px',
            color: 'var(--text-muted)',
            overflow: 'hidden',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
          }}
        >
          {description}
        </span>
      )}
      {suspicious && (
        <span
          role="note"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '11px',
            fontWeight: 700,
            color: 'var(--caution)',
          }}
        >
          <AlertTriangle size={12} aria-hidden="true" />
          {WARNING_TEXT}
        </span>
      )}
    </a>
  );
};
