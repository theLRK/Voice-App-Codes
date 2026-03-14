const { executePrompt } = require("../assistant/tools/toolSupport");

async function connect() {
  return true;
}

async function execute(command, context) {
  return executePrompt(command, {
    context,
    instructions: [
      "You are the FlowMative Gmail integration.",
      "Draft polished email content from the user's spoken command.",
      "Keep formatting suitable for an email compose window."
    ].join("\n")
  });
}

module.exports = {
  connect,
  execute
};
