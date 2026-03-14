import json
import logging
import math
import os
import tempfile
import time
import wave
from contextlib import suppress
from threading import Lock
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from faster_whisper import WhisperModel
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

MODEL_SIZE = os.getenv("WHISPER_MODEL_SIZE", "small")
DEVICE = os.getenv("WHISPER_DEVICE", "auto")
COMPUTE_TYPE = os.getenv("WHISPER_COMPUTE_TYPE", "int8")
CPU_THREADS = int(os.getenv("WHISPER_CPU_THREADS", "4"))
NUM_WORKERS = int(os.getenv("WHISPER_NUM_WORKERS", "1"))
APP_DIR = os.path.dirname(os.path.abspath(__file__))
SERVICE_ROOT = os.path.dirname(APP_DIR)
DATA_DIR = os.getenv("WHISPER_DATA_DIR", os.path.join(SERVICE_ROOT, "data"))
DICTIONARY_PATH = os.getenv(
    "WHISPER_DICTIONARY_PATH",
    os.path.join(DATA_DIR, "personal_dictionary.json"),
)
STREAM_SAMPLE_RATE = 16000
STREAM_SAMPLE_WIDTH = 2
STREAM_CHANNELS = 1
STREAM_MIN_TRANSCRIBE_BYTES = int(
    os.getenv(
        "WHISPER_STREAM_MIN_TRANSCRIBE_BYTES",
        str(STREAM_SAMPLE_RATE * STREAM_SAMPLE_WIDTH * STREAM_CHANNELS),
    )
)
STREAM_SESSION_TTL_SECONDS = int(os.getenv("WHISPER_STREAM_SESSION_TTL_SECONDS", "300"))
DEFAULT_BEAM_SIZE = int(os.getenv("WHISPER_DEFAULT_BEAM_SIZE", "5"))
DEFAULT_STREAM_BEAM_SIZE = int(os.getenv("WHISPER_STREAM_BEAM_SIZE", "2"))
DEFAULT_PATIENCE = float(os.getenv("WHISPER_DEFAULT_PATIENCE", "1.2"))
DEFAULT_STREAM_PATIENCE = float(os.getenv("WHISPER_STREAM_PATIENCE", "1.0"))
DEFAULT_REPETITION_PENALTY = float(os.getenv("WHISPER_DEFAULT_REPETITION_PENALTY", "1.02"))
DEFAULT_STREAM_REPETITION_PENALTY = float(
    os.getenv("WHISPER_STREAM_REPETITION_PENALTY", "1.01")
)
DEFAULT_NO_SPEECH_THRESHOLD = float(os.getenv("WHISPER_DEFAULT_NO_SPEECH_THRESHOLD", "0.45"))
DEFAULT_STREAM_NO_SPEECH_THRESHOLD = float(
    os.getenv("WHISPER_STREAM_NO_SPEECH_THRESHOLD", "0.5")
)
DEFAULT_LOG_PROB_THRESHOLD = float(os.getenv("WHISPER_DEFAULT_LOG_PROB_THRESHOLD", "-1.0"))
DEFAULT_STREAM_LOG_PROB_THRESHOLD = float(
    os.getenv("WHISPER_STREAM_LOG_PROB_THRESHOLD", "-1.2")
)
DEFAULT_CONDITION_ON_PREVIOUS_TEXT = os.getenv(
    "WHISPER_DEFAULT_CONDITION_ON_PREVIOUS_TEXT", "true"
).lower() == "true"
DEFAULT_STREAM_CONDITION_ON_PREVIOUS_TEXT = os.getenv(
    "WHISPER_STREAM_CONDITION_ON_PREVIOUS_TEXT", "false"
).lower() == "true"
VAD_MIN_SILENCE_DURATION_MS = int(os.getenv("WHISPER_VAD_MIN_SILENCE_MS", "250"))
VAD_SPEECH_PAD_MS = int(os.getenv("WHISPER_VAD_SPEECH_PAD_MS", "120"))
VAD_MIN_SPEECH_DURATION_MS = int(os.getenv("WHISPER_VAD_MIN_SPEECH_MS", "150"))
LOG_LEVEL = os.getenv("WHISPER_LOG_LEVEL", "INFO").upper()

logging.basicConfig(
    level=getattr(logging, LOG_LEVEL, logging.INFO),
    format="%(asctime)s %(levelname)s %(message)s",
)
logger = logging.getLogger("flowmative.whisper")

