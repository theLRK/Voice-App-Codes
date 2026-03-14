const fs = require("fs");
const path = require("path");
const robot = require("robotjs");
const {
  app,
  BrowserWindow,
  clipboard,
  globalShortcut,
  ipcMain,
  Menu,
  screen
} = require("electron");
const { Tray } = require("electron");
const { uIOhook, UiohookKey } = require("uiohook-napi");

const { recordAudio, DEFAULT_OUTPUT_PATH } = require("../../../backend/node-api/record");
const {
  transcribeAudio,
  createStreamingTranscriber
} = require("../../../backend/node-api/transcribeAudio");
const {
  ensureSpeechServiceRunning,
  stopManagedSpeechService
} = require("../../../backend/serviceManager");
const { processFormatting } = require("../../../assistant/formatting/formatProcessor");
const {
  getSettings,
  updateSetting
} = require("../../../assistant/settings/settingsManager");
const {
  clearMemory,
  deleteHistoryEntry,
  getConversationHistory
} = require("../../../assistant/memory/memoryManager");
const {
  addMacro,
  deleteMacro,
  getMacros
} = require("../../../assistant/macros/macroManager");
const {
  routeCommand,
  isFollowUpCommand,
  shouldUseSelectedText
} = require("../../../assistant/router/commandRouter");
const { refineDictation } = require("../../../assistant/refinement/refineDictation");
const { shouldRefine } = require("../../../assistant/refinement/refinementDecision");

let overlayWindow = null;
let bubbleWindow = null;
let historyWindow = null;
let settingsWindow = null;
let tray = null;
let recordingSession = null;
let processing = false;
let pushToTalkHeld = false;
let assistantEnabled = true;
let hookStarted = false;
let isQuitting = false;
let ctrlHeld = false;
let altHeld = false;
let shortcutRegistered = false;
let registeredShortcut = null;
let currentSettings = getSettings();
const TRAY_ICON_PATH = path.join(__dirname, "..", "assets", "tray.png");
const OVERLAY_WINDOW_WIDTH = 400;
const OVERLAY_WINDOW_HEIGHT = 200;
const OVERLAY_MARGIN = 20;
const OVERLAY_HIDE_DELAY_MS = 1500;
const BUBBLE_WINDOW_WIDTH = 120;
const BUBBLE_WINDOW_HEIGHT = 120;
const BUBBLE_MARGIN = 28;
const BUBBLE_HIDE_DELAY_MS = 220;
const COMMAND_PREFIXES = [
  "write",
  "create",
  "generate",
  "summarize",
  "summary",
  "explain",
  "draft",
  "code",
  "build",
  "email",
  "program",
  "function"
];

function mapSpeechModel(settingValue) {
  return settingValue === "whisper-small" ? "small" : "base";
}

function applyRuntimeSettings(settings) {
  currentSettings = { ...settings };
  process.env.OPENAI_COMMAND_MODEL = currentSettings.commandModel;
  process.env.WHISPER_MODEL_SIZE = mapSpeechModel(currentSettings.speechModel);
}

function syncLoginItemSettings(settings = currentSettings) {
  app.setLoginItemSettings({
    openAtLogin: settings.startOnLogin !== false,
    path: process.execPath
  });
}

function getPushToTalkKey() {
  return currentSettings.pushToTalkKey || "Ctrl+Space";
}

function getTypingDelay() {
  switch (currentSettings.typingSpeed) {
    case "slow":
      return 60;
    case "fast":
      return 0;
    default:
      return 10;
  }
}

function normalizeLanguageHint(language) {
  if (typeof language !== "string" || !language.trim()) {
    return null;
  }

  const primarySubtag = language.trim().replace(/_/g, "-").split("-")[0].toLowerCase();
  return /^[a-z]{2,3}$/.test(primarySubtag) ? primarySubtag : null;
}

function getPreferredTranscriptionLanguage() {
  const envLanguage = normalizeLanguageHint(process.env.FLOWMATIVE_TRANSCRIPTION_LANGUAGE);

  if (envLanguage) {
    return envLanguage;
  }

  return normalizeLanguageHint(app.getLocale());
}

