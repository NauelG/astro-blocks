# Skill Registry — astro-blocks

<!-- Updated by sdd-init. Re-run `/sdd-init` to regenerate. -->

Last updated: 2026-06-30

## Sources scanned

- `.claude/skills` (project-level, canonical for Claude Code)
- `.agents/skills` (project-level, alias — same content as .claude/skills)
- `~/.claude/skills` (user-level)

## Contract

**Delegator use only.** This registry is an index, not a summary. Any agent that launches subagents reads it to select relevant skills, then passes exact `SKILL.md` paths for the subagent to read before work.

`SKILL.md` remains the source of truth. Do not inject generated summaries or compact rules by default; pass paths so subagents load the full runtime contract and preserve author intent.

## Skills

| Skill | Trigger / description | Scope | Path |
| --- | --- | --- | --- |
| `accessibility` | Audit and improve web accessibility following WCAG 2.2 guidelines. Use when asked to "improve accessibility", "a11y audit", "WCAG compliance", "screen reader support", "keyboard navigation", or "make accessible". | project | `/Users/gnaue/GIT/PERSONAL/astro-blocks/.claude/skills/accessibility/SKILL.md` |
| `astro` | Skill for building with the Astro web framework. Helps create Astro components and pages, configure SSR adapters, set up content collections, deploy static sites, and manage project structure and CLI commands. Use when the user needs to work with Astro, mentions .astro files, asks about static site generation (SSG), islands architecture, content collections, or deploying an Astro project. | project | `/Users/gnaue/GIT/PERSONAL/astro-blocks/.claude/skills/astro/SKILL.md` |
| `astro-integration-authoring` | Author an Astro integration as an npm package. Use when working with plugin/index.ts, injectRoute authoring, astro:config:setup hook, AstroIntegration return type, addVirtualImports, integration package structure, or peerDependency astro. | project | `/Users/gnaue/GIT/PERSONAL/astro-blocks/.claude/skills/astro-integration-authoring/SKILL.md` |
| `frontend-design` | Create distinctive, production-grade frontend interfaces with high design quality. Use this skill when the user asks to build web components, pages, artifacts, posters, or applications (examples include websites, landing pages, dashboards, React components, HTML/CSS layouts, or when styling/beautifying any web UI). | project | `/Users/gnaue/GIT/PERSONAL/astro-blocks/.claude/skills/frontend-design/SKILL.md` |
| `node-test-runner` | Unit testing patterns for astro-blocks using the built-in Node.js test runner. Covers node:test imports, node:assert/strict assertions, withTempProject temp-dir isolation, env-var save/restore, async test syntax, and subset run commands. Use when writing unit tests, running node --test, using node:test or assert/strict, isolating tests with withTempProject, or running a subset of tests with --test-name-pattern. | project | `/Users/gnaue/GIT/PERSONAL/astro-blocks/.claude/skills/node-test-runner/SKILL.md` |
| `nodejs-backend-patterns` | Build production-ready Node.js backend services with Express/Fastify, implementing middleware patterns, error handling, authentication, database integration, and API design best practices. Use when creating Node.js servers, REST APIs, GraphQL backends, or microservices architectures. | project | `/Users/gnaue/GIT/PERSONAL/astro-blocks/.claude/skills/nodejs-backend-patterns/SKILL.md` |
| `nodejs-best-practices` | Node.js development principles and decision-making. Framework selection, async patterns, security, and architecture. Teaches thinking, not copying. | project | `/Users/gnaue/GIT/PERSONAL/astro-blocks/.claude/skills/nodejs-best-practices/SKILL.md` |
| `npm-release` | Covers the tag-triggered npm release workflow for astro-blocks. Use when asked to "cut a release", "publish npm", "npm publish", "dist-tag", "changelog entry", "extract-changelog-entry", "version bump", "alpha release", "semver", "tag release", or "provenance". | project | `/Users/gnaue/GIT/PERSONAL/astro-blocks/.claude/skills/npm-release/SKILL.md` |
| `playwright-best-practices` | Use when writing Playwright tests, fixing flaky tests, debugging failures, implementing Page Object Model, configuring CI/CD, optimizing performance, mocking APIs, handling authentication or OAuth, testing accessibility (axe-core), file uploads/downloads, date/time mocking, WebSockets, geolocation, permissions, multi-tab/popup flows, mobile/responsive layouts, touch gestures, GraphQL, error handling, offline mode, multi-user collaboration, third-party services, console error monitoring, global setup/teardown, test annotations, test tags, project dependencies, security testing, performance budgets, iframes, component testing, canvas/WebGL, service workers/PWA, test coverage, i18n, Electron apps, or browser extension testing. | project | `/Users/gnaue/GIT/PERSONAL/astro-blocks/.claude/skills/playwright-best-practices/SKILL.md` |
| `seo` | Optimize for search engine visibility and ranking. Use when asked to "improve SEO", "optimize for search", "fix meta tags", "add structured data", "sitemap optimization", or "search engine optimization". | project | `/Users/gnaue/GIT/PERSONAL/astro-blocks/.claude/skills/seo/SKILL.md` |
| `typescript-advanced-types` | Master TypeScript's advanced type system including generics, conditional types, mapped types, template literals, and utility types for building type-safe applications. Use when implementing complex type logic, creating reusable type utilities, or ensuring compile-time type safety in TypeScript projects. | project | `/Users/gnaue/GIT/PERSONAL/astro-blocks/.claude/skills/typescript-advanced-types/SKILL.md` |