app = FastAPI(title="FlowMative Whisper Service", version="0.1.0")
model = WhisperModel(
    MODEL_SIZE,
    device=DEVICE,
    compute_type=COMPUTE_TYPE,
    cpu_threads=CPU_THREADS,
    num_workers=NUM_WORKERS,
)
logger.info(
    "Loaded Whisper model=%s device=%s compute_type=%s cpu_threads=%s workers=%s",
    MODEL_SIZE,
    DEVICE,
    COMPUTE_TYPE,
    CPU_THREADS,
    NUM_WORKERS,
)
streaming_sessions: dict[str, dict] = {}
streaming_sessions_lock = Lock()


class DictionaryPayload(BaseModel):
    entries: list[str] = Field(default_factory=list)


def round_float(value: Optional[float], digits: int = 3) -> Optional[float]:
    if value is None:
        return None

    return round(float(value), digits)


def normalize_entries(entries: list[str]) -> list[str]:
    seen = set()
    normalized = []

    for entry in entries:
        cleaned = entry.strip()
        if cleaned and cleaned.lower() not in seen:
            seen.add(cleaned.lower())
            normalized.append(cleaned)

    return normalized


def ensure_dictionary_file() -> None:
    os.makedirs(DATA_DIR, exist_ok=True)

    if not os.path.exists(DICTIONARY_PATH):
        with open(DICTIONARY_PATH, "w", encoding="utf-8") as dictionary_file:
            json.dump({"entries": []}, dictionary_file, indent=2)


def load_dictionary_entries() -> list[str]:
    ensure_dictionary_file()

    with open(DICTIONARY_PATH, "r", encoding="utf-8") as dictionary_file:
        payload = json.load(dictionary_file)

    return normalize_entries(payload.get("entries", []))


def save_dictionary_entries(entries: list[str]) -> list[str]:
    ensure_dictionary_file()
    normalized = normalize_entries(entries)

    with open(DICTIONARY_PATH, "w", encoding="utf-8") as dictionary_file:
        json.dump({"entries": normalized}, dictionary_file, indent=2)

    return normalized


def build_hotwords(personal_entries: list[str], extra_hotwords: Optional[str]) -> Optional[str]:
    merged = list(personal_entries)

    if extra_hotwords:
        merged.extend(extra_hotwords.split(","))

    hotwords = normalize_entries(merged)
    return ", ".join(hotwords) if hotwords else None


def resolve_decode_settings(
    *,
    is_stream: bool,
    beam_size: Optional[int],
    vad_filter: Optional[bool],
    condition_on_previous_text: Optional[bool],
    patience: Optional[float],
    repetition_penalty: Optional[float],
    no_speech_threshold: Optional[float],
    log_prob_threshold: Optional[float],
) -> dict:
    return {
        "beam_size": beam_size
        if beam_size is not None
        else (DEFAULT_STREAM_BEAM_SIZE if is_stream else DEFAULT_BEAM_SIZE),
        "vad_filter": vad_filter if vad_filter is not None else True,
        "condition_on_previous_text": (
            condition_on_previous_text
            if condition_on_previous_text is not None
            else (
                DEFAULT_STREAM_CONDITION_ON_PREVIOUS_TEXT
                if is_stream
                else DEFAULT_CONDITION_ON_PREVIOUS_TEXT
            )
        ),
        "patience": patience
        if patience is not None
        else (DEFAULT_STREAM_PATIENCE if is_stream else DEFAULT_PATIENCE),
        "repetition_penalty": repetition_penalty
        if repetition_penalty is not None
        else (
            DEFAULT_STREAM_REPETITION_PENALTY
            if is_stream
            else DEFAULT_REPETITION_PENALTY
        ),
        "no_speech_threshold": no_speech_threshold
        if no_speech_threshold is not None
        else (
            DEFAULT_STREAM_NO_SPEECH_THRESHOLD
            if is_stream
            else DEFAULT_NO_SPEECH_THRESHOLD
        ),
        "log_prob_threshold": log_prob_threshold
        if log_prob_threshold is not None
        else (
            DEFAULT_STREAM_LOG_PROB_THRESHOLD
            if is_stream
            else DEFAULT_LOG_PROB_THRESHOLD
        ),
    }


def serialize_segment(segment) -> dict:
    return {
        "id": getattr(segment, "id", None),
        "start": round_float(getattr(segment, "start", None), 3),
        "end": round_float(getattr(segment, "end", None), 3),
        "text": getattr(segment, "text", "").strip(),
        "avg_logprob": round_float(getattr(segment, "avg_logprob", None), 4),
        "no_speech_prob": round_float(getattr(segment, "no_speech_prob", None), 4),
        "compression_ratio": round_float(getattr(segment, "compression_ratio", None), 4),
    }


