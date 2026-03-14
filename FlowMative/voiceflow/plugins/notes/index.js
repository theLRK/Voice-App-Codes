const { executePrompt } = require("../../assistant/tools/toolSupport");

async function execute(input, context) {
  return executePrompt(input, {
    context,
    instructions: [
      "You are the FlowMative notes plugin.",
      "Turn spoken requests into clean notes or note-friendly summaries.",
      "Keep the output easy to paste into a notes app."
    ].join("\n")
  });
}

module.exports = {
  execute
};
