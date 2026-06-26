// Musical analysis that turns a transcription into learning scaffolding: tempo
// (so the bar grid matches the real song), key (so notes can be scale-locked and
// in-key rows highlighted), and a rough chord-per-bar guess (a harmony hint to
// block out fast). Key and chords are derived from the *transcribed notes*, not
// raw audio, so they reuse one pipeline and need no extra library.
import { guess } from 'web-audio-beat-detector';
import { NOTE_NAMES, makeKey } from './pitchMap.js';

// Krumhansl–Schmuckler key profiles (perceived tonal hierarchy of each scale
// degree). Correlating a song's pitch-class histogram against all 24 rotations
// of these picks the most likely key.
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];


// Detect tempo (and the downbeat offset) from the decoded audio. Falls back to
// 120 BPM if detection throws (it can on very short or ambiguous clips).
export async function detectTempo(audioBuffer) {
    try {
        const { bpm, offset } = await guess(audioBuffer);
        return { bpm, offsetSeconds: offset || 0 };
    } catch {
        return { bpm: 120, offsetSeconds: 0 };
    }
}

function pitchClassHistogram(notes) {
    const hist = new Array(12).fill(0);
    notes.forEach(n => {
        // Weight by duration so held/structural notes count more than passing ones.
        hist[((n.midi % 12) + 12) % 12] += Math.max(0.05, n.duration || 0.05);
    });
    return hist;
}

function pearson(a, b) {
    const n = a.length;
    const ma = a.reduce((s, x) => s + x, 0) / n;
    const mb = b.reduce((s, x) => s + x, 0) / n;
    let num = 0, da = 0, db = 0;
    for (let i = 0; i < n; i++) {
        const xa = a[i] - ma, xb = b[i] - mb;
        num += xa * xb; da += xa * xa; db += xb * xb;
    }
    const den = Math.sqrt(da * db);
    return den === 0 ? 0 : num / den;
}

// Estimate the key from the transcribed notes. Returns
// { tonic, mode, name, scalePitchClasses }.
export function detectKey(notes) {
    const hist = pitchClassHistogram(notes);
    let best = { score: -Infinity, tonic: 0, mode: 'major' };
    for (let tonic = 0; tonic < 12; tonic++) {
        const rotated = hist.map((_, i) => hist[(i + tonic) % 12]);
        const majScore = pearson(rotated, MAJOR_PROFILE);
        const minScore = pearson(rotated, MINOR_PROFILE);
        if (majScore > best.score) best = { score: majScore, tonic, mode: 'major' };
        if (minScore > best.score) best = { score: minScore, tonic, mode: 'minor' };
    }
    return makeKey(best.tonic, best.mode);
}

const CHORD_QUALITIES = [
    { suffix: '', tones: [0, 4, 7] },   // major
    { suffix: 'm', tones: [0, 3, 7] }   // minor
];

// Suggest one chord per bar by matching each bar's pitch-class content against
// major/minor triads. Returns [{ time, name, pitchClasses }]. Rough by design —
// a harmony scaffold to block out fast, not a definitive analysis.
export function suggestChords(notes, { bpm, offsetSeconds = 0, beatsPerChord = 4 } = {}) {
    if (!notes.length) return [];
    const secondsPerChord = (60 / bpm) * beatsPerChord;
    const end = notes.reduce((m, n) => Math.max(m, n.time + n.duration), 0);
    const chords = [];
    for (let t = offsetSeconds; t < end; t += secondsPerChord) {
        const windowEnd = t + secondsPerChord;
        const inWindow = notes.filter(n => n.time < windowEnd && (n.time + n.duration) > t);
        if (!inWindow.length) continue;
        const hist = pitchClassHistogram(inWindow);

        let best = { score: -Infinity, root: 0, quality: CHORD_QUALITIES[0] };
        for (let root = 0; root < 12; root++) {
            for (const q of CHORD_QUALITIES) {
                const tones = q.tones.map(x => (x + root) % 12);
                let score = 0;
                for (let pc = 0; pc < 12; pc++) {
                    score += tones.includes(pc) ? hist[pc] : -0.5 * hist[pc];
                }
                if (score > best.score) best = { score, root, quality: q };
            }
        }
        chords.push({
            time: t,
            name: `${NOTE_NAMES[best.root]}${best.quality.suffix}`,
            pitchClasses: best.quality.tones.map(x => (x + best.root) % 12)
        });
    }
    return chords;
}