def build_transcription_result(transcript_segments: list[dict], info) -> dict:
    transcript = " ".join(
        segment["text"] for segment in transcript_segments if segment["text"]
    ).strip()
    avg_logprob_values = [
        segment["avg_logprob"]
        for segment in transcript_segments
        if segment["avg_logprob"] is not None
    ]
    no_speech_prob_values = [
        segment["no_speech_prob"]
        for segment in transcript_segments
        if segment["no_speech_prob"] is not None
    ]
    speech_duration = sum(
        max(0.0, (segment["end"] or 0.0) - (segment["start"] or 0.0))
        for segment in transcript_segments
        if segment["text"]
    )
    avg_logprob = (
        sum(avg_logprob_values) / len(avg_logprob_values)
        if avg_logprob_values
        else None
    )
    no_speech_probability = (
        sum(no_speech_prob_values) / len(no_speech_prob_values)
        if no_speech_prob_values
        else None
    )
    confidence = None

    if avg_logprob is not None:
        confidence = max(0.0, min(1.0, math.exp(avg_logprob)))

    duration = getattr(info, "duration", 0.0) or 0.0

    return {
        "transcript": transcript,
        "language": getattr(info, "language", None),
        "language_probability": round_float(
            getattr(info, "language_probability", None), 4
        ),
        "duration": round_float(duration),
        "speech_duration": round_float(speech_duration),
        "speech_ratio": round_float(speech_duration / duration if duration else 0.0, 4),
        "avg_logprob": round_float(avg_logprob, 4),
        "confidence": round_float(confidence, 4),
        "no_speech_probability": round_float(no_speech_probability, 4),
        "segment_count": len(transcript_segments),
        "segments": transcript_segments,
    }


def transcribe_file(
    *,
    file_path: str,
    language: Optional[str],
    initial_prompt: Optional[str],
    hotwords: Optional[str],
    decode_settings: dict,
) -> dict:
    segments, info = model.transcribe(
        file_path,
        language=language,
        initial_prompt=initial_prompt,
        beam_size=decode_settings["beam_size"],
        patience=decode_settings["patience"],
        repetition_penalty=decode_settings["repetition_penalty"],
        condition_on_previous_text=decode_settings["condition_on_previous_text"],
        vad_filter=decode_settings["vad_filter"],
        vad_parameters={
            "min_silence_duration_ms": VAD_MIN_SILENCE_DURATION_MS,
            "speech_pad_ms": VAD_SPEECH_PAD_MS,
            "min_speech_duration_ms": VAD_MIN_SPEECH_DURATION_MS,
        },
        temperature=0.0,
        log_prob_threshold=decode_settings["log_prob_threshold"],
        no_speech_threshold=decode_settings["no_speech_threshold"],
        compression_ratio_threshold=2.4,
        word_timestamps=False,
        hotwords=hotwords,
    )

    transcript_segments = [
        serialize_segment(segment)
        for segment in segments
        if getattr(segment, "text", "").strip()
    ]

    return build_transcription_result(transcript_segments, info)


def write_pcm_wav(file_path: str, pcm_audio: bytes) -> None:
    with wave.open(file_path, "wb") as wav_file:
        wav_file.setnchannels(STREAM_CHANNELS)
        wav_file.setsampwidth(STREAM_SAMPLE_WIDTH)
        wav_file.setframerate(STREAM_SAMPLE_RATE)
        wav_file.writeframes(pcm_audio)


def transcribe_pcm_audio(
    *,
    pcm_audio: bytes,
    language: Optional[str],
    initial_prompt: Optional[str],
    hotwords: Optional[str],
    decode_settings: dict,
) -> dict:
    temp_file_path = None

    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as temp_file:
            temp_file_path = temp_file.name

        write_pcm_wav(temp_file_path, pcm_audio)
        return transcribe_file(
            file_path=temp_file_path,
            language=language,
            initial_prompt=initial_prompt,
            hotwords=hotwords,
            decode_settings=decode_settings,
        )
    finally:
        if temp_file_path:
            with suppress(OSError):
                os.remove(temp_file_path)


def cleanup_stale_stream_sessions() -> None:
    now = time.time()
    expired_session_ids = []

    for session_id, session in streaming_sessions.items():
        if now - session["updated_at"] > STREAM_SESSION_TTL_SECONDS:
            expired_session_ids.append(session_id)

    for session_id in expired_session_ids:
        streaming_sessions.pop(session_id, None)


