# Node API

This package contains the audio capture module used by FlowMative.

## API

- `startRecording(options?)`
- `stopRecording()`

`startRecording()` begins microphone capture immediately, emits live chunks, and writes the same stream into a temporary WAV file.
`stopRecording()` stops the active session and resolves with the buffered audio, temp file path, and byte count.
