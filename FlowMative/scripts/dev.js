const path = require("path");
const { spawn } = require("child_process");

const rootDir = path.resolve(__dirname, "..");
const whisperDir = path.join(rootDir, "voiceflow", "speech", "whisper-service");
const pythonCommand = process.env.PYTHON_EXECUTABLE || "python";
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

const children = [];
let shuttingDown = false;

function spawnProcess(label, command, args, cwd) {
  const child = spawn(command, args, {
    cwd,
    env: process.env,
    stdio: ["inherit", "pipe", "pipe"]
  });

  child.stdout.on("data", (chunk) => {
    process.stdout.write(`[${label}] ${chunk}`);
  });

  child.stderr.on("data", (chunk) => {
    process.stderr.write(`[${label}] ${chunk}`);
  });

  child.on("exit", (code, signal) => {
    if (!shuttingDown) {
      console.log(`[${label}] exited with code ${code ?? "null"} signal ${signal ?? "none"}`);
      shutdown(code || 1);
    }
  });

  children.push(child);
  return child;
}

function shutdown(exitCode = 0) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  for (const child of children) {
    if (!child.killed) {
      child.kill();
    }
  }

  setTimeout(() => {
    process.exit(exitCode);
  }, 100);
}

spawnProcess(
  "whisper",
  pythonCommand,
  ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000"],
  whisperDir
);

spawnProcess(
  "electron",
  npmCommand,
  ["run", "start", "--workspace", "voiceflow/desktop/electron-app"],
  rootDir
);

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
