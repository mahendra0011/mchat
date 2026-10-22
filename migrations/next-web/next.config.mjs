/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The Vite client currently points at a same-origin API base; keep parity here
  // and proxy API + realtime traffic to the API service in production.
  async rewrites() {
    const apiBase = process.env.API_BASE_URL || 'http://localhost:8080';
    return [
      { source: '/v1/:path*', destination: `${apiBase}/v1/:path*` },
    ];
  },
  headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
