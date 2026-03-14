"""
Speech transcription microservice using FastAPI and faster-whisper.

Install dependencies with:
    pip install -r requirements.txt
"""

import os
import tempfile
import time
import wave
from contextlib import asynccontextmanager, suppress
from pathlib import Path
from threading import Lock

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from faster_whisper import WhisperModel

MODEL_SIZE = "base"
ALLOWED_SUFFIXES = {".wav", ".mp3"}
STREAM_SAMPLE_RATE = 16000
STREAM_SAMPLE_WIDTH = 2
STREAM_CHANNELS = 1
STREAM_SESSION_TTL_SECONDS = 300


@asynccontextmanager
async def lifespan(app: FastAPI):
    print(f"Loading faster-whisper model: {MODEL_SIZE}")
    app.state.whisper_model = WhisperModel(
        MODEL_SIZE,
        device=os.getenv("WHISPER_DEVICE", "auto"),
        compute_type=os.getenv("WHISPER_COMPUTE_TYPE", "int8"),
    )
    app.state.streaming_sessions = {}
    app.state.streaming_sessions_lock = Lock()
    print("Whisper model loaded")
    yield


app = FastAPI(title="Speech Transcription Service", lifespan=lifespan)


def transcribe_audio_file(model: WhisperModel, file_path: str) -> str:
    segments, info = model.transcribe(
        file_path,
        beam_size=1,
        best_of=1,
        temperature=0.0,
        vad_filter=True,
        condition_on_previous_text=False,
        word_timestamps=False,
    )

    print(
        f"Detected language={info.language} "
        f"probability={info.language_probability:.2f}"
    )

    transcript_parts = []
    for segment in segments:
        text = segment.text.strip()
        print(f"[{segment.start:.2f}s -> {segment.end:.2f}s] {text}")
        if text:
            transcript_parts.append(text)

    return " ".join(transcript_parts).strip()


def write_stream_wav(file_path: str, pcm_audio: bytes) -> None:
    with wave.open(file_path, "wb") as wav_file:
        wav_file.setnchannels(STREAM_CHANNELS)
        wav_file.setsampwidth(STREAM_SAMPLE_WIDTH)
        wav_file.setframerate(STREAM_SAMPLE_RATE)
        wav_file.writeframes(pcm_audio)


def transcribe_stream_audio(model: WhisperModel, pcm_audio: bytes) -> str:
    temp_file_path = None

    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as temp_file:
            temp_file_path = temp_file.name

        write_stream_wav(temp_file_path, pcm_audio)
        return transcribe_audio_file(model, temp_file_path)
    finally:
        if temp_file_path:
            with suppress(OSError):
                os.remove(temp_file_path)


def cleanup_stale_stream_sessions(app: FastAPI) -> None:
    now = time.time()
    expired_session_ids = []

    for session_id, session in app.state.streaming_sessions.items():
        if now - session["updated_at"] > STREAM_SESSION_TTL_SECONDS:
            expired_session_ids.append(session_id)

    for session_id in expired_session_ids:
        app.state.streaming_sessions.pop(session_id, None)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "model": MODEL_SIZE}


@app.post("/transcribe")
async def transcribe(file: UploadFile = File(...)) -> dict:
    if not file.filename:
        raise HTTPException(status_code=400, detail="An audio file is required.")

    suffix = Path(file.filename).suffix.lower()
    if suffix not in ALLOWED_SUFFIXES:
        raise HTTPException(
            status_code=400,
            detail="Unsupported audio format. Please upload a .wav or .mp3 file.",
        )

    temp_file_path = None

    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
            temp_file_path = temp_file.name

            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                temp_file.write(chunk)

        transcript = transcribe_audio_file(app.state.whisper_model, temp_file_path)
        return {"transcript": transcript}
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Transcription failed: {error}",
        ) from error
    finally:
        await file.close()
        if temp_file_path:
            with suppress(OSError):
                os.remove(temp_file_path)


@app.post("/transcribe/stream")
async def transcribe_stream(
    session_id: str = Form(...),
    chunk_index: int = Form(0),
    is_final: bool = Form(False),
    file: UploadFile | None = File(default=None),
) -> dict:
    chunk_bytes = b""

    try:
        if file:
          chunk_bytes = await file.read()

        with app.state.streaming_sessions_lock:
            cleanup_stale_stream_sessions(app)

            session = app.state.streaming_sessions.setdefault(
                session_id,
                {
                    "pcm_audio": bytearray(),
                    "transcript": "",
                    "updated_at": time.time(),
                    "chunk_index": -1,
                },
            )

            if chunk_index > session["chunk_index"]:
                session["pcm_audio"].extend(chunk_bytes)
                session["chunk_index"] = chunk_index

            session["updated_at"] = time.time()
            pcm_audio = bytes(session["pcm_audio"])

        transcript = session["transcript"]
        if pcm_audio:
            transcript = transcribe_stream_audio(app.state.whisper_model, pcm_audio)

        with app.state.streaming_sessions_lock:
            active_session = app.state.streaming_sessions.get(session_id)
            if active_session is not None:
                active_session["transcript"] = transcript
                active_session["updated_at"] = time.time()

                if is_final:
                    app.state.streaming_sessions.pop(session_id, None)

        return {
            "session_id": session_id,
            "chunk_index": chunk_index,
            "is_final": is_final,
            "transcript": transcript,
        }
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Streaming transcription failed: {error}",
        ) from error
    finally:
        if file:
            await file.close()
