# Fable Advisor

**Your session runs the show on whatever Claude model you like (Opus 5.5 recommended). Luna, Gemini, and Sol implement by capability; Fable 5.1 reviews before anything ships.**

<a href="https://github.com/DannyMac180/fable-advisor/raw/main/assets/fable-advisor-demo.mp4"><img src="assets/fable-advisor-demo-poster.png" alt="30-second demo of the v5 pattern: Fable 5.1 orchestrates, GPT-5.6 Luna implements, Fable 5.1 reviews" width="100%"></a>

<p align="center"><em>▶ 30s demo (v5) — orchestrator → Codex lane implements → Fable 5.1 reviews</em></p>

Claude Code lets every subagent run on a different model — and lets the session itself run on a different model than its subagents. This plugin exploits that with the **architect pattern**: your session — on whichever model you think is best — acts as a full-time architect. It owns requirements, decomposition, specs, and verification, routes every implementation task to the right lane, and gets a clean-context **Fable 5.1** review of the finished work before calling anything done:

| Lane | Producer | Invocation | Route here when |
|---|---|---|---|
| Routine | **GPT-6 Luna** (effort `max` by default) | `luna-implementer` agent (default) | The spec fully determines the outcome — Codex does the typing via the [Codex CLI](https://github.com/openai/codex) |
| Broad context | **Gemini 3.8 Flash** | `gemini-implementer` agent | Broad repository/design-system context or cross-module pattern discovery determines the work — Antigravity CLI uses your account to do the typing |
| High-complexity | **GPT-6 Sol** (effort `high` by default) | `sol-implementer` agent | One-off tasks where judgment the spec can't capture decides the outcome: subtle concurrency, hard debugging, security-sensitive paths, wide refactors |
| Review | **Fable 5.1** | `fable-advisor` agent | Commitment boundaries, and **always once at the end** — the advisor reviews the accumulated changes before the architect reports done |

**The Codex lanes have default reasoning efforts.** Luna runs at `max` and Sol at `high` unless the spec's `REASONING:` line overrides them (`low … max`, plus `ultra` on Sol). The Antigravity adapter pins the Medium model variant without a separate effort override. The session and advisor run at whatever `/effort` you set.

**You can see which model runs each step.** The orchestration skill labels every delegation with its model (`GPT-6 Luna · max: add pagination`, `Gemini 3.8 Flash: build dashboard`, `Fable 5.1: final review`), announces each routing decision in one line, and the agents carry distinct UI colours.

Tokens route by capability: the session emits judgment and specs; independent OpenAI/Google-family lanes emit code; Fable reviews. For high-stakes work, an architect may opt in to racing Luna vs Gemini, Gemini vs Sol, or Luna vs Sol in isolated worktrees, then compare actual diffs and verification rather than accepting the first finisher.

The plugin ships the **orchestration skill** — the routing doctrine that teaches the session when to use each lane and each effort rung, the cost discipline that keeps the session's token volume minimal (emit judgment not volume, keep context lean, reason once then hand off), the six-part spec contract that makes context-free delegation safe, the verification rules that keep every lane honest, and how to fold in the official [Codex plugin for Claude Code](https://github.com/openai/codex-plugin-cc) when it's installed.

## Go deeper

I write [**Attention Heads**](https://attentionheads.substack.com/?utm_source=github&utm_medium=readme&utm_campaign=fable-advisor) — deep, evidence-backed writing on AI, cognition, and agentic engineering. The **Agentic Engineering Field Notes** series is where I publish practical advice on the craft of using AI. [Subscribe](https://attentionheads.substack.com/subscribe?utm_source=github&utm_medium=readme&utm_campaign=fable-advisor) to get new posts to your inbox.

## Install

```
claude plugin marketplace add DannyMac180/fable-advisor
claude plugin install fable-advisor@fable-advisor
```

Updating an existing installation to the latest release:

```
claude plugin marketplace update fable-advisor
claude plugin update fable-advisor@fable-advisor
```

Then pick whichever model you want as the architect — the plugin doesn't choose it for you. The advisor is pinned to Fable 5.1 regardless.

**Lite mode — one file, 30 seconds.** Don't want the full pattern? Copy [`agents/fable-advisor.md`](agents/fable-advisor.md) into `~/.claude/agents/` and keep your session on Sonnet. You get advisor consults at commitment boundaries without the orchestration layer (see "Advisor-only mode" below).

## Requirements

- **Node.js ≥ 18** for the read-only lane resolver, safe setup migration helper, and lightweight eval scripts; Bash and Git for the Gemini runner's diff checks.
- **Claude Code ≥ 2.1.170** with a subscription that includes Fable 5.1 (Pro, Max, Team, or Enterprise — all current consumer plans qualify). The agents use the `fable` alias, which resolves to Fable 5.1.
- **No Fable access** (e.g. API-key billing)? Change `model: fable` → `model: opus` in `agents/fable-advisor.md`. Same pattern; the reviewer role shifts down to Opus.
- **Routine and complex lanes** need the [OpenAI Codex CLI](https://github.com/openai/codex) installed and authenticated (`npm i -g @openai/codex`, then `codex login`). Luna uses `gpt-6-luna` (default effort `max`); Sol uses `gpt-6-sol` (default effort `high`).
- **Broad lane** uses [Antigravity CLI](https://antigravity.google/docs/cli/install/) (`agy`) with your signed-in Google account, not an API key. Start `agy` interactively to sign in, then check `agy models`. The default is `gemini-3.8-flash-medium` (Gemini 3.8 Flash, Medium), verified with CLI 1.2.12. The adapter runs with `--sandbox --mode accept-edits` and does not auto-approve shell commands or change global permissions. A headless permission denial returns `blocked`, even if the CLI exits 0.
- Each unavailable lane fails loudly. The broad lane never falls back to the discontinued personal-login path in the old Gemini CLI, to API-key billing, or to another model. The architect must announce any different lane selection.
- **Migration from the initial Gemini CLI adapter:** if your version-2 config explicitly pins the old bare `gemini-3.8-flash`, rerun setup and confirm an Antigravity model slug. That choice is preserved until you change it; the runner reports `unavailable` instead of silently mapping it. Version-1 configs with no broad entry use the new built-in recommendation. The agent name and runner filename remain stable.
- **Optional: the [Codex plugin for Claude Code](https://github.com/openai/codex-plugin-cc)** (`/plugin marketplace add openai/codex-plugin-cc`, then `/plugin install codex@openai-codex`). When it's enabled, the orchestration skill uses `/codex:adversarial-review` as a GPT-family second reviewer ahead of the Fable review, `/codex:rescue` as a user-driven delegation path, and `/codex:setup` to diagnose a lane that reports `unavailable`. Not a dependency — the lanes drive `codex exec` directly either way.
- Heads-up: if a pinned Claude model isn't available on your account, Claude Code silently falls back to your session model — the pattern degrades quietly rather than erroring. If advisor verdicts feel unremarkable, check your plan. (This quiet fallback applies only to Claude model pins — the codex lanes always fail loudly with a structured error.)

Model resolution order in Claude Code: `CLAUDE_CODE_SUBAGENT_MODEL` env var → per-invocation `model` parameter → agent frontmatter → session model. **Don't set `CLAUDE_CODE_SUBAGENT_MODEL`** (check the `env` block of `~/.claude/settings.json` too): it overrides the advisor's `fable` pin, so your "Fable" review silently runs on another model. Effort resolution: `CLAUDE_CODE_EFFORT_LEVEL` env var → agent frontmatter `effort` → session `/effort`. None of this plugin's agents set a Claude `effort`, so the advisor follows your session; the codex lanes use their own defaults (Luna `max`, Sol `high`) unless the spec overrides them.

## Choose your lane models

Run `/fable-advisor:setup` once after installing. It configures four capability lanes: `routine` (Luna), `broad` (Gemini), `complex` (Sol), and `reviewer` (Fable). Codex efforts remain configurable; Gemini has no invented effort control. Choices live in `~/.claude/fable-advisor/lanes.json` (version 2). Existing version-1 files remain readable: their three choices stay intact and a missing `broad` resolves to built-in Gemini 3.8 Flash. Re-running setup migrates safely with a backup, preserving custom models. The model catalog is `config/models.json`. Setup recommends **Claude Opus 5.5 for the session architect** but never changes the current session.

## Use it

With the plugin installed, just ask for work — the orchestration skill routes it:

```
Add rate limiting to our public API. Design it, delegate the
implementation, and verify the evidence before you call it done.
```

The architect asks how specified the outcome is, how much broad context is needed, how much difficult judgment remains, and how costly a mistake would be. It picks a lane, reads the diff, independently verifies, sends the work to `fable-advisor` for clean-context final review, and only then reports done. Do not route by file count alone. A context failure in Luna suggests Gemini; a reasoning failure suggests Sol; ambiguity returns to the architect to rewrite the spec.

To make the doctrine always-on, add one line to your project's `CLAUDE.md`:

```
You are the architect — minimize your own token volume. Delegate all
implementation through the orchestration skill's routing table (never
type code yourself), label each delegation with its model, delegate broad
codebase exploration to cheap read-only agents, verify evidence before
accepting any lane's report, and get a fable-advisor review before
reporting any deliverable done.
```

## Commitment boundaries and the final review

Even the architect gets a second opinion. The `fable-advisor` agent is a read-only skeptic on Fable 5.1, working in a clean context. It's consulted before architecture decisions, migrations, API designs, whenever a problem has resisted two attempts, and **always once at the end of a deliverable**, where it reads the accumulated diff with fresh eyes, against the stated goal rather than the conversation, and returns ship / fix-first / rethink. It never implements. It sees the code fresh, without your conversation's accumulated assumptions — that context-clean skepticism is what the final review buys. For an independent-model review on top, the Codex plugin's `/codex:adversarial-review` slots in just before it.

## Behavioral evals

Run `npm run eval:static` for fast dependency-free catalog, agent, fallback, and verification checks. Run `npm run eval:behavior` explicitly for Claude Code routing/escalation/review decisions; it consumes model tokens and requires Claude Code authentication. `npm run eval:all` runs both. The runner loads this checkout with the locally supported `claude --plugin-dir . --print --output-format json` flags, asks for JSON routing decisions **without implementation**, grades observable fields rather than exact prose, and stores sanitized case transcripts only in a temporary directory. A failed/flaky case remains visible. See [`evals/README.md`](evals/README.md) for smoke tests and CI guidance. Static checks are suitable for normal CI; behavioral checks are opt-in.

## Advisor-only mode (the original pattern)

The minimal arrangement, for when you'd rather skip the orchestration layer: run the session on Sonnet and consult `fable-advisor` only at commitment boundaries.

```
Migrate our checkout sessions from Postgres to Redis — plan it,
consult your advisor before committing, then implement.
```

A typical consult costs cents. To make it automatic, add to your project's `CLAUDE.md`:

```
Before committing to any architecture decision, migration, or refactor
touching 3+ files, consult the fable-advisor agent and act on its verdict.
```

## FAQ

**Is this Anthropic's "advisor tool"?** No — that's a server-side API feature. These are plain Claude Code subagents plus a skill: readable, editable, no beta flags.

**Does this work on claude.ai?** No — subagent model routing is Claude Code only (CLI, desktop, VS Code, web).

**Why not just let Fable (or your session model) write the code too?** You can. Fable is excellent. It's also the most expensive model per token, and most of a session's tokens are implementation mechanics that the independent Codex/Antigravity lanes handle — from different vendors, which buys you a real second opinion. Spend the premium where it changes outcomes: the architecture and the final review.

**Upgrading from v5?** v6 stops telling you which model to run the session on: use whichever you think is best (I use Opus 5.5). The lanes move to GPT-6: **`codex-implementer` is renamed `luna-implementer`** and runs `gpt-6-luna`, and `sol-implementer` runs `gpt-6-sol`. Each lane now has a default effort (Luna `max`, Sol `high`), so the spec's `REASONING:` line is only needed to override it. Delegations are labelled with the model running them, and the agents have UI colours. Update anything (a `CLAUDE.md`, a script) that calls `codex-implementer` by name.

**Upgrading from v4?** v5 moves the session architect from Opus to **Fable 5.1**, replaces the Fable 5 `fable-implementer` lane with **`sol-implementer`** (GPT-5.6 Sol via Codex), and **unpins reasoning effort everywhere** — the architect names it per task in a new sixth spec line. The advisor is now Fable 5.1. The Codex plugin integration is new and optional. If you still want a Claude implementation lane, grab [`fable-implementer.md` from the v4.0 tree](https://github.com/DannyMac180/fable-advisor/blob/ad2bdc3/agents/fable-implementer.md).

**Upgrading from v3?** v4 moved the architect to Opus, removed the Grok 4.5 lane, and made `codex-implementer` the default typing lane; if you still want the Grok lane, grab [`grok-implementer.md` from the v3.1 tree](https://github.com/DannyMac180/fable-advisor/blob/b3b50a9/agents/grok-implementer.md).

**Why GPT lanes in a Claude plugin?** Vendor diversity. Models from one family share blind spots; an independent implementation from a different lineage catches what same-family review misses — and with Claude as the architect and reviewer, every diff gets cross-vendor review for free. The architect and reviewer stay Claude — the lanes are producers, not judges.

## License

MIT
