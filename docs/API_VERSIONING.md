# API Versioning & Deprecation Policy

## Versioning Strategy

The Orbit Chat API uses **URL-based versioning** with the version prefix in the path:

- Current version: `/v1/`
- All endpoints are prefixed with `/v1/` (e.g., `/v1/integrations`, `/v1/conversations`)

## Version Headers

Every API response includes the following headers:

| Header | Value | Description |
|--------|-------|-------------|
| `API-Version` | `1` | Current API version |
| `API-Deprecated` | `false` | Whether this version is deprecated |
| `Sunset` | `2027-10-21` | Date when this version will be sunset (RFC 8594) |

Example response headers:
```
API-Version: 1
API-Deprecated: false
Sunset: 2027-10-21
```

## Deprecation Policy

### 12-Month Notice Period

When a new API version is released:
1. The previous version enters **deprecation** status
2. A **12-month notice period** begins from the deprecation announcement
3. During this period:
   - Both versions remain fully functional
   - Deprecated version responses include `API-Deprecated: true`
   - `Sunset` header indicates the exact shutdown date
   - Migration guide is published and linked in developer communications

### Deprecation Headers

When a version is deprecated:
```
API-Version: 1
API-Deprecated: true
Sunset: 2027-10-21
Link: <https://docs.orbit.local/migration/v1-to-v2>; rel="migration-guide"
```

### End of Life

After the `Sunset` date:
- The deprecated version returns `410 Gone` for all endpoints
- Response body includes migration guidance:
```json
{
  "error": {
    "code": "VERSION_SUNSET",
    "message": "API v1 has been sunset. Please migrate to v2.",
    "migrationGuide": "https://docs.orbit.local/migration/v1-to-v2"
  }
}
```

## Migration Guide

Each deprecation includes a comprehensive migration guide at:
`https://docs.orbit.local/migration/v{old}-to-v{new}`

The guide covers:
- Breaking changes summary
- Endpoint mapping (old → new)
- Request/response schema changes
- Authentication changes (if any)
- Code examples for common migration patterns
- Timeline and support contacts

## Client Requirements

### Version Detection

Clients SHOULD:
1. Read `API-Version` header on first response
2. Log warning if `API-Deprecated: true`
3. Plan migration before `Sunset` date
4. Use `Link` header with `rel="migration-guide"` for automated detection

### Backward Compatibility

Within a major version (`v1.x`):
- New optional fields may be added to responses
- New optional parameters may be added to requests
- New endpoints may be added
- Existing fields/parameters will never be removed or changed

### Breaking Changes

Breaking changes ONLY occur in new major versions (`v2`, `v3`, etc.):
- Field removals or type changes
- Required parameter additions
- Endpoint removals
- Authentication scheme changes

## Current Version Status

| Version | Status | Released | Deprecated | Sunset |
|---------|--------|----------|------------|--------|
| v1 | Active | 2026-10-21 | No | 2027-10-21 |

## Support

For migration assistance:
- Email: api-support@orbit.local
- Discord: #api-developers
- Documentation: https://docs.orbit.local/api