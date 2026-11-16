# 001 — Tooling: Biome (single tool)

Date: 2026-11-16. Status: accepted.

## Context

Phase 1 needs one linter/formatter (spec 01 §1.1: Biome **or** ESLint + Prettier).
The project brief is craft/minimal: few deps, fast CI, neutral style until Phase 3
decides on Tailwind.

## Options

1. **Biome (single binary: lint + format + organize imports).** One dep, zero
   plugin config, fast. Covers TS/JS/JSON/JSONC out of the box.
2. **ESLint + Prettier.** Two tools, plugin matrix (`eslint-config-*`,
   `eslint-plugin-astro`), slower, more config surface.

## Choice

Biome. Fewer deps fits the minimal brief; Astro/Svelte support is not needed in
Phase 1 (only `.astro`/`.ts`/`.json` touched; `.astro` files are out of scope
for Biome and checked by `astro check` instead).

## Consequences

- `pnpm check` = `astro check` + `biome check .` + `vitest run`.
- If Biome blocks editor/Svelte needs later (Phase 4 islands), switch to
  ESLint + Prettier via a new ADR.
