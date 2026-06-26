// In-browser mp3 -> notes transcription using Spotify's Basic Pitch (a TF.js
// polyphonic note model). This replaces the old "convert in an external tool,
// then import the .mid" step: the user drops the actual song and the app does
// the rough transcription itself. The output is deliberately fed through the
// same quantize/cleaning pipeline as MIDI import (see midiImport.js) because a
// transcription of a full mix is noisy — it's a sketch to refine, not a score.
//
// This module pulls in TF.js + the Basic Pitch model (~1MB), so it is only ever
// loaded via dynamic import() from the "Learn a Song" flow, never on first paint.
import * as tf from '@tensorflow/tfjs';
import { BasicPitch, noteFramesToTime, addPitchBendsToNoteEvents, outputToNotesPoly } from '@spotify/basic-pitch';
import * as Tone from 'tone';

// Basic Pitch is trained on 22.05kHz mono audio.
const MODEL_SAMPLE_RATE = 22050;
// Served from public/ so transcription works offline with no CDN dependency.
const MODEL_URL = '/basic-pitch-model/model.json';

let basicPitch = null;
function getModel() {
    if (!basicPitch) basicPitch = new BasicPitch(tf.loadGraphModel(MODEL_URL));
    return basicPitch;
}

// Resample any AudioBuffer to the model's 22.05kHz mono spec. Used both for a
// decoded file and for an already-decoded stem buffer.
export async function resampleBuffer(audioBuffer) {
    const length = Math.ceil(audioBuffer.duration * MODEL_SAMPLE_RATE);
    const offline = new OfflineAudioContext(1, length, MODEL_SAMPLE_RATE);
    const src = offline.createBufferSource();
    src.buffer = audioBuffer;
    src.connect(offline.destination);
    src.start();
    return offline.startRendering();
}

// Decode the file to its native-rate AudioBuffer (used as the reference track)
// and a 22.05kHz mono copy (fed to the model).
async function decodeAndResample(file) {
    const arrayBuffer = await file.arrayBuffer();
    const decodeCtx = new (window.AudioContext || window.webkitAudioContext)();
    const original = await decodeCtx.decodeAudioData(arrayBuffer);
    decodeCtx.close();

    const resampled = await resampleBuffer(original);
    return { original, resampled };
}

// Run Basic Pitch over an already-resampled-or-not AudioBuffer and return
// { notes: [{ time, duration, midi, name }] }. Pass a stem buffer here to
// transcribe one clean source at a time. `onProgress(percent0to1)` fires during
// inference (the slow step).
export async function transcribeBuffer(audioBuffer, onProgress) {
    const resampled = audioBuffer.sampleRate === MODEL_SAMPLE_RATE && audioBuffer.numberOfChannels === 1
        ? audioBuffer
        : await resampleBuffer(audioBuffer);

    const frames = [];
    const onsets = [];
    const contours = [];
    await getModel().evaluateModel(
        resampled,
        (f, o, c) => {
            frames.push(...f);
            onsets.push(...o);
            contours.push(...c);
        },
        (pct) => { if (onProgress) onProgress(Math.max(0, Math.min(1, pct))); }
    );

    // onsetThresh/frameThresh left at defaults; minNoteLen ~11 frames (~127ms)
    // already prunes the shortest transients before our own cleaning runs.
    const noteEvents = noteFramesToTime(
        addPitchBendsToNoteEvents(
            contours,
            outputToNotesPoly(frames, onsets, 0.5, 0.3, 11)
        )
    );

    const notes = noteEvents.map(n => ({
        time: n.startTimeSeconds,
        duration: n.durationSeconds,
        midi: n.pitchMidi,
        name: Tone.Frequency(n.pitchMidi, 'midi').toNote()
    }));

    return { notes };
}

// Returns { notes: [{ time, duration, midi, name }], audioBuffer } where
// audioBuffer is the full-quality decode for use as the reference player. This
// is the legacy full-mix path (kept as a fallback when no stem server is up).
export async function transcribeAudioFile(file, onProgress) {
    const { original, resampled } = await decodeAndResample(file);
    const { notes } = await transcribeBuffer(resampled, onProgress);
    return { notes, audioBuffer: original };
}
