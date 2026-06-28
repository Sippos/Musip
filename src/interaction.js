import { state, generateId, getActiveTrack, undoNote, redoNote, clearRedo } from './state.js';
import * as Tone from 'tone';
import { getTrackScale, playSound, syncAudioPart, LOOP_LENGTH_SECONDS, instrumentsStart, instrumentsStop } from './audio.js';
import { noteToY, yToNote, getTrackLayout, snapMidiToScale, TRACK_MIDI_RANGE, MIN_PITCH_RANGE, MAX_PITCH_RANGE } from './pitchMap.js';
import { RULER_HEIGHT, visibleDur, xToTime, timeToX, clampScrollX, MAX_ZOOM_X } from './renderer.js';

const keys = ['a', 's', 'd', 'f', 'g'];
const activePresses = {};

// When Scale Lock is on and a song's key is known, snap a note name to the
// nearest in-key pitch so handcrafted notes stay in tune. Returns the note
// unchanged otherwise (chromatic placement).
function applyScaleLock(noteName, track) {
    if (track && track.engine === 'chop') return noteName;
    if (!state.scaleLock || !state.song.key) return noteName;
    const midi = Tone.Frequency(noteName).toMidi();
    const snapped = snapMidiToScale(midi, state.song.key.scalePitchClasses);
    return Tone.Frequency(snapped, 'midi').toNote();
}

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
                clearRedo();
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
        
        // Redo (Ctrl+Shift+Z / Cmd+Shift+Z, or Ctrl+Y)
        if (((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'z') ||
            ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y')) {
            redoNote();
            syncAudioPart(state.notes);
        // Undo (Ctrl+Z or Cmd+Z)
        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
            undoNote();
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

                clearRedo();
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
    let dragOffsets = [];
    let dragStartNoteSecs = 0;
    
    // Auto-scroll state
    let autoScrollDir = 0; // -1 for up (decrease midi), 1 for down (increase midi)
    let autoScrollTrackLayout = null;
    let autoScrollRAF = null;
    let currentMouseX = 0;
    let currentMouseY = 0;

    // Move the playhead (Transport position) to a canvas X. Works whether the
    // Transport is running or paused; the render loop reads Transport.seconds.
    function scrubTo(x) {
        const loopDur = LOOP_LENGTH_SECONDS();
        let t = xToTime(x);
        t = Math.max(0, Math.min(loopDur - 0.001, t));
        Tone.Transport.seconds = t;
    }

    function doAutoScroll() {
        if (!dragMode || !dragNote || autoScrollDir === 0 || !autoScrollTrackLayout) {
            autoScrollRAF = null;
            return;
        }
        
        const trLayout = autoScrollTrackLayout;
        let scrolled = false;
        const currentBaseMidi = trLayout.track.baseMidi || 48;
        // One semitone of scroll = one lane tall, which depends on the track's zoom.
        const laneHeight = trLayout.height / (Math.round(trLayout.track.pitchRange || TRACK_MIDI_RANGE));
        if (autoScrollDir === -1 && currentBaseMidi < 84) {
            trLayout.track.baseMidi = currentBaseMidi + 1;
            dragStartY += laneHeight;
            scrolled = true;
        } else if (autoScrollDir === 1 && currentBaseMidi > 12) {
            trLayout.track.baseMidi = currentBaseMidi - 1;
            dragStartY -= laneHeight;
            scrolled = true;
        }
        
        if (scrolled) {
            // Re-trigger the pitch calculation logic
            window.dispatchEvent(new MouseEvent('mousemove', {
                clientX: currentMouseX,
                clientY: currentMouseY
            }));
        }
        
        // Loop every ~50ms for smooth but controlled scroll
        setTimeout(() => {
            if (autoScrollDir !== 0) {
                autoScrollRAF = requestAnimationFrame(doAutoScroll);
            }
        }, 50);
    }


    
    // Prevent context menu to allow right-click erasing
    canvasEl.addEventListener('contextmenu', e => e.preventDefault());
    
    // Wheel event for scrolling + horizontal (time) zoom.
    canvasEl.addEventListener('wheel', (e) => {
        e.preventDefault();
        if (!state.camera) state.camera = { scrollY: 0, zoomY: 1.0, zoomX: 1.0, scrollX: 0 };

        const rect = canvasEl.getBoundingClientRect();
        const currentY = e.clientY - rect.top;
        const cursorX = e.clientX - rect.left;

        // Ctrl/Cmd + wheel = zoom the TIMELINE in/out, anchored on the note under
        // the cursor (so you zoom into what you're looking at). This magnifies time
        // — notes spread apart so they're easy to grab — without changing how tall
        // they are.
        if (e.ctrlKey || e.metaKey) {
            const timeAtCursor = xToTime(cursorX);
            const factor = e.deltaY < 0 ? 1.2 : 1 / 1.2; // wheel up = zoom in
            state.camera.zoomX = Math.max(1, Math.min(MAX_ZOOM_X, (state.camera.zoomX || 1) * factor));
            // Keep timeAtCursor pinned under the cursor after the zoom change.
            state.camera.scrollX = timeAtCursor - (cursorX / canvasEl.width) * visibleDur();
            clampScrollX();
            return;
        }

        // Shift + wheel = pan the timeline left/right when zoomed in.
        if (e.shiftKey) {
            state.camera.scrollX = (state.camera.scrollX || 0) + Math.sign(e.deltaY) * visibleDur() * 0.15;
            clampScrollX();
            return;
        }

        const scrollY = state.camera.scrollY || 0;
        const layout = getTrackLayout(state.tracks, scrollY);
        const hoveredLayout = layout.find(l => currentY >= l.top && currentY <= l.bottom);
        if (hoveredLayout && hoveredLayout.track.expanded) {
            const track = hoveredLayout.track;
            let minLimit = 12; // C0
            let maxLimit = 84; // C6
            if (track.type === 'drums') {
                minLimit = 36;
                maxLimit = 36; // Lock drum scrolling
            } else if (track.engine === 'chop') {
                minLimit = 48;
                maxLimit = 48; // Lock chop scrolling
            }
            const delta = Math.sign(e.deltaY);
            track.baseMidi = Math.max(minLimit, Math.min(maxLimit, Math.round((track.baseMidi || 48)) + delta));
            return;
        }

        // Otherwise scroll the arrangement vertically.
        state.camera.scrollY -= e.deltaY;
        const baseLayout = getTrackLayout(state.tracks, 0);
        const totalHeight = baseLayout.length > 0 ? baseLayout[baseLayout.length - 1].bottom : 0;
        const maxScroll = Math.max(0, totalHeight - canvasEl.height);
        state.camera.scrollY = Math.max(-maxScroll, Math.min(0, state.camera.scrollY));
    }, { passive: false });

    canvasEl.addEventListener('mousedown', (e) => {
        if (!state.isPlaying) return;

        if (e.button === 1) e.preventDefault();

        const rect = canvasEl.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const clickY = e.clientY - rect.top;

        // Middle button to pan the view
        if (e.button === 1) {
            dragMode = 'pan';
            dragStartX = clickX;
            dragOffsets = { startScrollX: state.camera.scrollX || 0 };
            return;
        }

        // Grab the playhead from the top timeline ruler (left button only).
        if (e.button === 0 && clickY <= RULER_HEIGHT) {
            dragMode = 'scrub';
            scrubTo(clickX);
            return;
        }

        const activeTrack = getActiveTrack();
        if (!activeTrack) return;

        const loopDur = LOOP_LENGTH_SECONDS();
        const scrollY = state.camera ? state.camera.scrollY : 0;
        const layout = getTrackLayout(state.tracks, scrollY);
        
        const hitTest = (n) => {
            const trackLayout = layout.find(l => l.track.id === n.trackId);
            if (!trackLayout) return false;
            
            const { track, top: trackTop, height: trackHeight } = trackLayout;
            
            const noteSecs = Tone.Time(n.time).toSeconds() % loopDur;
            const noteX = timeToX(noteSecs);
            const durSecs = Tone.Time(n.duration).toSeconds();
            const noteWidth = timeToX(durSecs) - timeToX(0);
            
            const noteY = noteToY(n, trackTop, trackHeight, track);
            
            let noteHeight;
            if (track.expanded) {
                noteHeight = Math.max(4, canvasEl.height * 0.015);
            } else {
                const laneHeight = trackHeight / 5;
                noteHeight = laneHeight * 0.8;
            }
            const halfHeight = noteHeight / 2;
            const minHitWidth = Math.max(10, noteWidth);
            
            return (clickX >= noteX - 4 && clickX <= noteX + minHitWidth + 4 &&
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
        
        // Erase Tool or Right Click
        if (state.activeTool === 'erase' || e.button === 2) {
            if (noteIndex !== -1) {
                state.notes.splice(noteIndex, 1);
                syncAudioPart(state.notes);
            }
            return;
        }
        
        // Left Click: Create, Move or Select
        if (e.button !== 0) return; 
        
        if (state.activeTool === 'select') {
            if (noteIndex !== -1 && state.selectedNoteIds.includes(state.notes[noteIndex].id)) {
                // Clicked on a selected note, prepare to move ALL selected notes
                dragMode = 'move-selection';
                dragStartX = clickX;
                dragStartY = clickY;
                dragOffsets = state.selectedNoteIds.map(id => {
                    const n = state.notes.find(nn => nn.id === id);
                    return {
                        note: n,
                        startNoteVal: n.note,
                        startTime: Tone.Time(n.time).toSeconds() % loopDur,
                        startScaleIndex: n.scaleIndex !== undefined ? n.scaleIndex : null
                    };
                }).filter(n => n.note);
            } else if (noteIndex !== -1) {
                // Clicked an unselected note with select tool -> Select only this one and move it
                state.selectedNoteIds = [state.notes[noteIndex].id];
                dragMode = 'move-selection';
                dragStartX = clickX;
                dragStartY = clickY;
                const n = state.notes[noteIndex];
                dragOffsets = [{
                    note: n,
                    startNoteVal: n.note,
                    startTime: Tone.Time(n.time).toSeconds() % loopDur,
                    startScaleIndex: n.scaleIndex !== undefined ? n.scaleIndex : null
                }];
            } else {
                // Clicked empty space -> start selection box
                dragMode = 'select-box';
                state.selectedNoteIds = [];
                dragStartX = clickX;
                dragStartY = clickY;
                state.selectionBox = { x: clickX, y: clickY, w: 0, h: 0 };
            }
            return;
        }
        
        // Default Tool: Draw
        if (noteIndex !== -1) {
            dragMode = 'move';
            dragNote = state.notes[noteIndex];
            dragNoteIndex = noteIndex;
            dragStartX = clickX;
            dragStartY = clickY;
            dragOffsets = [{
                note: dragNote,
                startNoteVal: dragNote.note,
                startTime: Tone.Time(dragNote.time).toSeconds() % loopDur,
                startScaleIndex: dragNote.scaleIndex !== undefined ? dragNote.scaleIndex : null
            }];
            
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
            
            const noteSecs = xToTime(clickX);
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
                } else {
                    noteVal = applyScaleLock(noteVal, clickedTrack);
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

            clearRedo();
            state.notes.push(dragNote);
            syncAudioPart(state.notes);
            
            playSound(clickedTrack.id, noteVal, undefined, "32n");
        }
    });
    
    window.addEventListener('mousemove', (e) => {
        currentMouseX = e.clientX;
        currentMouseY = e.clientY;

        if (!dragMode) {
            // Hint that the top ruler strip is the playhead scrub zone.
            const rect = canvasEl.getBoundingClientRect();
            const overRuler = (e.clientY - rect.top) <= RULER_HEIGHT &&
                e.clientX >= rect.left && e.clientX <= rect.right;
            canvasEl.style.cursor = overRuler ? 'ew-resize' : '';
            return;
        }

        if (dragMode === 'scrub') {
            const rect = canvasEl.getBoundingClientRect();
            scrubTo(e.clientX - rect.left);
            return;
        }

        if (dragMode === 'pan') {
            const rect = canvasEl.getBoundingClientRect();
            const currentX = e.clientX - rect.left;
            const diffX = currentX - dragStartX;
            state.camera.scrollX = dragOffsets.startScrollX - (diffX / canvasEl.width) * visibleDur();
            clampScrollX();
            return;
        }

        const activeTrack = getActiveTrack();
        if (!activeTrack) return;
        
        const rect = canvasEl.getBoundingClientRect();
        const currentX = e.clientX - rect.left;
        const currentY = e.clientY - rect.top;
        
        const loopDur = LOOP_LENGTH_SECONDS();
        const scrollY = state.camera ? state.camera.scrollY : 0;
        const layout = getTrackLayout(state.tracks, scrollY);
        
        if (dragMode === 'select-box') {
            state.selectionBox.w = currentX - dragStartX;
            state.selectionBox.h = currentY - dragStartY;
            
            // Normalize box for hit detection
            const box = {
                x: state.selectionBox.w < 0 ? currentX : dragStartX,
                y: state.selectionBox.h < 0 ? currentY : dragStartY,
                w: Math.abs(state.selectionBox.w),
                h: Math.abs(state.selectionBox.h)
            };
            
            state.selectedNoteIds = [];
            state.notes.forEach(note => {
                const trackLayout = layout.find(l => l.track.id === note.trackId);
                if (!trackLayout) return;
                
                const noteSecs = Tone.Time(note.time).toSeconds() % loopDur;
                const noteX = timeToX(noteSecs);
                const noteY = noteToY(note, trackLayout.top, trackLayout.height, trackLayout.track);
                
                if (noteX >= box.x && noteX <= box.x + box.w &&
                    noteY >= box.y && noteY <= box.y + box.h) {
                    state.selectedNoteIds.push(note.id);
                }
            });
            return;
        }
        
        if (dragMode === 'create' && activeTrack.type !== 'drums') {
            // Drag to draw length
            const diffX = Math.max(0, currentX - dragStartX);
            const diffSecs = xToTime(currentX) - xToTime(dragStartX);
            
            const minDur = Tone.Time("32n").toSeconds();
            let newDurSecs = Math.max(minDur, diffSecs);
            let qDur = Tone.Time(newDurSecs).quantize("32n");
            if (Tone.Time(qDur).toSeconds() <= 0) qDur = "32n";
            dragNote.duration = qDur;
            
        } else if (dragMode === 'move' || dragMode === 'move-selection') {
            const diffXSecs = xToTime(currentX) - xToTime(dragStartX);
            
            // Auto-scroll track internal pitch if dragging near edge
            if (dragNote) {
                const trLayout = layout.find(l => l.track.id === dragNote.trackId);
                if (trLayout && trLayout.track.expanded && trLayout.track.type !== 'drums') {
                    const edgeThreshold = 30; // pixels
                    const visibleTop = Math.max(0, trLayout.top);
                    const visibleBottom = Math.min(canvasEl.height, trLayout.bottom);
                    
                    let newDir = 0;
                    if (currentY < visibleTop + edgeThreshold) {
                        newDir = -1; // Scroll up view (higher notes)
                    } else if (currentY > visibleBottom - edgeThreshold) {
                        newDir = 1; // Scroll down view (lower notes)
                    }
                    
                    if (newDir !== autoScrollDir) {
                        autoScrollDir = newDir;
                        autoScrollTrackLayout = trLayout;
                        if (autoScrollDir !== 0 && !autoScrollRAF) {
                            autoScrollRAF = requestAnimationFrame(doAutoScroll);
                        }
                    }
                } else {
                    autoScrollDir = 0;
                }
            }
            
            dragOffsets.forEach(item => {
                let noteSecs = item.startTime + diffXSecs;
                if (noteSecs < 0) noteSecs = 0;
                if (noteSecs >= loopDur) noteSecs = loopDur - 0.01;
                const qTime = Tone.Time(noteSecs).quantize("32n");
                item.note.time = Tone.Time(qTime).toBarsBeatsSixteenths();
                
                const t = state.tracks.find(tr => tr.id === item.note.trackId);
                const trLayout = layout.find(l => l.track.id === t.id);
                if (trLayout) {
                    let newNoteVal;
                    const noteYDiff = currentY - dragStartY;
                    const startNoteY = noteToY({note: item.startNoteVal}, trLayout.top, trLayout.height, t);
                    const targetY = startNoteY + noteYDiff;
                    
                    if (t.expanded) {
                        newNoteVal = yToNote(targetY, trLayout.top, trLayout.height, t);
                        if (t.type === 'drums') {
                            const midi = Tone.Frequency(newNoteVal).toMidi();
                            if (midi >= 40) newNoteVal = 'F#2';
                            else if (midi >= 37) newNoteVal = 'D2';
                            else newNoteVal = 'C2';
                        } else {
                            newNoteVal = applyScaleLock(newNoteVal, t);
                        }
                        // Clamp chop track drags to strictly Pad 1-16 limits (MIDI 48-63)
                        if (t.engine === 'chop') {
                            const midi = Tone.Frequency(newNoteVal).toMidi();
                            const clamped = Math.max(48, Math.min(63, midi));
                            newNoteVal = Tone.Frequency(clamped, 'midi').toNote();
                        }
                        item.note.scaleIndex = undefined;
                    } else {
                        const yWithinTrack = targetY - trLayout.top;
                        const yIndex = Math.floor(yWithinTrack / (trLayout.height / 5));
                        let scaleIndex = (5 - 1) - yIndex;
                        if (scaleIndex < 0) scaleIndex = 0;
                        if (scaleIndex > 4) scaleIndex = 4;
                        const scale = getTrackScale(t);
                        newNoteVal = scale[scaleIndex];
                        item.note.scaleIndex = scaleIndex;
                    }
                    
                    if (item.note.note !== newNoteVal && dragMode === 'move') {
                        playSound(t.id, newNoteVal, undefined, "32n");
                    }
                    item.note.note = newNoteVal;
                }
            });
        }
    });
    
    window.addEventListener('mouseup', (e) => {
        if (dragMode) {
            if (dragMode !== 'select-box' && dragMode !== 'scrub') {
                syncAudioPart(state.notes);
            }
            state.selectionBox = null;
            dragMode = null;
            dragNote = null;
            dragNoteIndex = -1;
            dragOffsets = [];
            
            autoScrollDir = 0;
            autoScrollRAF = null;
        }
    });
}
