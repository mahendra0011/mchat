import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

export function generateCsrfToken(): string {
  return randomBytes(32).toString('hex');
}

function parseCookie(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  if (!match) return undefined;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

function isExempt(request: any): boolean {
  const method = String(request.method || 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return true;
  const url = String(request.url || '').split('?')[0];
  if (url.startsWith('/v1/webhooks/') || url.startsWith('/v1/integrations/')) return true;
  return false;
}

export async function csrfPreHandler(request: any, reply: any): Promise<any> {
  if (isExempt(request)) return;
  const cookieToken = parseCookie(request.headers?.cookie, 'X-CSRF-Token');
  if (!cookieToken) return;
  const headerToken = request.headers?.['x-csrf-token'];
  if (!headerToken || String(headerToken) !== cookieToken) {
    reply.status(403).send({
      error: { code: 'CSRF_TOKEN_INVALID', message: 'Invalid or missing CSRF token', requestId: request.id },
    });
    return reply;
  }
}

export function csrfMiddleware(...args: any[]): any {
  // Factory mode: csrfMiddleware() -> Fastify plugin
  const plugin = async (fastify: FastifyInstance) => {
    fastify.get('/v1/session', async (_request: any, reply: any) => {
      const token = generateCsrfToken();
      reply.header('Set-Cookie', `X-CSRF-Token=${token}; HttpOnly; SameSite=Strict; Path=/`);
      return { csrfToken: token };
    });

    fastify.addHook('preHandler', csrfPreHandler);
  };

  // Fastify plugin invocation mode: csrfMiddleware(fastify, opts, done)
  if (args.length > 0 && args[0] && typeof args[0].addHook === 'function') {
    const fastify = args[0] as FastifyInstance;
    const done = args[args.length - 1];
    plugin(fastify).then(() => {
      if (typeof done === 'function') done();
    }).catch((err) => {
      if (typeof done === 'function') done(err);
    });
    return;
  }

  return plugin;
}
