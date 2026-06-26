# Musip Stem Server

Local stem-separation backend for Musip's "Learn a Song" feature. It runs
[Demucs](https://github.com/facebookresearch/demucs) (`htdemucs`, 4-stem) over an
uploaded track and serves back the `vocals / drums / bass / other` stems. The
browser then transcribes each clean stem on its own — separation is the only
part that needs a server.

If this server isn't running, the app falls back to the legacy in-browser
full-mix transcription, so it stays usable standalone (just lower quality).

## Setup

```bash
cd server
python -m venv .venv && source .venv/bin/activate   # optional but recommended
pip install -r requirements.txt
```

`requirements.txt` installs the **CPU-only** torch/torchaudio from PyTorch's CPU
index (the default PyPI wheels pull multiple GB of CUDA libs). For GPU, install
the matching CUDA builds instead and set `device="cuda"` in `app.py`.

**`ffmpeg` and `ffprobe` must both be on your PATH** — Demucs shells out to them
to decode the upload. Use your OS package manager, or without admin rights:

```bash
pip install static-ffmpeg
python -c "import static_ffmpeg.run as r; print(*r.get_or_fetch_platform_executables_else_raise())"
# symlink the printed ffmpeg/ffprobe paths into a directory on your PATH
```

The first separation downloads the `htdemucs` weights (~80 MB) and caches them
under `~/.cache/torch`. Stems are written with the stdlib `wave` module, so no
torchaudio I/O backend (torchcodec/soundfile) is required for output.

## Run

```bash
uvicorn app:app --port 8000
```

The Vite dev server proxies `/api` here (see `vite.config.js`), so the browser
talks to it same-origin. To run the frontend and backend together from the repo
root: `npm run dev:all`.

CPU separation of a ~3-minute song takes a couple of minutes; a CUDA GPU is much
faster. To use a GPU, change `device="cpu"` to `device="cuda"` in `app.py`.

## API

- `POST /api/separate` — multipart `file=@song.mp3` → `{ "jobId": "..." }`
- `GET  /api/separate/{jobId}` — `{ status, progress, stems, error }`; `stems`
  is `{ vocals, drums, bass, other }` of stem URLs once `status == "done"`
- `GET  /api/stems/{jobId}/{stem}.wav` — the rendered stem (44.1 kHz wav)
- `GET  /api/health` — liveness check

Jobs and stems live in a temp dir (`$TMPDIR/musip-stems`) and are not persisted
across restarts.
