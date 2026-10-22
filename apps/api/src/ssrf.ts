import dns from 'node:dns/promises';
import { validateSafeUrl as domainValidateSafeUrl } from '@orbit/domain';

export interface SafeUrlResult {
  safe: boolean;
  reason?: string;
}

export function validateSafeUrl(url: string): SafeUrlResult {
  const result = domainValidateSafeUrl(url);
  return {
    safe: result.isAllowed,
    reason: result.isAllowed ? undefined : result.reason,
  };
}

function isPrivateIp(ip: string): boolean {
  const trimmed = ip.trim().toLowerCase();
  if (trimmed === '::1' || trimmed === '::') return true;

  // IPv4-mapped IPv6
  const v4Mapped = trimmed.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (v4Mapped) return isPrivateIp(v4Mapped[1]);

  if (/^\d+\.\d+\.\d+\.\d+$/.test(trimmed)) {
    const parts = trimmed.split('.').map((p) => Number.parseInt(p, 10));
    if (parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return true;
    const [a, b] = parts;
    if (a === 0) return true;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // multicast/reserved
    if (a === 192 && parts[1] === 0 && parts[2] === 0) return true; // 192.0.0.0/24
    return false;
  }

  // IPv6
  if (trimmed.includes(':')) {
    if (trimmed.startsWith('fe80')) return true; // link-local
    if (trimmed.startsWith('fc') || trimmed.startsWith('fd')) return true; // ULA
    if (trimmed.startsWith('ff')) return true; // multicast
    return false;
  }

  return false;
}

const dnsCache = new Map<string, { ip: string; at: number }>();

export async function detectDnsRebinding(url: string): Promise<boolean> {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return true;
  }

  // IP literal
  if (isPrivateIp(hostname)) return true;

  try {
    const lookup = await dns.lookup(hostname);
    const ip = lookup.address;
    if (isPrivateIp(ip)) return true;

    const now = Date.now();
    const cached = dnsCache.get(hostname);
    if (cached && now - cached.at < 5000 && cached.ip !== ip) {
      return true;
    }
    dnsCache.set(hostname, { ip, at: now });
    return false;
  } catch {
    // Fail closed for suspicious; but allow known safe hostnames? Use fail-closed.
    return true;
  }
}

export function egressProxy(url: string): string {
  const proxy = process.env.EGRESS_PROXY_IP;
  if (!proxy || proxy.trim() === '') return url;
  return `http://${proxy.trim()}/proxy?url=${encodeURIComponent(url)}`;
}

export function isAllowedUrl(url: string): boolean {
  const patternsRaw = process.env.ALLOWED_URL_PATTERNS;
  if (!patternsRaw || patternsRaw.trim() === '') return true;
  const patterns = patternsRaw.split(',').map((p) => p.trim()).filter(Boolean);
  if (patterns.length === 0) return true;
  return patterns.some((pattern) => {
    const regex = new RegExp(
      '^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$'
    );
    return regex.test(url);
  });
}
