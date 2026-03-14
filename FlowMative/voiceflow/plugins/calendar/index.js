const { executePrompt } = require("../../assistant/tools/toolSupport");

async function execute(input, context) {
  return executePrompt(input, {
    context,
    instructions: [
      "You are the FlowMative calendar plugin.",
      "Help with meeting planning, event creation text, and scheduling assistance.",
      "Return a concise actionable result."
    ].join("\n")
  });
}

module.exports = {
  execute
};