function logCaptureDiagnostics(captureDiagnostics, audioFilePath, audioFileSize) {
  if (!captureDiagnostics) {
    return;
  }

  console.log("Capture diagnostics:", JSON.stringify({
    audioFilePath,
    audioFileSize,
    config: captureDiagnostics.config,
    durationSeconds: captureDiagnostics.durationSeconds,
    speechDurationSeconds: captureDiagnostics.speechDurationSeconds,
    speechRatio: captureDiagnostics.speechRatio,
    averageRms: captureDiagnostics.averageRms,
    peak: captureDiagnostics.peak,
    speechSegmentCount: captureDiagnostics.speechSegmentCount,
    speechSegments: captureDiagnostics.speechSegments
  }));
}

function logTranscriptionDiagnostics(diagnostics) {
  if (!diagnostics) {
    return;
  }

  console.log("Transcription diagnostics:", JSON.stringify({
    requestLabel: diagnostics.requestLabel,
    language: diagnostics.language,
    languageProbability: diagnostics.languageProbability,
    confidence: diagnostics.confidence,
    avgLogProb: diagnostics.avgLogProb,
    noSpeechProbability: diagnostics.noSpeechProbability,
    durationSeconds: diagnostics.durationSeconds,
    speechDurationSeconds: diagnostics.speechDurationSeconds,
    speechRatio: diagnostics.speechRatio,
    segmentCount: diagnostics.segmentCount,
    audio: diagnostics.audio,
    segments: diagnostics.segments
  }));
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function shortcutUsesModifier(shortcut, modifier) {
  return shortcut.split("+").map((part) => part.trim().toLowerCase()).includes(modifier);
}

const overlayState = {
  state: "Ready",
  transcript: "",
  action: ""
};
let bubbleState = "Idle";
let overlayHideTimer = null;
let bubbleHideTimer = null;

function sendOverlayEvent(channel, payload) {
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    return;
  }

  overlayWindow.webContents.send(channel, payload);
}

function syncOverlay() {
  sendOverlayEvent("assistant-state", overlayState.state);
  sendOverlayEvent("assistant-transcript", overlayState.transcript);
  sendOverlayEvent("assistant-action", overlayState.action);
}

function sendBubbleState() {
  if (!bubbleWindow || bubbleWindow.isDestroyed()) {
    return;
  }

  switch (bubbleState) {
    case "Listening":
      bubbleWindow.webContents.send("assistant-listening");
      break;
    case "Processing":
      bubbleWindow.webContents.send("assistant-processing");
      break;
    case "Typing":
      bubbleWindow.webContents.send("assistant-typing");
      break;
    default:
      bubbleWindow.webContents.send("assistant-idle");
      break;
  }
}

function updateOverlay(patch = {}) {
  if (typeof patch.state === "string") {
    overlayState.state = patch.state;
    sendOverlayEvent("assistant-state", overlayState.state);
  }

  if (typeof patch.transcript === "string") {
    overlayState.transcript = patch.transcript;
    sendOverlayEvent("assistant-transcript", overlayState.transcript);
  }

  if (typeof patch.action === "string") {
    overlayState.action = patch.action;
    sendOverlayEvent("assistant-action", overlayState.action);
  }
}

function clearOverlayHideTimer() {
  if (!overlayHideTimer) {
    return;
  }

  clearTimeout(overlayHideTimer);
  overlayHideTimer = null;
}

function clearBubbleHideTimer() {
  if (!bubbleHideTimer) {
    return;
  }

  clearTimeout(bubbleHideTimer);
  bubbleHideTimer = null;
}

function setStatus(status) {
  if (status === "Ready") {
    updateOverlay({
      state: status,
      transcript: "",
      action: ""
    });
    return;
  }

  updateOverlay({ state: status });
}

function setTranscript(transcript) {
  updateOverlay({ transcript });
}

function setAction(action) {
  updateOverlay({ action });
}

