# Whisper Service

FastAPI microservice for audio transcription with `faster-whisper`.

## Run

```bash
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

## Endpoint

- `POST /transcribe`
- `GET /dictionary`
- `POST /dictionary`
- `PUT /dictionary`
- `DELETE /dictionary`

Send multipart form data with an audio file in the `file` field. Optional form fields:

- `language`
- `beam_size`
- `vad_filter`
- `hotwords`
- `use_personal_dictionary`
