# Fable Advisor evals

The harness checks **this plugin's orchestration behavior**, not general coding ability. It requires Node.js ≥ 18, Bash, Git, and standard Unix utilities (including `sed`, `grep`, `diff`, `cmp`, `cksum`, and `mktemp`). There are no npm package dependencies. Model-driven checks additionally require the provider CLIs being exercised.

- `npm run eval:static` — fast deterministic validation: manifests/frontmatter, four-lane catalog, no-fallback and reviewer invariants, version-1 resolution, plus Antigravity account-runner tests in disposable Git fixtures with isolated PATH/shims. Does not invoke a model or alter real Claude/Codex/Antigravity configuration.
- `npm run eval:behavior` — **opt-in and token-consuming** Claude Code decision checks. Requires `claude auth status` to show a login. Loads this checkout using the installed CLI's `--plugin-dir`, uses `--print --output-format json --json-schema` and plan permission mode, and asks for routing/escalation/verification/review decisions **without implementation**. It grades enum fields and event ordering, never exact prose. A missing login exits 2 as UNTESTED, not PASS.
- `npm run eval:all` — both tiers; do not put this on every install/update. Normal CI should run `eval:static`; behavioral runs belong in a dedicated, explicitly authorized workflow.

Set `FABLE_EVAL_REPEATS=2` or `3` for bounded repeated runs. Only integers 1–3 are accepted; invalid values fail before authentication/model calls. Every run is reported separately; there is no hidden majority-vote pass. Each case is capped at 3 minutes and $0.25.

Decision content and stderr are recursively redacted for known credential patterns and local home/plugin/temp paths before being saved or printed. Transcripts live in an OS temporary directory; their locations are printed for inspection. Redaction is best-effort, not a guarantee against arbitrary sensitive model output. Do not commit generated transcripts.

Static tests never rename/delete a real provider binary. Temporary shims exercise unavailable/auth/blocked/timeout/empty-diff/failing-verification/success outcomes, exit-0 soft denials, model mismatches, malformed events, API-key-mode refusal, and legacy-slug refusal. Regression tests cover configured models, literal verifier arguments, malformed config, concurrent setup writes, output redaction, and invalid repeat counts. The Codex missing-binary check uses an empty executable search path.

**Limitations:** Claude decision evals test the loaded doctrine and machine-readable decisions, not an end-to-end implementation/review event trace. The Gemini smoke test against the real model is separate and costs tokens; run it only in a disposable repository with a harmless file task, then inspect the diff and verification output. Provider/model access may differ across machines. If a case is flaky, keep failed run records and tighten the scenario/schema rather than relabeling it a pass.
