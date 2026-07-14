<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# AGENTS.md — AstroBlocks

Cómo trabaja el agente en este repo: el **ciclo de desarrollo** y las **políticas transversales**
que se aplican siempre. La referencia operativa (estructura, dominio, gotchas) y el sistema de
diseño viven en documentos aparte, que se cargan bajo demanda para no gastar contexto en cada sesión.

## Lectura obligatoria antes de tocar código

- **`docs/CONTEXT.md`** — mental model, glosario, convenciones y gotchas del sistema.
- **`docs/DESIGN.md`** — design system del panel. Obligatorio para cualquier trabajo de UI del admin.
- **`docs/DECISIONS.md` + `docs/adr/`** — decisiones de arquitectura y su porqué (inmutables).
- Plan de referencia: documento "Plan final: CMS para Astro".

Guías de mantenedor/consumidor: `docs/DEVELOPING.md`, `docs/LOCAL_PACKAGE_TESTING.md`, `README.md`.

---

## Principios

- **Idioma:** responde y redacta los artefactos en el idioma que use el humano. No fuerces ningún
  idioma ni añadas notas de traducción.
- **Control:** el ciclo se detiene en cada **GATE** y espera aprobación explícita antes de seguir.
- **Versionado:** el conocimiento intencional vive en git — `docs/specs/`, `docs/adr/`, `docs/CONTEXT.md`, `docs/DESIGN.md`.
- **Sin ruido efímero:** no documentes contexto derivable del código ("esta función se llama en X").

---

## El ciclo

Disparador: el humano dice *"implementemos XYZ"*. Ejecuta estas fases en orden, parando en cada **GATE**.

1. **Grilling.** Interroga hasta fijar alcance, casos borde y vocabulario. Usa el lenguaje de
   `docs/CONTEXT.md`. → **GATE: confirma que entendiste antes de escribir nada.**
2. **Propose.** Crea `docs/changes/<slug>/` con `proposal.md`, `design.md` y `spec-delta.md`. Si la
   solución implica una decisión no obvia, crea también un ADR en `docs/adr/`.
   → **GATE: el humano aprueba propuesta, diseño y delta.**
3. **Plan.** Genera `tasks.md` en vertical slices (cada tarea con rutas de fichero y criterio de
   verificación). → **GATE: el humano aprueba el plan.**
4. **Implement.** Ejecuta las tareas de un mismo cambio **de corrido**, con disciplina TDD:
   test que falla → mínimo código para pasarlo → refactor → commit. Marca cada tarea en `tasks.md`.
5. **Review.** Revisa el diff contra `spec-delta.md` y las convenciones de `docs/CONTEXT.md` / `docs/DESIGN.md`.
   Reporta problemas por severidad. → **GATE: el humano aprueba o pide cambios.**
6. **Archive.** Aplica el `spec-delta.md` sobre `docs/specs/` (la spec viva), mueve `docs/changes/<slug>/`
   a `docs/changes/archive/<fecha>-<slug>/`, y deja el ADR intacto. Commit.

**GATE** = para de trabajar, resume en pocas líneas lo hecho en la fase, y espera un "ok" explícito.
No avances a la fase siguiente sin él.

### Convención de `spec-delta.md`

Describe el cambio respecto a `docs/specs/` marcando cada sección:

```markdown
## ADDED: <capability>
<requisitos/escenarios nuevos>

## MODIFIED: <capability existente>
<qué cambia>

## REMOVED: <capability>
<qué se elimina y por qué>
```

En **Archive** estos deltas se integran en `docs/specs/` para que la spec viva refleje el estado actual.

---

## Enrutado de artefactos (dónde va cada cosa)

- **Decisión con su porqué** ("por qué X no obvio") → **`docs/adr/`** (formato Nygard, inmutable).
- **Definición de dominio / convención / gotcha** → **`docs/CONTEXT.md`**.
- **Regla visual del panel** → **`docs/DESIGN.md`**.
- **Comportamiento vivo del sistema** → **`docs/specs/`**.
- **Contexto de código efímero** → **descartar**.

