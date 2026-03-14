const { executePrompt } = require("../tools/toolSupport");

const EDITING_PROMPT = [
  "You are the FlowMative inline text editor.",
  "You receive a user instruction and selected text from the active application.",
  "Rewrite the selected text according to the instruction.",
  "Preserve the original meaning unless the instruction clearly asks to shorten, summarize, expand, or formalize it.",
  "Return only the rewritten text."
].join("\n");

async function processEditingCommand(command, selectedText) {
  if (typeof command !== "string" || !command.trim()) {
    throw new Error("A non-empty editing command is required.");
  }

  if (typeof selectedText !== "string" || !selectedText.trim()) {
    throw new Error("Selected text is required for inline editing commands.");
  }

  return executePrompt(
    [
      `User instruction: ${command.trim()}`,
      "",
      `Text: ${selectedText.trim()}`,
      "",
      "Rewrite the text according to the instruction."
    ].join("\n"),
    {
      model: process.env.OPENAI_COMMAND_MODEL || "gpt-4o-mini",
      instructions: EDITING_PROMPT
    }
  );
}

module.exports = {
  processEditingCommand
};
