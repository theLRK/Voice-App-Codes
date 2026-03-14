const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const recorder = require("node-record-lpcm16");
const recorders = require("node-record-lpcm16/recorders");

const DEFAULT_OUTPUT_PATH = path.join(__dirname, "recording.wav");
const DEFAULT_DURATION_MS = 5000;
const SOX_DIR = "C:\\tools\\sox";
const SOX_EXE = path.join(SOX_DIR, "sox.exe");
const WAV_HEADER_SIZE = 44;
const PCM_SAMPLE_RATE = 16000;
const PCM_CHANNELS = 1;
const PCM_BITS_PER_SAMPLE = 16;
const PCM_BYTES_PER_SAMPLE = PCM_BITS_PER_SAMPLE / 8;
const PCM_FRAME_BYTES = PCM_CHANNELS * PCM_BYTES_PER_SAMPLE;
const CAPTURE_SPEECH_RMS_THRESHOLD = Number(
  process.env.FLOWMATIVE_CAPTURE_SPEECH_RMS_THRESHOLD || 0.012
);
const CAPTURE_SPEECH_HANGOVER_MS = Number(
  process.env.FLOWMATIVE_CAPTURE_SPEECH_HANGOVER_MS || 240
);

if (!recorders.__flowmativeWindowsSoxPatchApplied) {
  const originalLoad = recorders.load.bind(recorders);

  recorders.load = (recorderName) => {
    if (recorderName === "sox" && process.platform === "win32") {
      return (options) => ({
        cmd: SOX_EXE,
        args: [
          "-q",
          "-t", "waveaudio",
          options.device || "default",
          "-r", String(options.sampleRate),
          "-c", String(options.channels),
          "-e", "signed-integer",
          "-b", "16",
          "-t", options.audioType,
          "-"
        ],
        spawnOptions: {
          env: { ...process.env }
        }
      });
    }

    return originalLoad(recorderName);
  };

  recorders.__flowmativeWindowsSoxPatchApplied = true;
}

function ensureSoxPath() {
  const pathEntries = (process.env.PATH || "").split(path.delimiter).filter(Boolean);

  if (!pathEntries.includes(SOX_DIR)) {
    process.env.PATH = [SOX_DIR, ...pathEntries].join(path.delimiter);
  }
}

function ensureSoxAvailable() {
  ensureSoxPath();

  if (!fs.existsSync(SOX_EXE)) {
    throw new Error("SoX not found. Please install SoX and ensure it is in PATH.");
  }
}

function normalizeRecordingError(error) {
  if (error instanceof Error) {
    return error;
  }

  if (typeof error === "string" && error.trim()) {
    return new Error(error);
  }

  return new Error("Microphone capture failed.");
}

function roundNumber(value, digits = 3) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Number(value.toFixed(digits));
}

