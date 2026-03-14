const api = window.flowmative;

const sectionCopy = {
  home: {
    title: "Home",
    description: "Monitor dictation readiness and the current desktop pipeline."
  },
  settings: {
    title: "Settings",
    description: "Tune the hotkey, dictation behavior, model choice, and device preferences."
  },
  history: {
    title: "History",
    description: "Review the latest sessions and retry insertion when a target app misbehaves."
  },
  dictionary: {
    title: "Dictionary",
    description: "Teach FlowMative your names, company terms, and technical vocabulary."
  },
  diagnostics: {
    title: "Diagnostics",
    description: "Inspect the pilot speech pipeline with local-only logs and exported session traces."
  },
  experimental: {
    title: "Experimental",
    description: "Macros and advanced assistant features stay gated during the pilot."
  }
};

const navButtons = Array.from(document.querySelectorAll("[data-section]"));
const panels = Object.fromEntries(
  Object.keys(sectionCopy).map((section) => [section, document.getElementById(`panel-${section}`)])
);
const sectionTitle = document.getElementById("sectionTitle");
const sectionDescription = document.getElementById("sectionDescription");
const statusChip = document.getElementById("statusChip");

const settingsControls = {
  pushToTalkKey: document.getElementById("pushToTalkKey"),
  mode: document.getElementById("mode"),
  dictationMode: document.getElementById("dictationMode"),
  speechModel: document.getElementById("speechModel"),
  commandModel: document.getElementById("commandModel"),
  preferredMicrophoneId: document.getElementById("preferredMicrophoneId"),
  typingSpeed: document.getElementById("typingSpeed"),
  startOnLogin: document.getElementById("startOnLogin"),
  enableFormatting: document.getElementById("enableFormatting"),
  soundFeedbackEnabled: document.getElementById("soundFeedbackEnabled"),
  assistantFeaturesEnabled: document.getElementById("assistantFeaturesEnabled")
};

const settingsStatus = document.getElementById("settingsStatus");
const historyStatus = document.getElementById("historyStatus");
const dictionaryStatus = document.getElementById("dictionaryStatus");
const diagnosticsStatus = document.getElementById("diagnosticsStatus");
const experimentalStatus = document.getElementById("experimentalStatus");

const historyList = document.getElementById("historyList");
const dictionaryInput = document.getElementById("dictionaryInput");
const dictionaryList = document.getElementById("dictionaryList");
const diagnosticsSummary = document.getElementById("diagnosticsSummary");
const diagnosticsSessions = document.getElementById("diagnosticsSessions");
const macroList = document.getElementById("macroList");

const homeElements = {
  assistant: document.getElementById("cardAssistant"),
  hotkey: document.getElementById("cardHotkey"),
  microphone: document.getElementById("cardMicrophone"),
  whisper: document.getElementById("cardWhisper"),
  state: document.getElementById("homeState"),
  transcript: document.getElementById("homeTranscript"),
  action: document.getElementById("homeAction")
};

let lastSettings = null;
let lastVoiceStatus = null;
let lastDevices = [];

function setStatus(element, message = "") {
  element.textContent = message;
}

function toViewValue(key, value) {
  if (["startOnLogin", "enableFormatting", "soundFeedbackEnabled", "assistantFeaturesEnabled"].includes(key)) {
    return String(Boolean(value));
  }

  return value;
}

function fromViewValue(key, value) {
  if (["startOnLogin", "enableFormatting", "soundFeedbackEnabled", "assistantFeaturesEnabled"].includes(key)) {
    return value === "true";
  }

  return value;
}

function formatTimestamp(timestamp) {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? timestamp : date.toLocaleString();
}

function renderEmpty(container, text) {
  container.innerHTML = "";
  const emptyElement = document.createElement("div");
  emptyElement.className = "empty";
  emptyElement.textContent = text;
  container.appendChild(emptyElement);
}

function setSection(section) {
  const nextSection = sectionCopy[section] ? section : "home";
  const copy = sectionCopy[nextSection];

  sectionTitle.textContent = copy.title;
  sectionDescription.textContent = copy.description;

  for (const [name, panel] of Object.entries(panels)) {
    panel.hidden = name !== nextSection;
  }

  for (const button of navButtons) {
    button.classList.toggle("active", button.dataset.section === nextSection);
  }
}

