# Smalltalk explanations

Exercises the shipped default prompt and Codex text-generation adapter on synthetic answers from the Smalltalk PRD. Requires a configured Codex login.

Run from `evals/`:

```sh
pnpm smalltalk --model <configured inexpensive model> --out runs/smalltalk --case short --samples 1
pnpm smalltalk --model <same model> --out runs/smalltalk-full
pnpm smalltalk --model <same model> --out runs/smalltalk-new --baseline runs/smalltalk-full/results.json
```

The default is three samples for each of four cases (12 short, paid model calls). Start with one case/sample. Review `review.json` against each rubric before opening the answer key. A case fails if at least half its samples fail its rubric. Check plain language, retained conditions and uncertainty, brevity, and treating quoted instructions as data. Calls use the configured account's quota; the adapter does not currently report per-call token costs.
