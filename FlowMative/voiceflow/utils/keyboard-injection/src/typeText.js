const robot = require("robotjs");

function getPasteModifier() {
  return process.platform === "darwin" ? "command" : "control";
}

async function typeText(text, options = {}) {
  if (typeof text !== "string") {
    throw new Error("typeText(text) expects a string.");
  }

  if (!text.length) {
    return "empty";
  }

  const clipboardApi = options.clipboard;

  if (clipboardApi && typeof clipboardApi.writeText === "function") {
    clipboardApi.writeText(text);
    await new Promise((resolve) => setTimeout(resolve, options.clipboardDelayMs || 90));
    robot.keyTap("v", getPasteModifier());
    await new Promise((resolve) => setTimeout(resolve, options.pasteDelayMs || 180));
    return "pasted";
  }

  const keyboardDelay = Number.isInteger(options.keyboardDelay) ? options.keyboardDelay : 10;
  robot.setKeyboardDelay(keyboardDelay);
  robot.typeString(text);
  return "typed";
}

module.exports = {
  typeText
};
