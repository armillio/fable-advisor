# TODO — per-lane model selection follow-ups

Prototype shipped: `/fable-advisor:setup` + `~/.claude/fable-advisor/lanes.json`. Still open:

- [ ] **Additional provider lanes.** Gemini now handles the broad capability through an Antigravity account-backed CLI wrapper. A future Claude implementation lane or alternate provider still needs its own agent; never route a model to an incompatible wrapper.
- [ ] **Neutral role names.** Agent descriptions and the routing doctrine hardcode "GPT-6 Luna", "Fable 5.2", etc. Rename to roles ("routine implementer") and show the model only in delegation labels.
- [x] **OpenAI reviewer.** `astra-reviewer` (the `pr_review` lane) runs a read-only review through `scripts/codex-lane.sh`.
- [ ] **SessionStart first-run nudge.** Hook that detects a missing lanes.json and tells the orchestrator to suggest setup (hooks can't prompt).
- [ ] **Claude-side effort.** Claude agents take `/effort`, not a flag; decide how a pinned effort applies to Claude lanes.
- [ ] **Model catalog upkeep.** Refresh `config/models.json` each release; validate typed IDs (e.g. a cheap codex ping).
- [ ] **Per-project overrides.** Support a project-level lanes.json, but keep it out of shared repos by default (teammates may lack codex).
