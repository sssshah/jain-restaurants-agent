# INCIDENTS.md - what this agent has learned the hard way

This file is the agent's long-term memory of mistakes. The agent itself
does NOT learn on its own: the loop (observe -> decide -> act) is not
learning. Learning here is a reviewed, versioned process:

1. A run goes wrong (or nearly does).
2. The run is in runs.log.jsonl - what the agent saw and decided.
3. A human finds the root cause and fixes the code.
4. A regression test is added to run-tests.js so the same mistake can
   never silently come back.
5. The incident is written up here, and everything is committed to git.

The agent never edits its own rules. Every "lesson" below arrived as a
code change a human reviewed - that is what makes the learning safe to
trust on a public directory.

---

## 2026-10-23 - Forno Rosso: a CSS file was read as the menu (first live submit)

**What happened:** The agent's first real end-to-end submit added
Forno Rosso (Chicago, Randolph St) to the live directory classified as
Pure Veg (`vegetarian`). Forno Rosso serves meat; the correct class is
Mixed (`both`). The site owner corrected the row by hand in Supabase.

**Root cause:** `lib/menuFetch.js` accepted any homepage link whose URL
contained the letters "menu" and any fetched text over 400 characters.
The restaurant's Wix site links a stylesheet named
`.../rb_werbolt[DropDownMenu_OverlineMenuButtonSkin]....min.css` -
"DropDownMenu" matched, 2,889 characters of CSS code were treated as
menu text, the code contained no meat words, and the classifier's
Pure Veg rule fired on a stray vegetarian signal.

**Fixes (all in code, same day):**
- Menu candidates must be real pages: file extensions AND content-type
  reject CSS/JS/images; "menu" must be an actual URL path segment.
- Fetched text must LOOK like a menu (food words / prices) before it
  counts as one - otherwise the agent honestly reports "no menu found"
  and classification stops at UNKNOWN for a human.
- Pure Veg now requires vegetarian evidence in the menu text itself;
  Google place types no longer count toward it.
- Italian cured meats (prosciutto, salami, mortadella, pancetta, ...)
  added to the meat scan.

**Regression tests:** `run-tests.js` - the CSS URL, code-text, and
classification cases from this incident run on every test pass.

**Lesson:** the loop worked end to end; one sloppy assumption in one
"sense" (the menu fetcher) poisoned a downstream decision. Verify what
each sense actually captured before trusting what the brain concludes.
