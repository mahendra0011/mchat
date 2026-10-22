const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'";

function setHeaders(reply: any): void {
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('X-Frame-Options', 'DENY');
  reply.header('X-XSS-Protection', '1; mode=block');
  reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  reply.header('Content-Security-Policy', CSP);
}

export function securityHeadersMiddleware(...args: any[]): any {
  // Factory mode: securityHeadersMiddleware() -> hook
  if (args.length === 0) {
    return async (_req: any, reply: any, payload: any) => {
      setHeaders(reply);
      return payload;
    };
  }

  const [a, b, c, d] = args;

  // Fastify plugin mode: securityHeadersMiddleware(fastify, opts, done)
  if (a && typeof a.addHook === 'function') {
    a.addHook('onSend', (_req: any, reply: any, payload: any, done: any) => {
      setHeaders(reply);
      done(null, payload);
    });
    if (typeof c === 'function') c();
    return;
  }

  // Hook mode: securityHeadersMiddleware(req, reply, payload, done)
  if (b && typeof b.header === 'function') {
    setHeaders(b);
    if (typeof d === 'function') {
      d(null, c);
      return;
    }
    return c;
  }

  return async (_req: any, reply: any, payload: any) => {
    setHeaders(reply);
    return payload;
  };
}
