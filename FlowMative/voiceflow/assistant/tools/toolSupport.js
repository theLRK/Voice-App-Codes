let clientPromise;

async function getOpenAIClient() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required to run assistant tools.");
  }

  if (!clientPromise) {
    clientPromise = import("openai").then(({ default: OpenAI }) => {
      return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    });
  }

  return clientPromise;
}

function formatContextBlock(context) {
  const appName = context?.appName || "Unknown";
  const windowTitle = context?.windowTitle || "Unknown";
  const processPath = context?.processPath || "Unknown";

  return [
    "Active application context:",
    `- App name: ${appName}`,
    `- Window title: ${windowTitle}`,
    `- Process path: ${processPath}`
  ].join("\n");
}

function extractOutputText(response) {
  if (typeof response.output_text === "string" && response.output_text.trim()) {
    return response.output_text.trim();
  }

  if (!Array.isArray(response.output)) {
    return "";
  }

  return response.output
    .flatMap((item) => item.content || [])
    .filter((item) => item.type === "output_text" && typeof item.text === "string")
    .map((item) => item.text.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

async function executePrompt(input, options = {}) {
  if (typeof input !== "string" || !input.trim()) {
    throw new Error("A non-empty command input is required.");
  }

  const client = await getOpenAIClient();
  const combinedInput = options.context
    ? `${formatContextBlock(options.context)}\n\nUser request:\n${input.trim()}`
    : input.trim();
  const response = await client.responses.create({
    model: options.model || process.env.OPENAI_COMMAND_MODEL || "gpt-4o-mini",
    instructions: options.instructions,
    input: combinedInput
  });

  const outputText = extractOutputText(response);

  if (!outputText) {
    throw new Error("OpenAI did not return assistant output.");
  }

  return outputText;
}

module.exports = {
  executePrompt,
  extractOutputText,
  formatContextBlock,
  getOpenAIClient
};