function createWindow() {
  const display = screen.getPrimaryDisplay();
  const x = Math.max(
    display.workArea.x,
    display.workArea.x + display.workArea.width - OVERLAY_WINDOW_WIDTH - OVERLAY_MARGIN
  );
  const y = display.workArea.y + OVERLAY_MARGIN;

  overlayWindow = new BrowserWindow({
    width: OVERLAY_WINDOW_WIDTH,
    height: OVERLAY_WINDOW_HEIGHT,
    x,
    y,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    alwaysOnTop: true,
    focusable: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    movable: true,
    show: false,
    skipTaskbar: true,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: true
    }
  });

  overlayWindow.on("close", (event) => {
    if (isQuitting) {
      return;
    }

    event.preventDefault();
    overlayWindow.hide();
  });

  overlayWindow.loadFile(path.join(__dirname, "overlay.html")).then(() => {
    syncOverlay();
  }).catch(() => {});
}

function createBubbleWindow() {
  const display = screen.getPrimaryDisplay();
  const x = Math.max(
    display.workArea.x,
    display.workArea.x + display.workArea.width - BUBBLE_WINDOW_WIDTH - BUBBLE_MARGIN
  );
  const y = display.workArea.y + display.workArea.height - BUBBLE_WINDOW_HEIGHT - BUBBLE_MARGIN;

  bubbleWindow = new BrowserWindow({
    width: BUBBLE_WINDOW_WIDTH,
    height: BUBBLE_WINDOW_HEIGHT,
    x,
    y,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    alwaysOnTop: true,
    focusable: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    movable: true,
    show: false,
    skipTaskbar: true,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: true
    }
  });

  bubbleWindow.on("close", (event) => {
    if (isQuitting) {
      return;
    }

    event.preventDefault();
    bubbleWindow.hide();
  });

  bubbleWindow.loadFile(path.join(__dirname, "bubble.html")).then(() => {
    sendBubbleState();
  }).catch(() => {});
}

function broadcastHistoryUpdate() {
  if (!historyWindow || historyWindow.isDestroyed()) {
    return;
  }

  historyWindow.webContents.send("history:updated", getConversationHistory().slice().reverse());
}

function createSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 460,
    height: 560,
    resizable: false,
    autoHideMenuBar: true,
    title: "FlowMative Settings",
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: true
    }
  });

  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });

  settingsWindow.loadFile(path.join(__dirname, "settings.html")).catch(() => {});
}

function createHistoryWindow() {
  if (historyWindow && !historyWindow.isDestroyed()) {
    historyWindow.focus();
    return;
  }

  historyWindow = new BrowserWindow({
    width: 980,
    height: 720,
    autoHideMenuBar: true,
    title: "FlowMative Command History",
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: true
    }
  });

  historyWindow.on("closed", () => {
    historyWindow = null;
  });

  historyWindow.loadFile(path.join(__dirname, "history.html")).catch(() => {});
}

function showStatusWindow() {
  clearOverlayHideTimer();

  if (!overlayWindow || overlayWindow.isDestroyed()) {
    createWindow();
  }

  if (typeof overlayWindow.showInactive === "function") {
    overlayWindow.showInactive();
    return;
  }

  overlayWindow.show();
}

function hideStatusWindow() {
  clearOverlayHideTimer();

  if (!overlayWindow || overlayWindow.isDestroyed()) {
    return;
  }

  overlayWindow.hide();
}

function showBubbleWindow() {
  clearBubbleHideTimer();

  if (!bubbleWindow || bubbleWindow.isDestroyed()) {
    createBubbleWindow();
  }

  if (typeof bubbleWindow.showInactive === "function") {
    bubbleWindow.showInactive();
    return;
  }

  bubbleWindow.show();
}

function hideBubbleWindow() {
  clearBubbleHideTimer();
  bubbleState = "Idle";

  if (!bubbleWindow || bubbleWindow.isDestroyed()) {
    return;
  }

  sendBubbleState();
  bubbleHideTimer = setTimeout(() => {
    if (!bubbleWindow || bubbleWindow.isDestroyed() || bubbleState !== "Idle") {
      return;
    }

    bubbleWindow.hide();
  }, BUBBLE_HIDE_DELAY_MS);
}

function setBubbleState(nextState) {
  clearBubbleHideTimer();
  bubbleState = nextState;
  showBubbleWindow();
  sendBubbleState();
}

