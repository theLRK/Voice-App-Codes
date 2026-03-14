const fs = require("fs");
const path = require("path");

const SETTINGS_PATH = path.join(__dirname, "..", "..", "config", "settings.json");
const DEFAULT_SETTINGS = {
  pushToTalkKey: "Ctrl+Space",
  mode: "auto",
  speechModel: "whisper-small",
  commandModel: "gpt-4o-mini",
  enableFormatting: true,
  typingSpeed: "normal",
  startOnLogin: true
};

let settingsCache = null;

function ensureSettingsFile() {
  const settingsDir = path.dirname(SETTINGS_PATH);

  if (!fs.existsSync(settingsDir)) {
    fs.mkdirSync(settingsDir, { recursive: true });
  }

  if (!fs.existsSync(SETTINGS_PATH)) {
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(DEFAULT_SETTINGS, null, 2), "utf-8");
  }
}

function loadSettingsFromDisk() {
  ensureSettingsFile();

  try {
    const fileContent = fs.readFileSync(SETTINGS_PATH, "utf-8");
    const parsed = JSON.parse(fileContent);
    return {
      ...DEFAULT_SETTINGS,
      ...parsed
    };
  } catch (error) {
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(DEFAULT_SETTINGS, null, 2), "utf-8");
    return { ...DEFAULT_SETTINGS };
  }
}

function getSettings() {
  if (!settingsCache) {
    settingsCache = loadSettingsFromDisk();
  }

  return { ...settingsCache };
}

function saveSettings() {
  if (!settingsCache) {
    settingsCache = loadSettingsFromDisk();
  }

  ensureSettingsFile();
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settingsCache, null, 2), "utf-8");
  return { ...settingsCache };
}

function updateSetting(key, value) {
  if (!(key in DEFAULT_SETTINGS)) {
    throw new Error(`Unknown setting: ${key}`);
  }

  if (!settingsCache) {
    settingsCache = loadSettingsFromDisk();
  }

  settingsCache = {
    ...settingsCache,
    [key]: value
  };

  return saveSettings();
}

module.exports = {
  SETTINGS_PATH,
  DEFAULT_SETTINGS,
  getSettings,
  updateSetting,
  saveSettings
};
