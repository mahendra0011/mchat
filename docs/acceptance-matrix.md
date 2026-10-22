# Acceptance Matrix

## Supported Browser/OS Combinations

| Browser | Minimum Version | Supported OS | Notes |
|---------|----------------|-------------|-------|
| Chrome | 108 | Windows 10+, macOS 10.15+, Linux (Ubuntu 20+) | Default supported browser |
| Firefox | 102 | Windows 10+, macOS 10.15+, Linux (Ubuntu 20+) | |
| Safari | 15 | macOS 10.15+, iOS 15+ | Mobile Safari via iOS |
| Edge | 108 | Windows 10+ | Chromium-based |

## Supported Mobile OS Versions

| Platform | Minimum Version | Notes |
|----------|----------------|-------|
| iOS | 15.0 | iPhone and iPad |
| Android | 12.0 | AOSP-based devices and Samsung One UI |

## Deprecated Clients

| Client | Deprecated Since | Grace Period | EOL Date |
|--------|-----------------|--------------|----------|
| Chrome 107 | Spec 27 release | 90 days | 2026-03-01 |
| Firefox 101 | Spec 27 release | 90 days | 2026-03-01 |
| Android < 10 | Spec 27 release | 180 days | 2026-09-01 |

## CDN Cache Policy Per Client Type

| Client Type | Cache TTL | Max Age | Notes |
|-------------|-----------|---------|-------|
| Web UI assets | 3600s | 24h | Cache-busting via version query |
| API responses (public) | 600s | 10m | No personal data |
| API responses (authenticated) | 0s | 0 | No caching |
| Mobile static assets | 86400s | 24h | Long cache TTL |
| Feature flag configs | 30s | 30s | Real-time refresh |