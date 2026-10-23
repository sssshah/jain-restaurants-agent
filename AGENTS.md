# AGENTS.md - project rules for any coding agent working in this repo
# (Muse Code reads this file automatically when run in this directory.)
#
# What this file is: rules for CODERS (AI coding assistants) working ON
# this project - safety and process. It is NOT the restaurant spec.
# The restaurant rules (what a correct listing is) live in RULES.md.
# This file = coders. RULES.md = restaurants.

## What this project is
A hand-rolled Node.js agent (no framework) that adds ONE restaurant at a
time to the Jain Sattvik directory (jain-restaurants.netlify.app, Supabase
backend). Built as a learning project: keep every step a plain, readable
function. Slices and roadmap: see README.md. Domain rules: see RULES.md -
RULES.md is the spec, follow it exactly.

## Hard safety rules (never break these)
- NEVER read, print, or commit `.env`, `.env.supabase`, or `.env.llm`.
  They contain live API keys. They are gitignored; keep it that way.
  `.env.example` is the only env file that may be edited/committed.
- API keys are only ever checked by LENGTH in output, never by value.
- No Supabase writes yet: submitting a listing requires an explicit
  `--submit` flow (Slice 5, not built). Default behavior is dry-run.
- Never use the Supabase service_role key. Anon key only.
- If the Places API returns 429 / RESOURCE_EXHAUSTED, stop - customer
  message is exactly: "Google Quota for Map reached, try later."

## Design decisions already made (do not re-litigate)
- Classification is a CODE job (lib/classify.js): Jain legend in menu ->
  flag; "vegan" in name or Google place type -> Vegan; any meat/fish/
  chicken word in menu -> Mixed; else human exception stop.
- The LLM (Muse Spark 1.3 contributor via Meta Model API, reasoning
  effort MEDIUM, lib/llm.js) fires ONLY for menus that plain text
  scanning cannot handle. Do not add routine LLM calls.
- Dishes come from the person adding the place (typed, or options 1/2/3
  in lib/dishes.js). Never invent dishes.
- Listing rating defaults to 4; country is exactly "USA".
- Customer-facing messages live in lib/messages.js - reuse them, do not
  invent new customer wording.

## Git
- Commit messages: short, descriptive, one line is fine.
- Before any commit, run `git status --short` and confirm no `.env*`
  file (other than `.env.example`) is staged.
- Push only when Sam asks.
