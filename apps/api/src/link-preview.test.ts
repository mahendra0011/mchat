import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchLinkPreview, isSuspiciousDomain, parseHtmlMetadata } from './link-preview.js';

function mockResponse(init: {
  status?: number;
  headers?: Record<string, string>;
  body?: string;
}): Response {
  const status = init.status ?? 200;
  const headers = new Headers(init.headers ?? {});
  const body = init.body ?? '';
  return {
    status,
    headers,
    ok: status >= 200 && status < 300,
    arrayBuffer: async () => new TextEncoder().encode(body).buffer as ArrayBuffer,
    text: async () => body,
  } as unknown as Response;
}

test('SSRF: private and metadata URLs are blocked before any fetch', async () => {
  let called = false;
  const fetchImpl = (async () => {
    called = true;
    return mockResponse({});
  }) as unknown as typeof fetch;

  const privatePreview = await fetchLinkPreview('http://192.168.1.10/admin', fetchImpl);
  assert.equal(privatePreview.blocked, true);
  assert.equal(privatePreview.ok, false);

  const metadataPreview = await fetchLinkPreview('https://169.254.169.254/latest/meta-data/', fetchImpl);
  assert.equal(metadataPreview.blocked, true);

  assert.equal(called, false, 'blocked URLs must never be fetched');
});

test('suspicious-domain heuristics flag punycode and risky TLDs', () => {
  assert.equal(isSuspiciousDomain('evil.example.xyz').suspicious, true);
  assert.equal(isSuspiciousDomain('xn--pple-43d.com').suspicious, true);
  assert.equal(isSuspiciousDomain('good.example.com').suspicious, false);
});

test('parses title, description, image, and site name from HTML', () => {
  const html = `
    <html><head>
      <title>Example &amp; Co</title>
      <meta property="og:description" content="A description" />
      <meta property="og:image" content="/img/preview.png" />
      <meta property="og:site_name" content="Example" />
    </head></html>`;
  const meta = parseHtmlMetadata(html, 'https://example.com/page');
  assert.equal(meta.title, 'Example & Co');
  assert.equal(meta.description, 'A description');
  assert.equal(meta.imageUrl, 'https://example.com/img/preview.png');
  assert.equal(meta.siteName, 'Example');
});

test('follows a bounded redirect chain and re-validates each hop', async () => {
  const calls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url === 'https://a.example/start') {
      return mockResponse({ status: 302, headers: { location: 'https://a.example/next' } });
    }
    return mockResponse({
      status: 200,
      headers: { 'content-type': 'text/html' },
      body: '<title>Reached</title>',
    });
  }) as unknown as typeof fetch;

  const preview = await fetchLinkPreview('https://a.example/start', fetchImpl);
  assert.equal(preview.ok, true);
  assert.equal(preview.title, 'Reached');
  assert.equal(preview.finalUrl, 'https://a.example/next');
  assert.equal(calls.length, 2);
});

test('does not follow a redirect into a private address', async () => {
  const fetchImpl = (async () =>
    mockResponse({ status: 302, headers: { location: 'http://10.0.0.5/secret' } })) as unknown as typeof fetch;
  const preview = await fetchLinkPreview('https://a.example/redirect', fetchImpl);
  assert.equal(preview.blocked, true);
  assert.equal(preview.ok, false);
});

test('non-HTML content types yield no preview without blocking', async () => {
  const fetchImpl = (async () =>
    mockResponse({ status: 200, headers: { 'content-type': 'application/pdf' }, body: '%PDF-1.4' })) as unknown as typeof fetch;
  const preview = await fetchLinkPreview('https://a.example/file.pdf', fetchImpl);
  assert.equal(preview.blocked, false);
  assert.equal(preview.ok, false);
});

test('oversized bodies are not parsed', async () => {
  const bigBody = 'x'.repeat(2 * 1024 * 1024); // 2 MiB > 1 MiB cap
  const fetchImpl = (async () =>
    mockResponse({ status: 200, headers: { 'content-type': 'text/html' }, body: bigBody })) as unknown as typeof fetch;
  const preview = await fetchLinkPreview('https://a.example/big', fetchImpl);
  assert.equal(preview.ok, false);
  assert.equal(preview.title, undefined);
});
