// Synth sounds are described by an oscillator + 5 playful "macro" knobs (each
// 0..1), where every macro moves a group of underlying audio params at once:
//   body   - fullness/length (envelope sustain + release)
//   bite   - brightness/edge (filter cutoff + resonance)
//   air    - space (reverb amount + room size)
//   punch  - transient/drive (attack + decay + distortion)
//   wobble - movement (vibrato depth + rate)
// This lets you dial in a sound by feel instead of browsing hundreds of presets.
export const DEFAULT_MACROS = { body: 0.55, bite: 0.4, air: 0.25, punch: 0.3, wobble: 0.0, crush: 0.0, stemPitch: 0.0 };

export const defaultPresets = {
    'bass-square': {
        name: 'Warm Bass',
        type: 'synth',
        osc: 'triangle',
        macros: { body: 0.7, bite: 0.25, air: 0.05, punch: 0.5, wobble: 0.0, crush: 0.0 }
    },
    'keys-sine': {
        name: 'Soft Keys',
        type: 'synth',
        osc: 'sine',
        macros: { body: 0.6, bite: 0.45, air: 0.35, punch: 0.2, wobble: 0.0, crush: 0.0 }
    },
    'atmospheric-pad': {
        name: 'Atmospheric Pad',
        type: 'synth',
        osc: 'sine',
        macros: { body: 0.9, bite: 0.1, air: 0.9, punch: 0.0, wobble: 0.2, crush: 0.0 }
    },
    'gritty-bass': {
        name: 'Gritty Bass',
        type: 'synth',
        osc: 'square',
        macros: { body: 0.6, bite: 0.8, air: 0.1, punch: 0.8, wobble: 0.0, crush: 0.7 }
    },
    'drums-kit': {
        name: 'Standard Kit',
        type: 'drums'
    }
};

export function loadUserPresets() {
    try {
        const stored = localStorage.getItem('musip_presets');
        return stored ? JSON.parse(stored) : {};
    } catch {
        return {};
    }
}

export function saveUserPreset(id, presetData) {
    const presets = loadUserPresets();
    presets[id] = presetData;
    localStorage.setItem('musip_presets', JSON.stringify(presets));
}

export function getPreset(id) {
    const userPresets = loadUserPresets();
    return userPresets[id] || defaultPresets[id] || defaultPresets['keys-sine'];
}

export const state = {
    activeTrackId: 'track-1',
    // Melodic tracks default to sampled (recorded) instruments via `engine:
    // 'sampler'` + `sampleInstrument`, so they sound realistic out of the box.
    // Set `engine: 'synth'` to fall back to the oscillator + macro engine, or
    // `engine: 'soundfont'` (+ `soundfontId` and `sfProgram: { bankMSB, bankLSB,
    // program, name }`) to voice the track from a user-imported SoundFont preset
    // via the shared spessasynth engine (see soundfont.js).
    //
    // `source` is the track's voice: 'synth' = play this track's instrument
    // (the default), 'stem' = play the original isolated recording from the
    // "Learn a Song" stem separation instead, so you can hear what the real
    // instrument sounds like and recreate it by ear. Only tracks imported from a
    // stem-separated song have a stem to switch to (see hasTrackStem in audio.js).
    tracks: [
        { id: 'track-1', name: 'Bass', presetId: 'bass-square', color: '#A8E6CF', type: 'synth', engine: 'sampler', sampleInstrument: 'bass-electric', baseMidi: 36, source: 'synth' },
        { id: 'track-2', name: 'Keys', presetId: 'keys-sine', color: '#FFD3B6', type: 'synth', engine: 'sampler', sampleInstrument: 'piano', baseMidi: 48, source: 'synth' },
        { id: 'track-3', name: 'Drums', presetId: 'drums-kit', color: '#FFAAA5', type: 'drums', baseMidi: 36, source: 'synth' }
    ],
    notes: [], // { trackId, note, time, duration, id, scaleIndex }
    isPlaying: false,
    // Analysis of the song being recreated, filled in by the "Learn a Song"
    // (audio transcription) flow. Drives the beat grid, scale highlight/lock and
    // chord hints. `key` is null until a song is analyzed.
    song: {
        // Starts at the Transport default (90) so the toolbar always shows a
        // tempo and the bar grid is meaningful before any song is learned.
        bpm: 90,
        // { tonic: 0..11, mode: 'major'|'minor', name: 'A minor',
        //   scalePitchClasses: [0..11] } — the set of pitch classes in key.
        // Defaults to C major so Scale Snap and the in-key row highlight work
        // out of the box; "Learn a Song" and the key picker overwrite it.
        key: { tonic: 0, mode: 'major', name: 'C major', scalePitchClasses: [0, 2, 4, 5, 7, 9, 11] },
        // [{ time (seconds), name: 'Am', pitchClasses: [...] }] under the grid.
        chords: []
    },
    // When on, placing/dragging notes snaps to the detected scale so everything
    // you put down is in key. Off = chromatic (free) placement.
    scaleLock: true,
    reference: {
        name: null,
        muted: false,
        offsetSeconds: 0
    },
    settings: {
        visualPulse: false,
        audioPulse: false
    },
    activeTool: 'draw', // 'draw', 'select', 'erase'
    // Notes removed by Undo, awaiting Redo. Cleared whenever a fresh note is
    // placed, since that invalidates the redo trail.
    redoStack: [],
    selectedNoteIds: [],
    selectionBox: null, // { x, y, w, h }
    camera: {
        scrollY: 0,
        zoomY: 1.0,
        // Horizontal (time) zoom for working on packed parts. zoomX = 1 shows the
        // whole loop across the canvas; >1 magnifies the timeline so notes spread
        // out and become easy to grab. scrollX is the time (seconds) at the left
        // edge of the view when zoomed in.
        zoomX: 1.0,
        scrollX: 0
    }
};

// Generate a random ID for notes or tracks
export function generateId() {
    return Math.random().toString(36).substr(2, 9);
}

export function getActiveTrack() {
    return state.tracks.find(t => t.id === state.activeTrackId);
}

// --- Undo / Redo ---------------------------------------------------------
// The history model is intentionally simple: it tracks note creation, so Undo
// removes the most recently added note and Redo puts it back. Placing a new
// note clears the redo trail (see clearRedo, called from the placement paths).

// Remove the last-added note; remember it so Redo can restore it.
export function undoNote() {
    const popped = state.notes.pop();
    if (popped) state.redoStack.push(popped);
    return popped;
}

// Re-add the most recently undone note.
export function redoNote() {
    const restored = state.redoStack.pop();
    if (restored) state.notes.push(restored);
    return restored;
}

// A fresh edit invalidates anything waiting to be redone.
export function clearRedo() {
    state.redoStack.length = 0;
}
