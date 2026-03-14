const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");
const { execFile } = require("child_process");
const { promisify } = require("util");
const axios = require("axios");
const FormData = require("form-data");

const TRANSCRIBE_URL = "http://127.0.0.1:8000/transcribe";
const STREAM_TRANSCRIBE_URL = "http://127.0.0.1:8000/transcribe/stream";
const DEFAULT_AUDIO_FILE_PATH = path.join(__dirname, "recording.wav");
const execFileAsync = promisify(execFile);
const DEFAULT_STREAM_CHUNK_BYTES = 32000;
const DEFAULT_STREAM_FLUSH_INTERVAL_MS = 450;
const DEFAULT_STREAM_MIN_VOICED_BYTES = 12000;
const DEFAULT_STREAM_SILENCE_RMS_THRESHOLD = Number(
  process.env.FLOWMATIVE_STREAM_SILENCE_RMS_THRESHOLD || 0.01
);
const DEFAULT_STREAM_SILENCE_HANGOVER_CHUNKS = Number(
  process.env.FLOWMATIVE_STREAM_SILENCE_HANGOVER_CHUNKS || 2
);
const NORMALIZED_SAMPLE_RATE = 16000;
const NORMALIZED_CHANNELS = 1;
const NORMALIZED_SAMPLE_FORMAT = "s16";
const NORMALIZATION_FILTER_GRAPH = process.env.FLOWMATIVE_TRANSCRIPTION_FILTER
  || "highpass=f=70,lowpass=f=7600,dynaudnorm=f=150:g=15";
const FINAL_TRANSCRIPTION_DEFAULTS = {
  beamSize: 5,
  vadFilter: true,
  conditionOnPreviousText: true,
  patience: 1.2,
  repetitionPenalty: 1.02,
  noSpeechThreshold: 0.45,
  logProbThreshold: -1.0
};
const STREAM_TRANSCRIPTION_DEFAULTS = {
  beamSize: 2,
  vadFilter: true,
  conditionOnPreviousText: false,
  patience: 1.0,
  repetitionPenalty: 1.01,
  noSpeechThreshold: 0.5,
  logProbThreshold: -1.2
};

function roundNumber(value, digits = 3) {
  if (!Number.isFinite(value)) {
    return null;
  }

  return Number(value.toFixed(digits));
}

function normalizeLanguage(language) {
  if (typeof language !== "string" || !language.trim()) {
    return null;
  }

  const cleaned = language.trim().replace(/_/g, "-");
  const primarySubtag = cleaned.split("-")[0].toLowerCase();

  return /^[a-z]{2,3}$/.test(primarySubtag) ? primarySubtag : null;
}

function normalizeTranscriptionError(error, url) {
  if (error.response) {
    const detail = error.response.data?.detail || error.response.statusText;
    return new Error(`Transcription request failed: ${error.response.status} ${detail}`);
  }

  if (error.code === "ECONNREFUSED" || error.code === "ECONNABORTED" || error.code === "ENOTFOUND") {
    return new Error(`Transcription service is not reachable at ${url}.`);
  }

  return new Error(`Failed to transcribe audio: ${error.message}`);
}

function readWavMetadata(filePath) {
  try {
    const header = fs.readFileSync(filePath).subarray(0, 44);

    if (
      header.length < 44
      || header.toString("ascii", 0, 4) !== "RIFF"
      || header.toString("ascii", 8, 12) !== "WAVE"
    ) {
      return null;
    }

    const channels = header.readUInt16LE(22);
    const sampleRate = header.readUInt32LE(24);
    const byteRate = header.readUInt32LE(28);
    const bitsPerSample = header.readUInt16LE(34);
    const dataBytes = header.readUInt32LE(40);

    return {
      filePath,
      channels,
      sampleRate,
      bitsPerSample,
      byteRate,
      bytes: dataBytes,
      durationSeconds: roundNumber(byteRate ? dataBytes / byteRate : 0)
    };
  } catch (error) {
    return null;
  }
}

