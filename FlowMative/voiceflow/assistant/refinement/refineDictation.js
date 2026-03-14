const { executePrompt } = require("../tools/toolSupport");

const REFINE_DICTATION_PROMPT = [
  "You are a writing assistant. Convert spoken dictation into clear, well-written text while preserving the original meaning.",
  "Detect the language of the user's dictation and return the refined text in that same language.",
  "Improve punctuation, capitalization, grammar, and phrasing without changing the user's intent.",
  "Do not translate unless the user explicitly asks for translation."
].join("\n");

async function refineDictation(text) {
  if (typeof text !== "string" || !text.trim()) {
    return "";
  }

  return executePrompt(text, {
    model: process.env.OPENAI_COMMAND_MODEL || "gpt-4o-mini",
    instructions: REFINE_DICTATION_PROMPT
  });
}

module.exports = {
  refineDictation
};
