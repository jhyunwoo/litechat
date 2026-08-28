Branch: `security/lc-sec-001-006-trusted-proxy-deps-container`
(ALLOW_WRITE_PR defaulted to false — no branch, commit, or PR was created. This is the proposal.)

Title: `security: fix rate-limit bypass, upgrade sharp, harden container and headers`

Commit message:

```
security(server): resolve client address from trusted proxy hops

Findings: LC-SEC-001, LC-SEC-003
Severity: High, Medium
CWE: CWE-307, CWE-290, CWE-348

The rate limiter keyed its bucket on CF-Connecting-IP / X-Forwarded-For
without validating them against any trusted-proxy model, so rotating a
header allocated a fresh budget per request and removed all brute-force
protection from /api/auth/login and /api/admin/login. Analytics read the
opposite (leftmost, client-supplied) end of the same header.

Both call sites now share resolveClientAddress(), which counts XFF from
the right by a configured trusted-hop count, honours CF-Connecting-IP only
when explicitly enabled, and falls back to the socket address.

Validation:
- 7 new cases in apps/server/src/security-controls.test.ts
- bun test (server): 134 pass / 0 fail
- original PoC now returns 429 (was 401 with the budget reset)

Residual risk: TRUSTED_PROXY_HOPS must match the deployment; restrict
origin ingress to the proxy at the network layer.
```

```
security(deps): upgrade sharp to patched release

Finding: LC-SEC-002
CVE/GHSA: CVE-2026-33327, CVE-2026-33328, CVE-2026-35590, CVE-2026-35591
Affected: 0.33.5   Patched: 0.35.4

sharp decodes attacker-supplied upload bytes at POST /api/images before
the format allowlist is applied, so the inherited libvips defects are
reachable. Also aligned hono to >=4.12.34 across workspaces.

Validation:
- bun test (images): 8 pass;  full suite 134 pass / 0 fail
- bun run check-types, bun run build: pass
- bun audit: sharp and all hono advisories cleared (25 -> 20)
```

```
security(infra): run the container as a non-root user

Finding: LC-SEC-004
CWE: CWE-250

The runtime stage had no USER directive. Switched to the image's existing
bun user (uid/gid 1000) and pinned the compose service to 1000:1000 so the
data volume is owned correctly.

Validation: NOT verified at runtime — no Docker on the audit host.
Residual risk: existing deployments need a one-time
`chown -R 1000:1000` on the litechat-data volume.
```

```
security(server): add Content-Security-Policy and bound analytics ingest

Findings: LC-SEC-005, LC-SEC-006
CWE: CWE-693, CWE-1021, CWE-770

hono's secureHeaders() emits no CSP by default. Added an explicit policy
with no unsafe-inline/unsafe-eval in script-src; the /docs CDN origin is
included only when exposeApiDocs is true. Rate-limited the unauthenticated
analytics router.

Validation:
- 4 new assertions in security-controls.test.ts
- browser-driven: web + dashboard, 0 CSP violations, authenticated
  WebSocket OPEN under connect-src 'self'
```

Review checklist
- [x] Patches limited to root causes
- [x] No secrets or PII in diff, logs, or artifacts
- [x] Regression tests cover each security invariant
- [x] Existing behaviour still tested (134 pass / 0 fail; baseline was 124)
- [x] Original PoC re-run and blocked
- [ ] Container change verified by an actual image build — **blocked, no Docker**
- [ ] Human security review
