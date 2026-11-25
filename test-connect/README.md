# test-connect — verification suite for `yats connect` per agent

Verifies that what `yats connect --install <agent>` leaves in a repo **actually
works**: the agent loads the config, uses the YATS tools, and saves tokens.
Everything runs in Docker; the host is untouched (no CLIs installed, no
credentials modified — copies live in `homes/`, gitignored).

## Flow

```
indexed fixture → reset fixture → connect --install <agent> → run agent headless
                → transcript in results/ → score.py → scorecard ✅/❌
```

## Setup (one-time)

```bash
./test-connect/build-image.sh          # yats-agent-lab image (agent CLIs + this branch's yats)
./test-connect/bin/seed-auth.sh        # copy host credentials into homes/ (host untouched)
./test-connect/bin/prepare-fixture.sh  # copy ~/cosas/abs → fixture/abs-bench and index it
```

## Running a test

```bash
./test-connect/bin/run-agent.sh codex test-connect/questions/abs/01-cli-commands.md --with-yats
./test-connect/bin/run-agent.sh codex test-connect/questions/abs/01-cli-commands.md --without-yats
python3 test-connect/bin/score.py \
  test-connect/questions/abs/01-cli-commands.expects \
  test-connect/results/codex/01-cli-commands__with-yats.jsonl \
  test-connect/results/codex/01-cli-commands__without-yats.jsonl
```

The runner resets the fixture and reinstalls the connect config on every run
(`with-yats`) or leaves it clean (`without-yats`). The scorecard checks:
uses YATS / starts with `search_code` / passes `path=` / ≤4-call budget /
shell-web fallbacks / tokens / savings % / correct answer.

## Supported agents

| Agent | Lab model | Savings (q01, 2-run avg) | Status |
|---|---|---|---|
| claude | DeepSeek (BYOK via ANTHROPIC_BASE_URL) | 77.4% input tokens | ✅ green |
| codex | DeepSeek (custom provider) | 54.9% input tokens | ✅ green |
| copilot | DeepSeek (BYOK, no GitHub account) | n/a (BYOK reports no tokens) | ✅ green |
| pi (pi.dev) | DeepSeek (models.json custom provider) | 25.4% input tokens | ✅ green |
| gemini | gemini-flash-lite-latest (own key) | pending (free-tier quota) | ⏳ GEMINI_API_KEY needed in .env |
| cursor | account model (subscription pool) | — | ⏳ CURSOR_API_KEY needed in .env |

**pi.dev** is not installed in the image: its host npm bundle is bind-mounted
read-only (`PI_AGENT_DIR`, defaults to the pi-node install). Zero image growth.

## Model-independent runs: DeepSeek BYOK

A single DeepSeek key runs claude, codex, copilot and pi behind **the same
model**, isolating agent behaviour (not the LLM). No GitHub accounts or
Anthropic credits required.

```bash
cp test-connect/env.example test-connect/.env   # fill in DEEPSEEK_API_KEY
```

- claude  → `ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic`
- codex   → `deepseek` provider in `~/.codex/config.toml` (isolated home only)
- copilot → `COPILOT_PROVIDER_*` BYOK + `COPILOT_OFFLINE=true` (no GitHub account)
- pi      → custom provider in `~/.pi/agent/models.json`

gemini and cursor stay bound to their own models (own auth required: gemini via
Google AI Studio free key, cursor via `agent login` / cursor.com account).

## Agent-version catalog (agent+version → prompt/config)

`connect/catalog.json` (in `packages/yats-toolkit/connect/`) records, per agent,
version ranges → the templates that performed best, with the measured evidence
(date, exact version, model, matrix, result). `yats connect` detects the
installed CLI version, matches the range and applies those templates; with no
match or no detection it falls back to the defaults. E.g. codex < 0.172 uses
`[features].multi_agent`; 0.172+ uses `[agents].enabled = false`.

## Procedure: a new agent version ships

1. **Update the lab** — `./test-connect/build-image.sh` pulls the newest CLIs
   (pi is mounted from the host: `npm update -g` there if applicable).
2. **Check the new version** inside the container:
   `docker run --rm -u 1000:1000 yats-agent-lab:latest <cli> --version`
3. **Run the cell with multi-run** (and the baseline if it may have changed):
   ```bash
   YATS_TEST_RUNS=2 ./test-connect/bin/run-agent.sh <agent> test-connect/questions/abs/01-cli-commands.md --with-yats
   YATS_TEST_RUNS=2 ./test-connect/bin/run-agent.sh <agent> test-connect/questions/abs/01-cli-commands.md --without-yats
   ```
4. **Score** with `python3 test-connect/bin/score.py <expects> <transcripts...>`.
5. **Record the result in `connect/catalog.json`**:
   - All green → update the existing entry (`agentVersion`, `date`, `result`)
     or, if that version changed behaviour, add a new entry with its
     `since`/`until` range and the necessary `files` overrides.
   - Something fails → iterate the prompt/config for that entry (or create new
     variants) until green BEFORE recording.
6. **Repack and verify**: `./test-connect/build-image.sh`, then confirm
   `yats connect --install <agent>` shows the correct "Known-good" line for
   that version.
