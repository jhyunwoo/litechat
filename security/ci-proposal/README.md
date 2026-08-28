# Proposed CI security checks

Not installed — `.github/` does not exist at `f52f085`, so adopting this is a deliberate choice.
Copy `security.yml` to `.github/workflows/security.yml`.

## Which check prevents which finding recurring

| Finding | Preventing check |
|---|---|
| LC-SEC-001, 003 | `bun run test` — `security-controls.test.ts` fails if the trusted-hop rule regresses |
| LC-SEC-002 | `bun audit` + Trivy image scan |
| LC-SEC-004 | Trivy image scan (`root-user` misconfiguration rule) |
| LC-SEC-005, 006 | `bun run test` — CSP and analytics-limit assertions |
| Secrets | gitleaks; the nightly lane uses `fetch-depth: 0` for full history |

## Before adopting

1. Pin every external action to a commit SHA (they are on floating tags here).
2. Keep `continue-on-error` on `bun audit`/Semgrep until the 20 known dev-only advisories are triaged,
   then remove it so new Critical/High block.
3. Never expose scan credentials to `pull_request_target` or fork PRs.
4. Do not point DAST at production from PR runs.
