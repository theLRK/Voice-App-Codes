const fs = require("fs");
const path = require("path");

const DEFAULT_MAX_SESSIONS = 250;

let storePath = null;
let exportDirPath = null;

function ensureInitialized() {
  if (!storePath || !exportDirPath) {
    throw new Error("Diagnostics store not initialized.");
  }
}

function ensureParentDir(filePath) {
  const dirPath = path.dirname(filePath);

  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function initializeDiagnosticsStore(userDataPath) {
  storePath = path.join(userDataPath, "diagnostics", "sessions.json");
  exportDirPath = path.join(userDataPath, "diagnostics", "exports");

  ensureParentDir(storePath);
  ensureParentDir(path.join(exportDirPath, "placeholder.txt"));

  if (!fs.existsSync(storePath)) {
    fs.writeFileSync(storePath, JSON.stringify({ sessions: [] }, null, 2), "utf-8");
  }

  return storePath;
}

function readStore() {
  ensureInitialized();

  try {
    const payload = JSON.parse(fs.readFileSync(storePath, "utf-8"));
    return {
      sessions: Array.isArray(payload.sessions) ? payload.sessions : []
    };
  } catch (error) {
    const fallback = { sessions: [] };
    fs.writeFileSync(storePath, JSON.stringify(fallback, null, 2), "utf-8");
    return fallback;
  }
}

function writeStore(store) {
  ensureInitialized();
  fs.writeFileSync(storePath, JSON.stringify(store, null, 2), "utf-8");
}

function pruneSessions(sessions, retentionDays = 14) {
  const cutoffTimestamp = Date.now() - (Math.max(1, retentionDays) * 24 * 60 * 60 * 1000);

  return sessions
    .filter((session) => {
      const timestamp = Date.parse(session.timestamp || "");
      return Number.isFinite(timestamp) ? timestamp >= cutoffTimestamp : true;
    })
    .slice(-DEFAULT_MAX_SESSIONS);
}

function logSession(session, options = {}) {
  const store = readStore();
  const nextSession = {
    ...session,
    timestamp: typeof session?.timestamp === "string" ? session.timestamp : new Date().toISOString()
  };
  store.sessions.push(nextSession);
  store.sessions = pruneSessions(store.sessions, options.retentionDays);
  writeStore(store);
  return nextSession;
}

function getRecentSessions(limit = 20) {
  const store = readStore();
  return store.sessions.slice(-Math.max(1, limit)).reverse();
}

function getDiagnosticsSummary(extra = {}) {
  const sessions = getRecentSessions(25);
  const recentWarnings = sessions.flatMap((session) => Array.isArray(session.warnings) ? session.warnings : []);

  return {
    storePath,
    sessionCount: readStore().sessions.length,
    recentWarnings,
    sessions,
    ...extra
  };
}

function exportDiagnostics() {
  ensureInitialized();
  const exportPath = path.join(
    exportDirPath,
    `flowmative-diagnostics-${new Date().toISOString().replace(/[:.]/g, "-")}.json`
  );
  fs.copyFileSync(storePath, exportPath);
  return exportPath;
}

module.exports = {
  initializeDiagnosticsStore,
  logSession,
  getRecentSessions,
  getDiagnosticsSummary,
  exportDiagnostics
};
