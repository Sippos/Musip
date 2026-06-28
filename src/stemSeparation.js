// Client for the local Demucs stem server (see server/). Uploads a track, polls
// the job until the four stems are ready, then fetches and decodes each into an
// AudioBuffer for in-browser transcription. The full mix is decoded too so the
// caller can reuse it as the reference player.
//
// Separation is the only step that needs the backend; if it isn't running these
// calls throw a StemServerUnavailableError so the "Learn a Song" flow can fall
// back to the legacy in-browser full-mix transcription.

const STEM_NAMES = ['vocals', 'drums', 'bass', 'other'];
const POLL_INTERVAL_MS = 1500;

export class StemServerUnavailableError extends Error {
    constructor(message) {
        super(message || 'Stem server is not reachable.');
        this.name = 'StemServerUnavailableError';
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function startJob(file) {
    const form = new FormData();
    form.append('file', file, file.name);
    let res;
    try {
        res = await fetch('/api/separate', { method: 'POST', body: form });
    } catch (err) {
        // Network error / connection refused = no server running.
        throw new StemServerUnavailableError();
    }
    if (!res.ok) {
        if (res.status === 404 || res.status === 500 || res.status === 502 || res.status === 503) {
            throw new StemServerUnavailableError();
        }
        throw new Error(`Stem server error (${res.status}).`);
    }
    const { jobId } = await res.json();
    return jobId;
}

async function pollJob(jobId, onProgress) {
    // eslint-disable-next-line no-constant-condition
    while (true) {
        let res;
        try {
            res = await fetch(`/api/separate/${jobId}`);
        } catch (err) {
            throw new StemServerUnavailableError();
        }
        if (!res.ok) {
            if (res.status === 404 || res.status === 500 || res.status === 502 || res.status === 503) {
                throw new StemServerUnavailableError();
            }
            throw new Error(`Stem server error (${res.status}).`);
        }
        const job = await res.json();
        if (onProgress) onProgress({ stage: 'separating', percent: job.progress || 0 });
        if (job.status === 'done') return job.stems;
        if (job.status === 'error') throw new Error(job.error || 'Stem separation failed.');
        await sleep(POLL_INTERVAL_MS);
    }
}

async function fetchAndDecode(url, audioCtx) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Could not download stem (${res.status}).`);
    const arrayBuffer = await res.arrayBuffer();
    return audioCtx.decodeAudioData(arrayBuffer);
}

// Returns { stems: { vocals, drums, bass, other } (AudioBuffers), original }.
// `original` is the full-mix decode for the reference player. `onProgress` gets
// { stage, percent } updates while separating.
export async function separateStems(file, onProgress) {
    const jobId = await startJob(file);
    const stemUrls = await pollJob(jobId, onProgress);

    // Use a single, persistent AudioContext to decode audio data.
    // If we close the context, the decoded AudioBuffers may have their memory freed
    // resulting in silent playback and empty waveforms!
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    
    const stems = {};
    for (const name of STEM_NAMES) {
        if (stemUrls[name]) stems[name] = await fetchAndDecode(stemUrls[name], audioCtx);
    }
    // Reuse the dropped file (not a stem) as the full-quality reference.
    const original = await audioCtx.decodeAudioData(await file.arrayBuffer());
    return { stems, original };
}
