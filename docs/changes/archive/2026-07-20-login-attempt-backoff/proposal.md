<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Proposal — Exponential backoff on failed logins, keyed by email

_Resolves [#125](https://github.com/NauelG/astro-blocks/issues/125) (P2, security). Grilled 2026-07-20._

## Problem

`POST /cms/api/auth/login` has no attempt counter of any kind. `handleLogin`
(`src/api/handlers/auth.ts:11-70`) validates the body, loads the store, and calls `verifyPassword`
— once per request, at whatever rate the caller can sustain. A repo-wide grep for
`rate.limit|lockout|throttle|attempts` in `src/` returns nothing.

scrypt (`auth-core.ts`) makes each guess expensive. It does not bound how many guesses are made.
Cost per attempt is not a limit on attempts.

The account being guessed is the **owner** of the CMS.

## Two things the issue got wrong

The issue's *Fix direction* proposes an `email + IP` key with lockout and `Retry-After`. Both halves
were checked against the code and neither survives.

### The IP is not knowable here

There is no IP plumbing in `src/` today — zero hits for `clientAddress`, `x-forwarded-for` or
`remoteAddress` — and `handleLogin` receives only a `Request`. That much is just missing work.
The problem is what the work would yield. Astro 7 derives the address like this
(`astro/dist/core/app/node.js:51-53`):

```js
const forwardedClientIp = hostValidated ? getFirstForwardedValue(req.headers["x-forwarded-for"]) : void 0;
const clientIp = forwardedClientIp || req.socket?.remoteAddress;
```

| Source | Trustworthy? | Useful as a key? |
| --- | --- | --- |
| `req.socket.remoteAddress` | Yes — real TCP peer, no blind spoofing | **No** behind a proxy: one address shared by every caller |
| `x-forwarded-for` | **No** — `@astrojs/internal-helpers` checks only that the first value matches `/^[0-9a-fA-F.:]{1,45}$/`; no trust boundary, no hop count | Yes, when a trusted proxy rewrites it |

The precedence is `forwardedClientIp || socket`: **the forgeable header wins over the trustworthy
socket**. An instance exposed directly with `allowedDomains` configured will believe an
attacker-supplied `X-Forwarded-For` over the real peer.

AstroBlocks is a distributable npm package. It cannot know which deployment it is running in, so it
cannot know which of those two values it is holding. More code does not fix this; the information is
not present at this layer.

Note that *availability* is not the problem — ADR-0010 already guarantees an SSR adapter at build
time via `assertAdapterConfigured`. But that guard is deliberately adapter-agnostic (node, vercel,
netlify, cloudflare, or any future one), so it cannot guarantee that the chosen adapter populates
`clientAddress` at all — and Astro's getter **throws** `StaticClientAddressNotAvailable` when it is
absent (`astro/dist/core/middleware/index.js:60-65`). Even granting availability everywhere, the
trust problem above is untouched: a value that is present is not thereby a value that means what we
need it to mean.

Keying on it is not neutral, it is negative: an attacker rotates the header for unlimited attempts,
and a throttle keyed by IP lets them forge a victim's address to throttle someone else.

### Lockout is a denial-of-service on a single-owner CMS

AstroBlocks has one owner. A lockout that denies the account after N failures lets any
unauthenticated caller make the CMS unadministrable by failing five times. That trades a
brute-force risk for a guaranteed availability loss, reachable by anyone who knows the owner's
email address.

## Proposal

**Delay failed attempts, keyed by email, in memory.**

1. **Key: the normalized email**, already computed at `auth.ts:23`. It is the one field an attacker
   cannot rotate without ceasing to attack the account. No new plumbing through `catchall.ts`, no
   signature change to `handleLogin`, no dependency on what any given adapter exposes.
2. **Exponential backoff, capped** — not lockout. The owner is never shut out; the attacker's
   sustained rate collapses. The delay applies **before** the response, and the response itself is
   unchanged.
3. **In memory, bounded.** A file-backed counter would mean one disk write per failed login
   (`data.ts:300`, tmp + rename) plus contention on the users lock — an I/O amplifier handed to the
   attacker, on the exact path being defended.
4. **The proxy stays the production layer**, documented as such. This is defense in depth.

### What this buys, stated honestly

Backoff bounds the rate a single key can sustain **over time**. It does not stop a burst of
concurrent requests that all arrive before any counter increments — against that, scrypt's per-guess
cost is what bounds throughput. The two compose: scrypt makes each guess expensive, backoff makes
sequences of guesses slow. Neither alone is sufficient and neither is claimed to be.

It also does nothing against a distributed attack spread across many accounts (password spray),
because there is only one account worth spraying and it is covered by its own key.

## Why the response must not change

`auth.ts:64` returns one `401 errors.invalidCredentials` for both "no such user" and "wrong
password". That uniformity is an anti-enumeration property.

A lockout branch would break it: a `429` that only ever appears for real accounts tells an attacker
exactly which emails exist. Backoff keeps the response **byte-identical** to an ordinary failure —
the delay is the only observable, and it applies to unknown emails too.

This is also why no `Retry-After` header is added. Beyond leaking existence, `localizedJsonError`
merges `extra` into the response **body**, not headers (`shared.ts:25-36`), so the header would have
required a new helper to leak information we do not want to leak.

## Bounded store

The key is attacker-controlled. An unbounded `Map` keyed by arbitrary emails is a memory-exhaustion
vector — trading a brute-force defense for an OOM. The store is capped with eviction, and the cap is
part of the contract rather than an implementation detail (see `design.md`).

## Non-goals

- No IP-based keying, now or later (ADR-0032 records why, so it is not re-litigated as a missing feature).
- No lockout, no CAPTCHA, no account-recovery flow.
- No persistence across restart, and no cross-instance coordination.
- No throttling of other endpoints. The reusable-limiter shape is deliberately not designed here:
  there is exactly one call site, and a second one would be needed to design it honestly.

## Boundaries

`jwtSecretMisconfigured` fail-closed behaviour, the first-user bootstrap path (`auth.ts:30-61`), the
token lifetime and `getAuth` are untouched. The bootstrap path cannot fail on credentials — with an
empty store any email and password succeed — so no counter can be reached there; see `design.md`.
