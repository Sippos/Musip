import * as Tone from 'tone';
import { state } from './state.js';

export const TRACK_MIDI_RANGE = 24;

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
            const laneHeight = trackHeight / TRACK_MIDI_RANGE;
            const midi = Tone.Frequency(noteStr).toMidi();
            const minMidi = track.baseMidi || 48;
            const noteIndex = midi - minMidi; // 0 to 23
            const yIndex = (TRACK_MIDI_RANGE - 1) - noteIndex; // 23 to 0
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

export function yToNote(y, trackTop, trackHeight, track) {
    if (track.expanded) {
        const yWithin = Math.max(0, Math.min(trackHeight - 0.001, y - trackTop));
        const laneHeight = trackHeight / TRACK_MIDI_RANGE;
        const yIndex = Math.floor(yWithin / laneHeight);
        const noteIndex = (TRACK_MIDI_RANGE - 1) - yIndex;
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