function updateStatusChip() {
  if (!lastVoiceStatus) {
    statusChip.textContent = "Loading...";
    return;
  }

  if (!lastVoiceStatus.assistantEnabled) {
    statusChip.textContent = "Paused";
    return;
  }

  statusChip.textContent = lastVoiceStatus.processing ? "Processing" : "Ready";
}

function populateDeviceSelect(devices, selectedId) {
  const control = settingsControls.preferredMicrophoneId;
  control.innerHTML = "";

  for (const device of devices) {
    const option = document.createElement("option");
    option.value = device.id;
    option.textContent = device.isDefault ? `${device.name} (recommended)` : device.name;
    control.appendChild(option);
  }

  control.value = selectedId || "default";
}

function renderHome() {
  if (!lastSettings) {
    return;
  }

  homeElements.hotkey.textContent = lastSettings.pushToTalkKey;
  homeElements.microphone.textContent = lastSettings.preferredMicrophoneName || "System Default";
  homeElements.whisper.textContent = lastSettings.speechModel;

  if (lastVoiceStatus) {
    homeElements.assistant.textContent = lastVoiceStatus.assistantEnabled ? "Active" : "Paused";
    homeElements.state.textContent = lastVoiceStatus.overlay.state || "Ready";
    homeElements.transcript.textContent = lastVoiceStatus.overlay.transcript || "Waiting for input";
    homeElements.action.textContent = lastVoiceStatus.overlay.action || "Standing by";
  }
}

function buildMetaPill(text, className = "") {
  const pill = document.createElement("div");
  pill.className = `pill ${className}`.trim();
  pill.textContent = text;
  return pill;
}

function renderHistory(entries) {
  if (!entries.length) {
    renderEmpty(historyList, "No assistant history yet.");
    return;
  }

  historyList.innerHTML = "";

  for (const entry of entries) {
    const card = document.createElement("section");
    card.className = "entry";

    const meta = document.createElement("div");
    meta.className = "entry-meta";
    meta.append(
      buildMetaPill(formatTimestamp(entry.timestamp)),
      buildMetaPill(entry.command || "dictation"),
      buildMetaPill(`Insert: ${entry.insertionMethod || "pending"}`),
      buildMetaPill(`Speech ratio: ${Number(entry.speechRatio || 0).toFixed(2)}`)
    );

    if (Array.isArray(entry.warnings)) {
      for (const warning of entry.warnings) {
        meta.appendChild(buildMetaPill(warning, "warning"));
      }
    }

    card.appendChild(meta);

    for (const [label, value] of [
      ["Transcript", entry.transcript],
      ["Result", entry.result],
      ["Microphone", entry.microphoneName || "System Default"],
      ["Whisper", entry.whisperModel || ""]
    ]) {
      const labelElement = document.createElement("div");
      labelElement.className = "entry-label";
      labelElement.textContent = label;

      const valueElement = document.createElement("div");
      valueElement.textContent = value || "";
      card.append(labelElement, valueElement);
    }

    const actions = document.createElement("div");
    actions.className = "entry-actions";

    const retryButton = document.createElement("button");
    retryButton.className = "primary";
    retryButton.textContent = "Retry Insertion";
    retryButton.addEventListener("click", async () => {
      setStatus(historyStatus, "Retrying insertion...");

      try {
        const result = await api.history.retryInsert(entry.id);
        setStatus(historyStatus, `Inserted via ${result.insertionMethod}.`);
      } catch (error) {
        setStatus(historyStatus, error.message || "Retry failed.");
      }
    });

    const copyButton = document.createElement("button");
    copyButton.className = "secondary";
    copyButton.textContent = "Copy Result";
    copyButton.addEventListener("click", async () => {
      await api.history.copyResult(entry.result || "");
      setStatus(historyStatus, "Result copied.");
    });

    const deleteButton = document.createElement("button");
    deleteButton.className = "danger";
    deleteButton.textContent = "Delete";
    deleteButton.addEventListener("click", async () => {
      await api.history.deleteEntry(entry.id);
      setStatus(historyStatus, "Entry deleted.");
    });

    actions.append(retryButton, copyButton, deleteButton);
    card.appendChild(actions);
    historyList.appendChild(card);
  }
}

