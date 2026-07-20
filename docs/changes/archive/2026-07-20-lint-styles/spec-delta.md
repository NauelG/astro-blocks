<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Spec delta — Bring `src/styles/` under the Biome gate

**No change to `docs/specs/`.** This change alters what the tooling checks, not what the system does.
No living spec describes the lint configuration, and none should: `docs/specs/` records *behaviour of
the product*, and a consumer's installed package behaves identically before and after.

**No ADR either.** The decision here is small and already has a home: ADR-0013 established the Biome
CI gate and its rules (`format --write` over `check --write`, warnings non-blocking, the baseline as
it stood). This change operates *inside* that decision rather than revisiting it — it widens the
scope the ADR already defined. Writing ADR-0032 to say "and also the CSS directory" would dilute the
series rather than add to it.

What does need recording is the one judgement that is not obvious from the diff: **why
`noImportantStyles` is off**. That is a rule about the panel's stylesheet, so it routes to
`docs/DESIGN.md`.

## Routed to `docs/DESIGN.md` (§1.3, `src/styles/cms-admin.css`)

> **Linting.** `cms-admin.css` está bajo el gate de Biome (`npm run check`). Antes no lo estaba, y
> dos correcciones de UI publicadas el 2026-07-20 pasaron por él sin que ninguna puerta las mirase
> (#95).
>
> La regla **`noImportantStyles` está desactivada** para `src/styles/**`, a propósito y con motivo:
> esta hoja se carga **después de Pico CSS** precisamente para que sus overrides ganen (§1), y usa
> `!important` en clases utilitarias como `.cms-hidden`. La regla asume que controlas toda la
> cascada; aquí no es cierto. **No la reactives sin quitar antes los `!important` deliberados** — hay
> 38, ninguno comentado, y varios sostienen el tema white-label.
>
> `noDescendingSpecificity` **sí está activa** (8 avisos hoy). Son señal real sobre el orden de la
> cascada y se dejan visibles a propósito; forman parte del ratchet de #65.

## Coordination, not documentation

[#65](https://github.com/NauelG/astro-blocks/issues/65) tracks the warning count and its stated
method is to watch it "drop toward zero". This change moves it from **62 to 69**: +8 `noDescendingSpecificity` from the CSS, −1
`useBiomeIgnoreFolder` — a warning Biome had been raising about the `!src/styles/**` exclusion this
change removes. That is a comment on the issue, not a document in the repo; the count lives there,
and leaving it stale would break the only tracking mechanism that issue has.

> **Measured, after quoting a stale figure.** ADR-0013 records "~77 warnings" and I repeated it as
> today's baseline without checking. The real figure on `main` is 62 — the ADR is correct as history
> and has simply drifted. #65's own top-offenders list is stale too (`useLiteralKeys` listed at ~17,
> actually 89). Both corrected in the issue comment.
