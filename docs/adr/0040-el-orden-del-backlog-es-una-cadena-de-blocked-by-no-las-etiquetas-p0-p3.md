<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# 0040 — El orden del backlog es una cadena de `blocked_by`, no las etiquetas `P0`–`P3`

- **Status:** Accepted — 2026-09-07
- **Date:** 2026-09-07
- **Decisores:** Nauel Gómez

## Contexto

El repo ya tiene etiquetas de prioridad `P0`–`P3` y un vocabulario de triage de cinco roles
(`docs/agents/triage-labels.md`). Ninguno de los dos responde la pregunta que un agente hace al
empezar una sesión: **¿qué toca ahora?**

Una etiqueta de prioridad clasifica en cubos, no ordena. Cuatro issues marcados `P1` no dicen cuál se
coge primero, y el desempate acaba siendo criterio del agente — que es exactamente la decisión que no
queremos delegarle. Peor: el cubo no captura dependencias reales. Un `P2` que desbloquea a tres `P1`
debería ir antes, y la etiqueta no tiene forma de decirlo.

Las alternativas consideradas fueron tres. Un **issue de "orden del backlog"** con una lista: se
convierte en un documento que hay que reescribir entero cada vez que entra trabajo nuevo, y que
diverge en silencio del estado real de los issues. **GitHub Projects**: introduce una superficie
fuera de `gh issue`, no versionada, que los agentes no pueden consultar con una sola llamada.
**Más granularidad de etiquetas** (`P0`…`P9`): traslada el problema, no lo resuelve.

GitHub tiene **dependencias nativas entre issues** (`blocked_by`), visibles en la UI y consultables
en una llamada. El repo ya las usa para `/wayfinder` (`docs/agents/issue-tracker.md`).

## Decisión

El orden de ejecución del backlog es una **cadena serial de aristas `blocked_by` nativas** entre los
propios issues. El siguiente elemento de trabajo es la única consulta de frontera: un issue
`ready-for-agent` cuyo `issue_dependencies_summary.blocked_by` sea `0`.

`P0`–`P3` se conservan y cambian de rol explícitamente: expresan **cuánto importa algo**, un juicio
humano que informa cómo el mantenedor cablea la cadena. No son un orden ejecutable, no lo sobrescriben
y el triage nunca los usa para reordenar.

Como la consulta de frontera se apoya en `ready-for-agent`, la exclusión mutua entre `needs-info` y
`ready-for-agent` deja de ser higiene y pasa a ser un requisito de corrección: un issue con ambas
etiquetas pasa la consulta siendo inejecutable, y el grafo sigue pareciendo sano. Queda documentada
en `docs/agents/triage-labels.md`.

## Consecuencias

- "¿Qué toca ahora?" tiene **una** respuesta, obtenida con una llamada por candidato, sin releer el
  backlog ni interpretar cubos de prioridad.
- Insertar trabajo a mitad de cadena cuesta dos `gh api POST` (repuntar dos aristas), no reescribir un
  documento de orden.
- El coste se paga al cablear: cada issue nuevo que entre en el backlog necesita su arista. Un issue
  sin arista queda fuera del orden y la consulta de frontera puede devolver más de un candidato — es
  la señal de que falta cableado, no de que el mecanismo falle.
- La cadena solo es fiable si la disciplina de etiquetas se mantiene. Es una dependencia real entre
  dos convenciones que antes eran independientes.
- El criterio se importa del repo hermano `renyst-app`, que llegó a él por la vía cara: un pase masivo
  de etiquetas dejó su backlog entero inejecutable sin que ninguna consulta lo delatara. Aquí se
  adopta antes de tener el incidente.