function buildRequestOptions(options = {}, mode = "final") {
  const defaults = mode === "stream"
    ? STREAM_TRANSCRIPTION_DEFAULTS
    : FINAL_TRANSCRIPTION_DEFAULTS;

  return {
    language: normalizeLanguage(options.language)
      || normalizeLanguage(process.env.FLOWMATIVE_TRANSCRIPTION_LANGUAGE),
    beamSize: Number.isFinite(options.beamSize) ? options.beamSize : defaults.beamSize,
    vadFilter: typeof options.vadFilter === "boolean" ? options.vadFilter : defaults.vadFilter,
    conditionOnPreviousText: typeof options.conditionOnPreviousText === "boolean"
      ? options.conditionOnPreviousText
      : defaults.conditionOnPreviousText,
    patience: Number.isFinite(options.patience) ? options.patience : defaults.patience,
    repetitionPenalty: Number.isFinite(options.repetitionPenalty)
      ? options.repetitionPenalty
      : defaults.repetitionPenalty,
    noSpeechThreshold: Number.isFinite(options.noSpeechThreshold)
      ? options.noSpeechThreshold
      : defaults.noSpeechThreshold,
    logProbThreshold: Number.isFinite(options.logProbThreshold)
      ? options.logProbThreshold
      : defaults.logProbThreshold,
    hotwords: typeof options.hotwords === "string" && options.hotwords.trim()
      ? options.hotwords.trim()
      : null,
    usePersonalDictionary: options.usePersonalDictionary !== false,
    requestLabel: typeof options.requestLabel === "string" && options.requestLabel.trim()
      ? options.requestLabel.trim()
      : null
  };
}

function appendFormField(form, name, value) {
  if (value === undefined || value === null || value === "") {
    return;
  }

  form.append(name, String(value));
}

async function normalizeAudioForTranscription(audioFilePath) {
  const normalizedPath = path.join(
    path.dirname(audioFilePath),
    `${path.basename(audioFilePath, path.extname(audioFilePath) || ".wav")}.normalized.wav`
  );

  fs.rmSync(normalizedPath, { force: true });

  try {
    await execFileAsync("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      audioFilePath,
      "-vn",
      "-ac",
      String(NORMALIZED_CHANNELS),
      "-ar",
      String(NORMALIZED_SAMPLE_RATE),
      "-sample_fmt",
      NORMALIZED_SAMPLE_FORMAT,
      "-af",
      NORMALIZATION_FILTER_GRAPH,
      normalizedPath
    ]);

    if (!fs.existsSync(normalizedPath)) {
      throw new Error(`Normalized audio file not created: ${normalizedPath}`);
    }

    console.log("Audio normalized for transcription");
    return {
      filePath: normalizedPath,
      metadata: readWavMetadata(normalizedPath),
      cleanup: () => {
        fs.rmSync(normalizedPath, { force: true });
      }
    };
  } catch (error) {
    if (error && (error.code === "ENOENT" || /not recognized/i.test(error.message || ""))) {
      return {
        filePath: audioFilePath,
        metadata: readWavMetadata(audioFilePath),
        cleanup: null
      };
    }

    throw error;
  }
}

function buildDiagnostics(payload, context = {}) {
  const segments = Array.isArray(payload?.segments) ? payload.segments : [];

  return {
    requestLabel: context.requestOptions?.requestLabel || null,
    language: payload?.language || context.requestOptions?.language || null,
    languageProbability: roundNumber(payload?.language_probability),
    confidence: roundNumber(payload?.confidence),
    avgLogProb: roundNumber(payload?.avg_logprob),
    noSpeechProbability: roundNumber(payload?.no_speech_probability),
    durationSeconds: roundNumber(payload?.duration),
    speechDurationSeconds: roundNumber(payload?.speech_duration),
    speechRatio: roundNumber(payload?.speech_ratio),
    segmentCount: Number.isFinite(payload?.segment_count)
      ? payload.segment_count
      : segments.length,
    audio: context.audioMetadata || null,
    segments,
    request: context.requestOptions ? {
      beamSize: context.requestOptions.beamSize,
      vadFilter: context.requestOptions.vadFilter,
      conditionOnPreviousText: context.requestOptions.conditionOnPreviousText,
      patience: context.requestOptions.patience,
      repetitionPenalty: context.requestOptions.repetitionPenalty,
      noSpeechThreshold: context.requestOptions.noSpeechThreshold,
      logProbThreshold: context.requestOptions.logProbThreshold,
      language: context.requestOptions.language
    } : null
  };
}

