const PROMPT_TEMPLATE = [
  "Rewrite the following spoken text into clear written English.",
  "Remove filler words.",
  "Add punctuation.",
  "Keep the meaning."
].join("\n");

let clientPromise;

async function getOpenAIClient() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required to rewrite transcripts.");
  }

  if (!clientPromise) {
    clientPromise = import("openai").then(({ default: OpenAI }) => {
      return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    });
  }

  return clientPromise;
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

async function rewriteTranscript(transcript, options = {}) {
  if (typeof transcript !== "string" || !transcript.trim()) {
    throw new Error("A non-empty transcript is required.");
  }

  const client = await getOpenAIClient();
  const response = await client.responses.create({
    model: options.model || process.env.OPENAI_REWRITE_MODEL || "gpt-4o",
    instructions: options.instructions || PROMPT_TEMPLATE,
    input: `Input: ${transcript.trim()}`
  });

  const rewrittenText = extractOutputText(response);

  if (!rewrittenText) {
    throw new Error("OpenAI did not return rewritten text.");
  }

  return {
    originalTranscript: transcript.trim(),
    rewrittenText,
    responseId: response.id
  };
}

module.exports = {
  PROMPT_TEMPLATE,
  rewriteTranscript
};
