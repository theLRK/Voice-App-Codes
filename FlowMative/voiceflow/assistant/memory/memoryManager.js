const fs = require("fs");
const path = require("path");

const MAX_HISTORY_LENGTH = 100;
const MEMORY_STORE_PATH = path.join(__dirname, "memoryStore.json");

let nextEntryId = 1;

let sessionMemory = {
  conversationHistory: [],
  lastTranscript: null,
  lastCommand: null,
  lastResult: null
};

function normalizeWarnings(warnings) {
  if (!Array.isArray(warnings)) {
    return [];
  }

  return warnings
    .filter((warning) => typeof warning === "string" && warning.trim())
    .map((warning) => warning.trim());
}

function normalizeHistoryEntry(entry, index = 0) {
  return {
    id: String(entry.id || index + 1),
    transcript: typeof entry.transcript === "string" ? entry.transcript : "",
    command: typeof entry.command === "string" ? entry.command : "",
    result: typeof entry.result === "string" ? entry.result : "",
    timestamp: typeof entry.timestamp === "string" ? entry.timestamp : new Date().toISOString(),
    insertionMethod: typeof entry.insertionMethod === "string" ? entry.insertionMethod : "pending",
    microphoneName: typeof entry.microphoneName === "string" ? entry.microphoneName : "System Default",
    whisperModel: typeof entry.whisperModel === "string" ? entry.whisperModel : "",
    transcriptionDurationMs: Number.isFinite(entry.transcriptionDurationMs) ? entry.transcriptionDurationMs : 0,
    refinementDurationMs: Number.isFinite(entry.refinementDurationMs) ? entry.refinementDurationMs : 0,
    audioFileSizeBytes: Number.isFinite(entry.audioFileSizeBytes) ? entry.audioFileSizeBytes : 0,
    speechRatio: Number.isFinite(entry.speechRatio) ? entry.speechRatio : 0,
    warnings: normalizeWarnings(entry.warnings)
  };
}

function ensureMemoryFile() {
  if (!fs.existsSync(MEMORY_STORE_PATH)) {
    fs.writeFileSync(MEMORY_STORE_PATH, JSON.stringify(sessionMemory, null, 2), "utf-8");
  }
}

function recalculateNextEntryId() {
  nextEntryId = sessionMemory.conversationHistory.reduce((maxEntryId, entry) => {
    const numericId = Number(entry.id);
    return Number.isFinite(numericId) ? Math.max(maxEntryId, numericId + 1) : maxEntryId;
  }, 1);
}

function recalculateLastPointers() {
  const lastEntry = sessionMemory.conversationHistory[sessionMemory.conversationHistory.length - 1] || null;
  sessionMemory.lastTranscript = lastEntry?.transcript || null;
  sessionMemory.lastCommand = lastEntry?.command || null;
  sessionMemory.lastResult = lastEntry?.result || null;
}

function loadMemory() {
  ensureMemoryFile();

  try {
    const fileContent = fs.readFileSync(MEMORY_STORE_PATH, "utf-8");
    const parsed = JSON.parse(fileContent);

    sessionMemory = {
      conversationHistory: Array.isArray(parsed.conversationHistory)
        ? parsed.conversationHistory.map((entry, index) => normalizeHistoryEntry(entry, index))
        : [],
      lastTranscript: typeof parsed.lastTranscript === "string" ? parsed.lastTranscript : null,
      lastCommand: typeof parsed.lastCommand === "string" ? parsed.lastCommand : null,
      lastResult: typeof parsed.lastResult === "string" ? parsed.lastResult : null
    };

    if (!sessionMemory.conversationHistory.length) {
      recalculateLastPointers();
    }

    recalculateNextEntryId();
  } catch (error) {
    sessionMemory = {
      conversationHistory: [],
      lastTranscript: null,
      lastCommand: null,
      lastResult: null
    };
    saveMemory();
  }

  return getMemorySnapshot();
}

function saveMemory() {
  ensureMemoryFile();
  fs.writeFileSync(MEMORY_STORE_PATH, JSON.stringify(sessionMemory, null, 2), "utf-8");
  return getMemorySnapshot();
}

function getMemorySnapshot() {
  return {
    conversationHistory: sessionMemory.conversationHistory.map((entry) => ({ ...entry })),
    lastTranscript: sessionMemory.lastTranscript,
    lastCommand: sessionMemory.lastCommand,
    lastResult: sessionMemory.lastResult
  };
}

function saveInteraction(transcriptOrEntry, command, result) {
  const entry = typeof transcriptOrEntry === "object" && transcriptOrEntry !== null
    ? normalizeHistoryEntry({
        ...transcriptOrEntry,
        id: String(nextEntryId++)
      })
    : normalizeHistoryEntry({
        id: String(nextEntryId++),
        transcript: typeof transcriptOrEntry === "string" ? transcriptOrEntry.trim() : "",
        command: typeof command === "string" ? command.trim() : "",
        result: typeof result === "string" ? result.trim() : "",
        timestamp: new Date().toISOString()
      });

  sessionMemory.conversationHistory.push(entry);

  if (sessionMemory.conversationHistory.length > MAX_HISTORY_LENGTH) {
    sessionMemory.conversationHistory = sessionMemory.conversationHistory.slice(-MAX_HISTORY_LENGTH);
  }

  recalculateLastPointers();
  saveMemory();
  return entry;
}

function getLastResult() {
  return sessionMemory.lastResult;
}

function getConversationHistory() {
  return sessionMemory.conversationHistory.map((entry) => ({ ...entry }));
}

function deleteHistoryEntry(entryId) {
  sessionMemory.conversationHistory = sessionMemory.conversationHistory.filter((entry) => entry.id !== String(entryId));
  recalculateLastPointers();
  saveMemory();
  return getConversationHistory();
}

function updateHistoryEntry(entryId, patch = {}) {
  const entryIndex = sessionMemory.conversationHistory.findIndex((entry) => entry.id === String(entryId));

  if (entryIndex === -1) {
    return null;
  }

  const currentEntry = sessionMemory.conversationHistory[entryIndex];
  const nextEntry = normalizeHistoryEntry({
    ...currentEntry,
    ...patch,
    id: currentEntry.id
  });

  sessionMemory.conversationHistory[entryIndex] = nextEntry;
  recalculateLastPointers();
  saveMemory();
  return { ...nextEntry };
}

function getHistoryEntry(entryId) {
  const entry = sessionMemory.conversationHistory.find((item) => item.id === String(entryId));
  return entry ? { ...entry } : null;
}

function clearMemory() {
  sessionMemory = {
    conversationHistory: [],
    lastTranscript: null,
    lastCommand: null,
    lastResult: null
  };
  nextEntryId = 1;
  saveMemory();
  return getMemorySnapshot();
}

loadMemory();

module.exports = {
  MEMORY_STORE_PATH,
  loadMemory,
  saveMemory,
  saveInteraction,
  getLastResult,
  getConversationHistory,
  getHistoryEntry,
  deleteHistoryEntry,
  updateHistoryEntry,
  clearMemory
};
