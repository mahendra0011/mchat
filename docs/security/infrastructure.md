# Infrastructure, Network & Secrets Security

Spec 38 implementation reference. Maps security requirements to the reference
artifacts in `infra/` and to the operational controls they depend on.

## 1. Environment isolation

- Separate accounts/projects (or at minimum separate VPCs, databases, buckets,
  keys and credentials) for development, staging and production.
- Production credentials are never available to development or preview
  environments. Pull requests do not receive production secrets.
- Development fixtures are clearly labelled, use dummy keys and are never
  imported into production storage.
- Staging receives production-like configuration with synthetic data; it is not
  a trust boundary and must not receive real customer content without approval.

## 2. Network zones

Reference topology (`infra/docker/docker-compose.yml`):

```
internet ──TLS──> edge/proxy (web, :8080 container) ──> api (:8080) ──> postgres / redis
```

- `frontend` network: `web` + `api` only. `backend` network: `api`, `postgres`,
  `redis`. The web tier cannot reach databases directly.
- Postgres and Redis publish on **loopback only** (`127.0.0.1:<port>`) for local
  debugging; production deployments must not publish them at all.
- Production: private subnets for app/data, egress restricted to required
  vendors, no database ingress from the internet, WAF/rate limiting at the edge.
- Kubernetes manifests (`infra/kubernetes/`) are the workload reference; add
  NetworkPolicy default-deny + explicit api→DB egress when moving to a cluster.
- Forwarded headers are trusted only from the edge proxy; configure the proxy
  trust list explicitly. Do not trust arbitrary `X-Forwarded-For` input.

## 3. Secrets

- Secrets come from a secret manager (or CI environment secrets for staging),
  injected at runtime. Never bake secrets into images, source, SBOMs or logs.
- `.env.example` contains placeholders only. `.env` is gitignored.
- Startup validation rejects unsafe production configuration (see
  `apps/api/src/env.ts`, `config.ts`). Missing/weak auth secrets must fail closed.
- Rotate credentials and signing keys on a schedule and immediately after
  exposure, staff departure or provider compromise. Rotation must not require a
  rebuild; support overlapping key windows where signatures are verified.
- Use distinct credentials per service and environment, with least privilege.
  Database app user must not own the cluster or bypass row-level controls.
- Dev credentials in compose are explicitly non-production (`local-dev-*`) and
  overridable via environment variables.

## 4. Database and object storage

- PostgreSQL: private network only, TLS in transit, encryption at rest, automated
  backups with restore drills (`docs/operations/disaster-recovery.md`), least
  privileged roles, audited admin access.
- Migrations run as a controlled step with backups; destructive changes are
  reversible or staged (see `apps/api/src/db/migrations.ts`).
- Object storage: private buckets, no public ACLs, server-side encryption,
  signed URLs with clamped TTL (1s–1h), malware/type validation and a quarantine
  state before serving attachments.
- Media signing secret is separate from session/auth secrets and rotated
  independently.

## 5. Container hardening

`infra/docker/Dockerfile.api`: multi-stage build, production-only runtime,
dedicated non-root `orbit` user, healthcheck.

`infra/docker/Dockerfile.web`: multi-stage build on
`nginxinc/nginx-unprivileged` (uid 101, listens on 8080, no root master process),
healthcheck.

Compose runtime controls applied to `api` and `web`:

- `read_only: true` with writable `tmpfs: /tmp` (API uploads use a dedicated
  volume).
- `cap_drop: [ALL]` and `security_opt: no-new-privileges:true`.
- Immutable/pinned base-image digests in production; images scanned by Trivy
  before deploy (`.github/workflows/security.yml`).
- Liveness/readiness probes and graceful shutdown; HPA in
  `infra/kubernetes/api-hpa.yaml`.

## 6. Cloud and IaC

- Terraform (`infra/terraform/`) is the source of truth for managed resources.
  State is remote, encrypted and locked; never committed.
- `terraform plan` is reviewed before apply. No wildcard IAM policies, public
  buckets, open security groups or unencrypted volumes.
- Tag resources with environment/owner/cost centre for incident response and
  cost control.
- CI scans Dockerfiles and IaC with Trivy config scanning; findings block
  HIGH/CRITICAL issues unless a documented exception exists.
- **Deferred:** Kubernetes NetworkPolicy manifests and managed secret-manager
  integration. Owner: Platform Lead. Review date: 2027-01-01.

## 7. Verification checklist

- [ ] Data stores have no public ingress; ports are loopback/private.
- [ ] Runtime containers are non-root, read-only, capability-dropped.
- [ ] No secret literals outside `.env.example` placeholders; gitleaks green.
- [ ] TLS enforced at the edge; HSTS at the public proxy.
- [ ] Backups encrypted and restore-tested.
- [ ] Signed URL TTLs and storage ACLs verified by tests.
- [ ] Rotations and incident credential revocation documented.
