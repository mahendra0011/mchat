import { SafeUrlValidationResult } from '@orbit/schemas';

/**
 * SSRF and Malicious Destination Validator (Spec 34)
 * Blocks:
 * - Loopback (127.0.0.0/8, ::1, localhost)
 * - Private RFC1918 (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)
 * - Link-local (169.254.0.0/16, fe80::/10)
 * - Cloud metadata services (169.254.169.254, metadata.google.internal)
 * - Non-HTTP(S) protocols (file:, gopher:, ftp:, javascript:)
 */

export function validateSafeUrl(
  urlString: string,
  options: { allowHttpInDevelopment?: boolean } = {}
): SafeUrlValidationResult {
  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    return {
      isAllowed: false,
      normalizedUrl: urlString,
      destinationCategory: 'BLOCKED_MALFORMED',
      reason: 'Malformed URL could not be parsed',
    };
  }

  // 1. Protocol check
  if (parsed.protocol !== 'https:') {
    if (parsed.protocol === 'http:' && options.allowHttpInDevelopment) {
      // Allowed only for dev testing
    } else {
      return {
        isAllowed: false,
        normalizedUrl: parsed.toString(),
        destinationCategory: 'BLOCKED_NON_HTTPS',
        reason: `Insecure protocol ${parsed.protocol} is forbidden; HTTPS required`,
      };
    }
  }

  const hostname = parsed.hostname.toLowerCase().trim();

  // 2. Loopback checks
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '[::1]' ||
    hostname.startsWith('127.') ||
    hostname.endsWith('.localhost')
  ) {
    return {
      isAllowed: false,
      normalizedUrl: parsed.toString(),
      destinationCategory: 'BLOCKED_LOOPBACK',
      reason: 'Loopback address access is strictly denied',
    };
  }

  // 3. Cloud metadata checks (AWS, GCP, Azure, Alibaba)
  if (
    hostname === '169.254.169.254' ||
    hostname === 'metadata.google.internal' ||
    hostname === 'metadata' ||
    hostname === '100.100.100.200' ||
    hostname.endsWith('.metadata.google.internal')
  ) {
    return {
      isAllowed: false,
      normalizedUrl: parsed.toString(),
      destinationCategory: 'BLOCKED_CLOUD_METADATA',
      reason: 'Cloud infrastructure metadata service access is strictly forbidden',
    };
  }

  // 4. Link-local check
  if (hostname.startsWith('169.254.') || hostname.startsWith('fe80:')) {
    return {
      isAllowed: false,
      normalizedUrl: parsed.toString(),
      destinationCategory: 'BLOCKED_PRIVATE_RANGE',
      reason: 'Link-local IPv4/IPv6 range is prohibited',
    };
  }

  // 5. Private RFC1918 IPv4 checks
  // 10.0.0.0/8
  if (hostname.startsWith('10.')) {
    return {
      isAllowed: false,
      normalizedUrl: parsed.toString(),
      destinationCategory: 'BLOCKED_PRIVATE_RANGE',
      reason: 'Private RFC1918 range (10.0.0.0/8) is prohibited',
    };
  }

  // 192.168.0.0/16
  if (hostname.startsWith('192.168.')) {
    return {
      isAllowed: false,
      normalizedUrl: parsed.toString(),
      destinationCategory: 'BLOCKED_PRIVATE_RANGE',
      reason: 'Private RFC1918 range (192.168.0.0/16) is prohibited',
    };
  }

  // 172.16.0.0/12 (172.16 - 172.31)
  const match172 = hostname.match(/^172\.(\d+)\./);
  if (match172) {
    const secondOctet = parseInt(match172[1], 10);
    if (secondOctet >= 16 && secondOctet <= 31) {
      return {
        isAllowed: false,
        normalizedUrl: parsed.toString(),
        destinationCategory: 'BLOCKED_PRIVATE_RANGE',
        reason: 'Private RFC1918 range (172.16.0.0/12) is prohibited',
      };
    }
  }

  // Passed all anti-SSRF checks
  return {
    isAllowed: true,
    normalizedUrl: parsed.toString(),
    destinationCategory: 'PUBLIC_SAFE',
    reason: 'Target URL is safe for egress',
  };
}
