// Starting-point presets: ready-made drum beats and chord progressions a
// beginner can drop onto a track instead of facing a blank piano roll. Each
// preset is musical, in-key, and fully editable once placed — it's a sketch to
// build on, not a locked loop. Drum patterns are 1 bar (tiled to fill the loop);
// chord progressions are 1 chord per bar (tiled / looped to fill).

import * as Tone from 'tone';

// Drum lane note names, matching the kick/snare/hat lanes the rest of the app
// uses (see getTrackScale's drums scale and interaction.js drum placement).
const KICK = 'C2';   // midi 36
const SNARE = 'D2';  // midi 38
const HAT = 'F#2';   // midi 42

// 16-step (one bar of sixteenth notes) patterns. Each lane lists the step
// indices (0..15) where that drum hits.
// `icon` is the inner markup of a 24×24 line icon (the rest of the app's
// <svg stroke="currentColor"> wrapper is added at render time). Minimalist bar
// glyphs hint at each beat's feel: even pulse, backbeat, sparse, rapid, groove.
export const DRUM_PATTERNS = [
    { id: 'four-floor', name: 'Four on the Floor', desc: 'House / dance',
      icon: '<rect x="3" y="7" width="2.6" height="10" rx="1" fill="currentColor" stroke="none"/><rect x="8.5" y="7" width="2.6" height="10" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="7" width="2.6" height="10" rx="1" fill="currentColor" stroke="none"/><rect x="19.5" y="7" width="2.6" height="10" rx="1" fill="currentColor" stroke="none"/>',
      lanes: { kick: [0, 4, 8, 12], snare: [4, 12], hat: [2, 6, 10, 14] } },
    { id: 'basic-rock', name: 'Basic Rock', desc: 'Steady backbeat',
      icon: '<rect x="3" y="5" width="2.6" height="14" rx="1" fill="currentColor" stroke="none"/><rect x="8.5" y="11" width="2.6" height="8" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="5" width="2.6" height="14" rx="1" fill="currentColor" stroke="none"/><rect x="19.5" y="11" width="2.6" height="8" rx="1" fill="currentColor" stroke="none"/>',
      lanes: { kick: [0, 8], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14] } },
    { id: 'boom-bap', name: 'Boom Bap', desc: 'Classic hip-hop',
      icon: '<rect x="4" y="5" width="3" height="14" rx="1" fill="currentColor" stroke="none"/><circle cx="12" cy="17" r="1.4" fill="currentColor" stroke="none"/><rect x="17" y="5" width="3" height="14" rx="1" fill="currentColor" stroke="none"/>',
      lanes: { kick: [0, 10], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14] } },
    { id: 'trap', name: 'Trap', desc: 'Rolling hi-hats',
      icon: '<rect x="3" y="7" width="1.4" height="10" rx="0.7" fill="currentColor" stroke="none"/><rect x="6.3" y="7" width="1.4" height="10" rx="0.7" fill="currentColor" stroke="none"/><rect x="9.6" y="7" width="1.4" height="10" rx="0.7" fill="currentColor" stroke="none"/><rect x="12.9" y="7" width="1.4" height="10" rx="0.7" fill="currentColor" stroke="none"/><rect x="16.2" y="7" width="1.4" height="10" rx="0.7" fill="currentColor" stroke="none"/><rect x="19.5" y="7" width="1.4" height="10" rx="0.7" fill="currentColor" stroke="none"/>',
      lanes: { kick: [0, 6, 10], snare: [8], hat: [0, 2, 3, 4, 6, 8, 10, 12, 13, 14] } },
    { id: 'pop', name: 'Pop Groove', desc: 'Radio-friendly',
      icon: '<rect x="3" y="12" width="2.6" height="7" rx="1" fill="currentColor" stroke="none"/><rect x="8.5" y="7" width="2.6" height="12" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="4" width="2.6" height="15" rx="1" fill="currentColor" stroke="none"/><rect x="19.5" y="9" width="2.6" height="10" rx="1" fill="currentColor" stroke="none"/>',
      lanes: { kick: [0, 8, 11], snare: [4, 12], hat: [2, 6, 10, 14] } },
];

