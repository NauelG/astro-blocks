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
- **`docs/adr/`** — decisiones de arquitectura y su porqué (inmutables); `docs/DECISIONS.md` es su
  índice generado.
- **`docs/agents/definition-of-done.md`** — la barra de "hecho", única para todo el repo.
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
5. **Review.** Revisa el diff contra `spec-delta.md` y las convenciones de `docs/CONTEXT.md` / `docs/DESIGN.md`,
   y contra la barra de `docs/agents/definition-of-done.md` (§ *Every change*). La skill `review-change`
   ejecuta esos dos ejes en paralelo. Reporta problemas por severidad.
   → **GATE: el humano aprueba o pide cambios.**
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

**Los ADR se escriben en inglés** (ADR-0041): slug del fichero, título, cabecera, secciones y prosa.
Es la única excepción al principio de idioma de este documento — el resto de `docs/` sigue el idioma
del humano.

Formato ADR (`docs/adr/NNNN-english-slug.md`), con la numeración a **cuatro dígitos** y una serie única:

- Título `# NNNN — <decision>`.
- Cabecera: `- **Status:**` y `- **Date:** AAAA-MM-DD` (obligatorios, los parsea el índice),
  `- **Deciders:**` y `- **Source:**` (recomendados). Otras claves son libres.
- Secciones `## Context` / `## Decision` / `## Consequences`. No añadas una sección de evidencia del
  código actual: envejece hasta volverse falsa y es justo el contexto efímero que se descarta (ADR-0041).

Un ADR es **inmutable**: si la decisión cambia, se crea uno nuevo y el viejo pasa a
`Status: Superseded by [ADR-NNNN](./NNNN-….md)`. La inmutabilidad protege **la decisión, no la prosa**:
traducir, renombrar o normalizar cabeceras la preserva y no requiere superseder (ADR-0041). Tras crear
uno, `npm run adr:index` regenera `docs/DECISIONS.md`; CI falla si el índice no está al día.

**No cites decisiones por números que no vivan en `docs/adr/`.** Un `ADR-4` de un `design.md` de
cambio no es un ADR del proyecto: colisiona con la serie real y deja de resolverse en cuanto ese
documento desaparece. O apunta al ADR canónico, o enuncia la restricción en el propio comentario.

---

## Políticas siempre activas

### Commits

