// llmJudge.js - the agent's JUDGMENT call for the ambiguous zone.
//
// Where this fits: the code rules (lib/classify.js) settle most menus
// cheaply and deterministically. They give up - UNKNOWN - when the
// menu text exists but carries no clean signal (awkward wording, a
// scanned-image PDF converted to messy text, a menu in another
// language's structure). That is precisely the case a rulebook cannot
// settle, and precisely where Sam's point applies: the AGENT should
// decide, instead of us writing one more rule for every edge case.
//
// So: when classification is UNKNOWN and menu text exists, runAgent
// may call judgeMenu() ONCE. The LLM (Muse Spark contributor - the
// same provider/key already wired in .env.llm) reads the menu and
// returns a verdict. The verdict is ADVISORY and bounded:
//   * It can only choose among vegetarian | both | vegan | null.
//   * It must cite the menu words that justify it (evidence).
//   * A failed call, a malformed reply, or a verdict with no cited
//     evidence all fall back to UNKNOWN - the human decides.
//   * It NEVER runs on the routine path (code already decided) and
//     NEVER sees keys, personal data, or anything but public menu text.
//
// Cost: only on UNKNOWN-with-menu cases, a few thousand tokens at
// contributor pricing - fractions of a cent per case. The call is
// skipped entirely when MODEL_API_KEY is missing.

const DEFAULT_MODEL = 'muse-spark-1.3-contributor';
const ENDPOINT = 'https://api.meta.ai/v1/chat/completions';

function truncate(text, max) {
  const t = String(text || '');
  return t.length > max ? t.slice(0, max) + '\n...[truncated]' : t;
}

async function judgeMenu({ name, menuText }) {
  const apiKey = process.env.MODEL_API_KEY;
  if (!apiKey) return { dietaryType: null, reason: 'LLM not configured (no MODEL_API_KEY).' };
  const model = process.env.LLM_MODEL || DEFAULT_MODEL;
  const effort = process.env.LLM_EFFORT || 'medium';

  const prompt =
    'You classify a restaurant menu for a Jain dining directory.\n' +
    'Jain = no meat, no fish, no chicken, AND no root vegetables.\n' +
    'Return JSON ONLY: {"dietaryType": "vegetarian"|"both"|"vegan"|null, "evidence": "short quote or menu words justifying it", "reason": "one line"}.\n' +
    '- "both" if the menu contains any meat/fish/seafood dish.\n' +
    '- "vegan" only if the menu is clearly all-plant (or the name says vegan).\n' +
    '- "vegetarian" only if the menu is clearly meat-free.\n' +
    '- null if the menu text is too messy, too short, or inconclusive.\n' +
    'Do NOT guess: null is the correct answer when unsure.\n\n' +
    'Restaurant: ' + String(name || '') + '\n' +
    'Menu text:\n' + truncate(menuText, 4000);

  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + apiKey,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
        reasoning_effort: effort,
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return { dietaryType: null, reason: 'LLM call failed (HTTP ' + res.status + ').' };
    const data = await res.json();
    const raw = data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content : '';
    const match = String(raw).match(/\{[\s\S]*\}/);
    if (!match) return { dietaryType: null, reason: 'LLM reply was not JSON.' };
    const parsed = JSON.parse(match[0]);
    const allowed = ['vegetarian', 'both', 'vegan', null];
    if (!allowed.includes(parsed.dietaryType)) {
      return { dietaryType: null, reason: 'LLM verdict outside the allowed set.' };
    }
    if (parsed.dietaryType && !parsed.evidence) {
      return { dietaryType: null, reason: 'LLM verdict cited no evidence - refused.' };
    }
    return {
      dietaryType: parsed.dietaryType,
      evidence: parsed.evidence || '',
      reason: parsed.reason || '',
    };
  } catch (err) {
    return { dietaryType: null, reason: 'LLM call error: ' + err.message };
  }
}

module.exports = { judgeMenu };
