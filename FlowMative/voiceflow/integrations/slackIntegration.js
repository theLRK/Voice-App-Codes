const { executePrompt } = require("../assistant/tools/toolSupport");

async function connect() {
  return true;
}

async function execute(command, context) {
  return executePrompt(command, {
    context,
    instructions: [
      "You are the FlowMative Slack integration.",
      "Draft concise Slack-ready replies or messages.",
      "Keep the tone conversational and direct."
    ].join("\n")
  });
}

module.exports = {
  connect,
  execute
};
