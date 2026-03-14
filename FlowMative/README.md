# FlowMative

FlowMative is a desktop-first voice workflow project organized as a small monorepo.

## Structure

```text
voiceflow/
  desktop/
    electron-app
  backend/
    node-api
  speech/
    whisper-service
  ai/
    text-processor
  utils/
    keyboard-injection
```

## Implemented in this scaffold

- `voiceflow/backend/node-api`: microphone recording module for real-time audio capture
- `voiceflow/speech/whisper-service`: FastAPI service backed by `faster-whisper`
- `voiceflow/ai/text-processor`: transcript cleanup service that calls OpenAI
- `voiceflow/utils/keyboard-injection`: active-app text insertion with `robotjs`
- `voiceflow/desktop/electron-app`: desktop orchestrator with a hold-to-dictate hotkey

## Notes

- The recorder is configured for 16 kHz mono WAV audio to keep latency low and to align with speech transcription workloads.
- `node-record-lpcm16` depends on a system recorder such as SoX or arecord being available on the host machine.

## Workspace commands

From the repo root:

```bash
npm run check
npm run dev
```

`npm run dev` starts the FastAPI whisper service and the Electron app together.
