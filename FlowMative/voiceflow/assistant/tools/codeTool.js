const { executePrompt } = require("./toolSupport");

const CODE_TOOL_PROMPT = [
  "You are the FlowMative code tool.",
  "Help with coding, programming, debugging, and function-writing requests.",
  "Prefer runnable examples.",
  "Keep explanations concise unless the user asks for more detail."
].join("\n");

async function execute(input, context) {
  return executePrompt(input, {
    model: process.env.OPENAI_CODE_MODEL || process.env.OPENAI_COMMAND_MODEL || "gpt-4o-mini",
    instructions: CODE_TOOL_PROMPT,
    context
  });
}

module.exports = {
  execute
};
