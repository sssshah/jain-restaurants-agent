// runLog.js - the agent's audit trail (its observable memory).
//
// Every run appends ONE JSON line to runs.log.jsonl in the project root
// (gitignored): what was looked up, what the senses saw (menu status +
// URL), what the brain decided (classification + evidence + confidence),
// and the outcome. When something goes wrong later - like the Forno
// Rosso CSS-menu incident - the log shows exactly what the agent saw
// and decided, so the lesson can be found without screenshots.
//
// Learning loop for this agent: run -> log -> human reviews incidents
// -> fix code + add a regression test -> commit. The agent never edits
// its own rules; its "learning" is versioned, reviewed changes.

const fs = require('node:fs');
const path = require('node:path');

function logRun(entry) {
  try {
    const line = JSON.stringify({ t: new Date().toISOString(), ...entry }) + '\n';
    fs.appendFileSync(path.join(__dirname, '..', 'runs.log.jsonl'), line, 'utf8');
  } catch { /* logging must never break a run */ }
}

module.exports = { logRun };
