const { ipcRenderer } = require("electron");

const bubbleElement = document.querySelector(".bubble");
const iconElement = document.getElementById("icon");
const labelElement = document.getElementById("label");

function renderBubble(state, icon, label, hidden) {
  bubbleElement.dataset.state = state;
  bubbleElement.classList.toggle("is-hidden", hidden);
  iconElement.textContent = icon;
  labelElement.textContent = label;
}

ipcRenderer.on("assistant-idle", () => {
  renderBubble("idle", "\u25CB", "Idle", true);
});

ipcRenderer.on("assistant-listening", () => {
  renderBubble("listening", "\uD83D\uDD34", "Listening", false);
});

ipcRenderer.on("assistant-processing", () => {
  renderBubble("processing", "\u2699", "Processing", false);
});

ipcRenderer.on("assistant-typing", () => {
  renderBubble("typing", "\u2713", "Typing", false);
});
