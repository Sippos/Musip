import * as Tone from 'tone';
import { state } from './state.js';

export const TRACK_MIDI_RANGE = 24;

// How many semitones an *expanded* track shows at once. Smaller = zoomed in
// (taller rows, easier to see/place individual notes); larger = more of the
// pitch range at once. Per-track so each instrument keeps its own zoom; falls
// back to the default 24-semitone window. Clamped to a sane range.
export const MIN_PITCH_RANGE = 6;
export const MAX_PITCH_RANGE = 48;
export function getPitchRange(track) {
    const r = Math.round((track && track.pitchRange) || TRACK_MIDI_RANGE);
    return Math.max(MIN_PITCH_RANGE, Math.min(MAX_PITCH_RANGE, r));
}

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10]; // natural minor

// Build a key descriptor from a tonic pitch class (0..11) and mode. Shared by
// auto key detection (analysis.js) and the manual key picker so both produce
// identical { tonic, mode, name, scalePitchClasses } objects. Lives here (a
// dependency-light module) rather than in analysis.js so the toolbar key picker
// doesn't drag the heavy tempo-detection library into the startup bundle.
export function makeKey(tonic, mode) {
    const scale = mode === 'major' ? MAJOR_SCALE : MINOR_SCALE;
    return {
        tonic,
        mode,
        name: `${NOTE_NAMES[tonic]} ${mode}`,
        scalePitchClasses: scale.map(d => (d + tonic) % 12)
    };
}

export const HEADER_OFFSET = 80;
export const TRACK_HEIGHT_COLLAPSED = 100;
export const TRACK_HEIGHT_EXPANDED = 300;

export function getTrackLayout(tracks, scrollY) {
    const layout = [];
    let currentY = HEADER_OFFSET + scrollY;
    
    tracks.forEach(track => {
        const height = track.expanded ? TRACK_HEIGHT_EXPANDED : TRACK_HEIGHT_COLLAPSED;
        layout.push({
            track: track,
            top: currentY,
            height: height,
            bottom: currentY + height
        });
        currentY += height;
    });
    
    return layout;
}

export function noteToY(noteObj, trackTop, trackHeight, track) {
    const noteStr = typeof noteObj === 'string' ? noteObj : noteObj.note;
    
    if (track.expanded) {
        try {
            const range = getPitchRange(track);
            const laneHeight = trackHeight / range;
            const midi = Tone.Frequency(noteStr).toMidi();
            const minMidi = track.baseMidi || 48;
            const noteIndex = midi - minMidi; // 0 to range-1
            const yIndex = (range - 1) - noteIndex;
            return trackTop + (yIndex * laneHeight) + (laneHeight / 2);
        } catch {
            return trackTop + (trackHeight / 2);
        }
    } else {
        const laneHeight = trackHeight / 5;
        
        if (typeof noteObj === 'object' && noteObj.scaleIndex !== undefined && noteObj.scaleIndex !== null) {
            const yIndex = 4 - noteObj.scaleIndex; // 0 (bottom) to 4 (top)
            return trackTop + (yIndex * laneHeight) + (laneHeight / 2);
        }
        
        try {
            const midi = Tone.Frequency(noteStr).toMidi();
            // In collapsed mode we still just estimate position based on a generic range
            const minMidi = track.baseMidi || 48;
            const maxMidi = minMidi + TRACK_MIDI_RANGE;
            const clampedMidi = Math.max(minMidi, Math.min(maxMidi, midi));
            const normalized = (clampedMidi - minMidi) / TRACK_MIDI_RANGE;
            const scaleIndex = Math.floor(normalized * 4.99); // 0 to 4
            const yIndex = 4 - scaleIndex;
            return trackTop + (yIndex * laneHeight) + (laneHeight / 2);
        } catch {
            return trackTop + (2 * laneHeight) + (laneHeight / 2); // Middle lane default
        }
    }
}

// Snap a MIDI pitch to the nearest pitch in `scalePitchClasses` (an array of
// 0..11 pitch classes that make up the detected key). Ties resolve downward.
// Returns the input unchanged when no scale is given.
export function snapMidiToScale(midi, scalePitchClasses) {
    if (!scalePitchClasses || scalePitchClasses.length === 0) return midi;
    const set = new Set(scalePitchClasses);
    for (let d = 0; d <= 6; d++) {
        if (set.has(((midi - d) % 12 + 12) % 12)) return midi - d;
        if (set.has((midi + d) % 12)) return midi + d;
    }
    return midi;
}

export function yToNote(y, trackTop, trackHeight, track) {
    if (track.expanded) {
        const range = getPitchRange(track);
        const yWithin = Math.max(0, Math.min(trackHeight - 0.001, y - trackTop));
        const laneHeight = trackHeight / range;
        const yIndex = Math.floor(yWithin / laneHeight);
        const noteIndex = (range - 1) - yIndex;
        const minMidi = track.baseMidi || 48;
        const midi = minMidi + noteIndex;
        const clamped = Math.max(0, Math.min(127, midi));
        return Tone.Frequency(clamped, "midi").toNote();
    } else {
        const yWithin = Math.max(0, Math.min(trackHeight - 0.001, y - trackTop));
        const normalized = 1.0 - (yWithin / trackHeight);
        const minMidi = track.baseMidi || 48;
        const midi = Math.floor(minMidi + (normalized * TRACK_MIDI_RANGE));
        const clamped = Math.max(0, Math.min(127, midi));
        return Tone.Frequency(clamped, "midi").toNote();
    }
}
