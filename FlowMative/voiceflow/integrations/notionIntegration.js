const { executePrompt } = require("../assistant/tools/toolSupport");

async function connect() {
  return true;
}

async function execute(command, context) {
  return executePrompt(command, {
    context,
    instructions: [
      "You are the FlowMative Notion integration.",
      "Draft or transform text for Notion pages and notes.",
      "Prefer clear structure and concise headings when useful."
    ].join("\n")
  });
}

module.exports = {
  connect,
  execute
};
