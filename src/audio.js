import * as Tone from 'tone';
import { state, getPreset, getActiveTrack } from './state.js';

export const trackSynths = {};
export const trackEffects = {};

// We will use a dynamic loop length
export let LOOP_LENGTH_MEASURES = 2;
export const LOOP_LENGTH_SECONDS = () => Tone.Time(`${LOOP_LENGTH_MEASURES}m`).toSeconds();

export function setLoopLengthMeasures(measures) {
    LOOP_LENGTH_MEASURES = measures;
    Tone.Transport.loopEnd = `${measures}m`;
    masterPart.loopEnd = `${measures}m`;
}

export const masterPart = new Tone.Part((time, noteValue) => {
    playSound(noteValue.trackId, noteValue.note, time, noteValue.duration);
}, []).start(0);

// Metronome Synth
const metronomeSynth = new Tone.MembraneSynth({
    pitchDecay: 0.008,
    octaves: 2,
    envelope: { attack: 0.001, decay: 0.1, sustain: 0, release: 0.1 }
}).toDestination();
metronomeSynth.volume.value = -10;

export const masterAnalyser = new Tone.Analyser('waveform', 256);
export const masterRecorder = new Tone.Recorder();
Tone.Destination.connect(masterAnalyser);
Tone.Destination.connect(masterRecorder);

export async function initAudio() {
    await Tone.start();
    Tone.Transport.bpm.value = 90;
    Tone.Transport.loop = true;
    Tone.Transport.loopStart = 0;
    Tone.Transport.loopEnd = `${LOOP_LENGTH_MEASURES}m`;
    
    masterPart.loop = true;
    masterPart.loopEnd = `${LOOP_LENGTH_MEASURES}m`;
    
    // Initialize synths for existing tracks
    state.tracks.forEach(track => {
        initTrackSynth(track.id, getPreset(track.presetId));
    });
    
    // Metronome tick
    Tone.Transport.scheduleRepeat((time) => {
        if (state.settings.audioPulse) {
            metronomeSynth.triggerAttackRelease("C6", "32n", time);
        }
    }, "4n");
}

export function initTrackSynth(trackId, preset) {
    // Cleanup old synth if it exists
    if (trackSynths[trackId]) {
        if (trackSynths[trackId].dispose) trackSynths[trackId].dispose();
        else {
            if(trackSynths[trackId].kick) trackSynths[trackId].kick.dispose();
            if(trackSynths[trackId].snare) trackSynths[trackId].snare.dispose();
            if(trackSynths[trackId].hat) trackSynths[trackId].hat.dispose();
        }
    }
    if (trackEffects[trackId]) {
        trackEffects[trackId].filter.dispose();
        trackEffects[trackId].distortion.dispose();
        trackEffects[trackId].reverb.dispose();
    }

    if (preset.type === 'drums') {
        trackSynths[trackId] = {
            kick: new Tone.MembraneSynth({ pitchDecay: 0.05, octaves: 4 }).toDestination(),
            snare: new Tone.NoiseSynth({
                noise: { type: 'white' },
                envelope: { attack: 0.005, decay: 0.2, sustain: 0 }
            }).toDestination(),
            hat: new Tone.NoiseSynth({
                noise: { type: 'pink' },
                envelope: { attack: 0.005, decay: 0.05, sustain: 0 }
            }).toDestination()
        };
        trackSynths[trackId].kick.volume.value = 5;
    } else {
        const filter = new Tone.Filter(20000, "lowpass");
        const distortion = new Tone.Distortion(0);
        const reverb = new Tone.Freeverb({ roomSize: 0.8, dampening: 3000 });
        
        filter.connect(distortion);
        distortion.connect(reverb);
        reverb.toDestination();
        
        trackEffects[trackId] = { filter, distortion, reverb };
        
        const synth = new Tone.PolySynth(Tone.Synth, {
            oscillator: { type: preset.oscillator || 'sine' },
            envelope: { attack: preset.attack || 0.1, release: preset.release || 1.0 }
        }).connect(filter);
        synth.volume.value = -5;
        trackSynths[trackId] = synth;
        
        // Apply initial effects
        updateInstrumentParams(trackId, {
            brightness: preset.brightness !== undefined ? preset.brightness : 1.0,
            space: preset.space || 0,
            dirt: preset.dirt || 0
        });
    }
}

