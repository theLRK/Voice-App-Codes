const robot = require("robotjs");

function typeText(text, options = {}) {
  if (typeof text !== "string") {
    throw new Error("typeText(text) expects a string.");
  }

  if (!text.length) {
    return;
  }

  const keyboardDelay = Number.isInteger(options.keyboardDelay) ? options.keyboardDelay : 10;
  robot.setKeyboardDelay(keyboardDelay);
  robot.typeString(text);
}

module.exports = {
  typeText
};