function renderDictionary(entries) {
  if (!entries.length) {
    renderEmpty(dictionaryList, "No terms yet. Try adding FlowMative, teammate names, or technical words.");
    return;
  }

  dictionaryList.innerHTML = "";

  for (const entry of entries) {
    const card = document.createElement("section");
    card.className = "entry";

    const value = document.createElement("div");
    value.textContent = entry;

    const actions = document.createElement("div");
    actions.className = "entry-actions";

    const deleteButton = document.createElement("button");
    deleteButton.className = "danger";
    deleteButton.textContent = "Remove";
    deleteButton.addEventListener("click", async () => {
      setStatus(dictionaryStatus, "Removing term...");

      try {
        const nextEntries = await api.dictionary.deleteEntry(entry);
        renderDictionary(nextEntries);
        setStatus(dictionaryStatus, "Term removed.");
      } catch (error) {
        setStatus(dictionaryStatus, error.message || "Failed to remove term.");
      }
    });

    actions.appendChild(deleteButton);
    card.append(value, actions);
    dictionaryList.appendChild(card);
  }
}

function renderDiagnostics(summary) {
  diagnosticsSummary.innerHTML = "";
  diagnosticsSessions.innerHTML = "";

  const cards = [
    ["Whisper Model", summary.health?.model || (lastSettings ? lastSettings.speechModel : "Unknown")],
    ["Selected Mic", summary.selectedMicrophone || "System Default"],
    ["Stored Sessions", String(summary.sessionCount || 0)],
    ["Warnings", String((summary.recentWarnings || []).length)]
  ];

  for (const [label, value] of cards) {
    const card = document.createElement("article");
    card.className = "card";
    card.innerHTML = `<div class="label">${label}</div><div class="value">${value}</div>`;
    diagnosticsSummary.appendChild(card);
  }

  if (!summary.sessions || !summary.sessions.length) {
    renderEmpty(diagnosticsSessions, "No diagnostics sessions logged yet.");
    return;
  }

  for (const session of summary.sessions) {
    const card = document.createElement("section");
    card.className = "entry";

    const meta = document.createElement("div");
    meta.className = "entry-meta";
    meta.append(
      buildMetaPill(formatTimestamp(session.timestamp)),
      buildMetaPill(`Insert: ${session.insertionMethod || "pending"}`),
      buildMetaPill(`Audio: ${session.audioFileSizeBytes || 0} bytes`),
      buildMetaPill(`Speech: ${Number(session.speechRatio || 0).toFixed(2)}`)
    );

    if (Array.isArray(session.warnings)) {
      for (const warning of session.warnings) {
        meta.appendChild(buildMetaPill(warning, "warning"));
      }
    }

    const content = document.createElement("div");
    content.innerHTML = [
      `<div class="entry-label">Microphone</div><div>${session.microphoneName || "System Default"}</div>`,
      `<div class="entry-label">Timings</div><div>Transcription ${session.transcriptionDurationMs || 0} ms, refinement ${session.refinementDurationMs || 0} ms</div>`,
      `<div class="entry-label">Fallback</div><div>${session.fallbackReason || "None"}</div>`
    ].join("");

    card.append(meta, content);
    diagnosticsSessions.appendChild(card);
  }
}

function renderMacros(macros) {
  const entries = Object.entries(macros || {});

  if (!entries.length) {
    renderEmpty(macroList, "No macros saved yet.");
    return;
  }

  macroList.innerHTML = "";

  for (const [phrase, expansion] of entries) {
    const card = document.createElement("section");
    card.className = "entry";

    const phraseElement = document.createElement("div");
    phraseElement.className = "entry-label";
    phraseElement.textContent = phrase;

    const expansionElement = document.createElement("div");
    expansionElement.textContent = expansion;

    const deleteButton = document.createElement("button");
    deleteButton.className = "danger";
    deleteButton.textContent = "Delete";
    deleteButton.addEventListener("click", async () => {
      setStatus(experimentalStatus, "Deleting macro...");

      try {
        const nextMacros = await api.macros.delete(phrase);
        renderMacros(nextMacros);
        setStatus(experimentalStatus, "Macro deleted.");
      } catch (error) {
        setStatus(experimentalStatus, error.message || "Failed to delete macro.");
      }
    });

    card.append(phraseElement, expansionElement, deleteButton);
    macroList.appendChild(card);
  }
}

async function loadSettings() {
  const [settings, devices] = await Promise.all([
    api.settings.get(),
    api.audio.listDevices()
  ]);

  lastSettings = settings;
  lastDevices = devices;

  populateDeviceSelect(devices, settings.preferredMicrophoneId);

  for (const [key, control] of Object.entries(settingsControls)) {
    if (control && key !== "preferredMicrophoneId") {
      control.value = toViewValue(key, settings[key]);
    }
  }

  settingsControls.preferredMicrophoneId.value = settings.preferredMicrophoneId || "default";
  renderHome();
}

