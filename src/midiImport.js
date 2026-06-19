import { Midi } from '@tonejs/midi';
import { state, generateId } from './state.js';
import { setLoopLengthMeasures, syncAudioPart, initTrackSynth, LOOP_LENGTH_MEASURES } from './audio.js';
import { getPreset } from './state.js';

export async function importMidiFile(file, renderTrackTabs) {
    const arrayBuffer = await file.arrayBuffer();
    const midi = new Midi(arrayBuffer);
    
    const newTracksStartIdx = state.tracks.length;
    
    const colors = ['#A8E6CF', '#FFD3B6', '#FFAAA5', '#D4A5FF', '#A5D8FF'];
    let colorIdx = state.tracks.length; // stagger colors based on existing tracks
    
    // Find length in seconds
    const duration = midi.duration;
    // Estimate measures based on 90 bpm -> 1 beat = 60/90 = 0.666s. 1 measure = 4 beats = 2.666s
    const measures = Math.ceil(duration / (60 / 90 * 4));
    setLoopLengthMeasures(Math.max(LOOP_LENGTH_MEASURES || 2, measures));
    
    const activeMidiTracks = midi.tracks.filter(t => t.notes.length > 0);
    
    if (activeMidiTracks.length === 1 && !activeMidiTracks[0].instrument.percussion && activeMidiTracks[0].channel !== 9) {
        // AUTO-SPLIT Single Track MIDI
        const srcTrack = activeMidiTracks[0];
        const lowId = `track-${generateId()}`;
        const midId = `track-${generateId()}`;
        const highId = `track-${generateId()}`;
        
        state.tracks.push({ id: lowId, name: 'Bass (Auto-Split)', presetId: 'bass-square', color: colors[0], type: 'synth' });
        state.tracks.push({ id: midId, name: 'Mid (Auto-Split)', presetId: 'keys-sine', color: colors[1], type: 'synth' });
        state.tracks.push({ id: highId, name: 'Lead (Auto-Split)', presetId: 'keys-sine', color: colors[2], type: 'synth' });
        
        srcTrack.notes.forEach(note => {
            let targetId;
            if (note.midi < 48) targetId = lowId;      // Below C3
            else if (note.midi <= 72) targetId = midId; // C3 to C5
            else targetId = highId;                     // Above C5
            
            state.notes.push({
                id: generateId(),
                trackId: targetId,
                note: note.name,
                time: note.time,
                duration: Math.max(0.05, note.duration)
            });
        });
        
        initTrackSynth(lowId, getPreset('bass-square'));
        initTrackSynth(midId, getPreset('keys-sine'));
        initTrackSynth(highId, getPreset('keys-sine'));
        
    } else {
        // STANDARD IMPORT
        activeMidiTracks.forEach((track, i) => {
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
                    const midiPitch = note.midi;
                    if (midiPitch >= 35 && midiPitch <= 40) noteStr = 'kick';
                    else if (midiPitch >= 41 && midiPitch <= 49) noteStr = 'snare';
                    else noteStr = 'hat';
                }
                
                state.notes.push({
                    id: generateId(),
                    trackId: trackId,
                    note: noteStr,
                    time: note.time,
                    duration: Math.max(0.05, note.duration)
                });
            });
            
            initTrackSynth(trackId, getPreset(isDrums ? 'drums-kit' : 'keys-sine'));
        });
    }
    
    if (state.tracks.length > newTracksStartIdx) {
        state.activeTrackId = state.tracks[newTracksStartIdx].id; // Select the first newly added track
    } else if (state.tracks.length === 0) {
        // Fallback if empty
        state.tracks.push({ id: 'track-1', name: 'Bass', presetId: 'bass-square', color: '#A8E6CF', type: 'synth' });
        state.activeTrackId = 'track-1';
        initTrackSynth('track-1', getPreset('bass-square'));
    }
    
    renderTrackTabs();
    syncAudioPart(state.notes);
}
