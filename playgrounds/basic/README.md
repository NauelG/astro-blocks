<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# AstroBlocks — Basic Playground

A minimal consumer project that validates the `@astroblocks/astro-blocks` integration in a
realistic Astro setup. It ships with demo content (pages, menus, media, and a pre-seeded admin
user) so you can explore every CMS feature without any extra setup.

## Prerequisites

- Node.js 18 or later
- `npm` workspaces (the playground is managed from the **repository root**)

## Running the Playground

All commands are run from the **repository root**, not from `playgrounds/basic/`:

```bash
# Build the package and start the playground dev server (hot reload)
npm run dev:playground

# Build the package and produce a static build of the playground
npm run build:playground

# Wipe Astro and AstroBlocks build caches, then start fresh
npm run dev:playground:fresh
```

`dev:playground` and `build:playground` both call `prepare:playground` first, which packs the
local package and installs it into the playground workspace so you always test the current
source, not a stale npm cache.

## Default Admin Credentials

The playground ships a pre-seeded owner account in `data/users.json`:

| Field    | Value             |
| -------- | ----------------- |
| Email    | `admin@test.com`  |
| Password | `admin1234`       |

Log in at `http://localhost:4321/cms`.

---

## Backup & Restore Demo

> This walkthrough exercises the **Import / Export** feature introduced in `@astroblocks/astro-blocks` v3.3.
> It covers two scenarios: round-trip restore on a blank instance, and an authenticated replace-all
> import on a running instance.

### Scenario 1 — Round-trip backup and restore

Use this to verify that an exported archive fully seeds a blank instance.

#### Step 1 — Start the playground and confirm it is populated

```bash
npm run dev:playground
```

Open `http://localhost:4321/cms` and log in with the default credentials above. The dashboard
shows the demo content: two published pages, six media uploads, one language pair (EN + ES),
menus, and a default configuration. Confirm the content looks right before proceeding.

#### Step 2 — Export a backup

1. Navigate to **Configuration › Import / Export** (`http://localhost:4321/cms/import-export`).
2. Under **Export**, all five units are available: Pages, Media, Users, Configuration, Global
   blocks. Select all of them (or choose a subset).
3. Click **Download backup**. The browser saves a `.zip` file named
   `astro-blocks-export-<timestamp>.zip`.

The archive contains a `manifest.json` with checksums and an `exportedAt` timestamp, plus one
JSON file per exported unit. The Media unit includes both the `media.json` registry and all
physical upload files under `public/uploads/`.

#### Step 3 — Reset the playground to a blank state

Stop the dev server (`Ctrl+C`), then restore the tracked data files to their committed state:

```bash
git checkout -- playgrounds/basic/data/ playgrounds/basic/public/uploads/
```

This is not a dedicated npm script — it uses `git checkout` to reset every file under
`playgrounds/basic/data/` and `playgrounds/basic/public/uploads/` to the version committed in
the repository. Both directories are fully git-tracked, so this is a reliable, repeatable
baseline. Untracked files that may have been added by the CMS (e.g. new uploads) are not
removed by `git checkout`; delete them manually with `rm -rf playgrounds/basic/public/uploads/`
followed by `mkdir -p playgrounds/basic/public/uploads/` if you want a completely empty uploads
directory.

To also wipe Astro and AstroBlocks build caches:

```bash
npm run clean:playground
```

This runs `rimraf playgrounds/basic/.astro playgrounds/basic/.astro-blocks` — it removes build
artifacts only, not content data.

Next, blank `data/users.json` so the instance has zero users (the bootstrap-import flow requires
this):

```bash
node -e "require('fs').writeFileSync('playgrounds/basic/data/users.json', JSON.stringify({ users: [] }, null, 2))"
```

#### Step 4 — Import the backup through the login screen

Start the playground again:

```bash
npm run dev:playground
```

Open `http://localhost:4321/cms`. Because `data/users.json` contains no users, the login card
shows an **"Import a backup"** button instead of a sign-in form (this is the bootstrap-import
control, which requires no authentication — it only activates when the instance has zero users).

1. Click **Import a backup** and select the `.zip` file you exported in Step 2.
2. The import runs on the server (`POST /cms/api/import/bootstrap`): it unpacks the archive,
   verifies checksums from `manifest.json`, and writes each unit to the matching `data/*.json`
   file. Media files are restored to `public/uploads/`.
3. When the status line reads **Done**, the instance is fully seeded.

#### Step 5 — Log in and verify

Return to `http://localhost:4321/cms` and sign in with the credentials that were included in the
Users unit of the backup (if you exported Users, those are the same credentials you used in
Step 1: `admin@test.com` / `admin1234`).

Verify that:

- The **Pages** list shows the same pages as before the reset.
- The **Media** library shows the same uploads with their variants.
- Global blocks and menus are intact.

---

### Scenario 2 — Authenticated replace-all import

Use this to overwrite a **running** instance with a backup without going through the bootstrap
flow. This is the typical path when migrating content between environments.

1. Log in to `/cms/import-export` on the target instance.
2. Under **Import**, click **Choose file** and select the backup `.zip`.
3. The manifest preview appears automatically (version, export date, unit count).
4. Select the units you want to restore. Only units present in the archive can be selected.
5. Click **Upload backup**.
6. A confirmation dialog appears. If the **Users** unit is selected, a session-close warning is
   shown: importing Users replaces all user accounts and your current session token becomes
   invalid immediately after the import completes. The page redirects to `/cms` so you can log
   in with the imported credentials.
7. Confirm. The import runs (`POST /cms/api/import`). When the status reads **Done**, the
   selected units have been replaced.

> **Note — Users unit and session close (ADR-7):** when the Users unit is imported, the server
> responds with `{ usersReplaced: true }`. The client clears `sessionStorage` (`cms-token` and
> `cms-user`) and redirects to `/cms`. Log in with the credentials from the imported backup.

---

## Version Badge

The version badge in `README.md` (root, line ~17) is bumped automatically by the `version`
npm lifecycle hook on every release. Do not bump it manually in this PR — it is a release task.