export function syncAudioPart(notes) {
    masterPart.clear();
    notes.forEach(note => {
        masterPart.add(note.time, note);
    });
}

export function quantize(time) {
    return Tone.Time(time).quantize("32n");
}

export const scales = {
    synth: ["C2", "Eb2", "F2", "G2", "Bb2"], // Generic pentatonic, could be octaved based on track
    drums: ["C2", "D2", "F#2", "F#2", "C2"]
};

export function getTrackScale(track) {
    if (track.type === 'drums') return scales.drums;
    // Simple octave offset based on track name or just stick to one scale for MVP
    if (track.name.toLowerCase().includes('keys')) {
        return ["C4", "Eb4", "F4", "G4", "Bb4"];
    }
    return scales.synth;
}

export function playSound(trackId, noteKey, time = Tone.now(), duration = "8n") {
    const track = state.tracks.find(t => t.id === trackId);
    if (track && track.muted) return;
    
    const synth = trackSynths[trackId];
    if (!synth) return;
    
    // Check if it's drums
    if (synth.kick) {
        if (noteKey === "C2" || noteKey === "kick") synth.kick.triggerAttackRelease("C1", "8n", time);
        else if (noteKey === "D2" || noteKey === "snare") synth.snare.triggerAttackRelease("16n", time);
        else if (noteKey === "F#2" || noteKey === "Gb2" || noteKey === "hat") synth.hat.triggerAttackRelease("32n", time);
    } else {
        synth.triggerAttackRelease(noteKey, duration, time);
    }
}

export function instrumentsStart(trackId, noteVal) {
    const track = state.tracks.find(t => t.id === trackId);
    if (track && track.muted) return;
    
    const synth = trackSynths[trackId];
    if (synth && synth.triggerAttack) {
        synth.triggerAttack(noteVal, Tone.now());
    }
}

export function instrumentsStop(trackId, noteVal) {
    const synth = trackSynths[trackId];
    if (synth && synth.triggerRelease) {
        synth.triggerRelease(noteVal, Tone.now());
    }
}

export function updateInstrumentParams(trackId, params) {
    const synth = trackSynths[trackId];
    if (!synth || synth.kick) return; // Ignore drums

    if (params.oscillator) {
        synth.set({ oscillator: { type: params.oscillator } });
    }
    if (params.attack !== undefined) {
        synth.set({ envelope: { attack: params.attack } });
    }
    if (params.release !== undefined) {
        synth.set({ envelope: { release: params.release } });
    }
    
    const effects = trackEffects[trackId];
    if (effects) {
        if (params.brightness !== undefined) {
            // Map 0-1 to 200Hz - 20000Hz exponentially
            const freq = 200 * Math.pow(100, params.brightness);
            effects.filter.frequency.value = freq;
        }
        if (params.space !== undefined) {
            effects.reverb.wet.value = params.space;
        }
        if (params.dirt !== undefined) {
            effects.distortion.distortion = params.dirt;
        }
    }
}

export function getInstrumentParams(trackId) {
    const synth = trackSynths[trackId];
    if (!synth || synth.kick) return null;
    
    const options = synth.get();
    const effects = trackEffects[trackId];
    
    let brightness = 1.0;
    let space = 0.0;
    let dirt = 0.0;
    
    if (effects) {
        // Reverse map freq to brightness: freq = 200 * 100^b => b = log10(freq/200) / 2
        brightness = Math.max(0, Math.min(1, Math.log10(effects.filter.frequency.value / 200) / 2));
        space = effects.reverb.wet.value;
        dirt = effects.distortion.distortion;
    }
    
    return {
        oscillator: options.oscillator.type,
        attack: options.envelope.attack,
        release: options.envelope.release,
        brightness,
        space,
        dirt
    };
}
