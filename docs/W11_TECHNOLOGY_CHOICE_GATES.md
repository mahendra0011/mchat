# W11 — Technology-Choice Gates

Decision gates for adopting or replacing technology in the Orbit chat platform.
Every gate names the current default, the measurable condition that unlocks a
change, and the anti-pattern to avoid. Specs 10 (Technical Architecture) and
14 (Trust & Safety) informed these gates; this doc is the living replacement
for one-off architecture prose.

## Ground rules

1. **Default to what the repo already ships.** New tech requires passing a gate
   below, not just novelty.
2. **Gates are measurable.** "Feels slow" is not a gate; "p95 render > 16 ms
   with 50k rows" is.
3. **Security defaults are not gates.** WebCrypto primitives, envelope
   encryption, snippet redaction, and workspace-header scoping are fixed
   requirements — never traded for convenience.
4. **Every replacement keeps the existing interface.** Swapping an engine is
   allowed only behind the current package boundary (`@orbit/domain`,
   `@orbit/crypto-adapter`, `@orbit/local-cache`, ...).

## 1. Encryption primitives — `packages/crypto-adapter`

| | |
|---|---|
| **Default** | WebCrypto P-256 ECDH → HKDF-SHA-256 conversation keys; AES-256-GCM message envelopes (`orbit.e2ee.v1.`) |
| **Change gate** | A platform target lacks WebCrypto ECDH/AES-GCM, **or** a reviewed cross-compatible protocol (e.g., real Double Ratchet) is scheduled with interop tests |
| **Anti-patterns** | Rolling own crypto; non-authenticated modes (CBC/CTR); server-side key escrow; logging key material; inventing a second envelope format |

Identity keys are per-device, non-exportable where the platform allows
(`extractable: false`), and stored only in local cache
(`e2ee:identity:<workspaceId>`). Server sees public SPKI only.

## 2. Key distribution — `apps/api/src/routes/crypto.ts`

| | |
|---|---|
| **Default** | `GET /v1/crypto/keys/workspace/:workspaceId` resolves the workspace owner's published bundle (best-effort, no liveness claims) |
| **Change gate** | Multi-device identities ship (then: per-device bundles + device lists + safety-number expansion) |
| **Anti-patterns** | Blocking message send on bundle fetch; treating bundle presence as identity verification (UI must keep safety numbers as the trust signal) |

## 3. Client message search — `packages/domain/src/e2ee-search.ts`

| | |
|---|---|
| **Default** | In-memory encrypted index (`createE2eeIndex`) fed with decrypted plaintext; ciphertext is never indexed |
| **Change gate** | Measured client index > ~100k messages or cross-conversation search latency > ~50 ms, **or** server-side search is approved with an explicit metadata threat model |
| **Anti-patterns** | Indexing envelopes; persisting plaintext queries; shipping search content to the server by default |

## 4. List virtualization — `packages/domain/src/virtualization.ts` + canvas

| | |
|---|---|
| **Default** | Flow-layout windowing via `computeVirtualWindow` (uniform estimated row height 84 px, overscan 10); lists ≤ **150** messages render fully |
| **Change gate** | Measured jank with > 150 rendered rows on target hardware, or scroll-position errors > 1 row on variable-height content (audio, cards) — then: measured row heights or a maintained virtualization library behind the same helper |
| **Anti-patterns** | Absolute-positioned rows (overlap bugs); windowing below the threshold (demo fidelity loss); virtualizing internal notes/workflow cards without their own gates |

## 5. Offline cache — `packages/domain/src/offline-cache.ts` + `apps/web/src/lib/offline-store.ts`

| | |
|---|---|
| **Default** | `LocalCache` LRU (50 conversations) over IndexedDB (private mode degrades to memory); keys: `msgs:<convId>`, `e2ee:decrypted:<convId>` |
| **Change gate** | Cache hit rate < ~80 % on reconnect paths, or quota errors in the field — then: size/time-based eviction tuning or a persistent cache engine |
| **Anti-patterns** | Caching ciphertext as if decryptable later without keys; unbounded growth; blocking boot on cache reads |

## 6. Realtime transport — WebSocket client

| | |
|---|---|
| **Default** | Single authenticated WebSocket (`x-workspace-id` scoped); REST for everything else |
| **Change gate** | Measured reconnect storms or fan-out > ~50 concurrent workspace streams per node — then: sticky sessions or a pub/sub fan-out layer |
| **Anti-patterns** | Second push channel for the same events; assuming delivery (messages carry client ids for dedupe — keep them) |

## 7. Media — upload path

| | |
|---|---|
| **Default** | Multipart upload to `/v1/media/upload` with server-side scanning hooks; E2EE attachments ride the envelope (plaintext name/body never hits the wire unencrypted in E2EE conversations) |
| **Change gate** | Storage costs or throughput demand object storage directly — then: presigned-URL flow keeping scan + ACL gates |
| **Anti-patterns** | Client-trusted MIME types; auto-downloading unknown media in the UI; leaking attachment names in list snippets for E2EE conversations |

## 8. Queue, cache, and observability — `infra/`

| | |
|---|---|
| **Default** | In-process job runner for dev; container images + Terraform + Kubernetes manifests ready for managed queue/Redis when scaling out |
| **Change gate** | Sustained background work (moderation scans, retries) blocking request paths, **or** multi-node deploys needing shared state — then: managed queue + Redis per the infra modules |
| **Anti-patterns** | Running infra the team cannot observe; skipping dead-letter handling; embedding business logic in queue consumers that belongs in packages |

## 9. Trust & Safety hooks — spec 14

Not a technology choice, but a gate on every new surface: message send paths,
report submission (`POST /v1/admin/reports` with evidence ids), snippet
redaction for encrypted envelopes (`'Encrypted message'`), and safety-number
verification UI must ship together. A feature that produces user-to-user
content without a report affordance fails review.

## Change process

1. Open a PR that cites the gate, the measurement, and the interface that stays
   stable.
2. Include rollback: the previous default must remain selectable by config
   (`feature-flags`) for one release.
3. Update this table in the same PR.