function createCaptureDiagnostics(config) {
  const threshold = config.speechRmsThreshold;
  const hangoverFrames = Math.max(
    1,
    Math.round((config.sampleRate * config.speechHangoverMs) / 1000)
  );

  let totalFrames = 0;
  let totalChunks = 0;
  let totalBytes = 0;
  let sumRms = 0;
  let peak = 0;
  let speechFrames = 0;
  let currentSegment = null;
  let lastSpeechFrame = null;
  const speechSegments = [];

  const finishSegment = (endFrame) => {
    if (!currentSegment) {
      return;
    }

    const segmentDurationFrames = Math.max(0, endFrame - currentSegment.startFrame);

    if (segmentDurationFrames > 0) {
      speechSegments.push({
        startMs: Math.round((currentSegment.startFrame / config.sampleRate) * 1000),
        endMs: Math.round((endFrame / config.sampleRate) * 1000),
        durationMs: Math.round((segmentDurationFrames / config.sampleRate) * 1000),
        peak: roundNumber(currentSegment.peak, 4),
        rms: roundNumber(currentSegment.maxRms, 4)
      });
    }

    currentSegment = null;
    lastSpeechFrame = null;
  };

  return {
    observe(chunk) {
      if (!chunk || chunk.length < PCM_BYTES_PER_SAMPLE) {
        return;
      }

      const usableBytes = chunk.length - (chunk.length % PCM_FRAME_BYTES);

      if (!usableBytes) {
        return;
      }

      let peakValue = 0;
      let energy = 0;
      let sampleCount = 0;

      for (let offset = 0; offset < usableBytes; offset += PCM_BYTES_PER_SAMPLE) {
        const sample = chunk.readInt16LE(offset) / 32768;
        const magnitude = Math.abs(sample);
        peakValue = Math.max(peakValue, magnitude);
        energy += sample * sample;
        sampleCount += 1;
      }

      if (!sampleCount) {
        return;
      }

      const chunkFrames = sampleCount / config.channels;
      const rms = Math.sqrt(energy / sampleCount);
      const speechLikely = rms >= threshold;
      const nextTotalFrames = totalFrames + chunkFrames;

      totalChunks += 1;
      totalBytes += usableBytes;
      totalFrames = nextTotalFrames;
      peak = Math.max(peak, peakValue);
      sumRms += rms;

      if (speechLikely) {
        speechFrames += chunkFrames;
        lastSpeechFrame = nextTotalFrames;

        if (!currentSegment) {
          currentSegment = {
            startFrame: nextTotalFrames - chunkFrames,
            peak: peakValue,
            maxRms: rms
          };
        } else {
          currentSegment.peak = Math.max(currentSegment.peak, peakValue);
          currentSegment.maxRms = Math.max(currentSegment.maxRms, rms);
        }
      } else if (currentSegment && lastSpeechFrame !== null && nextTotalFrames - lastSpeechFrame >= hangoverFrames) {
        finishSegment(nextTotalFrames);
      }
    },
    finalize() {
      if (currentSegment) {
        finishSegment(totalFrames);
      }

      return this.snapshot();
    },
    snapshot() {
      const durationSeconds = totalFrames / config.sampleRate;

      return {
        config: {
          recorder: config.recorder,
          sampleRate: config.sampleRate,
          channels: config.channels,
          bitsPerSample: config.bitsPerSample,
          speechRmsThreshold: roundNumber(config.speechRmsThreshold, 4),
          speechHangoverMs: config.speechHangoverMs
        },
        chunkCount: totalChunks,
        bytes: totalBytes,
        durationSeconds: roundNumber(durationSeconds),
        averageRms: roundNumber(totalChunks ? sumRms / totalChunks : 0, 4),
        peak: roundNumber(peak, 4),
        speechDurationSeconds: roundNumber(speechFrames / config.sampleRate),
        speechRatio: roundNumber(totalFrames ? speechFrames / totalFrames : 0),
        speechSegmentCount: speechSegments.length,
        speechSegments: speechSegments.map((segment) => ({ ...segment }))
      };
    }
  };
}

function createWavBufferFromPcm(pcmBuffer) {
  const byteRate = PCM_SAMPLE_RATE * PCM_CHANNELS * (PCM_BITS_PER_SAMPLE / 8);
  const blockAlign = PCM_CHANNELS * (PCM_BITS_PER_SAMPLE / 8);
  const header = Buffer.alloc(WAV_HEADER_SIZE);

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcmBuffer.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(PCM_CHANNELS, 22);
  header.writeUInt32LE(PCM_SAMPLE_RATE, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(PCM_BITS_PER_SAMPLE, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcmBuffer.length, 40);

  return Buffer.concat([header, pcmBuffer]);
}

function playBeep(frequency, duration) {
  if (process.platform !== "win32") {
    process.stdout.write("\u0007");
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    execFile(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `[console]::Beep(${frequency}, ${duration})`
      ],
      () => resolve()
    );
  });
}

