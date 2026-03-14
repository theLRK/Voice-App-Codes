const REFINEMENT_TRIGGER_PHRASES = [
  "plan",
  "explain",
  "describe",
  "write",
  "create",
  "summarize"
];

const SIMPLE_PUNCTUATION_PATTERN = /\b(comma|period|full stop|question mark|exclamation mark|colon|semicolon|quote|apostrophe|open quote|close quote|new line|newline|next line)\b/i;
const TERMINAL_PUNCTUATION_PATTERN = /[.!?]["')\]]?$/;
const STARTS_WITH_CAPITAL_PATTERN = /^[A-Z]/;

function countWords(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function containsTriggerPhrase(text) {
  const normalized = text.toLowerCase();
  return REFINEMENT_TRIGGER_PHRASES.some((phrase) => normalized.includes(phrase));
}

function appearsWellFormatted(text) {
  const trimmed = text.trim();

  if (!trimmed) {
    return false;
  }

  return STARTS_WITH_CAPITAL_PATTERN.test(trimmed) && TERMINAL_PUNCTUATION_PATTERN.test(trimmed);
}

function shouldRefine(text) {
  if (typeof text !== "string" || !text.trim()) {
    return false;
  }

  const trimmed = text.trim();
  const wordCount = countWords(trimmed);
  const hasTriggerPhrase = containsTriggerPhrase(trimmed);

  if (wordCount < 12) {
    return false;
  }

  if (SIMPLE_PUNCTUATION_PATTERN.test(trimmed)) {
    return false;
  }

  if (appearsWellFormatted(trimmed) && !hasTriggerPhrase) {
    return false;
  }

  return wordCount > 12 || hasTriggerPhrase;
}

module.exports = {
  shouldRefine
};
