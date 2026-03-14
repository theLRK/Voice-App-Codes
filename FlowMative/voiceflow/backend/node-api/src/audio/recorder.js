const fs = require("fs");
const os = require("os");
const path = require("path");
const { EventEmitter } = require("events");
const { PassThrough } = require("stream");
const recorder = require("node-record-lpcm16");

let activeSession = null;

function createTempFilePath() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(os.tmpdir(), `flowmative-recording-${stamp}.wav`);
}

function startRecording(options = {}) {
  if (activeSession) {
    throw new Error("A recording session is already active.");
  }

  const emitter = new EventEmitter();
  const chunkStream = new PassThrough();
  const tempFilePath = options.tempFilePath || createTempFilePath();
  fs.mkdirSync(path.dirname(tempFilePath), { recursive: true });
  const fileWriter = fs.createWriteStream(tempFilePath);
  const bufferedChunks = [];

  const recording = recorder.record({
    sampleRate: options.sampleRate || 16000,
    channels: options.channels || 1,
    audioType: options.audioType || "wav",
    endOnSilence: false,
    recorder: options.recorder,
    silence: options.silence,
    threshold: options.threshold,
    verbose: false
  });

  const inputStream = recording.stream();

  inputStream.on("data", (chunk) => {
    bufferedChunks.push(chunk);
    chunkStream.write(chunk);
    emitter.emit("data", chunk);

    if (typeof options.onAudioChunk === "function") {
      options.onAudioChunk(chunk);
    }
  });

  inputStream.on("error", (error) => {
    emitter.emit("error", error);
    chunkStream.destroy(error);
  });

  inputStream.on("end", () => {
    chunkStream.end();
    emitter.emit("end");
  });

  fileWriter.on("error", (error) => {
    emitter.emit("error", error);
    chunkStream.destroy(error);
  });

  inputStream.pipe(fileWriter);

  activeSession = {
    emitter,
    chunkStream,
    fileWriter,
    bufferedChunks,
    recording,
    tempFilePath
  };

  return {
    audioStream: chunkStream,
    events: emitter,
    tempFilePath
  };
}

function stopRecording() {
  if (!activeSession) {
    throw new Error("No active recording session to stop.");
  }

  const session = activeSession;
  activeSession = null;

  return new Promise((resolve, reject) => {
    let settled = false;

    const finalize = () => {
      if (settled) {
        return;
      }

      settled = true;
      const buffer = Buffer.concat(session.bufferedChunks);

      resolve({
        buffer,
        bytes: buffer.length,
        tempFilePath: session.tempFilePath
      });
    };

    const fail = (error) => {
      if (settled) {
        return;
      }

      settled = true;
      reject(error);
    };

    session.fileWriter.once("finish", finalize);
    session.fileWriter.once("error", fail);
    session.events.once("error", fail);

    try {
      session.recording.stop();
    } catch (error) {
      fail(error);
    }
  });
}

module.exports = {
  startRecording,
  stopRecording
};