## User-level skills (from ~/.claude/skills)

| Skill | Trigger / description | Scope | Path |
| --- | --- | --- | --- |
| `branch-pr` | Create pull requests with issue-first checks. Trigger: creating, opening, or preparing PRs for review. | user | `/Users/gnaue/.claude/skills/branch-pr/SKILL.md` |
| `chained-pr` | Trigger: PRs over 400 lines, stacked PRs, review slices. Split oversized changes into chained PRs that protect review focus. | user | `/Users/gnaue/.claude/skills/chained-pr/SKILL.md` |
| `cognitive-doc-design` | Design docs that reduce cognitive load. Trigger: writing guides, READMEs, RFCs, onboarding, architecture, or review-facing docs. | user | `/Users/gnaue/.claude/skills/cognitive-doc-design/SKILL.md` |
| `comment-writer` | Write warm, direct collaboration comments. Trigger: PR feedback, issue replies, reviews, Slack messages, or GitHub comments. | user | `/Users/gnaue/.claude/skills/comment-writer/SKILL.md` |
| `judgment-day` | Trigger: judgment day, dual review, adversarial review. Run blind dual review, fix confirmed issues, then re-judge. | user | `/Users/gnaue/.claude/skills/judgment-day/SKILL.md` |
| `issue-creation` | Create GitHub issues, bug reports, or feature requests. Trigger: creating GitHub issues. | user | `/Users/gnaue/.claude/skills/issue-creation/SKILL.md` |
| `skill-creator` | Trigger: new skills, agent instructions, documenting AI usage patterns. Create LLM-first skills with valid frontmatter. | user | `/Users/gnaue/.claude/skills/skill-creator/SKILL.md` |
| `skill-improver` | Trigger: improve skills, audit skills, refactor skills, skill quality. Audit and upgrade existing LLM-first skills. | user | `/Users/gnaue/.claude/skills/skill-improver/SKILL.md` |
| `work-unit-commits` | Plan commits as reviewable work units. Trigger: implementation, commit splitting, chained PRs, or keeping tests and docs with code. | user | `/Users/gnaue/.claude/skills/work-unit-commits/SKILL.md` |

## Loading protocol

1. Match task context and target files against the `Trigger / description` column.
2. Pass only the matching `Path` values to the subagent under `## Skills to load before work`.
3. Instruct the subagent to read those exact `SKILL.md` files before reading, writing, reviewing, testing, or creating artifacts.
4. If no matching skill exists, proceed without project skill injection and report `skill_resolution: none`.
