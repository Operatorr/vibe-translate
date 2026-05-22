# Model bench

Compares OpenRouter models for the app's AI tasks (translate / explain / dictation),
recording latency, token counts, throughput, and price. It exercises the **real**
provider functions — same prompts and strict-JSON schemas the app uses — so a model
that can't produce the required structured output shows as ❌.

## Run

```
pnpm bench
```

Reads `OPENROUTER_API_KEY` from the environment or `.dev.vars`. Prints a table and
saves a copy to `bench/results/` (gitignored). Makes real, paid OpenRouter calls,
which is why it's separate from `pnpm test`.

## Configure

Edit [`bench.toml`](./bench.toml). Up to 10 `[[combo]]` entries:

```toml
repeat = 1                 # runs per combo (latency/throughput averaged)

[[combo]]
task = "translate"         # translate | explain | dictation
model = "x-ai/grok-4.3"
reasoning = "low"          # none (disable) | minimal | low | medium | high; omit for model default
```

Up to 50 combos.

## Metrics

- **Latency** — wall-clock for the full provider call (network + reasoning + generation), averaged over `repeat`.
- **Prompt / Out tok** — prompt and completion tokens (completion includes reasoning tokens).
- **tok/s** — completion tokens ÷ latency (generation throughput).
- **Cost (USD)** — `prompt·price + completion·price` from OpenRouter's live per-token pricing; `n/a` if the model isn't listed.
