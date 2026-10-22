/**
 * Content sanitization and safe link/text processing.
 * Rule: Never render untrusted user content as raw HTML.
 */

export function sanitizePlainText(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

export function extractSafeLinks(text: string): { url: string; isSafe: boolean }[] {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const matches = text.match(urlRegex) || [];
  
  return matches.map((url) => {
    try {
      const parsed = new URL(url);
      const isHttp = parsed.protocol === 'http:' || parsed.protocol === 'https:';
      const isLocal = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
      return { url, isSafe: isHttp && !isLocal };
    } catch {
      return { url, isSafe: false };
    }
  });
}

export function createMessageSnippet(body: string, maxLength = 80): string {
  const cleaned = body.replace(/[\r\n]+/g, ' ').trim();
  if (cleaned.length <= maxLength) return cleaned;
  return cleaned.slice(0, maxLength - 1) + '…';
}
