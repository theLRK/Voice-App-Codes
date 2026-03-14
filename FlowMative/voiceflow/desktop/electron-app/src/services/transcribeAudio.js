const fs = require("fs/promises");
const path = require("path");

async function transcribeAudio(filePath, options = {}) {
  const endpointBase = options.baseUrl || process.env.SPEECH_SERVICE_URL || "http://127.0.0.1:8000";
  const fileBuffer = await fs.readFile(filePath);
  const formData = new FormData();

  formData.append("file", new Blob([fileBuffer]), path.basename(filePath));

  if (options.language) {
    formData.append("language", options.language);
  }

  const response = await fetch(`${endpointBase.replace(/\/$/, "")}/transcribe`, {
    method: "POST",
    body: formData
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Transcription service returned ${response.status}: ${errorText}`);
  }

  const payload = await response.json();
  return typeof payload.transcript === "string" ? payload.transcript.trim() : "";
}

module.exports = {
  transcribeAudio
};