function scheduleOverlayHide(delay = OVERLAY_HIDE_DELAY_MS) {
  clearOverlayHideTimer();
  overlayHideTimer = setTimeout(() => {
    hideStatusWindow();
  }, delay);
}

function beginListeningOverlay() {
  clearOverlayHideTimer();
  updateOverlay({
    state: "Listening",
    transcript: "",
    action: "Listening for your request"
  });
  showStatusWindow();
  setBubbleState("Listening");
}

function beginProcessingOverlay(action = "") {
  clearOverlayHideTimer();
  updateOverlay({
    state: "Processing",
    action
  });
  showStatusWindow();
  setBubbleState("Processing");
}

function beginExecutingOverlay(action = "") {
  clearOverlayHideTimer();
  updateOverlay({
    state: "Executing tool",
    action
  });
  showStatusWindow();
  setBubbleState("Processing");
}

function completeOverlay(action = "Result ready", delay = OVERLAY_HIDE_DELAY_MS) {
  updateOverlay({
    state: "Completed",
    action
  });
  showStatusWindow();
  scheduleOverlayHide(delay);
}

async function captureSelectedText() {
  const clipboardBackup = clipboard.readText();
  const sentinel = `__flowmative_selection__${Date.now()}`;
  const modifier = process.platform === "darwin" ? "command" : "control";

  clipboard.writeText(sentinel);
  await wait(50);
  robot.keyTap("c", modifier);
  await wait(140);

  const selectedText = clipboard.readText();
  clipboard.writeText(clipboardBackup);

  if (!selectedText || selectedText === sentinel) {
    return "";
  }

  console.log("Selected text captured");
  return selectedText;
}

function formatError(error) {
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

  if (message.includes("Transcription service is not reachable")) {
    return message;
  }

  if (message.includes("OPENAI_API_KEY is required")) {
    return message;
  }

  return message || "Voice pipeline failed.";
}

function detectIntent(transcript) {
  if (currentSettings.mode === "dictation") {
    return "dictation";
  }

  if (currentSettings.mode === "command") {
    return "command";
  }

  const normalizedTranscript = transcript.trim().toLowerCase();

  if (isFollowUpCommand(normalizedTranscript)) {
    return "command";
  }

  if (COMMAND_PREFIXES.some((prefix) => normalizedTranscript.startsWith(prefix))) {
    return "command";
  }

  return "dictation";
}

async function typeText(text) {
  if (typeof text !== "string") {
    throw new Error("typeText(text) expects a string.");
  }

  const sanitized = sanitizeTypingText(text);

  if (!sanitized.length) {
    return "empty";
  }

  console.log(`Typing sanitized text: ${sanitized}`);
  await restoreExternalFocusBeforeTyping();

  try {
    robot.setKeyboardDelay(getTypingDelay());
    robot.typeString(sanitized);
    return "typed";
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error || "Unknown RobotJS typing error.");
    console.error(`Typing failed: ${errorMessage}`);
  }

  const clipboardBackup = clipboard.readText();
  const modifier = process.platform === "darwin" ? "command" : "control";
  let shouldRestoreClipboard = true;

  try {
    clipboard.writeText(sanitized);
    await wait(60);
    robot.keyTap("v", modifier);
    await wait(Math.max(80, getTypingDelay() + 40));
    return "typed";
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error || "Unknown paste fallback error.");
    console.error(`Paste fallback failed: ${errorMessage}`);
    shouldRestoreClipboard = false;
    clipboard.writeText(sanitized);
    return "clipboard";
  } finally {
    if (shouldRestoreClipboard && clipboard.readText() === sanitized) {
      clipboard.writeText(clipboardBackup);
    }
  }
}

function sanitizeTypingText(text) {
  return text
    .normalize("NFKC")
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .replace(/[‐‑‒–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/\u00A0/g, " ")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\r/g, "")
    .replace(/\t/g, " ");
}

