const DEFAULT_BASE_URL = "http://127.0.0.1:8000";

function getBaseUrl() {
  return (process.env.SPEECH_SERVICE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
}

async function request(pathname, options = {}) {
  const response = await fetch(`${getBaseUrl()}${pathname}`, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Speech service request failed: ${response.status}`);
  }

  return response.json();
}

async function listDictionaryEntries() {
  const payload = await request("/dictionary");
  return Array.isArray(payload.entries) ? payload.entries : [];
}

async function addDictionaryEntries(entries) {
  const payload = await request("/dictionary", {
    method: "POST",
    body: { entries }
  });
  return Array.isArray(payload.entries) ? payload.entries : [];
}

async function replaceDictionaryEntries(entries) {
  const payload = await request("/dictionary", {
    method: "PUT",
    body: { entries }
  });
  return Array.isArray(payload.entries) ? payload.entries : [];
}

async function deleteDictionaryEntry(entry) {
  const currentEntries = await listDictionaryEntries();
  return replaceDictionaryEntries(currentEntries.filter((item) => item !== entry));
}

async function clearDictionaryEntries() {
  const payload = await request("/dictionary", {
    method: "DELETE"
  });
  return Array.isArray(payload.entries) ? payload.entries : [];
}

module.exports = {
  listDictionaryEntries,
  addDictionaryEntries,
  replaceDictionaryEntries,
  deleteDictionaryEntry,
  clearDictionaryEntries
};
