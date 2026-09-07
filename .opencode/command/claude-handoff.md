---
description: Run the claude-handoff workflow.
---
<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

Create an OpenCode-native handoff for the current conversation. Write a concise summary that lets a fresh background `general` subagent continue immediately, then launch that subagent with the summary as its prompt.

Include the current goal, completed work, unresolved decisions, relevant paths and commands, and suggested skills. Do not duplicate existing artifacts; reference them by path or URL. Redact secrets and personally identifiable information.

$ARGUMENTS
