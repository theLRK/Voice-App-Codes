const { executePrompt } = require("./toolSupport");

const SUMMARIZE_TOOL_PROMPT = [
  "You are the FlowMative summarize tool.",
  "Summarize the user's content clearly and accurately.",
  "Preserve the important points and remove repetition.",
  "Use short paragraphs or bullets only when they improve clarity."
].join("\n");

async function execute(input, context) {
  return executePrompt(input, {
    model: process.env.OPENAI_SUMMARIZE_MODEL || process.env.OPENAI_COMMAND_MODEL || "gpt-4o-mini",
    instructions: SUMMARIZE_TOOL_PROMPT,
    context
  });
}

module.exports = {
  execute
};