async function restoreExternalFocusBeforeTyping() {
  console.log("Restoring focus before typing...");

  if (overlayWindow && !overlayWindow.isDestroyed()) {
    if (typeof overlayWindow.blur === "function") {
      overlayWindow.blur();
    }

    overlayWindow.hide();
  }

  if (bubbleWindow && !bubbleWindow.isDestroyed() && typeof bubbleWindow.blur === "function") {
    bubbleWindow.blur();
  }

  await wait(150);
  console.log("Typing into external application.");
}

async function startPipelineRecording() {
  if (!assistantEnabled || recordingSession || processing) {
    return;
  }

  const languageHint = getPreferredTranscriptionLanguage();
  const streamingTranscriber = createStreamingTranscriber({
    language: languageHint,
    requestLabel: "electron-stream",
    onPartial: (partialTranscript) => {
      if (!recordingSession || recordingSession.streamingTranscriber !== streamingTranscriber || processing) {
        return;
      }

      setTranscript(partialTranscript);
    }
  });

  try {
    console.log("Push-to-talk activated");
    beginListeningOverlay();
    recordingSession = await recordAudio({
      manualStop: true,
      onChunk: (chunk) => streamingTranscriber.appendChunk(chunk)
    });
    recordingSession.streamingTranscriber = streamingTranscriber;
    if (languageHint) {
      console.log(`Transcription language hint: ${languageHint}`);
    }

    if (!pushToTalkHeld && recordingSession) {
      await stopPipelineRecording();
    }
  } catch (error) {
    streamingTranscriber.abort();
    console.error(formatError(error));
    hideBubbleWindow();
    completeOverlay(formatError(error), 2200);
    recordingSession = null;
  }
}