Todos los commits siguen [Conventional Commits](https://www.conventionalcommits.org/).

- **Idioma:** **todos** los mensajes (tipo, descripción, cuerpo, footer) se escriben **en inglés**. Sin excepciones.
- **Formato de la primera línea:** `<tipo>[ámbito opcional]: <descripción>`.
- **Tipos:** `feat` (funcionalidad), `fix` (bug), `docs` (solo documentación), `chore` (mantenimiento/tooling),
  `refactor` (sin cambio de comportamiento), `style` (formato), `test` (tests).
- **Sin footers de atribución:** ningún commit lleva `Reviewed-by`, `Co-authored-by`, `Generated-by`,
  `Agent:` ni etiqueta equivalente. El autor git ya identifica a quien firma; cualquier footer añadido
  o bien repite ese dato o bien introduce una traza de herramienta. El historial es humano y punto.
  (Los `tasks.md` archivados bajo `docs/changes/archive/` piden un footer `Reviewed-by`: son registro
  de la política vigente entonces, no se reescriben.)
- **Antes del commit:** pasa la barra de `docs/agents/definition-of-done.md` § *Every change*. El bump
  de `package.json` y la entrada en `CHANGELOG.md` **no** van aquí: pertenecen al cierre de release
  (ver *Versionado*), y solo cuando el humano lo pide.

### Versionado y release

- **SemVer estable** (`X.Y.Z`, publicado en npm): `patch` para fixes/refinos/docs; `minor` para nuevas
  capacidades o cambios amplios de UX/flujo; `major` para breaking changes. AstroBlocks ya salió de la
  fase `0.x.y-alpha.N`.
- **Cuándo:** **no** hagas bump ni toques `CHANGELOG` durante el desarrollo. Solo cuando el humano pida
  **cerrar/commit**: (1) incrementa `version` en `package.json`, (2) añade entrada en `CHANGELOG.md`,
  (3) commit, (4) tag **anotado** `vX.Y.Z` (justo después del commit de release):
  `git tag -a vX.Y.Z -m "vX.Y.Z"`. Siempre anotado, nunca ligero — `git push --follow-tags`
  solo empuja tags anotados.
- **Checklist de cierre:** en `docs/agents/definition-of-done.md` § *Closing a release*. Es la lista
  única; no la dupliques aquí ni en el PR template. El badge de versión del `README.md` ya no depende
  de que alguien se acuerde: `release-tag.yml` lo verifica contra `package.json` al validar el tag.
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

## Agent skills

### Issue tracker

Los issues viven en GitHub Issues (`NauelG/astro-blocks`, vía CLI `gh`); los PRs externos
**no** son superficie de triage. Ver `docs/agents/issue-tracker.md`.

### Triage labels

Vocabulario canónico sin mapeo: `needs-triage`, `needs-info`, `ready-for-agent`,
`ready-for-human`, `wontfix`. Ver `docs/agents/triage-labels.md`.

### Domain docs

Single-context; el `CONTEXT.md` vive en `docs/CONTEXT.md` (no en la raíz) y los ADRs en
`docs/adr/`. Ver `docs/agents/domain.md`.

### Skills al servicio del ciclo

**El ciclo de este documento manda; las skills lo sirven.** Ninguna skill redefine las fases,
los GATEs ni dónde viven los artefactos. Cada skill del set curado sirve a una fase o a una
política concreta:

| Fase / política | Skill | Qué aporta |
| --- | --- | --- |
| 1. Grilling | `grilling`, `grill-with-docs` | Interrogatorio hasta fijar alcance; la variante *with-docs* deja ADR y glosario por el camino. |
| 4. Implement | `tdd` | Disciplina red-green-refactor que la fase ya exige. |
| 5. Review | `review-change` | Dos ejes en paralelo: **Standards** = `docs/CONTEXT.md` + `docs/DESIGN.md`; **Spec** = el `spec-delta.md` del cambio. |
| Enrutado de artefactos | `domain-modeling` | Escribe `docs/CONTEXT.md` y los ADRs con el formato de este repo. |
| Triage | `triage` | Consume `docs/agents/issue-tracker.md` y `docs/agents/triage-labels.md`. |
| Documentación de agentes | `writing-for-agents` | Estilo obligatorio al editar este fichero o cualquier skill. |
| Post-ciclo | `retro` | Propone mejoras del entorno del agente, no del producto. |

**Skills deliberadamente excluidas.** `to-spec` e `implement-spec` traen un ciclo propio —
spec publicada como issue, tickets en grafo `blocked_by`, subagentes concurrentes en worktrees
y sin GATEs. Es incompatible con este ciclo en tres ejes: dónde vive la spec (`docs/changes/`,
no un issue), quién manda (GATE humano, no autonomía) y cuál es la unidad de trabajo (vertical
slice con TDD, no ticket del grafo). No se vendorizan y no se usan.

**Cómo se instalan.** `.agents/skills/` y `.claude/skills/` están gitignoreados: solo se trackea
el set curado, con el contenido real en `.agents/skills/<name>/` y un symlink en
`.claude/skills/<name>/` para que Claude Code lo vea. Las skills vendorizadas se copian verbatim
— conservan su frontmatter y licencia upstream y **no** llevan cabecera BSL. Para promover una
skill local al set curado: `git add -f .agents/skills/<name> .claude/skills/<name>`, más su
comando en `.opencode/command/<name>.md`. `skills-lock.json` es un fichero generado que registra
la procedencia; no se edita a mano.

---

## Punteros

`docs/CONTEXT.md` · `docs/DESIGN.md` · `docs/DECISIONS.md` · `docs/adr/` · `docs/agents/` · `docs/DEVELOPING.md` · `docs/LOCAL_PACKAGE_TESTING.md` · `README.md`