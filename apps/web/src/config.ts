/**
 * Central web client configuration.
 * Client-side variables are assumed public (Spec 00_START_HERE.md).
 * Configure via VITE_API_BASE_URL / VITE_WS_BASE_URL (see .env.example).
 */

export const API_BASE_URL: string =
  import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000';

export const WS_BASE_URL: string =
  import.meta.env.VITE_WS_BASE_URL ?? 'ws://localhost:4000/v1/realtime';

export function apiUrl(path: string): string {
  return `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}