async function stopPipelineRecording() {
  if (!recordingSession || processing) {
    return;
  }

  processing = true;
  const session = recordingSession;
  recordingSession = null;
  console.log("Push-to-talk recording stopped");
  beginProcessingOverlay("Transcribing audio");

  try {
    const audioFilePath = await session.stop();
    if (session.streamingTranscriber) {
      try {
        const streamingResult = await session.streamingTranscriber.finalize();
        if (streamingResult && streamingResult.diagnostics) {
          logTranscriptionDiagnostics(streamingResult.diagnostics);
        }
      } catch (error) {
        console.error(`Live transcription update failed: ${formatError(error)}`);
      }
    }

    console.log("Processing transcription...");

    const startedAt = process.hrtime.bigint();
    const recordedAudioPath = audioFilePath || DEFAULT_OUTPUT_PATH;
    const audioFileSize = fs.existsSync(recordedAudioPath)
      ? fs.statSync(recordedAudioPath).size
      : 0;
    const captureDiagnostics = typeof session.getDiagnostics === "function"
      ? session.getDiagnostics()
      : null;
    const transcriptionResult = await transcribeAudio(recordedAudioPath, {
      language: getPreferredTranscriptionLanguage(),
      requestLabel: "electron-final",
      logTranscript: false,
      returnFullResponse: true
    });
    const transcript = transcriptionResult.transcript;
    const elapsedSeconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
    console.log("Transcript:", transcript || "[empty]");
    console.log("Audio file size:", audioFileSize, "bytes");
    logCaptureDiagnostics(captureDiagnostics, recordedAudioPath, audioFileSize);
    logTranscriptionDiagnostics(transcriptionResult.diagnostics);

    if (!transcript || !transcript.trim()) {
      if (audioFileSize < 20000) {
        console.log("Audio appears too short or silent.");
      } else {
        console.log("Whisper returned empty transcript despite audio.");
      }

      console.log("No speech detected.");
      setTranscript("");
      hideBubbleWindow();
      completeOverlay("No speech detected");
      console.log(`Transcription time: ${elapsedSeconds.toFixed(1)} seconds`);
      return;
    }

    const intent = detectIntent(transcript);
    setTranscript(transcript);

    if (intent === "command") {
      console.log(`Command detected: ${transcript}`);
      beginProcessingOverlay("Selecting tool");
      const selectedText = shouldUseSelectedText(transcript, "placeholder")
        ? await captureSelectedText()
        : "";
      const commandResult = await routeCommand(transcript, undefined, {
        selectedText,
        onToolSelected: async (toolName) => {
          beginProcessingOverlay(`Selected tool: ${toolName}`);
          await wait(140);
        },
        onAction: async (actionText) => {
          beginExecutingOverlay(actionText);
        }
      });
      broadcastHistoryUpdate();
      console.log(`Router selected tool: ${commandResult.toolName}`);
      console.log("");
      console.log("Result:");
      console.log("");
      console.log(commandResult.response);

      if (commandResult.action === "type") {
        setBubbleState("Typing");
        setAction("Typing result into active app");
        const typingResult = await typeText(commandResult.response);
        if (typingResult === "typed") {
          console.log("Typed into active application.");
        } else if (typingResult === "clipboard") {
          console.log("Typing failed. Copied result to clipboard instead.");
        } else {
          console.log("No text produced. Skipping typing.");
        }
        hideBubbleWindow();
        completeOverlay(
          typingResult === "typed"
            ? "Typed into active app"
            : typingResult === "clipboard"
              ? "Copied result to clipboard"
              : "Nothing to type"
        );
      } else {
        setAction("Copying result to clipboard");
        clipboard.writeText(commandResult.response);
        console.log("Copied result to clipboard.");
        hideBubbleWindow();
        completeOverlay("Result ready");
      }
    } else {
      beginExecutingOverlay(
        currentSettings.enableFormatting ? "Formatting dictated text" : "Evaluating dictated text"
      );
      const formatted = currentSettings.enableFormatting
        ? processFormatting(transcript)
        : transcript;
      console.log(`Formatted dictation: ${formatted}`);

      let outputText = formatted;

      if (shouldRefine(formatted)) {
        console.log("Refinement applied");
        setAction("Refining dictated text");

        try {
          outputText = await refineDictation(formatted);
        } catch (error) {
          const refinementError = error instanceof Error ? error.message : String(error || "Unknown refinement error.");
          console.error(`Dictation refinement failed: ${refinementError}`);
          outputText = formatted;
        }
      } else {
        console.log("Refinement skipped");
        setAction("Typing formatted dictation");
      }

      console.log(`Refined dictation: ${outputText}`);
      const typingResult = await typeText(outputText);
      if (typingResult === "typed") {
        setBubbleState("Typing");
        console.log("Typed into active application.");
      } else if (typingResult === "clipboard") {
        console.log("Typing failed. Copied result to clipboard instead.");
      } else {
        console.log("No text produced. Skipping typing.");
      }
      hideBubbleWindow();
      completeOverlay(
        typingResult === "typed"
          ? "Typed into active app"
          : typingResult === "clipboard"
            ? "Copied result to clipboard"
            : "Nothing to type"
      );
    }

    console.log(`Transcription time: ${elapsedSeconds.toFixed(1)} seconds`);
  } catch (error) {
    if (session.streamingTranscriber) {
      session.streamingTranscriber.abort();
    }
    const formattedError = formatError(error);
    console.error(formattedError);
    hideBubbleWindow();
    completeOverlay(formattedError, 2400);
  } finally {
    processing = false;
  }
}

function registerPushToTalk() {
  const pushToTalkKey = getPushToTalkKey();

  if (shortcutRegistered || globalShortcut.isRegistered(pushToTalkKey)) {
    return true;
  }

  const registered = globalShortcut.register(pushToTalkKey, () => {
    if (!assistantEnabled || pushToTalkHeld) {
      return;
    }

    pushToTalkHeld = true;
    void startPipelineRecording();
  });

  if (!registered) {
    console.error("Push-to-talk registration failed.");
    return false;
  }

  shortcutRegistered = true;
  registeredShortcut = pushToTalkKey;
  console.log(`Push-to-talk shortcut registered: ${pushToTalkKey}`);
  return true;
}