def log_transcription_result(
    *,
    request_label: Optional[str],
    bytes_received: int,
    result: dict,
    is_stream: bool,
    elapsed_seconds: float,
    session_id: Optional[str] = None,
) -> None:
    logger.info(
        "%s transcription complete%s model=%s bytes=%s duration=%ss speech=%ss elapsed=%ss confidence=%s language=%s(%s) segments=%s",
        request_label or ("stream" if is_stream else "final"),
        f" session={session_id}" if session_id else "",
        MODEL_SIZE,
        bytes_received,
        result["duration"],
        result["speech_duration"],
        round_float(elapsed_seconds, 3),
        result["confidence"],
        result["language"],
        result["language_probability"],
        result["segment_count"],
    )


@app.get("/health")
async def healthcheck() -> dict:
    return {"status": "ok", "model": MODEL_SIZE}


@app.get("/dictionary")
async def get_dictionary() -> dict:
    return {"entries": load_dictionary_entries()}


@app.post("/dictionary")
async def add_dictionary_entries(payload: DictionaryPayload) -> dict:
    existing_entries = load_dictionary_entries()
    updated_entries = save_dictionary_entries(existing_entries + payload.entries)
    return {"entries": updated_entries}


@app.put("/dictionary")
async def replace_dictionary_entries(payload: DictionaryPayload) -> dict:
    return {"entries": save_dictionary_entries(payload.entries)}


@app.delete("/dictionary")
async def clear_dictionary_entries() -> dict:
    return {"entries": save_dictionary_entries([])}


@app.post("/transcribe")
async def transcribe(
    file: UploadFile = File(...),
    language: Optional[str] = Form(default=None),
    beam_size: Optional[int] = Form(default=None),
    vad_filter: Optional[bool] = Form(default=None),
    condition_on_previous_text: Optional[bool] = Form(default=None),
    patience: Optional[float] = Form(default=None),
    repetition_penalty: Optional[float] = Form(default=None),
    no_speech_threshold: Optional[float] = Form(default=None),
    log_prob_threshold: Optional[float] = Form(default=None),
    initial_prompt: Optional[str] = Form(default=None),
    hotwords: Optional[str] = Form(default=None),
    use_personal_dictionary: bool = Form(default=True),
    request_label: Optional[str] = Form(default=None),
) -> dict:
    if not file.filename:
        raise HTTPException(status_code=400, detail="An audio file is required.")

    suffix = os.path.splitext(file.filename)[1] or ".wav"
    temp_file_path = None
    bytes_received = 0

    try:
        started_at = time.perf_counter()
        personal_entries = load_dictionary_entries() if use_personal_dictionary else []
        merged_hotwords = build_hotwords(personal_entries, hotwords)
        decode_settings = resolve_decode_settings(
            is_stream=False,
            beam_size=beam_size,
            vad_filter=vad_filter,
            condition_on_previous_text=condition_on_previous_text,
            patience=patience,
            repetition_penalty=repetition_penalty,
            no_speech_threshold=no_speech_threshold,
            log_prob_threshold=log_prob_threshold,
        )

        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
            temp_file_path = temp_file.name
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                bytes_received += len(chunk)
                temp_file.write(chunk)

        result = await run_in_threadpool(
            transcribe_file,
            file_path=temp_file_path,
            language=language,
            initial_prompt=initial_prompt,
            hotwords=merged_hotwords,
            decode_settings=decode_settings,
        )
        log_transcription_result(
            request_label=request_label,
            bytes_received=bytes_received,
            result=result,
            is_stream=False,
            elapsed_seconds=time.perf_counter() - started_at,
        )
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Transcription failed: {error}") from error
    finally:
        await file.close()
        if temp_file_path:
            with suppress(OSError):
                os.remove(temp_file_path)

    return result