async function recordAudio(options = {}) {
  const outputPath = options.outputPath || DEFAULT_OUTPUT_PATH;
  const durationMs = options.durationMs || DEFAULT_DURATION_MS;
  const outputFileName = path.basename(outputPath);
  const onChunk = typeof options.onChunk === "function" ? options.onChunk : null;
  const captureConfig = {
    recorder: "sox",
    sampleRate: PCM_SAMPLE_RATE,
    channels: PCM_CHANNELS,
    bitsPerSample: PCM_BITS_PER_SAMPLE,
    speechRmsThreshold: Number.isFinite(options.speechRmsThreshold)
      ? options.speechRmsThreshold
      : CAPTURE_SPEECH_RMS_THRESHOLD,
    speechHangoverMs: Number.isFinite(options.speechHangoverMs)
      ? options.speechHangoverMs
      : CAPTURE_SPEECH_HANGOVER_MS
  };
  const captureDiagnostics = createCaptureDiagnostics(captureConfig);
  let finalCaptureDiagnostics = null;

  ensureSoxAvailable();
  fs.rmSync(outputPath, { force: true });

  if (options.logStart !== false) {
    console.log("Recording started...");
  }
  if (options.logConfig !== false) {
    console.log("Microphone config:", JSON.stringify(captureConfig));
  }
  if (options.beep !== false) {
    await playBeep(1046, 150);
  }

  const outputStream = fs.createWriteStream(outputPath);
  const recording = recorder.record({
    sampleRate: captureConfig.sampleRate,
    channels: captureConfig.channels,
    threshold: 0,
    silence: "1.0",
    audioType: "wav",
    endOnSilence: false,
    recorder: captureConfig.recorder,
    verbose: false
  });
  const inputStream = recording.stream();
  let stopTriggered = false;
  let completed = false;
  let wavHeaderBuffer = Buffer.alloc(0);
  let wavHeaderStripped = false;
  let pcmBuffers = [];
  let pcmBytes = 0;
  let resolveDone;
  let rejectDone;

  const done = new Promise((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });

  const stop = () => {
    if (stopTriggered) {
      return;
    }

    stopTriggered = true;

    if (recording.process && typeof recording.process.kill === "function") {
      recording.process.kill("SIGINT");
      return;
    }

    recording.stop();
  };

  const fail = (error) => {
    if (completed) {
      return;
    }

    if (
      stopTriggered &&
      typeof error === "string" &&
      error.includes("has exited with error code")
    ) {
      return;
    }

    if (error && error.code === "ENOENT") {
      rejectDone(new Error("SoX not found. Please install SoX and ensure it is in PATH."));
      return;
    }

    rejectDone(normalizeRecordingError(error));
  };

  const handleAudioChunk = (chunk) => {
    if (!chunk || !chunk.length) {
      return;
    }

    let pcmChunk = chunk;

    if (!wavHeaderStripped) {
      wavHeaderBuffer = Buffer.concat([wavHeaderBuffer, chunk]);

      if (wavHeaderBuffer.length <= WAV_HEADER_SIZE) {
        return;
      }

      pcmChunk = wavHeaderBuffer.subarray(WAV_HEADER_SIZE);
      wavHeaderBuffer = Buffer.alloc(0);
      wavHeaderStripped = true;
    }

    if (!pcmChunk.length) {
      return;
    }

    captureDiagnostics.observe(pcmChunk);
    pcmBuffers.push(Buffer.from(pcmChunk));
    pcmBytes += pcmChunk.length;

    if (!onChunk) {
      return;
    }

    Promise.resolve(onChunk(Buffer.from(pcmChunk))).catch((error) => {
      console.error(`Streaming chunk handler failed: ${normalizeRecordingError(error).message}`);
    });
  };

  outputStream.on("finish", async () => {
    completed = true;

    const pcmBuffer = pcmBytes ? Buffer.concat(pcmBuffers, pcmBytes) : Buffer.alloc(0);
    const normalizedWavBuffer = createWavBufferFromPcm(pcmBuffer);
    fs.writeFileSync(outputPath, normalizedWavBuffer);
    finalCaptureDiagnostics = captureDiagnostics.finalize();

    if (options.beep !== false) {
      await playBeep(784, 150);
    }

    if (options.logComplete !== false) {
      console.log(`Recording complete: ${outputFileName}`);
    }

    resolveDone(outputPath);
  });

  outputStream.on("error", fail);
  inputStream.on("error", fail);
  inputStream.on("data", handleAudioChunk);

  inputStream.pipe(outputStream);

  if (!options.manualStop) {
    setTimeout(stop, durationMs);
    return done;
  }

  return {
    outputPath,
    getDiagnostics: () => finalCaptureDiagnostics || captureDiagnostics.snapshot(),
    stop: async () => {
      stop();
      return done;
    },
    done
  };
}

module.exports = {
  recordAudio,
  DEFAULT_OUTPUT_PATH
};

if (require.main === module) {
  recordAudio().catch((error) => {
    console.error(`Microphone capture failed: ${error.message}`);
    process.exitCode = 1;
  });
}
