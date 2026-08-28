# litechat Threat Model

Scope: commit `f52f085`. Built before deep scanning to prioritise realistic attack paths over
scanner alert volume.

## Assets

| Asset | Store | Sensitivity |
|---|---|---|
| Message content | SQLite `messages` | High — private correspondence |
| Uploaded images | Disk `UPLOAD_DIR` + `images` metadata | High |
| Session tokens | Redis `sess:` / `admin_sess:` | Critical — bearer equivalent |
| Password hashes | SQLite `users.password_hash` | Critical (argon2id) |
| IP + geolocation + MaxMind Insights | `analytics_sessions`, `geoip_insights` | High — PII, ISP/org/user-type |
| Notification body previews | `notification_log.body_preview` | Medium — message excerpts |
| Content reports | `content_reports` | Medium |

## Identities and Roles

| Principal | Credential | Reaches |
|---|---|---|
| Anonymous | none | `/api/auth/{register,login}`, `/api/analytics/*`, static, `/api/health` |
| User | `lc_sess` cookie or Bearer | chat, friends, images, push, safety, `/ws` |
| Admin | `lc_admin_sess` cookie (host-only, 12h) | all `/api/admin/*` |
| Operator | env + volume | everything |

Namespaces are disjoint (`sess:` vs `admin_sess:`, different cookies) — a chat session cannot
reach an admin route. Verified by reading both middlewares.

## Trust Boundaries

| # | Boundary | Controls | Assumptions |
|---|---|---|---|
| TB1 | Internet → Traefik | TLS termination, host routing | **Origin not directly reachable** — unverified |
| TB2 | Traefik → Bun | `X-Forwarded-For` append | **Exactly one trusted hop** — the assumption LC-SEC-001/003 broke |
| TB3 | Anonymous → authenticated | `requireAuth`, Redis lookup | Token secrecy; 256-bit CSPRNG |
| TB4 | User → user | `requireMembership`, `canAccess`, block checks | Verified sound |
| TB5 | User → admin | `requireAdmin`, separate cookie | Only 5/15min brute-force limit — broken by LC-SEC-001 |
| TB6 | Client → server validation | Zod on server via `zValidator` | Server-side, not client-only — verified |
| TB7 | Upload → image decoder | Size cap, format allowlist **after** decode | libvips memory safety — LC-SEC-002 |
| TB8 | Process → container | (none before this audit) | Was root — LC-SEC-004 |
| TB9 | Server → Redis | compose network only | No Redis password |
| TB10 | Server → MaxMind | hardcoded hosts, TLS, Basic auth | Archive contents trusted (`tar xzf`) |
| TB11 | Browser → SW/PWA | precache only, no runtime cache | Verified — no private caching |
| TB12 | Mobile local storage | `expo-secure-store`, `WHEN_UNLOCKED_THIS_DEVICE_ONLY` | Device not jailbroken |
| TB13 | Build/CI | none — no CI exists | Greenfield |

## Attacker Capabilities

- **Anonymous remote.** Can register freely, set arbitrary request headers, POST unauthenticated
  analytics. → *realised in LC-SEC-001, 003, 006.*
- **Authenticated user.** Can upload arbitrary bytes to the image decoder, open a WebSocket, send
  frames. → *realised in LC-SEC-002.*
- **Malicious peer.** Can send messages/images to a conversation partner and trigger their push path.
- **Network-adjacent.** If it can reach Redis, it reads and mints every session (no password).
- **Supply chain.** Controls a dependency version or the MaxMind archive.

## Abuse Cases Considered

| Class | Outcome |
|---|---|
| IDOR / BOLA on conversations, messages, images, push, friends | **Not found** — every path gated |
| Privilege escalation user → admin | **Not found** via app logic; reachable by brute force (LC-SEC-001) |
| SQL injection | **Not found** — parameterised; sort identifiers whitelisted at route |
| XSS (reflected/stored/DOM) | **Not found** — no injection sink in 175 files; CSP added anyway |
| CSRF | Blocked by `SameSite=Lax` + JSON content-type |
| SSRF | **Not found** — hardcoded hosts, `isIP()` validation |
| Path traversal (static, uploads) | **Not found** — decode-before-check; UUID-derived paths |
| Session theft / fixation | Tokens are CSPRNG, httpOnly, rotated on login; no fixation vector |
| Rate-limit bypass | **Found** — LC-SEC-001 |
| Cache poisoning (SW) | **Not found** — precache only |
| Unsafe deserialisation | **Not found** — JSON + Zod only |
| Information disclosure via errors | Error codes are machine strings; no stack traces returned |
| Resource abuse | **Found** — LC-SEC-006 |

## Prioritisation Outcome

TB2 and TB5 carried the most risk: an unauthenticated attacker who controls a header crossing TB2
defeats the only control on TB5. That drove LC-SEC-001 to the top of the queue ahead of anything
`bun audit` reported. TB7 ranked second because it is the one place raw attacker bytes reach a
native decoder.
