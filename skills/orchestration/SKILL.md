---
name: orchestration
description: Capability-based routing doctrine for a Claude Code session architect. Route routine implementation to Luna, broad-context implementation to Gemini, complex implementation to Sol, every completed deliverable to the read-only Fable advisor for clean-context final review, and every pull request to the read-only Astra reviewer before it opens. Use for decomposition, implementation delegation, escalation, verification, race mode, setup choices, and commitment-boundary consultation.
---

# Orchestration — the architect's routing doctrine

The session is the architect: it owns requirements, architecture, decomposition, specifications, routing, verification, and the final verdict. The user chooses its Claude model; **Opus 5.5 is recommended, not automatically selected**. The architect emits judgment and specs, not implementation volume. Delegate code to the cheapest adequate implementation capability, inspect the result, verify independently, and obtain a clean-context Fable review before reporting a deliverable done.

## Capability lanes

| Capability | Current producer | Invoke | Appropriate work |
|---|---|---|---|
| `routine` | GPT-6 Luna (`gpt-6-luna`, effort `max` by default) | `luna-implementer` | Fully specified, mechanical changes; straightforward features, wiring, CRUD, pattern-following tests. Default when the spec determines the answer. |
| `broad` | Gemini 3.8 Flash (`gemini-3.8-flash-medium`) | `gemini-implementer` | Broad repository context, frontend/UI or design-system consistency, pattern discovery or propagation across modules. Context-heavy but not unusually hard reasoning. |
| `complex` | GPT-6.1 Sol (`gpt-6.1-sol`, effort `high` by default) | `sol-implementer` | Difficult unresolved judgment; subtle concurrency, races, security/cryptography, high-risk migrations or data loss, hard sync semantics, or debugging that resisted a capable attempt. |
| `reviewer` | Fable 5.2 (`fable`) | `fable-advisor` | Read-only commitment-boundary advice and mandatory final review. Never implementation. |
| `pr_review` | GPT-6 Astra (`gpt-6-astra`, effort `high` by default) | `astra-reviewer` | Read-only cross-vendor review of the committed branch, once per round before a pull request opens. Never implementation. |

The broad wrapper invokes Antigravity CLI (`agy`) with the user's signed-in account, never an API-key fallback. Explicit legacy `gemini-3.8-flash` pins require a user-confirmed setup change to an Antigravity slug; do not silently remap them.

The wrappers are lightweight Claude subagents; the external model actually writes implementation. The Codex lanes (`routine`, `complex`, `pr_review`) all run through `scripts/codex-lane.sh`: it takes the model only from lane configuration, checks any effort override against the catalog, fixes the sandbox per lane, caps a run at 580 seconds to fit the Bash tool's 10-minute ceiling, and checks the result. The wrapper passes just the lane, an optional effort and the spec on stdin. A missing, unauthenticated, blocked, or unavailable provider is **not** permission to let the Claude wrapper type code or silently substitute a different model.

### Read user configuration

Before delegation, run the bundled read-only resolver (`node "${CLAUDE_PLUGIN_ROOT}/scripts/resolve-lanes.mjs"`) or read `~/.claude/fable-advisor/lanes.json` with equivalent rules. Version 1 remains valid: preserve its `routine`, `complex`, and `reviewer` choices and resolve a missing `broad` to the catalog's `gemini-3.8-flash-medium` recommendation. Version 2 adds `broad` and `pr_review`; missing individual keys use built-in defaults (`pr_review` resolves to `gpt-6-astra` at `high`). Do not rewrite user configuration as part of routing. Reject incompatible provider/model pairings rather than silently running a different CLI. Use the configured model and effort in the spec/delegation label, with the reviewer model passed to the Agent call. Suggest `/fable-advisor:setup` once if no file exists. Never assume a setup choice proves the CLI is authenticated or the model accessible.

### Four routing questions

1. How completely does the spec determine the correct implementation?
2. How much broad repository/context understanding is required?
3. How much unresolved difficult judgment remains?
4. How expensive would a wrong implementation be?

Fully specified + mechanical → `routine`. Broad context + UI/frontend or repository-wide pattern understanding → `broad`. Difficult reasoning + concurrency/security/migrations/high-risk debugging → `complex`. **Do not route by file count alone.** An architecture choice is owned by the architect, with `reviewer` consultation at the commitment boundary; it is not an implementation delegation.

### Escalation and failure classification

- `routine` failed for insufficient surrounding context → rewrite the spec as needed and route `broad`.
- `routine` had context but lacked difficult reasoning/judgment → route `complex`.
- `routine` exposed ambiguity or contradictory requirements → architect resolves and rewrites the spec before any retry.
- `broad` understood context but implementation/reasoning failed → route `complex` with evidence.
- `broad` exposed ambiguity → architect rewrites the spec. It exposed an architectural issue → architect owns the decision, optionally consulting `reviewer` at the commitment boundary.
- Two repeated failed attempts are evidence that classification, architecture, or spec may be wrong. Pause and diagnose rather than retrying the same prompt.
- `blocked` → surface the denial verbatim and let the user/architect decide; never reword a prompt, alter flags, or change execution mode to bypass it.
- `unavailable` or `timeout` → report it explicitly. Any different lane or model is an **announced architect decision**, not a silent fallback.

No implementation lane may expand scope or change architecture without returning that decision to the architect.

## Cost discipline and effort

