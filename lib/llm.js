// llm.js - Muse Spark via the Meta Model API (OpenAI-compatible)
//
// Used RARELY in this agent: only when a menu can't be handled by plain
// code scanning (scanned-image menu, awkward PDF). See RULES.md.
//
// API facts (verified 2026-10-23):
//   Endpoint: https://api.meta.ai/v1/chat/completions
//   Auth:     Authorization: Bearer <MODEL_API_KEY>   (key lives in .env.llm)
//   Model:    process.env.LLM_MODEL = muse-spark-1.3-contributor
//   Contributor tier = $0.10 / $0.20 per million in/out tokens, and Meta
//   may train on prompts/completions - so we only ever send PUBLIC menu
//   text here. Never keys, never private data.

// Reasoning effort: Sam chose MEDIUM (2026-10-23). The API accepts
// minimal / low / medium / high / xhigh; if omitted, the model picks its
// own depth (can be xhigh = expensive). Reasoning tokens bill at the
// OUTPUT rate, so medium keeps messy-menu calls cheap and fast.
// Override with LLM_EFFORT in .env.llm.
const DEFAULT_EFFORT = 'medium';

async function askLLM(prompt, apiKey, model, effort) {
  const res = await fetch('https://api.meta.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      reasoning_effort: effort || process.env.LLM_EFFORT || DEFAULT_EFFORT,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`LLM error ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
  }
  const text = data.choices && data.choices[0] && data.choices[0].message
    ? data.choices[0].message.content
    : '(empty response)';
  return { text, usage: data.usage || null };
}

// Tiny connection test - proves the key + model work, for a fraction of a cent.
async function testLLM(apiKey, model) {
  const { text, usage } = await askLLM(
    'Reply with exactly one word: ready',
    apiKey,
    model
  );
  return { text, usage };
}

module.exports = { askLLM, testLLM };
