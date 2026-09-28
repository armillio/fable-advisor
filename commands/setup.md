---
description: Configure routine, broad, complex and reviewer lanes, preserving existing choices.
allowed-tools: Bash, Read, Write, AskUserQuestion
---

Configure the four capability lanes; the parent Claude Code session model is **never** changed. Recommend **Claude Opus 5.5** as the session architect, but leave the user's selection alone.

1. Read `${CLAUDE_PLUGIN_ROOT}/config/models.json` and, if present, `~/.claude/fable-advisor/lanes.json`. Use `node "${CLAUDE_PLUGIN_ROOT}/scripts/resolve-lanes.mjs"` to display the effective choices before asking. A version-1 file without `broad` is valid: resolve that lane to the built-in `gemini-3.8-flash-medium` recommendation until the user opts to save version 2. Missing lanes use catalog defaults, but preserve any present custom model and effort. If JSON is invalid or an unknown future version, stop and ask the user rather than overwriting it.
2. Preflight both providers, without changing auth or global configuration:
   ```bash
   command -v codex && codex --version && codex login status
   command -v agy && agy --version
   ```
   An unavailable CLI or login/model-access error is a warning, **not** a reason to erase a choice. Codex setup remains `npm i -g @openai/codex && codex login`. For the broad lane, use Antigravity account sign-in: the user runs `agy` interactively if not signed in, and `agy models` lists supported slugs. Do not configure API keys, modify authentication, or save credentials in `lanes.json`. The old Gemini CLI is not a fallback.
   An existing explicit `broad.model: gemini-3.8-flash` is a legacy CLI slug. Keep it unchanged until the user confirms `gemini-3.8-flash-medium` (or another supported Gemini slug); explain that the wrapper otherwise returns `unavailable`. Never silently rewrite a custom model choice.
3. Ask for `routine`, `broad`, `complex`, and `reviewer` model choices from the catalog, recommended first. Allow a typed model ID. Keep an existing custom choice as the default rather than silently resetting it. `broad` is the Google-family Antigravity account lane; do not offer an OpenAI/Claude model for it without explaining that this plugin does not have a matching broad wrapper. Similarly keep implementer provider types compatible with their wrappers.
4. Ask for default effort only for `routine` and `complex`, using the selected catalog model's supported `efforts` and `default_effort`; preserve existing custom effort when valid. The Antigravity adapter uses its catalog model variant (Medium by default); do **not** invent a separate Gemini effort setting. If a typed Codex model has unknown efforts, retain the existing effort or the lane default and flag that compatibility is unverified.
5. If reviewer and implementer selections collapse to one model family, warn that the second opinion loses independence, and ask whether to keep it. Do not change the reviewer pin without explicit choice.
6. Write the four **confirmed** choices as JSON to a unique temporary file, then call `node "${CLAUDE_PLUGIN_ROOT}/scripts/save-lanes.mjs" "$CHOICES_FILE"` and remove that choices file. Do not manually rewrite `lanes.json`. The helper takes an exclusive lock before re-reading the existing file, merges the choices while preserving unrelated/unknown keys, sets `version` to `2`, validates JSON, writes a unique same-directory temporary file, backs up the previous valid config, and atomically renames into place. It refuses invalid or future-version input, leaving the original intact. A competing setup fails without writing; reread the current choices and reconfirm before retrying. SIGINT, SIGTERM, and SIGHUP clean up the owned lock and temporary file. SIGKILL, power loss, or a runtime crash cannot run cleanup: a leftover `lanes.json.lock` must not be removed automatically. Inspect its `owner.json` (PID, hostname, start time, and temporary-file path); on that host, confirm the original writer and any other setup have stopped. PID reuse or missing metadata is not proof of safety. Only then manually remove the recorded temporary file if present, `owner.json`, and the empty lock directory. Never delete `lanes.json` or backups. Reread and reconfirm choices before rerunning setup. Never point it at a user's real config during tests. Example confirmed choices shape:
   ```json
   {
     "version": 2,
     "routine": { "provider": "openai", "model": "gpt-6-luna", "effort": "max" },
     "broad": { "provider": "google", "model": "gemini-3.8-flash-medium" },
     "complex": { "provider": "openai", "model": "gpt-6-sol", "effort": "high" },
     "reviewer": { "provider": "anthropic", "model": "fable" }
   }
   ```
7. Confirm all four lane choices, show the config path, and state whether a version-1 backup was made. Mention any CLI/auth warning prominently. Setup does not invoke implementation and does not change the current session architect.
