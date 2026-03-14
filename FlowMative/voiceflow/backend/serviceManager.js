const path = require("path");
const { spawn } = require("child_process");

const HEALTH_URL = "http://127.0.0.1:8000/health";
const PYTHON_COMMAND = process.env.PYTHON_EXECUTABLE || "python";
const WHISPER_SERVICE_DIR = path.join(__dirname, "..", "speech", "whisper-service");
const HEALTHCHECK_TIMEOUT_MS = 1500;
const STARTUP_TIMEOUT_MS = Number(process.env.WHISPER_STARTUP_TIMEOUT_MS || 600000);
const POLL_INTERVAL_MS = 750;
const RESTART_DELAY_MS = 1000;
const WAIT_LOG_INTERVAL_MS = 10000;

let serviceProcess = null;
let ensurePromise = null;
let restartTimer = null;
let stoppingService = false;

async function checkSpeechService() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HEALTHCHECK_TIMEOUT_MS);

  try {
    const response = await fetch(HEALTH_URL, {
      method: "GET",
      signal: controller.signal
    });

    if (!response.ok) {
      return false;
    }

    const payload = await response.json().catch(() => null);
    return payload?.status === "ok";
  } catch (error) {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForSpeechServiceReady(timeoutMs = STARTUP_TIMEOUT_MS) {
  const startedAt = Date.now();
  let lastWaitLogAt = 0;

  while (Date.now() - startedAt < timeoutMs) {
    if (await checkSpeechService()) {
      console.log("Whisper service ready.");
      return true;
    }

    if (Date.now() - lastWaitLogAt >= WAIT_LOG_INTERVAL_MS) {
      console.log("Waiting for Whisper service...");
      lastWaitLogAt = Date.now();
    }

    await wait(POLL_INTERVAL_MS);
  }

  throw new Error("Whisper service failed to become ready.");
}

function attachProcessLogging(child) {
  child.stdout.on("data", (chunk) => {
    process.stdout.write(`[whisper] ${chunk}`);
  });

  child.stderr.on("data", (chunk) => {
    process.stderr.write(`[whisper] ${chunk}`);
  });
}

function scheduleRestart() {
  if (stoppingService || restartTimer) {
    return;
  }

  console.log("Whisper service stopped. Restarting...");
  restartTimer = setTimeout(() => {
    restartTimer = null;
    void startSpeechService().catch((error) => {
      console.error(`Failed to restart Whisper service: ${error.message}`);
    });
  }, RESTART_DELAY_MS);
}

function spawnSpeechServiceProcess() {
  stoppingService = false;
  console.log("Starting Whisper service...");

  const child = spawn(
    PYTHON_COMMAND,
    ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000"],
    {
      cwd: WHISPER_SERVICE_DIR,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    }
  );

  attachProcessLogging(child);

  child.on("exit", () => {
    if (serviceProcess === child) {
      serviceProcess = null;
    }

    scheduleRestart();
  });

  child.on("error", (error) => {
    console.error(`Whisper service process error: ${error.message}`);
  });

  serviceProcess = child;
  return child;
}

async function startSpeechService() {
  stoppingService = false;

  if (await checkSpeechService()) {
    console.log("Whisper service ready.");
    return true;
  }

  if (!serviceProcess) {
    spawnSpeechServiceProcess();
  }

  await waitForSpeechServiceReady();
  return true;
}

async function ensureSpeechServiceRunning() {
  if (!ensurePromise) {
    ensurePromise = (async () => {
      try {
        return await startSpeechService();
      } finally {
        ensurePromise = null;
      }
    })();
  }

  return ensurePromise;
}

function stopManagedSpeechService() {
  stoppingService = true;

  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }

  if (serviceProcess && !serviceProcess.killed) {
    serviceProcess.kill();
  }

  serviceProcess = null;
}

module.exports = {
  startSpeechService,
  checkSpeechService,
  ensureSpeechServiceRunning,
  stopManagedSpeechService
};
