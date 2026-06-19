import * as Tone from 'tone';
import { state } from './state.js';

export const MIN_MIDI = 36; // C2
export const MAX_MIDI = 96; // C7
export const MIDI_RANGE = MAX_MIDI - MIN_MIDI;

export function noteToY(noteObj, trackTop, trackHeight) {
    const noteStr = typeof noteObj === 'string' ? noteObj : noteObj.note;
    const laneHeight = trackHeight / 5;
    
    // 1. If it has a scaleIndex (from clicking/keyboard), perfectly use the 5 lanes
    if (typeof noteObj === 'object' && noteObj.scaleIndex !== undefined && noteObj.scaleIndex !== null) {
        const yIndex = 4 - noteObj.scaleIndex; // 0 (bottom) to 4 (top)
        return trackTop + (yIndex * laneHeight) + (laneHeight / 2);
    }
    
    // 2. Fallback for imported Notes: visually quantize to the 5 lanes
    try {
        const midi = Tone.Frequency(noteStr).toMidi();
        const clampedMidi = Math.max(MIN_MIDI, Math.min(MAX_MIDI, midi));
        const normalized = (clampedMidi - MIN_MIDI) / MIDI_RANGE;
        const scaleIndex = Math.floor(normalized * 4.99); // 0 to 4
        const yIndex = 4 - scaleIndex;
        return trackTop + (yIndex * laneHeight) + (laneHeight / 2);
    } catch {
        return trackTop + (2 * laneHeight) + (laneHeight / 2); // Middle lane default
    }
}