async function transcribeAudio(audioFilePath = DEFAULT_AUDIO_FILE_PATH, options = {}) {
  if (!fs.existsSync(audioFilePath)) {
    throw new Error(`Audio file not found: ${audioFilePath}`);
  }

  const requestOptions = buildRequestOptions(options, "final");
  const normalizedAudio = await normalizeAudioForTranscription(audioFilePath);
  const form = new FormData();
  form.append("file", fs.createReadStream(normalizedAudio.filePath));
  appendFormField(form, "language", requestOptions.language);
  appendFormField(form, "beam_size", requestOptions.beamSize);
  appendFormField(form, "vad_filter", requestOptions.vadFilter);
  appendFormField(form, "condition_on_previous_text", requestOptions.conditionOnPreviousText);
  appendFormField(form, "patience", requestOptions.patience);
  appendFormField(form, "repetition_penalty", requestOptions.repetitionPenalty);
  appendFormField(form, "no_speech_threshold", requestOptions.noSpeechThreshold);
  appendFormField(form, "log_prob_threshold", requestOptions.logProbThreshold);
  appendFormField(form, "hotwords", requestOptions.hotwords);
  appendFormField(form, "use_personal_dictionary", requestOptions.usePersonalDictionary);
  appendFormField(form, "request_label", requestOptions.requestLabel);

  try {
    const response = await axios.post(options.url || TRANSCRIBE_URL, form, {
      headers: form.getHeaders(),
      maxBodyLength: Infinity,
      timeout: 60000
    });

    const payload = response.data || {};
    const transcript = typeof payload.transcript === "string"
      ? payload.transcript.trim()
      : "";
    const diagnostics = buildDiagnostics(payload, {
      audioMetadata: normalizedAudio.metadata,
      requestOptions
    });

    if (options.logTranscript !== false) {
      console.log(`Transcript: ${transcript}`);
    }

    if (options.logDiagnostics) {
      console.log("Transcription diagnostics:", JSON.stringify(diagnostics));
    }

    if (options.returnFullResponse) {
      return {
        transcript,
        diagnostics,
        raw: payload
      };
    }

    return transcript;
  } catch (error) {
    throw normalizeTranscriptionError(error, options.url || TRANSCRIBE_URL);
  } finally {
    if (typeof normalizedAudio.cleanup === "function") {
      normalizedAudio.cleanup();
    }
  }
}

async function postStreamingChunk(url, payload) {
  const form = new FormData();
  form.append("session_id", payload.sessionId);
  form.append("chunk_index", String(payload.chunkIndex));
  form.append("is_final", String(payload.isFinal));
  appendFormField(form, "language", payload.requestOptions.language);
  appendFormField(form, "beam_size", payload.requestOptions.beamSize);
  appendFormField(form, "vad_filter", payload.requestOptions.vadFilter);
  appendFormField(form, "condition_on_previous_text", payload.requestOptions.conditionOnPreviousText);
  appendFormField(form, "patience", payload.requestOptions.patience);
  appendFormField(form, "repetition_penalty", payload.requestOptions.repetitionPenalty);
  appendFormField(form, "no_speech_threshold", payload.requestOptions.noSpeechThreshold);
  appendFormField(form, "log_prob_threshold", payload.requestOptions.logProbThreshold);
  appendFormField(form, "hotwords", payload.requestOptions.hotwords);
  appendFormField(form, "use_personal_dictionary", payload.requestOptions.usePersonalDictionary);
  appendFormField(form, "request_label", payload.requestOptions.requestLabel);

  if (payload.chunk && payload.chunk.length) {
    form.append("file", payload.chunk, {
      filename: `chunk-${payload.chunkIndex}.pcm`,
      contentType: "application/octet-stream"
    });
  }

  try {
    const response = await axios.post(url, form, {
      headers: form.getHeaders(),
      maxBodyLength: Infinity,
      timeout: 60000
    });

    return response.data || {};
  } catch (error) {
    throw normalizeTranscriptionError(error, url);
  }
}

function getPcmChunkRms(chunk) {
  if (!chunk || chunk.length < 2) {
    return 0;
  }

  const usableBytes = chunk.length - (chunk.length % 2);

  if (!usableBytes) {
    return 0;
  }

  let energy = 0;
  let samples = 0;

  for (let offset = 0; offset < usableBytes; offset += 2) {
    const sample = chunk.readInt16LE(offset) / 32768;
    energy += sample * sample;
    samples += 1;
  }

  return samples ? Math.sqrt(energy / samples) : 0;
}

