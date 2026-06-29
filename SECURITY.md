<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Security Policy

`@astroblocks/astro-blocks` is an **Astro integration published to npm** — not a
deployed application. It ships an admin panel, API handlers, media upload
processing, and block validation logic. Even so, we take security seriously for
all code that runs in consumer projects.

## Supported versions

Only the latest published npm release and the `main` branch are maintained.
There are no backported security branches.

| Version         | Supported |
| --------------- | --------- |
| Latest (`main`) | ✅        |
| Older releases  | ❌        |

## Reporting a vulnerability

**Do not open a public issue for security problems.**

Report privately through **GitHub Private Vulnerability Reporting**:

1. Go to the repository's **Security** tab.
2. Click **Report a vulnerability** (or use
   [this direct link](https://github.com/NauelG/astro-blocks/security/advisories/new)).
3. Fill in the advisory form with as much detail as you can.

If GitHub private reporting is unavailable to you, email
**g.nauel@gmail.com** with subject line `[SECURITY] @astroblocks/astro-blocks`.

Please include:

- The affected area (API handlers, admin UI, auth/session, media upload, block
  validation, SSR rendering, or other).
- Steps to reproduce, expected vs. actual behavior, and potential impact.
- Any relevant logs, proof of concept, or reproduction repository.

This is a solo-maintained open-source project. You can expect a best-effort
acknowledgement as soon as possible. Once a fix is prepared, a patched release
will be published and you will be credited in the advisory unless you prefer
anonymity.

## Scope

**In scope** — vulnerabilities in the integration code itself:

- Authentication and session handling (JWT, admin credentials, cookie settings).
- API handler logic (`api/handlers.ts`) — input validation, authorization checks.
- File upload and media handling — path traversal, type validation, size limits.
- Block validation and output escaping — XSS or injection via block content.
- SSR rendering issues that could expose sensitive data or allow injection.
- Secrets leaked by the integration's own tooling (gitleaks allowlist gaps, etc.).

**Out of scope:**

- Vulnerabilities in the consumer's own site code, block implementations, or
  deployment — those are the consumer's responsibility.
- Vulnerabilities in Astro itself or third-party npm dependencies — please
  report those to the respective upstream projects.
- Issues that only affect the demo/placeholder data under `playgrounds/` (those
  credentials are intentionally non-secret example data).

## Hardening reminders for consumer projects

When deploying a site that uses this integration:

- Set strong, unique values for `JWT_SECRET`, `ADMIN_USER`, and `ADMIN_PASSWORD`
  — never use example values.
- Never commit real `.env` files to version control.
- Keep `npm audit` and dependency updates in your workflow.
- Run `npm run secrets` (gitleaks) in your CI pipeline to catch accidental
  credential leaks.
