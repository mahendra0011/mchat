# Architecture Decisions

## Why Vite/React instead of Next.js App Router
We chose Vite + React for a lighter client build, faster dev feedback, and explicit control over routing and data fetching. Next.js App Router's server components and framework coupling added complexity we did not need for a real-time chat client.

## Why custom auth instead of Keycloak/OIDC
We implement session/device-based auth in-process to keep deployment simple and avoid operating a separate identity provider. OIDC/Keycloak remain an option for enterprise SSO later.

## Why custom DbClient instead of Prisma/Drizzle
A thin DbClient keeps SQL explicit and avoids ORM overhead/migrations lock-in. Schema is hand-managed for clarity and portability.

## Why in-memory queue instead of PostgreSQL/Redis-backed
The in-memory queue keeps the default deployment dependency-free. PostgreSQL/Redis-backed queues can be enabled when durability or scale requires it.

## Why no S3 object storage (use case-specific)
Media storage is filesystem/local by default; object storage is use-case specific and can be plugged in where needed.

## Why no OpenTelemetry (logging strategy instead)
We rely on structured application logging and privacy-safe telemetry rather than full distributed tracing to reduce overhead and complexity.

## Why no SAST/SCA/secrets scanning in CI (planned for Q3)
Security scanning in CI is planned for Q3; current focus is on manual review and targeted security tests.
