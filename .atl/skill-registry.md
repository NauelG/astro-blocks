# Skill Registry — astro-blocks

Generated: 2026-04-15

## Trigger Table

| Trigger | Skill | Source |
|---------|-------|--------|
| accessibility, a11y audit, WCAG, screen reader, keyboard navigation | accessibility | project |
| Astro, .astro files, SSG, islands, content collections | astro | project |
| UI components, pages, landing pages, dashboards, styling/beautifying | frontend-design | project |
| Node.js servers, REST APIs, Express, Fastify, microservices | nodejs-backend-patterns | project |
| Node.js architecture, framework selection, async patterns | nodejs-best-practices | project |
| Playwright tests, E2E, flaky tests, Page Object Model, test CI/CD | playwright-best-practices | project |
| SEO, meta tags, structured data, sitemap, search optimization | seo | project |
| TypeScript generics, conditional types, mapped types, utility types | typescript-advanced-types | project |
| Creating a PR, pull request, prepare changes for review | branch-pr | user |
| Go tests, bubbletea, teatest | go-testing | user |
| GitHub issue, bug report, feature request | issue-creation | user |
| judgment day, dual review, adversarial review | judgment-day | user |
| Create new skill, add agent instructions | skill-creator | user |

## Convention Files

| File | Description |
|------|-------------|
| AGENTS.md | Project agent guide — architecture, routes, design system, conventions |
| CLAUDE.md | Claude-specific instructions — skill auto-load table |

## Compact Rules

### accessibility
- Audit against WCAG 2.2 AA minimum (A = must pass, AA = should pass)
- All interactive elements must be keyboard reachable and have visible focus indicators
- Images: descriptive `alt` text; decorative images use `alt=""` + `role="presentation"`
- Form inputs must have `<label>` associated via for/id, or `aria-label`
- Color contrast: ≥4.5:1 for normal text, ≥3:1 for large text/UI components
- Never rely on color alone to convey meaning — pair with text or icon
- Use semantic HTML first; ARIA only when HTML semantics are insufficient

### astro
- `.astro` frontmatter (between `---`) runs at build/request time only, never in browser
- SSR requires an adapter in `astro.config.mjs`; this project uses SSR by default
- Use `Astro.props`, `Astro.params`, `Astro.request` for component/server data
- Client-side JS: add `client:load`, `client:idle`, or `client:visible` to framework components
- Inject routes via `injectRoute()` in `astro:config:setup` — NOT in `src/pages`
- `<Image />` from `astro:assets` for optimized images; never plain `<img>` for local assets
- `import.meta.env` for env vars (`PUBLIC_` prefix for client-side, none for server-only)

### frontend-design
- Choose a BOLD aesthetic direction before coding — commit fully
- 90% neutral, 10% accent; never use `--cms-primary` for large layout surfaces or backgrounds
- White-label: design must look correct with ANY configurable primary color
- Avoid generic AI aesthetics — no stock shadow patterns, no interchangeable cards
- Surfaces: flat, light, soft borders; distinguish app background → content surface → component surface
- Topbar, toolbars, and auxiliary blocks must feel visually secondary to the main content area
- Use real working code, not placeholders

### nodejs-backend-patterns
- Validate all external input at system boundaries; trust internal code
- Use async/await; handle errors with try/catch or centralized error middleware
- Never store secrets in code — environment variables only
- Structure: routes → controllers → services → repositories
- Use connection pooling; never open a new connection per request

### nodejs-best-practices
- Choose framework by need: Express (simple), Fastify (performance), Koa (middleware control)
- Always use async/await with proper error handling; never mix callbacks and promises
- Validate all external inputs with a schema validator (Zod, Joi, etc.)
- Keep business logic in services, not routes
- Never block the event loop with CPU-intensive synchronous work

### playwright-best-practices
- Use auto-retrying `expect()` assertions — never `page.waitForTimeout()`
- Prefer semantic locators: `getByRole()`, `getByLabel()`, `getByText()`; avoid CSS/XPath
- Use Page Object Model for reusable interactions; fixtures for shared state
- Never mock your own frontend-to-backend; mock only third-party services
- Use `storageState` for authenticated tests to skip login on every test
- Tests must be independent; no shared mutable state across test files

### seo
- Every page: unique `<title>` (50–60 chars) + `<meta name="description">` (150–160 chars)
- Use `<link rel="canonical">` to prevent duplicate content
- JSON-LD structured data in `<head>` for articles, breadcrumbs, products
- Images: descriptive `alt`, `loading="lazy"` for below-fold, provide `width`/`height`
- Core Web Vitals targets: LCP < 2.5s, CLS < 0.1, INP < 200ms
- Server-side render SEO-critical content — never rely on client-only JS for indexable text

### typescript-advanced-types
- Use `satisfies` to validate type shape without widening
- Prefer `unknown` over `any`; always narrow before using
- Use `infer` inside conditional types to extract sub-types
- Discriminated unions + exhaustive `never` check in switch for type-safe branching
- Template literal types for string pattern validation at compile time
- Mapped types with `as` for key remapping and filtering

### branch-pr
- Follow issue-first: reference a GitHub issue before opening a PR
- PR title: conventional commit style (`feat:`, `fix:`, `chore:`, etc.)
- Include test evidence; screenshot/video for UI changes
- One concern per PR — split if it grew

### go-testing
- Use `teatest` for Bubbletea TUI testing
- Table-driven tests with `t.Run()` for clarity
- Use `t.Helper()` in assertion helpers
- `_test` suffix package for blackbox tests, same package for whitebox

### issue-creation
- Issue-first: create issue before branching or implementing
- Include acceptance criteria and reproduction steps
- Label: bug, feat, chore, docs, etc.

### judgment-day
- Launch TWO independent blind judge sub-agents simultaneously
- Each reviews without seeing the other's output
- Synthesize findings, apply fixes, re-judge until both pass or escalate after 2 iterations

### skill-creator
- Skills use YAML frontmatter: name, description (with Trigger:), license, metadata
- One purpose per skill file — keep focused
- Include compact rules section for sub-agent injection
- Test skills on real scenarios before publishing
