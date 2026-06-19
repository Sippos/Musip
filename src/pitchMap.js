import * as Tone from 'tone';
import { state } from './state.js';

export const MIN_MIDI = 36; // C2
export const MAX_MIDI = 96; // C7
export const MIDI_RANGE = MAX_MIDI - MIN_MIDI;

export function noteToY(noteStr, height) {
    if (noteStr === 'kick') return height * 0.8;
    if (noteStr === 'snare') return height * 0.5;
    if (noteStr === 'hat') return height * 0.2;
    
    const scrollY = state.camera ? state.camera.scrollY : 0;
    const zoomY = state.camera ? state.camera.zoomY : 1.0;
    
    try {
        const midi = Tone.Frequency(noteStr).toMidi();
        // Don't clamp anymore if we want to be able to scroll to them? 
        // Wait, if we zoom, maybe it's fine to draw outside bounds.
        // But MIDI range is our reference scale.
        const normalized = 1.0 - ((midi - MIN_MIDI) / MIDI_RANGE);
        
        let base_y = (normalized * (height - 20)) + 10;
        
        let cy = height / 2;
        let zoomed_y = cy + (base_y - cy) * zoomY;
        return zoomed_y + scrollY;
    } catch {
        return height * 0.5;
    }
}

export function yToNote(y, height) {
    const scrollY = state.camera ? state.camera.scrollY : 0;
    const zoomY = state.camera ? state.camera.zoomY : 1.0;
    
    let unzoomed_y = y - scrollY;
    let cy = height / 2;
    let base_y = cy + (unzoomed_y - cy) / zoomY;
    
    const normalized = 1.0 - ((base_y - 10) / (height - 20));
    const midi = Math.round(MIN_MIDI + (normalized * MIDI_RANGE));
    
    // Clamp to standard MIDI bounds 0-127
    const clamped = Math.max(0, Math.min(127, midi));
    return Tone.Frequency(clamped, "midi").toNote();
}
