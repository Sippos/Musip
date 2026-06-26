"""Local stem-separation backend for Musip's "Learn a Song" flow.

Runs Demucs (htdemucs, 4-stem) on an uploaded track and serves the resulting
vocals/drums/bass/other stems back to the browser, which then transcribes each
clean stem independently. Separation is the only step that needs a server; all
transcription stays in-browser.

Run:  uvicorn app:app --port 8000   (from this directory)
"""
import os
import shutil
import tempfile
import threading
import uuid
import wave

import numpy as np

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

app = FastAPI(title="Musip Stem Server")

# Dev only: the Vite app calls us same-origin via its /api proxy, but allow any
# origin so the server also works if hit directly.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

STEMS = ("vocals", "drums", "bass", "other")
WORK_ROOT = os.path.join(tempfile.gettempdir(), "musip-stems")
os.makedirs(WORK_ROOT, exist_ok=True)

# jobId -> { status: 'queued'|'running'|'done'|'error', progress: float,
#            stems: {name: url}|None, error: str|None, dir: path }
_jobs = {}
_jobs_lock = threading.Lock()

# Demucs is heavy to import and load; do it lazily and cache the model so only
# the first separation pays the cost.
_model = None
_model_lock = threading.Lock()


def _write_wav(tensor, path, samplerate):
    """Write a (channels, samples) float tensor to a 16-bit PCM wav.

    Done with the stdlib instead of torchaudio.save so the server doesn't depend
    on a torchaudio I/O backend (ffmpeg/soundfile/torchcodec) just to write."""
    arr = tensor.detach().cpu().numpy()
    if arr.ndim == 1:
        arr = arr[None, :]
    arr = np.clip(arr.T, -1.0, 1.0)  # -> (samples, channels)
    pcm = (arr * 32767.0).astype("<i2")
    with wave.open(path, "wb") as w:
        w.setnchannels(arr.shape[1])
        w.setsampwidth(2)
        w.setframerate(int(samplerate))
        w.writeframes(pcm.tobytes())


def _get_model():
    global _model
    with _model_lock:
        if _model is None:
            from demucs.pretrained import get_model
            m = get_model("htdemucs")
            m.eval()
            _model = m
        return _model


def _separate(job_id, input_path):
    def set_progress(p):
        with _jobs_lock:
            job = _jobs[job_id]
            job["progress"] = max(job["progress"], min(0.99, p))

    try:
        # Heavy imports live inside the try so an import/runtime failure marks the
        # job as "error" instead of leaving it stuck in "queued".
        from demucs.apply import apply_model
        from demucs.audio import AudioFile

        with _jobs_lock:
            _jobs[job_id]["status"] = "running"

        model = _get_model()
        set_progress(0.1)

        wav = AudioFile(input_path).read(
            streams=0, samplerate=model.samplerate, channels=model.audio_channels
        )
        ref = wav.mean(0)
        wav = (wav - ref.mean()) / (ref.std() + 1e-8)

        # Newer demucs reports real progress via a callback dict; fall back to a
        # coarse two-step estimate on versions that don't support it.
        def callback(d):
            if d.get("state") != "end":
                return
            models = max(1, d.get("models", 1))
            idx = d.get("model_idx_in_bag", 0)
            frac = (idx + d["segment_offset"] / max(1, d["audio_length"])) / models
            set_progress(0.1 + 0.85 * frac)

        try:
            sources = apply_model(
                model, wav[None], device="cpu", progress=False, callback=callback
            )[0]
        except TypeError:
            sources = apply_model(model, wav[None], device="cpu", progress=False)[0]
            set_progress(0.9)

        sources = sources * (ref.std() + 1e-8) + ref.mean()

        out_dir = _jobs[job_id]["dir"]
        name_to_source = dict(zip(model.sources, sources))
        stems = {}
        for name in STEMS:
            source = name_to_source[name]
            out_path = os.path.join(out_dir, f"{name}.wav")
            _write_wav(source, out_path, model.samplerate)
            stems[name] = f"/api/stems/{job_id}/{name}.wav"

        with _jobs_lock:
            _jobs[job_id]["stems"] = stems
            _jobs[job_id]["progress"] = 1.0
            _jobs[job_id]["status"] = "done"
    except Exception as exc:  # noqa: BLE001 - surface any failure to the client
        with _jobs_lock:
            _jobs[job_id]["status"] = "error"
            _jobs[job_id]["error"] = str(exc)
    finally:
        try:
            os.remove(input_path)
        except OSError:
            pass


@app.post("/api/separate")
async def separate(file: UploadFile = File(...)):
    job_id = uuid.uuid4().hex
    job_dir = os.path.join(WORK_ROOT, job_id)
    os.makedirs(job_dir, exist_ok=True)

    suffix = os.path.splitext(file.filename or "")[1] or ".audio"
    input_path = os.path.join(job_dir, f"input{suffix}")
    with open(input_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    with _jobs_lock:
        _jobs[job_id] = {
            "status": "queued",
            "progress": 0.0,
            "stems": None,
            "error": None,
            "dir": job_dir,
        }

    threading.Thread(target=_separate, args=(job_id, input_path), daemon=True).start()
    return {"jobId": job_id}


@app.get("/api/separate/{job_id}")
async def job_status(job_id: str):
    with _jobs_lock:
        job = _jobs.get(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Unknown job")
        return {
            "status": job["status"],
            "progress": job["progress"],
            "stems": job["stems"],
            "error": job["error"],
        }


@app.get("/api/stems/{job_id}/{stem}.wav")
async def get_stem(job_id: str, stem: str):
    if stem not in STEMS:
        raise HTTPException(status_code=404, detail="Unknown stem")
    with _jobs_lock:
        job = _jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Unknown job")
    path = os.path.join(job["dir"], f"{stem}.wav")
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Stem not ready")
    return FileResponse(path, media_type="audio/wav")


@app.get("/api/health")
async def health():
    return {"ok": True}
