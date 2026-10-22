# Open-Source & Low-Cost Deployment Options

Spec 44 implementation reference. The goal is a credible low-cost beta path
without locking the product into a single vendor or sacrificing the security
gates in `docs/security/release-gates.md`.

## 1. Deployment profiles

| Profile | Use | Shape | Relative monthly cost |
|---|---|---|---|
| Local | Development, CI | Docker Compose, local Postgres/Redis, no TLS | $0 |
| Low-cost beta | Early users, single region | 2 API containers, managed Postgres, managed Redis, object storage + CDN, hosted CI, free observability tier | Low |
| Growth | Paying customers | Autoscaled API/WebSocket, HA Postgres, multi-AZ, WAF, paid observability | Medium |
| Self-hosted | Data-residency/enterprise | Kubernetes or VMs, self-managed Postgres/Valkey/MinIO, operator on-call | Infrastructure + staff cost |

Start with the low-cost beta profile. Do not self-host stateful services until
there is an on-call rotation and tested restore drills.

## 2. Component options

| Capability | Low-cost / open-source | Managed alternative | Notes |
|---|---|---|---|
| API compute | Docker on a small VPS / Fly.io / Render | ECS/Cloud Run/App Service | Immutable images, health checks |
| Web/static | CDN + object storage | Vercel/Netlify/CloudFront | SPA only; API stays separate |
| PostgreSQL | Self-hosted 16 on a VPS | Neon/Supabase/RDS/Cloud SQL | Managed backups/PITR strongly preferred |
| Redis/Valkey | Self-hosted Valkey | Upstash/ElastiCache/Memorystore | Ephemeral only; TLS + auth |
| Object storage | MinIO | S3/R2/GCS | Private buckets, signed URLs |
| Realtime media | Self-hosted LiveKit | LiveKit Cloud | Deferred until calls ship |
| Email | SES | Resend/Postmark | Verify domain, bounce handling |
| Push | FCM/APNs direct | OneSignal | Generic previews by default |
| Observability | Grafana/Prometheus/Loki self-hosted | Grafana Cloud free/starter | Watch ingestion cost/cardinality |
| CI/CD | GitHub Actions | — | Self-hosted runners only if needed |
| Secrets | Cloud secret manager | Doppler/1Password | Never in images or repo |
| Malware scanning | ClamAV container | Cloud scanner | Quarantine before serving |

## 3. Recommended beta architecture

```
CDN/WAF ──> web (static)
   └──────> api (2 instances, private network)
                ├── managed PostgreSQL (HA optional, PITR on)
                ├── managed Redis/Valkey (ephemeral)
                └── private object storage (signed URLs)
```

- Single region, multi-AZ data services, automated backups, TLS everywhere.
- Deploy on merge to `main` after all gates pass; keep the previous image for
  rollback. Database migrations are backward-compatible for one release.
- Use environment-scoped secrets and separate staging/production accounts.
- Enable budget alerts and per-workspace quotas from day one.

## 4. Selection checklist

- [ ] Open protocol/API and export path; no proprietary data lock-in.
- [ ] Data residency and sub-processor list acceptable.
- [ ] Encryption in transit/at rest, private networking, audit logs.
- [ ] Backup/PITR, restore documentation and tested RTO/RPO.
- [ ] Pricing predictable at 10× current usage; egress and ingestion modelled.
- [ ] Security posture (SOC 2/ISO evidence where available) and incident terms.
- [ ] Exit plan: dump/export, DNS cutover, key rotation, parallel-run window.

## 5. Deferred decisions

- Managed Kubernetes vs VM/container platform: defer until traffic or compliance
  requires it. Owner: Platform Lead. Review: 2027-01-01.
- Self-hosted LiveKit and malware scanning: activate with the calls/files GA
  gates, not before. Owners: Media Lead / Security Lead.
- Multi-region active-active: excluded for beta; documented as a future option
  after DR drills and cost review.