function startKeyboardHook() {
  if (hookStarted) {
    return;
  }

  const isCtrlKey = (keycode) => {
    return keycode === UiohookKey.Ctrl || keycode === UiohookKey.CtrlRight;
  };

  const isAltKey = (keycode) => {
    return keycode === UiohookKey.Alt || keycode === UiohookKey.AltRight;
  };

  const isPushToTalkComboActive = (spaceHeld) => {
    const shortcut = getPushToTalkKey();
    const needsCtrl = shortcutUsesModifier(shortcut, "ctrl");
    const needsAlt = shortcutUsesModifier(shortcut, "alt");

    if (!spaceHeld) {
      return false;
    }

    if (needsCtrl && !ctrlHeld) {
      return false;
    }

    if (needsAlt && !altHeld) {
      return false;
    }

    return true;
  };

  const stopIfPushToTalkReleased = () => {
    if (!pushToTalkHeld || isPushToTalkComboActive(spaceHeld)) {
      return;
    }

    pushToTalkHeld = false;
    void stopPipelineRecording();
  };

  let spaceHeld = false;

  uIOhook.on("keydown", (event) => {
    if (isCtrlKey(event.keycode)) {
      ctrlHeld = true;
      return;
    }

    if (isAltKey(event.keycode)) {
      altHeld = true;
      return;
    }

    if (event.keycode === UiohookKey.Space) {
      spaceHeld = true;
    }
  });

  uIOhook.on("keyup", (event) => {
    if (isCtrlKey(event.keycode)) {
      ctrlHeld = false;
      stopIfPushToTalkReleased();
      return;
    }

    if (isAltKey(event.keycode)) {
      altHeld = false;
      stopIfPushToTalkReleased();
      return;
    }

    if (event.keycode !== UiohookKey.Space) {
      return;
    }

    spaceHeld = false;
    stopIfPushToTalkReleased();
  });

  uIOhook.start();
  hookStarted = true;
}

function enableAssistant() {
  assistantEnabled = true;
  const registered = registerPushToTalk();

  if (!registered) {
    assistantEnabled = false;
    setStatus("Ready");
    if (tray) {
      tray.setContextMenu(buildTrayMenu());
    }
    return;
  }

  setStatus("Ready");
  if (tray) {
    tray.setContextMenu(buildTrayMenu());
  }
  console.log("Assistant started.");
}

function pauseAssistant() {
  assistantEnabled = false;
  pushToTalkHeld = false;
  ctrlHeld = false;
  altHeld = false;
  shortcutRegistered = false;

  if (registeredShortcut) {
    globalShortcut.unregister(registeredShortcut);
  }

  registeredShortcut = null;
  setStatus("Ready");
  if (tray) {
    tray.setContextMenu(buildTrayMenu());
  }
  console.log("Assistant paused.");
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    {
      label: "Start Assistant",
      enabled: !assistantEnabled,
      click: () => enableAssistant()
    },
    {
      label: "Pause Assistant",
      enabled: assistantEnabled,
      click: () => pauseAssistant()
    },
    {
      label: "Open Assistant Overlay",
      click: () => showStatusWindow()
    },
    {
      label: "Settings",
      click: () => createSettingsWindow()
    },
    {
      label: "Open Command History",
      click: () => createHistoryWindow()
    },
    {
      label: "Quit",
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);
}

function createTray() {
  tray = new Tray(TRAY_ICON_PATH);
  tray.setToolTip("FlowMative Voice Assistant");
  tray.setContextMenu(buildTrayMenu());
  tray.on("click", () => {
    tray.popUpContextMenu(buildTrayMenu());
  });
}

async function applyUpdatedSettings(nextSettings, previousSettings) {
  applyRuntimeSettings(nextSettings);
  syncLoginItemSettings(nextSettings);

  if (nextSettings.pushToTalkKey !== previousSettings.pushToTalkKey) {
    if (registeredShortcut) {
      globalShortcut.unregister(registeredShortcut);
    }

    shortcutRegistered = false;
    registeredShortcut = null;

    if (assistantEnabled && !registerPushToTalk()) {
      const revertedSettings = updateSetting("pushToTalkKey", previousSettings.pushToTalkKey);
      applyRuntimeSettings(revertedSettings);
      registerPushToTalk();
      throw new Error("Push-to-talk registration failed.");
    }
  }

  if (nextSettings.speechModel !== previousSettings.speechModel) {
    const wasEnabled = assistantEnabled;

    if (registeredShortcut) {
      globalShortcut.unregister(registeredShortcut);
      shortcutRegistered = false;
      registeredShortcut = null;
    }

    assistantEnabled = false;
    setStatus("Restarting speech service...");
    stopManagedSpeechService();

    try {
      await ensureSpeechServiceRunning();
      if (wasEnabled) {
        enableAssistant();
      }
    } catch (error) {
      setStatus("Speech service unavailable");
      throw error;
    }
  }
}