function createStreamingTranscriber(options = {}) {
  const url = options.url || STREAM_TRANSCRIBE_URL;
  const sessionId = options.sessionId || randomUUID();
  const requestOptions = buildRequestOptions(options, "stream");
  const minChunkBytes = options.minChunkBytes || DEFAULT_STREAM_CHUNK_BYTES;
  const minVoicedBytes = options.minVoicedBytes || DEFAULT_STREAM_MIN_VOICED_BYTES;
  const flushIntervalMs = options.flushIntervalMs || DEFAULT_STREAM_FLUSH_INTERVAL_MS;
  const silenceRmsThreshold = Number.isFinite(options.silenceRmsThreshold)
    ? options.silenceRmsThreshold
    : DEFAULT_STREAM_SILENCE_RMS_THRESHOLD;
  const silenceHangoverChunks = Number.isFinite(options.silenceHangoverChunks)
    ? options.silenceHangoverChunks
    : DEFAULT_STREAM_SILENCE_HANGOVER_CHUNKS;
  const onPartial = typeof options.onPartial === "function" ? options.onPartial : null;

  let pendingBuffers = [];
  let pendingBytes = 0;
  let pendingVoicedBytes = 0;
  let flushTimer = null;
  let chunkIndex = 0;
  let closed = false;
  let lastTranscript = "";
  let lastDiagnostics = null;
  let requestChain = Promise.resolve({
    transcript: "",
    diagnostics: null,
    raw: null
  });
  let silentChunkStreak = 0;

  const clearFlushTimer = () => {
    if (!flushTimer) {
      return;
    }

    clearTimeout(flushTimer);
    flushTimer = null;
  };

  const emitPartial = (payload, isFinal) => {
    if (!onPartial) {
      return;
    }

    onPartial(payload.transcript, {
      isFinal,
      sessionId,
      diagnostics: payload.diagnostics,
      raw: payload.raw
    });
  };

  const enqueueRequest = (chunk, isFinal) => {
    const currentChunkIndex = chunk.length ? chunkIndex++ : chunkIndex;

    requestChain = requestChain.catch(() => ({
      transcript: lastTranscript,
      diagnostics: lastDiagnostics,
      raw: null
    })).then(async () => {
      const rawPayload = await postStreamingChunk(url, {
        sessionId,
        chunkIndex: currentChunkIndex,
        isFinal,
        chunk,
        requestOptions
      });
      const transcript = typeof rawPayload.transcript === "string"
        ? rawPayload.transcript.trim()
        : "";
      const diagnostics = buildDiagnostics(rawPayload, { requestOptions });
      const payload = {
        transcript,
        diagnostics,
        raw: rawPayload
      };

      lastTranscript = transcript;
      lastDiagnostics = diagnostics;
      emitPartial(payload, isFinal);
      return payload;
    });

    return requestChain;
  };

  const scheduleFlush = () => {
    if (flushTimer || closed) {
      return;
    }

    flushTimer = setTimeout(() => {
      void flush().catch(() => {});
    }, flushIntervalMs);
  };

  const flush = async (isFinal = false) => {
    clearFlushTimer();

    if (!pendingBytes && !isFinal) {
      return {
        transcript: lastTranscript,
        diagnostics: lastDiagnostics,
        raw: null
      };
    }

    if (!isFinal && pendingVoicedBytes < minVoicedBytes && lastTranscript) {
      scheduleFlush();
      return {
        transcript: lastTranscript,
        diagnostics: lastDiagnostics,
        raw: null
      };
    }

    const chunk = pendingBytes ? Buffer.concat(pendingBuffers, pendingBytes) : Buffer.alloc(0);
    pendingBuffers = [];
    pendingBytes = 0;
    pendingVoicedBytes = 0;

    return enqueueRequest(chunk, isFinal);
  };

  return {
    sessionId,
    appendChunk(chunk) {
      if (closed || !chunk || !chunk.length) {
        return;
      }

      const rms = getPcmChunkRms(chunk);
      const speechLikely = rms >= silenceRmsThreshold;

      if (speechLikely) {
        silentChunkStreak = 0;
        pendingVoicedBytes += chunk.length;
      } else if (!pendingBytes || silentChunkStreak >= silenceHangoverChunks) {
        silentChunkStreak += 1;
        return;
      } else {
        silentChunkStreak += 1;
      }

      pendingBuffers.push(Buffer.from(chunk));
      pendingBytes += chunk.length;

      if (pendingBytes >= minChunkBytes && (pendingVoicedBytes >= minVoicedBytes || !lastTranscript)) {
        void flush().catch(() => {});
        return;
      }

      scheduleFlush();
    },
    async finalize() {
      if (closed) {
        return requestChain;
      }

      closed = true;
      return flush(true);
    },
    abort() {
      closed = true;
      pendingBuffers = [];
      pendingBytes = 0;
      pendingVoicedBytes = 0;
      clearFlushTimer();
    }
  };
}

module.exports = {
  transcribeAudio,
  createStreamingTranscriber,
  TRANSCRIBE_URL,
  STREAM_TRANSCRIBE_URL,
  DEFAULT_AUDIO_FILE_PATH
};

if (require.main === module) {
  transcribeAudio().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
