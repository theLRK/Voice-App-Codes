const { executePrompt } = require("./toolSupport");

const EMAIL_TOOL_PROMPT = [
  "You are the FlowMative email tool.",
  "Draft polished emails from short spoken requests.",
  "Infer a professional structure when details are missing.",
  "Include a subject line when it helps.",
  "Return only the email content."
].join("\n");

async function execute(input, context) {
  return executePrompt(input, {
    model: process.env.OPENAI_EMAIL_MODEL || process.env.OPENAI_COMMAND_MODEL || "gpt-4o-mini",
    instructions: EMAIL_TOOL_PROMPT,
    context
  });
}

module.exports = {
  execute
};
