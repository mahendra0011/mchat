export function sanitizeHtml(html: string): string {
  let out = html;
  // Remove dangerous tags with their contents
  out = out.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  out = out.replace(/<object\b[^>]*>[\s\S]*?<\/object>/gi, '');
  out = out.replace(/<embed\b[^>]*>/gi, '');
  out = out.replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, '');
  // Remove on* attributes
  out = out.replace(/\s+on[a-z]+\s*=\s*(".*?"|'.*?'|[^\s>]+)/gi, '');
  return out;
}

export function sanitizeUserContent(content: string): string {
  return content.replace(/<[^>]*>/g, '');
}
