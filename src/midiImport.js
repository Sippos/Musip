import { Midi } from '@tonejs/midi';
import { state, generateId } from './state.js';
import { setLoopLengthMeasures, syncAudioPart, initTrackSynth } from './audio.js';
import { getPreset } from './state.js';

export async function importMidiFile(file, renderTrackTabs) {
    const arrayBuffer = await file.arrayBuffer();
    const midi = new Midi(arrayBuffer);
    
    // Clear existing
    state.tracks = [];
    state.notes = [];
    
    const colors = ['#A8E6CF', '#FFD3B6', '#FFAAA5', '#D4A5FF', '#A5D8FF'];
    let colorIdx = 0;
    
    // Find length in seconds
    const duration = midi.duration;
    // Estimate measures based on 90 bpm -> 1 beat = 60/90 = 0.666s. 1 measure = 4 beats = 2.666s
    const measures = Math.ceil(duration / (60 / 90 * 4));
    setLoopLengthMeasures(Math.max(2, measures));
    
    midi.tracks.forEach((track, i) => {
        if (track.notes.length === 0) return;
        
        const isDrums = track.instrument.percussion || track.channel === 9;
        const trackId = `track-${generateId()}`;
        
        state.tracks.push({
            id: trackId,
            name: track.name || (isDrums ? 'MIDI Drums' : `Track ${i+1}`),
            presetId: isDrums ? 'drums-kit' : 'keys-sine',
            color: colors[colorIdx % colors.length],
            type: isDrums ? 'drums' : 'synth'
        });
        colorIdx++;
        
        track.notes.forEach(note => {
            let noteStr = note.name;
            if (isDrums) {
                // simple mapping for standard GM drums
                const midiPitch = note.midi;
                if (midiPitch >= 35 && midiPitch <= 40) noteStr = 'kick';
                else if (midiPitch >= 38 && midiPitch <= 40) noteStr = 'snare';
                else if (midiPitch >= 41 && midiPitch <= 49) noteStr = 'snare'; // tom/clap etc mapped to snare
                else noteStr = 'hat';
            }
            
            state.notes.push({
                id: generateId(),
                trackId: trackId,
                note: noteStr,
                time: note.time, // true seconds from MIDI
                duration: Math.max(0.05, note.duration) // true duration
            });
        });
        
        initTrackSynth(trackId, getPreset(isDrums ? 'drums-kit' : 'keys-sine'));
    });
    
    if (state.tracks.length > 0) {
        state.activeTrackId = state.tracks[0].id;
    } else {
        // Fallback if empty
        state.tracks.push({ id: 'track-1', name: 'Bass', presetId: 'bass-square', color: '#A8E6CF', type: 'synth' });
        state.activeTrackId = 'track-1';
        initTrackSynth('track-1', getPreset('bass-square'));
    }
    
    renderTrackTabs();
    syncAudioPart(state.notes);
}
