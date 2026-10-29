<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Spec — Public locale routing

> Living specification. Describes how the public site decides the locale of `/` and how it
> remembers the visitor's choice. Changed via the cycle's `spec-delta.md` mechanism (see
> `AGENTS.md`). History: inaugurated by change `internal-navigation-behind-proxy`, which made
> internal navigation survive a TLS-terminating proxy. Open follow-up: #192 (cached `/`).

## Capability

On `/`, the public site may send a visitor arriving from outside to the home of their preferred
non-default locale — the **root locale redirect**. The visitor's choice is remembered as the
**locale preference**, and reaching `/` through an **internal navigation** is itself a choice of the
default locale. Vocabulary: `docs/CONTEXT.md` §3.

## Requirements

- **R1 — Scope of the root locale redirect.** Only the public `[...slug]` route under
  `publicRendering: 'server'` (`page.astro`) evaluates it, and only when the pathname is exactly
  `/`. No other route redirects by locale; `page-static.astro` does not implement it.
- **R2 — Internal navigation never redirects.** When the request to `/` is an internal navigation,
  the default-locale home is served without consulting the cookie or `Accept-Language`.
- **R3 — Internal navigation = same hostname.** A request is an internal navigation when the
  hostname of its `Referer` equals the request hostname after dropping **a single** leading `www.`
  from both. Scheme and port are ignored: behind a TLS-terminating proxy the server sees `http`
  while the browser sends `https`. Any other subdomain is a different site. With no `Referer`, or one
  that is not a URL, the request is external.
- **R4 — Precedence on external requests.**
  (a) If the locale preference is an enabled locale equal to the default, no redirect.
  (b) If it is an enabled non-default locale with a published home, `302` to that home.
  (c) Otherwise, take the **first** `Accept-Language` entry (by `q` order) that resolves to an
  enabled locale — by exact code or by base language, including another regional variant of the
  same language (`es-MX` resolves to `es-es`). If that locale is not the default and has a
  published home, `302` to that home with `Vary: Accept-Language`. If the first match is the
  default locale, the search stops there.
  (d) Otherwise, no redirect.
- **R5 — The redirect keeps the query and sets the preference.** The target is the localized home
  path plus the original query string, and the response writes the target locale as the locale
  preference.
- **R6 — Every public page writes its locale.** Every `[...slug]` response that is not a root
  locale redirect — including stored Redirects and 404s — persists the locale resolved from its URL
  into `astroblocks-locale` (enabled locales only; `Path=/`, one year, `SameSite=Lax`, `HttpOnly`).
  An internal navigation to `/` therefore returns the preference to the default locale.
- **R7 — Known limitations.**
  - The request hostname comes from the `Host` header: a proxy that does not forward it breaks R3.
  - A site that suppresses the `Referer` on same-site navigation (`Referrer-Policy: no-referrer`)
    leaves its language switcher unable to return to the default locale (R3: no `Referer` means
    external).
  - A response for `/` served from the route cache does not evaluate R2–R6 (#192).
  - A trailing-dot hostname in the `Referer` (`example.com.`) counts as a different site.
- **R8 — Regression coverage.** `tests/localization.test.js` pins R3 (scheme, port, `www.` on
  either side, other subdomains, another host, missing or invalid `Referer`) and the behind-proxy
  scenario of R2: request `http://host/`, `Referer: https://host/es`, preference `es` → no redirect.
