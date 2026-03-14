# Electron App

Electron main-process app for FlowMative.

## Hotkey

- Hold `CTRL+SPACE` to start recording
- Release either key to stop recording, transcribe, rewrite, and type the result

## Environment

- `SPEECH_SERVICE_URL` defaults to `http://127.0.0.1:8000`
- `OPENAI_API_KEY` must be set for rewrite processing

## Native module note

`uiohook-napi`, `robotjs`, and the microphone recorder may need Electron-specific rebuild steps when you install dependencies for production use.
