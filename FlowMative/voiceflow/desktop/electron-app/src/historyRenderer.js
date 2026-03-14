const { ipcRenderer } = require("electron");

const historyElement = document.getElementById("history");
const statusElement = document.getElementById("status");
const clearAllButton = document.getElementById("clearAll");

function setStatus(message = "") {
  statusElement.textContent = message;
}

function formatTimestamp(timestamp) {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime())
    ? timestamp
    : date.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
      });
}

function buildLabel(command) {
  return command === "followUpRewrite" ? "Follow-up command" : command || "Unknown";
}

async function copyResult(result) {
  await ipcRenderer.invoke("copy-history-result", result);
  setStatus("Result copied.");
}

async function deleteEntry(entryId) {
  await ipcRenderer.invoke("delete-history-entry", entryId);
  setStatus("Entry deleted.");
}

async function clearAllHistory() {
  await ipcRenderer.invoke("clear-history");
  setStatus("History cleared.");
}

function createValueRow(label, value) {
  const labelElement = document.createElement("div");
  labelElement.className = "label";
  labelElement.textContent = label;

  const valueElement = document.createElement("div");
  valueElement.className = "value";
  valueElement.textContent = value || "";

  return [labelElement, valueElement];
}

function renderHistory(entries) {
  historyElement.innerHTML = "";

  if (!entries.length) {
    const emptyState = document.createElement("div");
    emptyState.className = "empty";
    emptyState.textContent = "No assistant history yet.";
    historyElement.appendChild(emptyState);
    return;
  }

  for (const entry of entries) {
    const card = document.createElement("section");
    card.className = "entry";

    const timeElement = document.createElement("div");
    timeElement.className = "time";
    timeElement.textContent = `[${formatTimestamp(entry.timestamp)}]`;
    card.appendChild(timeElement);

    for (const [label, value] of [
      ["Transcript", entry.transcript],
      ["Tool", buildLabel(entry.command)],
      ["Result", entry.result]
    ]) {
      const [labelElement, valueElement] = createValueRow(label, value);
      card.append(labelElement, valueElement);
    }

    const actions = document.createElement("div");
    actions.className = "actions";

    const copyButton = document.createElement("button");
    copyButton.className = "secondary";
    copyButton.textContent = "Copy Result";
    copyButton.addEventListener("click", () => {
      void copyResult(entry.result || "");
    });

    const deleteButton = document.createElement("button");
    deleteButton.className = "danger";
    deleteButton.textContent = "Delete Entry";
    deleteButton.addEventListener("click", () => {
      void deleteEntry(entry.id);
    });

    actions.append(copyButton, deleteButton);
    card.appendChild(actions);
    historyElement.appendChild(card);
  }
}

async function loadHistory() {
  const entries = await ipcRenderer.invoke("get-history");
  renderHistory(entries);
}

clearAllButton.addEventListener("click", () => {
  void clearAllHistory();
});

ipcRenderer.on("history:updated", (_event, entries) => {
  renderHistory(entries);
});

loadHistory().catch((error) => {
  setStatus(error.message || "Failed to load history.");
});
