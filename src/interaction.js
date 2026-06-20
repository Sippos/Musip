import { state, generateId, getActiveTrack } from './state.js';
import * as Tone from 'tone';
import { getTrackScale, playSound, syncAudioPart, LOOP_LENGTH_SECONDS, instrumentsStart, instrumentsStop } from './audio.js';
import { noteToY, yToNote, getTrackLayout } from './pitchMap.js';

const keys = ['a', 's', 'd', 'f', 'g'];
const activePresses = {};

export function initInteraction(canvasEl) {
    window.addEventListener('keydown', (e) => {
        if (e.code === 'Space' && state.isPlaying) {
            e.preventDefault();
            if (Tone.Transport.state === "started") {
                Tone.Transport.pause();
            } else {
                Tone.Transport.start();
            }
            return;
        }
        
        if (!state.isPlaying || e.repeat) return;
        
        const key = e.key.toLowerCase();
        const index = keys.indexOf(key);
        
        if (index !== -1) {
            state.activeKeyIndex = index;
            
            const activeTrack = getActiveTrack();
            if (!activeTrack) return;
            
            const scale = getTrackScale(activeTrack);
            const noteVal = scale[index];
            
            // Quantize to nearest 16th note, wrapped in loop
            const now = Tone.Transport.seconds;
            let qTime = Tone.Time(now).quantize("32n");
            
            // Start playing immediately for responsiveness
            if (activeTrack.type === 'drums') {
                playSound(activeTrack.id, noteVal, undefined, "32n");
                
                // For drums, duration is fixed, save directly
                state.notes.push({
                    id: generateId(),
                    trackId: activeTrack.id,
                    note: noteVal,
                    scaleIndex: index,
                    time: Tone.Time(qTime).toBarsBeatsSixteenths(),
                    duration: "32n"
                });
                syncAudioPart(state.notes);
                
            } else {
                // Synths - trigger and wait for keyup
                instrumentsStart(activeTrack.id, noteVal);
                
                activePresses[key] = {
                    time: qTime, // raw quantized seconds
                    noteVal,
                    scaleIndex: index
                };
            }
        }
        
        // Undo (Ctrl+Z or Cmd+Z)
        if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
            state.notes.pop();
            syncAudioPart(state.notes);
        }
    });
    
    window.addEventListener('keyup', (e) => {
        const key = e.key.toLowerCase();
        
        if (keys.indexOf(key) !== -1) {
            state.activeKeyIndex = null;
            
            if (activePresses[key]) {
                const press = activePresses[key];
                const activeTrack = getActiveTrack();
                if (!activeTrack) return;
                
                instrumentsStop(activeTrack.id, press.noteVal);
                
                const now = Tone.Transport.seconds;
                let qEndTime = Tone.Time(now).quantize("32n");
                let duration = qEndTime - press.time;
                
                if (duration <= 0) duration = Tone.Time("32n").toSeconds();
                
                state.notes.push({
                    id: generateId(),
                    trackId: activeTrack.id,
                    note: press.noteVal,
                    scaleIndex: press.scaleIndex,
                    time: Tone.Time(press.time).toBarsBeatsSixteenths(),
                    duration: duration // save duration in seconds for synth
                });
                syncAudioPart(state.notes);
                
                delete activePresses[key];
            }
        }
    });
    
    // Piano Roll Mouse Interaction
    let dragMode = null;
    let dragNote = null;
    let dragStartX = 0;
    let dragStartY = 0;
    let dragNoteIndex = -1;
    
    // Prevent context menu to allow right-click erasing
    canvasEl.addEventListener('contextmenu', e => e.preventDefault());
    
    // Wheel event for scrolling
    canvasEl.addEventListener('wheel', (e) => {
        e.preventDefault();
        
        const rect = canvasEl.getBoundingClientRect();
        const currentY = e.clientY - rect.top;
        const scrollY = state.camera ? state.camera.scrollY : 0;
        const layout = getTrackLayout(state.tracks, scrollY);
        
        const hoveredLayout = layout.find(l => currentY >= l.top && currentY <= l.bottom);
        if (hoveredLayout && hoveredLayout.track.expanded) {
            // Scroll internal pitch
            const delta = Math.sign(e.deltaY);
            // Invert delta so scrolling down moves to lower pitches
            hoveredLayout.track.baseMidi = Math.max(0, Math.min(100, (hoveredLayout.track.baseMidi || 48) + delta));
            return;
        }
        
        // Otherwise scroll arrangement
        if (!state.camera) state.camera = { scrollY: 0, zoomY: 1.0 };
        state.camera.scrollY -= e.deltaY;
        
        const baseLayout = getTrackLayout(state.tracks, 0);
        const totalHeight = baseLayout.length > 0 ? baseLayout[baseLayout.length - 1].bottom : 0;
        const maxScroll = Math.max(0, totalHeight - canvasEl.height);
        state.camera.scrollY = Math.max(-maxScroll, Math.min(0, state.camera.scrollY));
    }, { passive: false });

    canvasEl.addEventListener('mousedown', (e) => {
        if (!state.isPlaying) return;
        
        const activeTrack = getActiveTrack();
        if (!activeTrack) return;
        
        const rect = canvasEl.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const clickY = e.clientY - rect.top;
        
        const loopDur = LOOP_LENGTH_SECONDS();
        const scrollY = state.camera ? state.camera.scrollY : 0;
        const layout = getTrackLayout(state.tracks, scrollY);
        
        const hitTest = (n) => {
            const trackLayout = layout.find(l => l.track.id === n.trackId);
            if (!trackLayout) return false;
            
            const { track, top: trackTop, height: trackHeight } = trackLayout;
            
            const noteSecs = Tone.Time(n.time).toSeconds() % loopDur;
            const noteX = (noteSecs / loopDur) * canvasEl.width;
            const durSecs = Tone.Time(n.duration).toSeconds();
            const noteWidth = (durSecs / loopDur) * canvasEl.width;
            
            const noteY = noteToY(n, trackTop, trackHeight, track);
            
            let noteHeight;
            if (track.expanded) {
                noteHeight = Math.max(4, canvasEl.height * 0.015);
            } else {
                const laneHeight = trackHeight / 5;
                noteHeight = laneHeight * 0.8;
            }
            const halfHeight = noteHeight / 2;
            
            return (clickX >= noteX && clickX <= noteX + noteWidth &&
                    clickY >= noteY - halfHeight - 4 && 
                    clickY <= noteY + halfHeight + 4);
        };
        
        let targetNoteIndex = -1;
        // First try to hit a note in the active track
        for (let i = state.notes.length - 1; i >= 0; i--) {
            if (state.notes[i].trackId === state.activeTrackId && hitTest(state.notes[i])) {
                targetNoteIndex = i;
                break;
            }
        }
        // If not found, try other tracks (but only if they are not muted)
        if (targetNoteIndex === -1) {
            for (let i = state.notes.length - 1; i >= 0; i--) {
                const track = state.tracks.find(t => t.id === state.notes[i].trackId);
                if (state.notes[i].trackId !== state.activeTrackId && track && !track.muted && hitTest(state.notes[i])) {
                    targetNoteIndex = i;
                    break;
                }
            }
        }
        
        const noteIndex = targetNoteIndex;
        
        // Right Click: Erase
        if (e.button === 2) {
            if (noteIndex !== -1) {
                state.notes.splice(noteIndex, 1);
                syncAudioPart(state.notes);
            }
            return;
        }
        
        // Left Click: Create or Move
        if (e.button !== 0) return; 
        
        if (noteIndex !== -1) {
            dragMode = 'move';
            dragNote = state.notes[noteIndex];
            dragNoteIndex = noteIndex;
            dragStartX = clickX;
            dragStartY = clickY;
            dragStartNoteSecs = Tone.Time(dragNote.time).toSeconds() % loopDur;
            
            if (dragNote.trackId !== state.activeTrackId) {
                state.activeTrackId = dragNote.trackId;
                window.dispatchEvent(new CustomEvent('activeTrackChanged'));
            }
        } else {
            // Determine clicked track from layout
            const clickedTrackLayout = layout.find(l => clickY >= l.top && clickY <= l.bottom);
            if (!clickedTrackLayout) return; // Clicked outside all tracks
            
            const { track: clickedTrack, top: trackTop, height: trackHeight } = clickedTrackLayout;
            
            if (clickedTrack.id !== state.activeTrackId) {
                state.activeTrackId = clickedTrack.id;
                window.dispatchEvent(new CustomEvent('activeTrackChanged'));
            }
            
            dragMode = 'create';
            dragStartX = clickX;
            dragStartY = clickY;
            
            const progress = clickX / canvasEl.width;
            const noteSecs = progress * loopDur;
            const qTime = Tone.Time(noteSecs).quantize("32n");
            
            let noteVal;
            let scaleIndex = null;
            
            if (clickedTrack.expanded) {
                noteVal = yToNote(clickY, trackTop, trackHeight, clickedTrack);
                if (clickedTrack.type === 'drums') {
                    const midi = Tone.Frequency(noteVal).toMidi();
                    if (midi >= 40) noteVal = 'F#2'; // Hat
                    else if (midi >= 37) noteVal = 'D2'; // Snare
                    else noteVal = 'C2'; // Kick
                }
            } else {
                const yWithinTrack = clickY - trackTop;
                const yIndex = Math.floor(yWithinTrack / (trackHeight / 5));
                scaleIndex = (5 - 1) - yIndex;
                if (scaleIndex < 0) scaleIndex = 0;
                if (scaleIndex > 4) scaleIndex = 4;
                
                const scale = getTrackScale(clickedTrack);
                noteVal = scale[scaleIndex];
            }
            
            dragNote = {
                id: generateId(),
                trackId: clickedTrack.id,
                note: noteVal,
                time: Tone.Time(qTime).toBarsBeatsSixteenths(),
                duration: "32n"
            };
            if (scaleIndex !== null) dragNote.scaleIndex = scaleIndex;
            
            state.notes.push(dragNote);
            syncAudioPart(state.notes);
            
            playSound(clickedTrack.id, noteVal, undefined, "32n");
        }
    });
    
    window.addEventListener('mousemove', (e) => {
        if (!dragMode || !dragNote) return;
        
        const activeTrack = getActiveTrack();
        if (!activeTrack) return;
        
        const rect = canvasEl.getBoundingClientRect();
        const currentX = e.clientX - rect.left;
        const currentY = e.clientY - rect.top;
        
        const loopDur = LOOP_LENGTH_SECONDS();
        const scrollY = state.camera ? state.camera.scrollY : 0;
        const layout = getTrackLayout(state.tracks, scrollY);
        
        const trackLayout = layout.find(l => l.track.id === dragNote.trackId);
        if (!trackLayout) return;
        const { track, top: trackTop, height: trackHeight } = trackLayout;
        
        if (dragMode === 'create' && activeTrack.type !== 'drums') {
            // Drag to draw length
            const diffX = Math.max(0, currentX - dragStartX);
            const diffSecs = (diffX / canvasEl.width) * loopDur;
            
            const minDur = Tone.Time("32n").toSeconds();
            let newDurSecs = Math.max(minDur, diffSecs);
            let qDur = Tone.Time(newDurSecs).quantize("32n");
            if (Tone.Time(qDur).toSeconds() <= 0) qDur = "32n";
            dragNote.duration = qDur;
            
        } else if (dragMode === 'move') {
            const oldNote = dragNote.note;
            
            // Update time relatively to prevent jumping
            const diffX = currentX - dragStartX;
            const diffSecs = (diffX / canvasEl.width) * loopDur;
            let noteSecs = dragStartNoteSecs + diffSecs;
            
            // Wrap around or clamp
            if (noteSecs < 0) noteSecs = 0;
            if (noteSecs >= loopDur) noteSecs = loopDur - 0.01;
            
            const qTime = Tone.Time(noteSecs).quantize("32n");
            dragNote.time = Tone.Time(qTime).toBarsBeatsSixteenths();
            
            // Update pitch
            let newNoteVal;
            if (track.expanded) {
                newNoteVal = yToNote(currentY, trackTop, trackHeight, track);
                if (track.type === 'drums') {
                    const midi = Tone.Frequency(newNoteVal).toMidi();
                    if (midi >= 40) newNoteVal = 'F#2';
                    else if (midi >= 37) newNoteVal = 'D2';
                    else newNoteVal = 'C2';
                }
                dragNote.scaleIndex = undefined; // Remove scale index since it's freeform now
            } else {
                const yWithinTrack = currentY - trackTop;
                const yIndex = Math.floor(yWithinTrack / (trackHeight / 5));
                let scaleIndex = (5 - 1) - yIndex;
                if (scaleIndex < 0) scaleIndex = 0;
                if (scaleIndex > 4) scaleIndex = 4;
                
                const scale = getTrackScale(activeTrack);
                newNoteVal = scale[scaleIndex];
                dragNote.scaleIndex = scaleIndex;
            }
            
            dragNote.note = newNoteVal;
            
            if (oldNote !== newNoteVal) {
                playSound(activeTrack.id, newNoteVal, undefined, "32n");
            }
        }
    });
    
    window.addEventListener('mouseup', (e) => {
        if (dragMode) {
            syncAudioPart(state.notes);
            dragMode = null;
            dragNote = null;
            dragNoteIndex = -1;
        }
    });
}