@app.post("/transcribe/stream")
async def transcribe_stream(
    session_id: str = Form(...),
    chunk_index: int = Form(default=0),
    is_final: bool = Form(default=False),
    file: UploadFile | None = File(default=None),
    language: Optional[str] = Form(default=None),
    beam_size: Optional[int] = Form(default=None),
    vad_filter: Optional[bool] = Form(default=None),
    condition_on_previous_text: Optional[bool] = Form(default=None),
    patience: Optional[float] = Form(default=None),
    repetition_penalty: Optional[float] = Form(default=None),
    no_speech_threshold: Optional[float] = Form(default=None),
    log_prob_threshold: Optional[float] = Form(default=None),
    initial_prompt: Optional[str] = Form(default=None),
    hotwords: Optional[str] = Form(default=None),
    use_personal_dictionary: bool = Form(default=True),
    request_label: Optional[str] = Form(default=None),
) -> dict:
    chunk_bytes = b""

    try:
        if file:
            chunk_bytes = await file.read()

        personal_entries = load_dictionary_entries() if use_personal_dictionary else []
        merged_hotwords = build_hotwords(personal_entries, hotwords)
        decode_settings = resolve_decode_settings(
            is_stream=True,
            beam_size=beam_size,
            vad_filter=vad_filter,
            condition_on_previous_text=condition_on_previous_text,
            patience=patience,
            repetition_penalty=repetition_penalty,
            no_speech_threshold=no_speech_threshold,
            log_prob_threshold=log_prob_threshold,
        )

        with streaming_sessions_lock:
            cleanup_stale_stream_sessions()

            session = streaming_sessions.setdefault(
                session_id,
                {
                    "pcm_audio": bytearray(),
                    "transcript": "",
                    "updated_at": time.time(),
                    "chunk_index": -1,
                    "last_transcribed_bytes": 0,
                    "language": None,
                    "language_probability": None,
                    "duration": 0.0,
                    "speech_duration": 0.0,
                    "speech_ratio": 0.0,
                    "confidence": None,
                    "avg_logprob": None,
                    "no_speech_probability": None,
                    "segment_count": 0,
                    "segments": [],
                },
            )

            if chunk_index > session["chunk_index"]:
                session["pcm_audio"].extend(chunk_bytes)
                session["chunk_index"] = chunk_index

            session["updated_at"] = time.time()
            pcm_audio = bytes(session["pcm_audio"])
            transcript = session["transcript"]
            last_transcribed_bytes = session["last_transcribed_bytes"]
            language_hint = language or session["language"]
            language_probability = session["language_probability"]
            duration = session["duration"]
            speech_duration = session["speech_duration"]
            speech_ratio = session["speech_ratio"]
            confidence = session["confidence"]
            avg_logprob = session["avg_logprob"]
            no_speech_probability = session["no_speech_probability"]
            segment_count = session["segment_count"]
            segments = session["segments"]

        should_transcribe = bool(
            pcm_audio
            and (
                is_final
                or not transcript
                or len(pcm_audio) - last_transcribed_bytes >= STREAM_MIN_TRANSCRIBE_BYTES
            )
        )

        if should_transcribe:
            started_at = time.perf_counter()
            result = await run_in_threadpool(
                transcribe_pcm_audio,
                pcm_audio=pcm_audio,
                language=language_hint,
                initial_prompt=initial_prompt,
                hotwords=merged_hotwords,
                decode_settings=decode_settings,
            )
            transcript = result["transcript"]
            language_hint = result["language"]
            language_probability = result["language_probability"]
            duration = result["duration"]
            speech_duration = result["speech_duration"]
            speech_ratio = result["speech_ratio"]
            confidence = result["confidence"]
            avg_logprob = result["avg_logprob"]
            no_speech_probability = result["no_speech_probability"]
            segment_count = result["segment_count"]
            segments = result["segments"]

            with streaming_sessions_lock:
                active_session = streaming_sessions.get(session_id)
                if active_session is not None:
                    active_session["transcript"] = transcript
                    active_session["updated_at"] = time.time()
                    active_session["last_transcribed_bytes"] = len(pcm_audio)
                    active_session["language"] = language_hint
                    active_session["language_probability"] = language_probability
                    active_session["duration"] = duration
                    active_session["speech_duration"] = speech_duration
                    active_session["speech_ratio"] = speech_ratio
                    active_session["confidence"] = confidence
                    active_session["avg_logprob"] = avg_logprob
                    active_session["no_speech_probability"] = no_speech_probability
                    active_session["segment_count"] = segment_count
                    active_session["segments"] = segments

            log_transcription_result(
                request_label=request_label,
                bytes_received=len(pcm_audio),
                result=result,
                is_stream=True,
                elapsed_seconds=time.perf_counter() - started_at,
                session_id=session_id,
            )
        elif is_final:
            with streaming_sessions_lock:
                active_session = streaming_sessions.get(session_id)
                if active_session is not None:
                    active_session["updated_at"] = time.time()

        if is_final:
            with streaming_sessions_lock:
                streaming_sessions.pop(session_id, None)

        return {
            "session_id": session_id,
            "chunk_index": chunk_index,
            "is_final": is_final,
            "transcript": transcript,
            "language": language_hint,
            "language_probability": language_probability,
            "duration": duration,
            "speech_duration": speech_duration,
            "speech_ratio": speech_ratio,
            "confidence": confidence,
            "avg_logprob": avg_logprob,
            "no_speech_probability": no_speech_probability,
            "segment_count": segment_count,
            "segments": segments,
        }
    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Streaming transcription failed: {error}",
        ) from error
    finally:
        if file:
            await file.close()