function registerSettingsIpc() {
  ipcMain.handle("settings:get", () => {
    return currentSettings;
  });

  ipcMain.handle("settings:update", async (_event, payload) => {
    const previousSettings = { ...currentSettings };
    const nextSettings = updateSetting(payload.key, payload.value);

    try {
      await applyUpdatedSettings(nextSettings, previousSettings);
      return currentSettings;
    } catch (error) {
      updateSetting(payload.key, previousSettings[payload.key]);
      applyRuntimeSettings(previousSettings);
      syncLoginItemSettings(previousSettings);
      throw error;
    }
  });
}

function registerMacroIpc() {
  ipcMain.handle("macros:get", () => {
    return getMacros();
  });

  ipcMain.handle("macros:add", (_event, payload) => {
    return addMacro(payload.phrase, payload.expansion);
  });

  ipcMain.handle("macros:delete", (_event, phrase) => {
    return deleteMacro(phrase);
  });
}

function registerHistoryIpc() {
  ipcMain.handle("get-history", () => {
    return getConversationHistory().slice().reverse();
  });

  ipcMain.handle("copy-history-result", (_event, result) => {
    clipboard.writeText(typeof result === "string" ? result : "");
    return true;
  });

  ipcMain.handle("delete-history-entry", (_event, entryId) => {
    const history = deleteHistoryEntry(entryId).slice().reverse();
    broadcastHistoryUpdate();
    return history;
  });

  ipcMain.handle("clear-history", () => {
    clearMemory();
    broadcastHistoryUpdate();
    return [];
  });
}

async function cleanupAndQuit() {
  clearOverlayHideTimer();
  clearBubbleHideTimer();
  hideBubbleWindow();
  globalShortcut.unregisterAll();
  shortcutRegistered = false;
  registeredShortcut = null;

  try {
    if (hookStarted) {
      uIOhook.stop();
      hookStarted = false;
    }
  } catch (error) {
    if (error && error.message) {
      console.error(error.message);
    }
  }

  if (recordingSession) {
    try {
      await recordingSession.stop();
    } catch (error) {
      console.error(formatError(error));
    } finally {
      if (recordingSession.streamingTranscriber) {
        recordingSession.streamingTranscriber.abort();
      }
    }
  }

  stopManagedSpeechService();
}

app.whenReady().then(async () => {
  applyRuntimeSettings(getSettings());
  syncLoginItemSettings(currentSettings);
  createWindow();
  createBubbleWindow();
  createTray();
  registerSettingsIpc();
  registerMacroIpc();
  registerHistoryIpc();
  setStatus("Starting speech service...");

  try {
    await ensureSpeechServiceRunning();
    startKeyboardHook();
    enableAssistant();
    console.log(`Push-to-talk ready. Hold ${getPushToTalkKey()} to record.`);
  } catch (error) {
    console.error(formatError(error));
    setStatus("Speech service unavailable");
  }
});

app.on("will-quit", (event) => {
  isQuitting = true;

  if (recordingSession || processing) {
    event.preventDefault();
    void cleanupAndQuit().finally(() => app.exit());
    return;
  }

  globalShortcut.unregisterAll();
  shortcutRegistered = false;
  registeredShortcut = null;
  try {
    if (hookStarted) {
      uIOhook.stop();
      hookStarted = false;
    }
  } catch (error) {
    if (error && error.message) {
      console.error(error.message);
    }
  }

  stopManagedSpeechService();
});

app.on("window-all-closed", () => {
  if (process.platform === "darwin") {
    return;
  }
});

app.on("activate", () => {
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    createWindow();
  }

  if (!bubbleWindow || bubbleWindow.isDestroyed()) {
    createBubbleWindow();
  }

  showStatusWindow();
});