Emit judgment, not volume: the architect writes specs and evaluates diffs, rather than typing boilerplate, tests, or fixes. Keep context lean by delegating broad read-only exploration where possible and bringing back conclusions, not full logs. Reason once, capture the decision in a complete spec, then hand off.

Codex lanes retain their existing effort contract. Luna defaults to `max` and supports `low`, `medium`, `high`, `xhigh`, `max`; Sol defaults to `high` and also supports `ultra`; Astra (`pr_review`) defaults to `high` and supports the same rungs as Sol. The spec's optional `REASONING: <effort>` overrides the default exactly; do not round unsupported rungs. Use low/medium for mechanical work, high/xhigh for interactions, max for truly hard work, and Sol's ultra only when worth its extra cost. The Antigravity adapter selects the Medium Gemini model variant by slug and has **no separate effort override**; do not translate Codex effort values. The architect and advisor inherit Claude session effort.

Label each delegation in the UI with the actual model (`GPT-6 Luna · max: ...`, `Gemini 3.8 Flash: ...`, `GPT-6.1 Sol · high: ...`, `Fable 5.2: final review`, `GPT-6 Astra · high: pre-PR review`), and announce the routing choice in one line. Retain the lane report's `LANE:` line when summarizing so the model that actually ran remains visible.

## Spec contract

Implementers share none of the conversation context. Every delegation carries objective, exact files, interfaces, constraints, verification command(s), and an optional `REASONING:` override for Codex only. Include model pin and relevant surrounding context explicitly. If the architect cannot finish the spec without leaving an architectural choice to the lane, make that choice first or consult the reviewer. An implementer must surface significant judgment calls rather than silently enlarging scope.

## Parallelism and opt-in race mode

Independent specs without shared files or ordering dependencies may run in parallel. For valuable or high-stakes comparisons, the architect may **opt in** to racing `routine` vs `broad`, `broad` vs `complex`, or `routine` vs `complex` on the same spec. Use isolated worktrees or otherwise non-overlapping working directories so candidates cannot overwrite each other. It is not the default for routine work, and the first finish is not the winner. The architect compares **actual diffs, independently executed verification, scope adherence, unnecessary complexity, judgment calls, architecture consistency, and test behavior**. It chooses a result or asks for revision; a runner's success claim is not the verdict.

## Verification and final review

Every implementation report is a claim until checked. The architect reads the actual diff and reruns or validates the verification command against the working tree. A model saying tests pass is not equivalent to independent execution. An empty implementation diff, failing verification, timeout, or blocked command cannot become `complete` merely because the model says so. Surface evidence and gaps in the report.

For every deliverable, the required order is:

```text
implementation → architect diff/evidence inspection → architect verification → fable-advisor clean-context final review → completion
  └─ when the deliverable ends in a pull request: commit → astra-reviewer → open the PR
```

Consult `fable-advisor` before architecture decisions, migrations, API shapes, major refactor strategies, and after two failed attempts. At the end, give it the stated goal, accumulated diff, constraints, and verification evidence. It returns ship / fix-first / rethink and remains read-only. Act on its verdict or surface disagreement. **Do not report done before this final review unless the user explicitly disables it.** The user may override the reviewer model in setup, but the default remains Fable 5.2; do not replace it merely because Opus 5.5 is recommended for the session architect.

## Pre-PR review

Every pull request gets one more gate after the Fable final review: GPT-6 Astra reviews the committed branch through `astra-reviewer`, in a read-only Codex sandbox.

- **Pass it** the repo path (absolute; the agent's cwd may be another checkout), the PR's base as a remote-qualified ref (`origin/main`, or `fork/main` when `origin` is upstream), a one- or two-line goal taken from the user's ask, and a `REASONING:` rung only when overriding `high` (raise it for security-sensitive paths, migrations or wide refactors).
- **Act on the verdict.** `fix-first` means at least one blocker or major. Those go back to the implementer lane as a corrected spec, get re-verified, and the branch is reviewed again. Minor findings are fixed or noted with a reason. Open the PR only on a `pass` for the branch's final commit, confirmed by its `REVIEWED:` SHA equalling `git rev-parse HEAD`: any change after a `pass`, minor fixes included, needs another review.
- **Two `fix-first` rounds, then stop** and surface the remaining findings to the user. Disagreement with a finding is surfaced the same way, never silently ignored.
- **Timeouts get one retry.** On `timeout`, re-run once at one rung lower effort (a run already at `low` retries at `low`) on the same full range; never pass a narrower range, since a partial review can't clear the whole PR. A second timeout stops the gate.
- **No PR without it.** `unavailable`, a second `timeout`, `failed` or `blocked` means the PR does not open; report the status and let the user decide.
- **Fable again only if the fixes grew.** Fixes that stay inside Astra's findings need re-verification, not a second Fable review; fixes that change behaviour beyond the findings go back through `fable-advisor` first.

Fable reads the diff against the goal in a clean context; Astra is a different vendor's frontier model reading the same branch, so the last gate before reviewers see the code is a cross-vendor one.

## Optional Codex plugin

When the official Codex plugin is installed, `/codex:adversarial-review` can precede the Fable final review for security-sensitive paths, migrations, or API changes; `/codex:review` is a lighter optional independent pass. `/codex:rescue` is a user-driven delegation path, not a replacement for these structured lane reports. `/codex:setup` can diagnose an unavailable Codex CLI. These commands add capabilities but are not required; keep the Fable review as the final gate.