// Chord progressions as diatonic scale degrees (0 = the key's tonic chord I,
// 4 = the V chord, 5 = vi, etc.). Quality (major/minor) falls out of the key's
// scale automatically when the triad is built, so one progression works in any
// key. Degrees may exceed 6 to climb into the next octave.
// `icon`: 24×24 line-icon inner markup (see DRUM_PATTERNS note). Melodic note /
// wave glyphs distinguish the progressions at a glance.
export const CHORD_PROGRESSIONS = [
    { id: 'pop', name: 'Pop · I–V–vi–IV', degrees: [0, 4, 5, 3],
      icon: '<circle cx="7" cy="17" r="3" fill="currentColor" stroke="none"/><path d="M10 17V6l8-2v3"/>' },
    { id: '50s', name: '50s · I–vi–IV–V', degrees: [0, 5, 3, 4],
      icon: '<circle cx="6" cy="17" r="2.5" fill="currentColor" stroke="none"/><circle cx="17" cy="15" r="2.5" fill="currentColor" stroke="none"/><path d="M8.5 17V5h11v10"/><line x1="8.5" y1="5" x2="19.5" y2="5"/>' },
    { id: 'sad-pop', name: 'Sad Pop · vi–IV–I–V', degrees: [5, 3, 0, 4],
      icon: '<polyline points="3 6 9 11 14 9 19 16"/><circle cx="19" cy="16" r="2.3" fill="currentColor" stroke="none"/>' },
    { id: 'canon', name: 'Canon · I–V–vi–iii–IV–I–IV–V', degrees: [0, 4, 5, 2, 3, 0, 3, 4],
      icon: '<path d="M20 12a8 8 0 1 1-2.3-5.6"/><polyline points="20 3 20 7 16 7"/>' },
    { id: 'blues', name: '12-Bar Blues', degrees: [0, 0, 0, 0, 3, 3, 0, 0, 4, 3, 0, 4],
      icon: '<path d="M3 16c3 0 3.5-9 6.5-9s3 9 6 9 3.5-9 5.5-9"/>' },
];

// Diatonic scale interval shapes (semitones from the tonic), used to turn a
// scale degree into a concrete pitch.
const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10]; // natural minor

// Octave to anchor chord roots in (C3 region) so progressions sit in a
// comfortable keys/piano register.
const CHORD_ROOT_BASE_MIDI = 48;

// step 0..15 within a bar -> Tone "bar:beat:sixteenth" position string.
function stepToBBS(bar, step) {
    return `${bar}:${Math.floor(step / 4)}:${step % 4}`;
}

// Scale degree (0-based, may exceed 6) -> MIDI note, given the ordered scale
// intervals and the tonic's root MIDI.
function degreeToMidi(degree, intervals, rootMidi) {
    const octave = Math.floor(degree / 7);
    const idx = ((degree % 7) + 7) % 7;
    return rootMidi + intervals[idx] + 12 * octave;
}

// Build drum-lane notes for a pattern tiled across `bars` bars. Returns
// [{ note, time, duration }] (caller adds id + trackId).
export function buildDrumNotes(pattern, { bars = 1 } = {}) {
    const lanes = [['kick', KICK], ['snare', SNARE], ['hat', HAT]];
    const notes = [];
    for (let bar = 0; bar < bars; bar++) {
        for (const [lane, noteName] of lanes) {
            (pattern.lanes[lane] || []).forEach(step => {
                notes.push({ note: noteName, time: stepToBBS(bar, step), duration: '16n' });
            });
        }
    }
    return notes;
}

// Build chord-progression notes (one bar per chord, triads stacked from the
// key's scale) tiled/looped across `bars` bars. `key` is state.song.key or null;
// when absent the progression renders in C major. Returns [{ note, time,
// duration }] (caller adds id + trackId).
export function buildChordNotes(progression, key, { bars = progression.degrees.length } = {}) {
    const tonic = key && Number.isInteger(key.tonic) ? key.tonic : 0;
    const intervals = key && key.mode === 'minor' ? MINOR_SCALE : MAJOR_SCALE;
    const rootMidi = CHORD_ROOT_BASE_MIDI + tonic;

    const notes = [];
    for (let bar = 0; bar < bars; bar++) {
        const degree = progression.degrees[bar % progression.degrees.length];
        // Triad: scale degrees d, d+2, d+4 (root, third, fifth).
        [degree, degree + 2, degree + 4].forEach(d => {
            const midi = degreeToMidi(d, intervals, rootMidi);
            notes.push({
                note: Tone.Frequency(midi, 'midi').toNote(),
                time: `${bar}:0:0`,
                duration: '1m'
            });
        });
    }
    return notes;
}