Formato ADR (`docs/adr/NNNN-titulo.md`): `Estado` · `Fecha` · `Decisores`, y las secciones
`## Contexto` / `## Decisión` / `## Consecuencias`. Un ADR es inmutable: si la decisión cambia,
se crea uno nuevo que marca al viejo como *Reemplazado por ADR-XXXX*.

---

## Políticas siempre activas

### Commits

Todos los commits siguen [Conventional Commits](https://www.conventionalcommits.org/).

- **Idioma:** **todos** los mensajes (tipo, descripción, cuerpo, footer) se escriben **en inglés**. Sin excepciones.
- **Formato de la primera línea:** `<tipo>[ámbito opcional]: <descripción>`.
- **Tipos:** `feat` (funcionalidad), `fix` (bug), `docs` (solo documentación), `chore` (mantenimiento/tooling),
  `refactor` (sin cambio de comportamiento), `style` (formato), `test` (tests).
- **`Reviewed-by`:** todo commit incluye en el footer `Reviewed-by: <nombre> <email>` con los datos del
  usuario git que ejecuta (`git config user.name`, `git config user.email`).
- **Sin etiquetas del agente:** no añadir `Co-authored-by` de bots, `Generated-by`, `Agent:` ni similares.
  El historial refleja solo autores humanos + el `Reviewed-by`.
- **Antes del commit:** si hay cambios en el paquete sin versión cerrada, primero bump de `package.json` +
  entrada en `CHANGELOG.md` (ver *Versionado*), y después el commit.

### Versionado y release

- **Prerelease interna** mientras AstroBlocks no esté estabilizado ni en npm. Formato: **`0.x.y-alpha.N`**
  (`patch` para fixes/refinos/docs; `minor` para nuevas capacidades o cambios amplios de UX/flujo).
- **Cuándo:** **no** hagas bump ni toques `CHANGELOG` durante el desarrollo. Solo cuando el humano pida
  **cerrar/commit**: (1) incrementa `version` en `package.json`, (2) añade entrada en `CHANGELOG.md`,
  (3) commit, (4) tag `vX.Y.Z-alpha.N` (justo después del commit de release).
- **Checklist de cierre:** alcance terminado · actualizar `src/meta/features.json` · `npm run features:validate` ·
  `npm run typecheck` · `npm test` · si toca UI/README visual, `npm run screenshots:readme` · sin cambios
  incidentales en playgrounds/datos · actualizar el **badge de versión** del `README.md`.
- **CHANGELOG** ([Keep a Changelog](https://keepachangelog.com/en/1.0.0/)): entrada nueva al inicio,
  `## [X.Y.Z] - AAAA-MM-DD`, un `### Title` (frase corta, titula la GitHub Release), y bloques
  `### Added/Changed/Fixed/Removed`. Sin sección `[Unreleased]`; cambios solo-CI/infra no llevan entrada.
- **npm/tags:** al hacer push de un tag de versión, el workflow publica en npm y gestiona dist-tags
  (`latest`/`alpha`) y la GitHub Release.

### Copyright en archivos nuevos

Al crear cualquier archivo nuevo (código o doc), incluir al inicio el bloque de copyright BSL:
`/* ... */` en `.mjs/.js/.mts/.ts/.css/.astro` (en `.astro`, al inicio del **frontmatter**, no en el template);
comentario `<!-- ... -->` en `.md`. **No** en JSON. Al cambiar de año natural, actualizar el año en todos los bloques.

### Compatibilidad

Sin soporte a versiones antiguas: todo *breaking change* se implementa **sin fallback ni migración** —
el código maneja solo el formato/contrato nuevo y se documenta el cambio. (Decisión de arquitectura → `docs/adr/`.)

### Documentación

`README.md` es **100% consumidor** (características, requisitos, instalación, config, API en tablas). Notas de
build, playground, `npm pack` o mantenimiento van a `docs/DEVELOPING.md` / `docs/LOCAL_PACKAGE_TESTING.md`, nunca al README.

---

## Punteros

`docs/CONTEXT.md` · `docs/DESIGN.md` · `docs/DECISIONS.md` · `docs/adr/` · `docs/DEVELOPING.md` · `docs/LOCAL_PACKAGE_TESTING.md` · `README.md`