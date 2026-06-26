// Turn a separated drum stem into drum-lane notes. Pitched models (Basic Pitch)
// are useless on percussion, so instead we detect onsets from an energy-novelty
// envelope and classify each hit by which frequency band dominates:
//   low  -> kick  (midi 36 -> C2 lane)
//   high -> hat   (midi 42 -> F#2 lane)
//   mid  -> snare (midi 38 -> D2 lane)
// The midi values land in the ranges midiImport's drumLane() expects, so the
// output drops straight into the standard multi-track import path.

const HOP = 256;            // ~5.8ms at 44.1k — onset-resolution frame hop
const MIN_GAP_SEC = 0.05;   // ignore hits closer than this (debounce double-triggers)
const HIT_DURATION = 0.12;  // nominal note length; import quantize caps it anyway

// One-pole lowpass. Returns a new Float32Array.
function lowpass(samples, sampleRate, cutoffHz) {
    const dt = 1 / sampleRate;
    const rc = 1 / (2 * Math.PI * cutoffHz);
    const a = dt / (rc + dt);
    const out = new Float32Array(samples.length);
    let y = 0;
    for (let i = 0; i < samples.length; i++) {
        y += a * (samples[i] - y);
        out[i] = y;
    }
    return out;
}

// One-pole highpass.
function highpass(samples, sampleRate, cutoffHz) {
    const dt = 1 / sampleRate;
    const rc = 1 / (2 * Math.PI * cutoffHz);
    const a = rc / (rc + dt);
    const out = new Float32Array(samples.length);
    let prevX = 0;
    let prevY = 0;
    for (let i = 0; i < samples.length; i++) {
        const y = a * (prevY + samples[i] - prevX);
        out[i] = y;
        prevX = samples[i];
        prevY = y;
    }
    return out;
}

function toMono(audioBuffer) {
    const ch = audioBuffer.numberOfChannels;
    if (ch === 1) return audioBuffer.getChannelData(0);
    const len = audioBuffer.length;
    const mono = new Float32Array(len);
    for (let c = 0; c < ch; c++) {
        const data = audioBuffer.getChannelData(c);
        for (let i = 0; i < len; i++) mono[i] += data[i] / ch;
    }
    return mono;
}

// Per-hop sum of squares for a band signal.
function bandEnvelope(band, frameCount) {
    const env = new Float32Array(frameCount);
    for (let f = 0; f < frameCount; f++) {
        const start = f * HOP;
        const end = Math.min(start + HOP, band.length);
        let e = 0;
        for (let i = start; i < end; i++) e += band[i] * band[i];
        env[f] = e;
    }
    return env;
}

function mean(arr) {
    let s = 0;
    for (let i = 0; i < arr.length; i++) s += arr[i];
    return arr.length ? s / arr.length : 0;
}

// Returns [{ time, duration, midi, name }] of detected drum hits.
export function transcribeDrums(audioBuffer) {
    const sampleRate = audioBuffer.sampleRate;
    const mono = toMono(audioBuffer);
    const frameCount = Math.floor(mono.length / HOP);
    if (frameCount < 2) return [];

    const low = bandEnvelope(lowpass(mono, sampleRate, 150), frameCount);
    const high = bandEnvelope(highpass(mono, sampleRate, 6000), frameCount);
    // Mid = total energy minus low and high contributions (kept >= 0).
    const totalBand = bandEnvelope(mono, frameCount);
    const mid = new Float32Array(frameCount);
    for (let f = 0; f < frameCount; f++) mid[f] = Math.max(0, totalBand[f] - low[f] - high[f]);

    // Onset novelty: half-wave-rectified increase in total energy frame to frame.
    const novelty = new Float32Array(frameCount);
    for (let f = 1; f < frameCount; f++) {
        novelty[f] = Math.max(0, totalBand[f] - totalBand[f - 1]);
    }
    const noveltyMean = mean(novelty);
    let variance = 0;
    for (let f = 0; f < frameCount; f++) variance += (novelty[f] - noveltyMean) ** 2;
    const noveltyStd = Math.sqrt(variance / frameCount);
    const threshold = noveltyMean + 1.5 * noveltyStd;

    // Per-band means to normalise out a band that's simply louder overall, so a
    // booming kick stem doesn't make every hit classify as a kick.
    const lowMean = mean(low) + 1e-12;
    const midMean = mean(mid) + 1e-12;
    const highMean = mean(high) + 1e-12;

    const minGapFrames = Math.max(1, Math.round((MIN_GAP_SEC * sampleRate) / HOP));
    const hits = [];
    let lastOnset = -minGapFrames;

    for (let f = 1; f < frameCount - 1; f++) {
        if (novelty[f] < threshold) continue;
        // Local peak.
        if (novelty[f] < novelty[f - 1] || novelty[f] < novelty[f + 1]) continue;
        if (f - lastOnset < minGapFrames) continue;
        lastOnset = f;

        // Sum band energy over a short window after the onset.
        const win = Math.min(frameCount, f + minGapFrames);
        let lowE = 0;
        let midE = 0;
        let highE = 0;
        for (let k = f; k < win; k++) {
            lowE += low[k];
            midE += mid[k];
            highE += high[k];
        }
        // Relative-to-typical strength per band.
        const lowScore = lowE / lowMean;
        const midScore = midE / midMean;
        const highScore = highE / highMean;

        let midi = 38; // snare default
        if (lowScore >= midScore && lowScore >= highScore) midi = 36;       // kick
        else if (highScore >= midScore && highScore >= lowScore) midi = 42; // hat
        const name = midi === 36 ? 'Kick' : midi === 42 ? 'Hat' : 'Snare';

        hits.push({ time: (f * HOP) / sampleRate, duration: HIT_DURATION, midi, name });
    }

    return hits;
}
