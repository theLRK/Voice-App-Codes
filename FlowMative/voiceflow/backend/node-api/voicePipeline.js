const fs = require("fs");
const https = require("https");
const os = require("os");
const path = require("path");
const { GlobalKeyboardListener } = require("node-global-key-listener");
const { recordAudio, DEFAULT_OUTPUT_PATH } = require("./record");
const { transcribeAudio } = require("./transcribeAudio");

const PACKAGE_KEY_SERVER_PATH = path.join(
  path.dirname(require.resolve("node-global-key-listener/package.json")),
  "bin",
  "WinKeyServer.exe"
);
const RUNTIME_KEY_SERVER_DIR = path.join(os.tmpdir(), "flowmative");
const RUNTIME_KEY_SERVER_PATH = path.join(RUNTIME_KEY_SERVER_DIR, "WinKeyServer.exe");
const KEY_SERVER_DOWNLOAD_URL = "https://unpkg.com/node-global-key-listener@0.3.0/bin/WinKeyServer.exe";

let keyboard = null;
let recordingSession = null;
let spaceHeld = false;
let processing = false;

function downloadFile(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      if (
        response.statusCode &&
        response.statusCode >= 300 &&
        response.statusCode < 400 &&
        response.headers.location
      ) {
        response.resume();
        downloadFile(response.headers.location).then(resolve).catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download WinKeyServer.exe: HTTP ${response.statusCode}`));
        return;
      }

      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve(Buffer.concat(chunks)));
      response.on("error", reject);
    }).on("error", reject);
  });
}

async function ensureKeyboardListenerAvailable() {
  if (process.platform !== "win32") {
    return null;
  }

  if (fs.existsSync(PACKAGE_KEY_SERVER_PATH)) {
    return PACKAGE_KEY_SERVER_PATH;
  }

  if (fs.existsSync(RUNTIME_KEY_SERVER_PATH)) {
    return RUNTIME_KEY_SERVER_PATH;
  }

  fs.mkdirSync(RUNTIME_KEY_SERVER_DIR, { recursive: true });
  const executable = await downloadFile(KEY_SERVER_DOWNLOAD_URL);
  fs.writeFileSync(RUNTIME_KEY_SERVER_PATH, executable);
  return RUNTIME_KEY_SERVER_PATH;
}

function formatPipelineError(error) {
  const message = error instanceof Error ? error.message : String(error || "");

  if (message.includes("SoX not found")) {
    return "SoX not found. Please install SoX and ensure it is in PATH.";
  }

  if (
    message.includes("no default audio device configured") ||
    message.includes("WaveAudio") ||
    message.includes("waveaudio") ||
    message.includes("audio device")
  ) {
    return "Microphone not accessible. Check your Windows input device and microphone permissions.";
  }

  if (
    message.includes("virus or potentially unwanted software") ||
    message.includes("Operation did not complete successfully") ||
    message.includes("spawn UNKNOWN")
  ) {
    return "Windows blocked the global keyboard helper. Allow WinKeyServer.exe in Windows Security, then run the pipeline again.";
  }

  if (message.includes("Failed to download WinKeyServer.exe")) {
    return message;
  }

  if (message.includes("Transcription service is not reachable")) {
    return message;
  }

  return message || "Voice pipeline failed.";
}

async function startPushToTalk() {
  if (recordingSession || processing) {
    return;
  }

  try {
    recordingSession = await recordAudio({ manualStop: true });

    if (!spaceHeld && recordingSession) {
      await stopAndTranscribe();
    }
  } catch (error) {
    console.error(formatPipelineError(error));
    recordingSession = null;
  }
}

async function stopAndTranscribe() {
  if (!recordingSession || processing) {
    return;
  }

  processing = true;
  const session = recordingSession;
  recordingSession = null;

  try {
    const audioFilePath = await session.stop();
    console.log("Processing transcription...");

    const startedAt = process.hrtime.bigint();
    const transcript = await transcribeAudio(audioFilePath || DEFAULT_OUTPUT_PATH, {
      logTranscript: false
    });
    const elapsedSeconds = Number(process.hrtime.bigint() - startedAt) / 1e9;

    console.log(`Transcript: ${transcript}`);
    console.log(`Transcription time: ${elapsedSeconds.toFixed(1)} seconds`);
  } catch (error) {
    console.error(formatPipelineError(error));
  } finally {
    processing = false;
  }
}

function handleKeyEvent(event) {
  if (event.name !== "SPACE") {
    return;
  }

  if (event.state === "DOWN") {
    if (spaceHeld) {
      return;
    }

    spaceHeld = true;
    void startPushToTalk();
    return;
  }

  if (event.state === "UP") {
    spaceHeld = false;
    void stopAndTranscribe();
  }
}

async function runVoicePipeline() {
  const keyServerPath = await ensureKeyboardListenerAvailable();

  keyboard = new GlobalKeyboardListener({
    windows: {
      serverPath: keyServerPath,
      onError: () => {
        console.error(
          "Global keyboard listener failed to start. Try reinstalling node-global-key-listener or restarting the terminal."
        );
      }
    }
  });

  await keyboard.addListener(handleKeyEvent);
  console.log("Hold SPACE to record. Release SPACE to transcribe. Press Ctrl+C to exit.");
}

process.on("SIGINT", async () => {
  if (keyboard) {
    keyboard.kill();
  }
  if (recordingSession) {
    try {
      await recordingSession.stop();
    } catch (error) {
      console.error(formatPipelineError(error));
    }
  }
  process.exit(0);
});

runVoicePipeline().catch((error) => {
  console.error(formatPipelineError(error));
  process.exitCode = 1;
});
