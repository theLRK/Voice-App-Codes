const FORMAT_REPLACEMENTS = [
  ["new paragraph", "\n\n"],
  ["question mark", "?"],
  ["exclamation mark", "!"],
  ["bullet point", "•"],
  ["new line", "\n"],
  ["semicolon", ";"],
  ["period", "."],
  ["comma", ","],
  ["colon", ":"]
];

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function processFormatting(text) {
  if (typeof text !== "string" || !text.trim()) {
    return "";
  }

  let formattedText = text.trim();

  for (const [phrase, replacement] of FORMAT_REPLACEMENTS) {
    const pattern = new RegExp(`\\b${escapeRegExp(phrase)}\\b`, "gi");
    formattedText = formattedText.replace(pattern, replacement);
  }

  formattedText = formattedText
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([,.;:!?])(?=\S)/g, "$1 ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  return formattedText;
}

module.exports = {
  processFormatting
};
