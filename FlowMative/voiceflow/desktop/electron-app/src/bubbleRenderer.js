const bubbleElement = document.querySelector(".bubble");
const iconElement = document.getElementById("icon");
const labelElement = document.getElementById("label");
const api = window.flowmative;

function renderBubble(state, icon, label, hidden) {
  bubbleElement.dataset.state = state;
  bubbleElement.classList.toggle("is-hidden", hidden);
  iconElement.textContent = icon;
  labelElement.textContent = label;
}

api.onBubbleUpdate((payload = {}) => {
  switch (payload.state) {
    case "Listening":
      renderBubble("listening", "\uD83D\uDD34", "Listening", false);
      break;
    case "Processing":
      renderBubble("processing", "\u2699", "Processing", false);
      break;
    case "Typing":
      renderBubble("typing", "\u2713", "Typing", false);
      break;
    default:
      renderBubble("idle", "\u25CB", "Idle", true);
      break;
  }
});
