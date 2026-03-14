const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);
const DEVICE_CACHE_TTL_MS = 15000;

let cache = {
  fetchedAt: 0,
  devices: null
};

function getDefaultDevice() {
  return {
    id: "default",
    name: "System Default",
    isDefault: true
  };
}

function normalizeDevice(device) {
  if (!device || typeof device.FriendlyName !== "string" || typeof device.InstanceId !== "string") {
    return null;
  }

  const name = device.FriendlyName.trim();
  const id = device.InstanceId.trim();

  if (!name || !id) {
    return null;
  }

  return {
    id,
    name,
    isDefault: false
  };
}

async function queryWindowsAudioDevices() {
  const script = [
    "$devices = Get-PnpDevice -Class AudioEndpoint -Status OK |",
    "  Where-Object { $_.FriendlyName -like 'Microphone*' } |",
    "  Select-Object FriendlyName, InstanceId;",
    "if (-not $devices) { '[]' } else { $devices | ConvertTo-Json -Compress }"
  ].join(" ");
  const { stdout } = await execFileAsync(
    "powershell",
    ["-NoProfile", "-Command", script],
    { windowsHide: true, timeout: 12000 }
  );
  const parsed = JSON.parse(stdout.trim() || "[]");
  const devices = (Array.isArray(parsed) ? parsed : [parsed])
    .map(normalizeDevice)
    .filter(Boolean);

  return [getDefaultDevice(), ...devices];
}

async function listAudioInputDevices(options = {}) {
  const now = Date.now();

  if (!options.forceRefresh && cache.devices && now - cache.fetchedAt < DEVICE_CACHE_TTL_MS) {
    return cache.devices.map((device) => ({ ...device }));
  }

  try {
    const devices = await queryWindowsAudioDevices();
    cache = {
      fetchedAt: now,
      devices
    };
  } catch (error) {
    cache = {
      fetchedAt: now,
      devices: [getDefaultDevice()]
    };
  }

  return cache.devices.map((device) => ({ ...device }));
}

function resolvePreferredAudioDevice(settings, devices = []) {
  const preferredId = typeof settings?.preferredMicrophoneId === "string"
    ? settings.preferredMicrophoneId
    : "default";
  const matchedDevice = devices.find((device) => device.id === preferredId);

  if (matchedDevice) {
    return { ...matchedDevice };
  }

  return { ...getDefaultDevice() };
}

module.exports = {
  listAudioInputDevices,
  resolvePreferredAudioDevice
};
