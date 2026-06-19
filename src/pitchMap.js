import * as Tone from 'tone';
import { state } from './state.js';

export const MIN_MIDI = 36; // C2
export const MAX_MIDI = 96; // C7
export const MIDI_RANGE = MAX_MIDI - MIN_MIDI;

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

export function noteToY(noteObj, trackTop, trackHeight, expanded) {
    const noteStr = typeof noteObj === 'string' ? noteObj : noteObj.note;
    
    if (expanded) {
        try {
            const midi = Tone.Frequency(noteStr).toMidi();
            const clampedMidi = Math.max(MIN_MIDI, Math.min(MAX_MIDI, midi));
            const normalized = 1.0 - ((clampedMidi - MIN_MIDI) / MIDI_RANGE);
            return trackTop + (normalized * trackHeight);
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
            const clampedMidi = Math.max(MIN_MIDI, Math.min(MAX_MIDI, midi));
            const normalized = (clampedMidi - MIN_MIDI) / MIDI_RANGE;
            const scaleIndex = Math.floor(normalized * 4.99); // 0 to 4
            const yIndex = 4 - scaleIndex;
            return trackTop + (yIndex * laneHeight) + (laneHeight / 2);
        } catch {
            return trackTop + (2 * laneHeight) + (laneHeight / 2); // Middle lane default
        }
    }
}

export function yToNote(y, trackTop, trackHeight) {
    const yWithin = Math.max(0, Math.min(trackHeight, y - trackTop));
    const normalized = 1.0 - (yWithin / trackHeight);
    const midi = Math.round(MIN_MIDI + (normalized * MIDI_RANGE));
    const clamped = Math.max(0, Math.min(127, midi));
    return Tone.Frequency(clamped, "midi").toNote();
}
