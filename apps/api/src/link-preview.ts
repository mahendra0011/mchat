import { validateSafeUrl } from '@orbit/domain';

/**
 * Hardened link-preview fetcher (Spec 14/34):
 * - SSRF-guarded (re-validated on every redirect hop, bounded hops).
 * - Timeouts, response-size cap, and content-type allow-list.
 * - Suspicious-domain heuristics (punycode / risky TLDs) surfaced as warnings.
 * The fetch implementation is injectable so tests never touch the network.
 */

export interface LinkPreview {
  url: string;
  finalUrl: string;
  title?: string;
  description?: string;
  imageUrl?: string;
  siteName?: string;
  suspicious: boolean;
  suspiciousReasons: string[];
  blocked: boolean;
  blockedReason?: string;
  /** True when the destination was reachable and returned parseable HTML. */
  ok: boolean;
}

const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 5000;
const MAX_BYTES = 1024 * 1024; // 1 MiB cap on preview body
const ALLOWED_CONTENT_TYPES = ['text/html', 'application/xhtml+xml'];

// Risky TLDs frequently abused for phishing / spam lures.
const SUSPICIOUS_TLDS = new Set([
  'zip', 'mov', 'tk', 'ml', 'ga', 'cf', 'gq', 'xyz', 'top', 'click',
  'country', 'stream', 'work', 'loan', 'racing', 'review',
]);

export function isSuspiciousDomain(hostname: string): { suspicious: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const host = hostname.toLowerCase();
  if (host.includes('xn--')) reasons.push('punycode_domain');
  const tld = host.split('.').pop() ?? '';
  if (SUSPICIOUS_TLDS.has(tld)) reasons.push('suspicious_tld');
  return { suspicious: reasons.length > 0, reasons };
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function metaContent(html: string, patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeEntities(match[1]);
  }
  return undefined;
}

export function parseHtmlMetadata(html: string, baseUrl: string): {
  title?: string;
  description?: string;
  imageUrl?: string;
  siteName?: string;
} {
  const title = metaContent(html, [/<title[^>]*>([\s\S]*?)<\/title>/i]);
  const description = metaContent(html, [
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i,
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i,
    /<meta[^>]+content=["']([^"']*)["'][^>]+property=["']og:description["']/i,
    /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i,
  ]);
  const imageRaw = metaContent(html, [/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']*)["']/i]);
  const siteName = metaContent(html, [/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']*)["']/i]);

  let imageUrl: string | undefined;
  if (imageRaw) {
    try {
      imageUrl = new URL(imageRaw, baseUrl).toString();
    } catch {
      imageUrl = undefined;
    }
  }

  return { title, description, imageUrl, siteName };
}

async function readCapped(response: Response, maxBytes: number): Promise<string | null> {
  // Read via arrayBuffer so we can enforce a size cap before parsing.
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > maxBytes) return null;
  return new TextDecoder('utf-8', { fatal: false }).decode(buffer);
}

export async function fetchLinkPreview(
  url: string,
  fetchImpl: typeof fetch = fetch
): Promise<LinkPreview> {
  const base: Pick<LinkPreview, 'url' | 'suspicious' | 'suspiciousReasons' | 'blocked' | 'ok'> = {
    url,
    suspicious: false,
    suspiciousReasons: [],
    blocked: false,
    ok: false,
  };

  // SSRF guard on the initial URL.
  const initial = validateSafeUrl(url);
  const host = safeHostname(url);
  const suspicious = host ? isSuspiciousDomain(host) : { suspicious: false, reasons: [] };
  base.suspicious = suspicious.suspicious;
  base.suspiciousReasons = suspicious.reasons;

  if (!initial.isAllowed) {
    return { ...base, finalUrl: url, blocked: true, blockedReason: initial.reason, ok: false };
  }

  let current = url;
  let response: Response | undefined;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const hopCheck = validateSafeUrl(current);
    if (!hopCheck.isAllowed) {
      return { ...base, finalUrl: current, blocked: true, blockedReason: hopCheck.reason, ok: false };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      response = await fetchImpl(current, {
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'user-agent': 'OrbitLinkPreview/1.0', accept: 'text/html,application/xhtml+xml' },
      });
    } catch {
      return { ...base, finalUrl: current, ok: false };
    } finally {
      clearTimeout(timer);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) break;
      try {
        current = new URL(location, current).toString();
      } catch {
        break;
      }
      continue;
    }
    break;
  }

  if (!response || response.status >= 400) {
    return { ...base, finalUrl: current, ok: false };
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (!ALLOWED_CONTENT_TYPES.some((ct) => contentType.includes(ct))) {
    // Non-HTML payload — no preview, but not blocked.
    return { ...base, finalUrl: current, ok: false };
  }

  const html = await readCapped(response, MAX_BYTES);
  if (html === null) {
    return { ...base, finalUrl: current, ok: false };
  }

  const meta = parseHtmlMetadata(html, current);
  return { ...base, finalUrl: current, ...meta, ok: true };
}

function safeHostname(url: string): string | undefined {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}
