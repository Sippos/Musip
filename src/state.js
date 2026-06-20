export const defaultPresets = {
    'bass-square': {
        name: 'Square Bass',
        type: 'synth',
        oscillator: 'square',
        attack: 0.05,
        release: 1.5,
        brightness: 0.4,
        space: 0.1,
        dirt: 0.3
    },
    'keys-sine': {
        name: 'Sine Keys',
        type: 'synth',
        oscillator: 'sine',
        attack: 0.1,
        release: 2.0,
        brightness: 0.8,
        space: 0.4,
        dirt: 0.0
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
    tracks: [
        { id: 'track-1', name: 'Bass', presetId: 'bass-square', color: '#A8E6CF', type: 'synth', baseMidi: 36 },
        { id: 'track-2', name: 'Keys', presetId: 'keys-sine', color: '#FFD3B6', type: 'synth', baseMidi: 48 },
        { id: 'track-3', name: 'Drums', presetId: 'drums-kit', color: '#FFAAA5', type: 'drums', baseMidi: 36 }
    ],
    notes: [], // { trackId, note, time, duration, id, scaleIndex }
    isPlaying: false,
    settings: {
        visualPulse: false,
        audioPulse: false
    },
    camera: {
        scrollY: 0,
        zoomY: 1.0
    }
};

// Generate a random ID for notes or tracks
export function generateId() {
    return Math.random().toString(36).substr(2, 9);
}

export function getActiveTrack() {
    return state.tracks.find(t => t.id === state.activeTrackId);
}
