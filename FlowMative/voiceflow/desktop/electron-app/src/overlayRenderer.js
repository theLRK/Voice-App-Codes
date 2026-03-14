const { ipcRenderer } = require("electron");

const overlayElement = document.querySelector(".overlay");
const stateElement = document.getElementById("state");
const transcriptElement = document.getElementById("transcript");
const actionElement = document.getElementById("action");

function formatStateLabel(state) {
  const normalizedState = typeof state === "string" && state.trim() ? state.trim() : "Ready";
  return normalizedState.endsWith("...") ? normalizedState : `${normalizedState}...`;
}

function setSectionText(element, value, fallbackText) {
  const nextValue = typeof value === "string" ? value.trim() : "";
  element.textContent = nextValue || fallbackText;
  element.classList.toggle("muted", !nextValue);
}

ipcRenderer.on("assistant-state", (_event, state) => {
  const normalizedState = typeof state === "string" && state.trim() ? state.trim() : "Ready";
  overlayElement.dataset.state = normalizedState.toLowerCase();
  stateElement.textContent = formatStateLabel(normalizedState);
});

ipcRenderer.on("assistant-transcript", (_event, transcript) => {
  setSectionText(transcriptElement, transcript, "Waiting for input");
});

ipcRenderer.on("assistant-action", (_event, action) => {
  setSectionText(actionElement, action, "Standing by");
});