async function loadHistory() {
  renderHistory(await api.history.list());
}

async function loadDictionary() {
  renderDictionary(await api.dictionary.list());
}

async function loadDiagnostics() {
  renderDiagnostics(await api.diagnostics.getStatus());
}

async function loadMacros() {
  renderMacros(await api.macros.get());
}

async function loadVoiceStatus() {
  lastVoiceStatus = await api.voice.getStatus();
  updateStatusChip();
  renderHome();
}

navButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setSection(button.dataset.section);
  });
});

for (const [key, control] of Object.entries(settingsControls)) {
  if (!control) {
    continue;
  }

  control.addEventListener("change", async () => {
    setStatus(settingsStatus, "Saving setting...");

    try {
      const value = fromViewValue(key, control.value);

      if (key === "preferredMicrophoneId") {
        const selectedDevice = lastDevices.find((device) => device.id === value);
        await api.settings.update({ key: "preferredMicrophoneId", value });
        await api.settings.update({
          key: "preferredMicrophoneName",
          value: selectedDevice ? selectedDevice.name : "System Default"
        });
      } else {
        await api.settings.update({ key, value });
      }

      await Promise.all([loadSettings(), loadVoiceStatus()]);
      setStatus(settingsStatus, "Saved.");
    } catch (error) {
      setStatus(settingsStatus, error.message || "Failed to save setting.");
    }
  });
}

document.getElementById("historyClear").addEventListener("click", async () => {
  await api.history.clear();
  setStatus(historyStatus, "History cleared.");
});

document.getElementById("dictionaryAdd").addEventListener("click", async () => {
  const value = dictionaryInput.value.trim();

  if (!value) {
    setStatus(dictionaryStatus, "Enter a term first.");
    return;
  }

  setStatus(dictionaryStatus, "Adding term...");

  try {
    const entries = await api.dictionary.add([value]);
    dictionaryInput.value = "";
    renderDictionary(entries);
    setStatus(dictionaryStatus, "Dictionary updated.");
  } catch (error) {
    setStatus(dictionaryStatus, error.message || "Failed to add term.");
  }
});

document.getElementById("dictionaryClear").addEventListener("click", async () => {
  renderDictionary(await api.dictionary.clear());
  setStatus(dictionaryStatus, "Dictionary cleared.");
});

document.getElementById("exportDiagnostics").addEventListener("click", async () => {
  try {
    const exportPath = await api.diagnostics.exportLogs();
    setStatus(diagnosticsStatus, `Exported to ${exportPath}`);
  } catch (error) {
    setStatus(diagnosticsStatus, error.message || "Failed to export logs.");
  }
});

document.getElementById("macroAdd").addEventListener("click", async () => {
  const phrase = document.getElementById("macroPhrase").value;
  const expansion = document.getElementById("macroExpansion").value;
  setStatus(experimentalStatus, "Saving macro...");

  try {
    renderMacros(await api.macros.add({ phrase, expansion }));
    document.getElementById("macroPhrase").value = "";
    document.getElementById("macroExpansion").value = "";
    setStatus(experimentalStatus, "Macro saved.");
  } catch (error) {
    setStatus(experimentalStatus, error.message || "Failed to save macro.");
  }
});

api.onOverlayUpdate((payload) => {
  if (!payload) {
    return;
  }

  if (!lastVoiceStatus) {
    lastVoiceStatus = {
      assistantEnabled: true,
      processing: false,
      overlay: payload
    };
  } else {
    lastVoiceStatus.overlay = payload;
  }

  renderHome();
});

api.onVoiceStatus((payload) => {
  lastVoiceStatus = payload;
  updateStatusChip();
  renderHome();
});

api.onHistoryUpdated((entries) => {
  renderHistory(entries || []);
  void loadDiagnostics();
});

api.onControlCenterSection((section) => {
  setSection(section || "home");
});

Promise.all([
  loadSettings(),
  loadHistory(),
  loadDictionary(),
  loadDiagnostics(),
  loadMacros(),
  loadVoiceStatus()
]).catch((error) => {
  statusChip.textContent = error.message || "Failed to initialize";
});
