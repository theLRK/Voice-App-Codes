const { executePrompt } = require("../../assistant/tools/toolSupport");

async function execute(input, context) {
  return executePrompt(input, {
    context,
    instructions: [
      "You are the FlowMative webSearch plugin.",
      "Help the user search for or research what they asked about.",
      "If live browsing is unavailable in this plugin, say what you would search for and provide a concise answer."
    ].join("\n")
  });
}

module.exports = {
  execute
};
