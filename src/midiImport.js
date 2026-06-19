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
        
        const bassNotes = srcTrack.notes.filter(n => n.midi < 48);
        const midNotes = srcTrack.notes.filter(n => n.midi >= 48 && n.midi <= 72);
        const leadNotes = srcTrack.notes.filter(n => n.midi > 72);
        
        const addSplitTrack = (notes, name, preset, colorIdx) => {
            if (notes.length === 0) return;
            const trackId = `track-${generateId()}`;
            state.tracks.push({ id: trackId, name: name, presetId: preset, color: colors[colorIdx % colors.length], type: 'synth', expanded: false, muted: false });
            
            notes.forEach(note => {
                state.notes.push({
                    id: generateId(),
                    trackId: trackId,
                    note: note.name,
                    time: note.time,
                    duration: Math.max(0.05, note.duration)
                });
            });
            initTrackSynth(trackId, getPreset(preset));
        };
        
        addSplitTrack(bassNotes, 'Bass (Auto-Split)', 'bass-square', 0);
        addSplitTrack(midNotes, 'Mid (Auto-Split)', 'keys-sine', 1);
        addSplitTrack(leadNotes, 'Lead (Auto-Split)', 'keys-sine', 2);
        
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
                type: isDrums ? 'drums' : 'synth',
                expanded: false,
                muted: false
            });
            colorIdx++;
            
            track.notes.forEach(note => {
                let noteStr = note.name;
                if (isDrums) {
                    const midiPitch = note.midi;
                    if (midiPitch >= 35 && midiPitch <= 40) noteStr = 'C2';
                    else if (midiPitch >= 41 && midiPitch <= 49) noteStr = 'D2';
                    else noteStr = 'F#2';
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
        state.tracks.push({ id: 'track-1', name: 'Bass', presetId: 'bass-square', color: '#A8E6CF', type: 'synth', expanded: false, muted: false });
        state.activeTrackId = 'track-1';
        initTrackSynth('track-1', getPreset('bass-square'));
    }
    
    renderTrackTabs();
    syncAudioPart(state.notes);
}
