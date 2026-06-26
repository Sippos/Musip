# Musip

Musip is a web-based music application featuring a "Learn a Song" functionality. It allows users to upload tracks, performs stem separation to isolate different instruments, and transcribes them for playback and learning.

## Architecture

The project is split into two main components:

1. **Frontend (Vite + Vanilla JS/HTML/CSS):**
   Handles the user interface, audio playback, and in-browser transcription. It leverages modern machine learning and web audio libraries to process and play back music.
   - **Audio Processing & Transcription:** `@spotify/basic-pitch` for pitch detection, `@tensorflow/tfjs`, and `web-audio-beat-detector`.
   - **MIDI & Synthesis:** `@tonejs/midi`, `tone`, and `spessasynth_lib` for high-quality SoundFont synthesis.

2. **Backend Server (Python + FastAPI):**
   A local stem-separation backend that runs [Demucs](https://github.com/facebookresearch/demucs) (`htdemucs`, 4-stem) to separate an uploaded track into `vocals`, `drums`, `bass`, and `other` stems. This allows the frontend to transcribe each clean stem independently for much higher accuracy. If the server is not available, the frontend falls back to legacy full-mix transcription.

## Setup & Running

### Prerequisites
- Node.js & npm
- Python 3.x
- `ffmpeg` and `ffprobe` installed and on your PATH (required by Demucs for audio decoding)

### Installation

1. Install the frontend dependencies from the root directory:
   ```bash
   npm install
   ```

2. Install the backend dependencies:
   ```bash
   cd server
   python -m venv .venv
   source .venv/bin/activate  # On Windows: .venv\Scripts\activate
   pip install -r requirements.txt
   ```
   *(Note: The server uses CPU-only PyTorch by default to save space. For GPU acceleration, install the appropriate CUDA builds and modify `app.py` as described in `server/README.md`.)*

### Running the App

You can run both the Vite frontend development server and the Python backend concurrently from the root directory:

```bash
npm run dev:all
```

Alternatively, you can run them separately:
- **Frontend:** `npm run dev`
- **Backend:** `cd server && uvicorn app:app --port 8000`

The Vite server is configured to automatically proxy `/api` requests to the local Python backend.

## How it Works
1. The user uploads an audio track in the browser.
2. The frontend sends the track to the Python backend via `/api/separate`.
3. The backend uses Demucs to split the track into 4 stems and returns the audio files.
4. The frontend downloads the stems, runs beat detection and pitch transcription (Basic Pitch) on the individual stems.
5. The application renders the transcribed MIDI data and plays it back using SpessaSynth and Tone.js.
