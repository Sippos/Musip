import * as Tone from 'tone';

export const MIN_MIDI = 36; // C2
export const MAX_MIDI = 96; // C7
export const MIDI_RANGE = MAX_MIDI - MIN_MIDI;

export function noteToY(noteStr, height) {
    if (noteStr === 'kick') return height * 0.8;
    if (noteStr === 'snare') return height * 0.5;
    if (noteStr === 'hat') return height * 0.2;
    
    try {
        const midi = Tone.Frequency(noteStr).toMidi();
        const clamped = Math.max(MIN_MIDI, Math.min(MAX_MIDI, midi));
        const normalized = 1.0 - ((clamped - MIN_MIDI) / MIDI_RANGE);
        // Add a small padding so notes aren't exactly on the edge
        return (normalized * (height - 20)) + 10;
    } catch {
        return height * 0.5;
    }
}

export function yToNote(y, height) {
    // Inverse of noteToY
    const yPad = Math.max(0, Math.min(height - 20, y - 10));
    const normalized = 1.0 - (yPad / (height - 20));
    const midi = Math.round(MIN_MIDI + (normalized * MIDI_RANGE));
    const clamped = Math.max(MIN_MIDI, Math.min(MAX_MIDI, midi));
    return Tone.Frequency(clamped, "midi").toNote();
}
