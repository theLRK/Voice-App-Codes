# Voice-App-Codes

Voice-App-Codes is a workspace for a desktop voice assistant stack built around Electron, local speech transcription, and OpenAI-powered text processing.

The main project in this repo is `FlowMative`, a desktop-first assistant that can:

- capture push-to-talk audio
- transcribe speech with a local Whisper service
- format and refine dictation before insertion
- rewrite selected text with inline voice editing commands
- route spoken commands to specialized tools
- show floating assistant UI feedback with overlays and bubbles

This repo also includes a separate `speech` folder for related Python speech work.

## Workspace Layout

```text
Voice App Codes/
  FlowMative/
    package.json
    scripts/
    voiceflow/
      ai/
      assistant/
      backend/
      config/
      desktop/
      integrations/
      plugins/
      speech/
      utils/
  speech/
    main.py
    requirements.txt
```

## FlowMative Architecture

`FlowMative/voiceflow` is organized into these major areas:

- `desktop/electron-app`: Electron desktop app, tray integration, overlays, floating bubble UI, settings, and command history
- `backend/node-api`: microphone recording pipeline, WAV handling, and transcription client
- `speech/whisper-service`: FastAPI speech service backed by `faster-whisper`
- `assistant`: command routing, refinement, formatting, editing, memory, macros, and tool integrations
- `ai/text-processor`: transcript rewrite helpers that call OpenAI
- `utils/keyboard-injection`: text insertion helpers for active applications
- `integrations` and `plugins`: app-specific and extensible command handlers

## Current Capabilities

- Push-to-talk assistant flow with tray-first startup
- Local Whisper transcription service health checks and streaming updates
- Dictation formatting and optional LLM refinement
- Inline editing commands such as rewrite, summarize, expand, and shorten selected text
- Floating listening bubble and assistant overlay UI
- Command routing for code, email, summarization, follow-up edits, plugins, and integrations
- Auto-start on login via Electron login item settings

## Requirements

### Windows desktop stack

- Node.js and npm
- Python 3
- SoX installed at `C:\tools\sox\sox.exe`
- OpenAI API key for refinement, editing, and command-generation features

### Python speech dependencies

Install from:

```bash
speech/requirements.txt
```

and for the bundled Whisper service:

```bash
FlowMative/voiceflow/speech/whisper-service/requirements.txt
```

## Getting Started

### 1. Install JavaScript dependencies

From `FlowMative`:

```bash
npm install
```

### 2. Install Python dependencies

For the Whisper service:

```bash
pip install -r FlowMative/voiceflow/speech/whisper-service/requirements.txt
```

### 3. Set environment variables

At minimum:

```bash
OPENAI_API_KEY=your_key_here
```

### 4. Start the desktop assistant stack

From `FlowMative`:

```bash
npm run dev
```

Useful commands:

```bash
npm run check
npm run electron:start
npm run dev:whisper
```

## Repository Notes

- The root repo ignores generated audio, local settings, logs, caches, and `node_modules`
- The Electron app is tray-first and is intended to run quietly in the background
- The repo currently targets a Windows workflow most directly

## License

Add a license before broader public distribution if you want reuse terms to be explicit.
