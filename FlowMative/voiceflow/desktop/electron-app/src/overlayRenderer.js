const api = window.flowmative;

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

api.onOverlayUpdate((payload = {}) => {
  const normalizedState = typeof payload.state === "string" && payload.state.trim() ? payload.state.trim() : "Ready";
  overlayElement.dataset.state = normalizedState.toLowerCase();
  stateElement.textContent = formatStateLabel(normalizedState);
  setSectionText(transcriptElement, payload.transcript, "Waiting for input");
  setSectionText(actionElement, payload.action, "Standing by");
});
