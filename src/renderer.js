import { state, getActiveTrack } from './state.js';
import * as Tone from 'tone';
import { LOOP_LENGTH_SECONDS, masterAnalyser, isTrackAudible } from './audio.js';
import { noteToY, getTrackLayout, getPitchRange } from './pitchMap.js';

// Height (in CSS/canvas px) of the timeline ruler strip across the top of the
// sequencer. Click/drag here to scrub the playhead; shared with interaction.js
// so the grab zone and the drawn strip stay in sync.
export const RULER_HEIGHT = 16;

let canvas, ctx;
let bgLightness = 96;
let lastBeat = -1;
let beatPulse = 0;

// Maximum horizontal zoom. zoomX=1 shows the whole loop; this caps how far in.
export const MAX_ZOOM_X = 40;

// How many seconds of the loop are visible given the current horizontal zoom.
export function visibleDur() {
    const loopDur = LOOP_LENGTH_SECONDS();
    const zoomX = (state.camera && state.camera.zoomX) || 1;
    return loopDur / zoomX;
}

// Clamp the horizontal scroll so the view stays within [0, loopDur].
export function clampScrollX() {
    if (!state.camera) return;
    const maxScroll = Math.max(0, LOOP_LENGTH_SECONDS() - visibleDur());
    state.camera.scrollX = Math.max(0, Math.min(maxScroll, state.camera.scrollX || 0));
}

// Time (seconds) -> canvas x, honouring horizontal zoom + scroll. The single
// source of truth for the time axis, shared with interaction.js so hit-testing
// and drawing never drift apart.
export function timeToX(seconds) {
    const scrollX = (state.camera && state.camera.scrollX) || 0;
    return ((seconds - scrollX) / visibleDur()) * canvas.width;
}

// Canvas x -> time (seconds). Inverse of timeToX.
export function xToTime(x) {
    const scrollX = (state.camera && state.camera.scrollX) || 0;
    return scrollX + (x / canvas.width) * visibleDur();
}

export function initRenderer(canvasEl) {
    canvas = canvasEl;
    ctx = canvas.getContext('2d');
    
    const resize = () => {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', resize);
    resize();
    
    requestAnimationFrame(render);
}

function render(time) {
    requestAnimationFrame(render);
    
    if (!state.isPlaying) {
        ctx.fillStyle = '#FAF9F6';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        return;
    }
    
    // Metronome / Takt tracking
    const pos = Tone.Transport.position.split(':');
    const currentBar = parseInt(pos[0]);
    const currentQuarter = parseInt(pos[1]);
    const absoluteBeat = currentBar * 4 + currentQuarter;
    
    if (absoluteBeat !== lastBeat && parseFloat(pos[2]) < 0.5) {
        lastBeat = absoluteBeat;
        beatPulse = 1.0;
        // Stronger background flash on the "1" (downbeat)
        if (currentQuarter === 0) {
            bgLightness = 98;
        } else {
            bgLightness = 97;
        }
    } else {
        beatPulse = Math.max(0, beatPulse - 0.05);
        bgLightness = Math.max(96, bgLightness - 0.1);
    }
    
    const actualBgLightness = state.settings.visualPulse ? bgLightness : 96;
    ctx.fillStyle = `hsl(40, 33%, ${actualBgLightness}%)`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Draw Living Waveform Background (Small, bottom middle)
    if (state.isPlaying && masterAnalyser && state.settings.visualPulse) {
        const values = masterAnalyser.getValue();
        ctx.beginPath();
        
        let sum = 0;
        for(let i=0; i<values.length; i++) sum += Math.abs(values[i]);
        const amp = sum / values.length;
        
        ctx.strokeStyle = `rgba(0, 0, 0, ${0.1 + (amp * 0.2)})`;
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        
        const waveWidth = 200;
        const waveHeight = 40;
        const startX = (canvas.width / 2) - (waveWidth / 2);
        const startY = canvas.height - 40;
        
        for (let i = 0; i < values.length; i++) {
            const x = startX + (i / (values.length - 1)) * waveWidth;
            const y = startY + (values[i] * waveHeight);
            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        }
        ctx.stroke();
    }
    
    const loopDur = LOOP_LENGTH_SECONDS();
    clampScrollX();
    const currentSecs = (Tone.Transport.seconds % loopDur);
    const playheadX = timeToX(currentSecs);

    const scrollY = state.camera ? state.camera.scrollY : 0;
    const layout = getTrackLayout(state.tracks, scrollY);
    
    // Draw track backgrounds and dividers
    layout.forEach((trackLayout, index) => {
        const trackTop = trackLayout.top;
        const trackHeight = trackLayout.height;
        const track = trackLayout.track;
        
        // Active track highlight
        ctx.fillStyle = track.id === state.activeTrackId ? 'rgba(0,0,0,0.03)' : 'transparent';
        ctx.fillRect(0, trackTop, canvas.width, trackHeight);
        
        // Draw 5 lane dividers ONLY if collapsed
        if (!track.expanded) {
            ctx.strokeStyle = 'rgba(0,0,0,0.03)';
            ctx.lineWidth = 1;
            for (let i = 1; i < 5; i++) {
                const laneY = trackTop + (i * (trackHeight / 5));
                ctx.beginPath();
                ctx.moveTo(0, laneY);
                ctx.lineTo(canvas.width, laneY);
                ctx.stroke();
            }
        } else {
            // Draw the piano-roll grid across the track's (zoomable) pitch window.
            const baseMidi = track.baseMidi || 48;
            const range = getPitchRange(track);
            for (let i = 0; i < range; i++) {
                const midi = baseMidi + i;
                const noteInOctave = midi % 12;
                const isBlackKey = [1, 3, 6, 8, 10].includes(noteInOctave);

                const yBottom = trackTop + ((1.0 - (i / range)) * trackHeight);
                const yTop = trackTop + ((1.0 - ((i + 1) / range)) * trackHeight);

                // When a song's key is known, tint in-key rows (tonic strongest)
                // and dim out-of-key rows so the "safe" notes are obvious at a
                // glance. Falls back to plain black-key shading otherwise.
                const key = state.song.key;
                if (key && track.type !== 'drums') {
                    if (noteInOctave === key.tonic) {
                        ctx.fillStyle = 'rgba(27, 158, 110, 0.12)';
                        ctx.fillRect(0, yTop, canvas.width, yBottom - yTop);
                    } else if (key.scalePitchClasses.includes(noteInOctave)) {
                        ctx.fillStyle = 'rgba(27, 158, 110, 0.05)';
                        ctx.fillRect(0, yTop, canvas.width, yBottom - yTop);
                    } else {
                        ctx.fillStyle = 'rgba(0,0,0,0.06)';
                        ctx.fillRect(0, yTop, canvas.width, yBottom - yTop);
                    }
                } else if (isBlackKey) {
                    ctx.fillStyle = 'rgba(0,0,0,0.03)';
                    ctx.fillRect(0, yTop, canvas.width, yBottom - yTop);
                }
                
                ctx.strokeStyle = 'rgba(0,0,0,0.02)';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(0, yTop);
                ctx.lineTo(canvas.width, yTop);
                ctx.stroke();
                
                // Draw C note labels to avoid "infinite loop" feeling
                if (noteInOctave === 0 && track.type !== 'drums') {
                    ctx.fillStyle = 'rgba(0,0,0,0.3)';
                    ctx.font = '10px sans-serif';
                    ctx.fillText(`C${Math.floor(midi / 12) - 1}`, 5, yBottom - 3);
                }
            }
        }
        
        // Track divider
        ctx.strokeStyle = 'rgba(0,0,0,0.15)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, trackTop + trackHeight);
        ctx.lineTo(canvas.width, trackTop + trackHeight);
        ctx.stroke();
    });

    // Beat grid: vertical bar/beat lines aligned to the playback tempo, so the
    // grid matches the real song once "Learn a Song" has set the detected tempo
    // (and gives a sensible grid at the default 90 BPM otherwise). Bars (every 4
    // beats) are drawn stronger than beats.
    const secondsPerBeat = 60 / Tone.Transport.bpm.value;
    if (secondsPerBeat > 0 && isFinite(secondsPerBeat)) {
        for (let beat = 0, t = 0; t < loopDur; beat++, t += secondsPerBeat) {
            const x = Math.round(timeToX(t)) + 0.5;
            if (x < 0 || x > canvas.width) continue; // off-screen when zoomed in
            ctx.strokeStyle = beat % 4 === 0 ? 'rgba(0,0,0,0.12)' : 'rgba(0,0,0,0.04)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x, RULER_HEIGHT);
            ctx.lineTo(x, canvas.height);
            ctx.stroke();
        }
    }

    // Draw notes
    state.notes.forEach(note => {
        const trackLayout = layout.find(l => l.track.id === note.trackId);
        if (!trackLayout) return;
        
        const { track, top: trackTop, height: trackHeight } = trackLayout;
        
        // Don't draw notes if they are scrolled off screen
        if (trackTop > canvas.height || trackTop + trackHeight < 0) return;
        
        const isActive = note.trackId === state.activeTrackId;
        ctx.fillStyle = track.color;
        if (!isTrackAudible(track)) {
            // Muted, or silenced because another track is soloed.
            ctx.fillStyle = '#999999';
            ctx.globalAlpha = isActive ? 0.3 : 0.05;
        } else {
            ctx.globalAlpha = isActive ? 1.0 : 0.5; // Inactive tracks are more visible now since they don't overlap
        }
        
        const noteSecs = Tone.Time(note.time).toSeconds() % loopDur;
        const noteX = timeToX(noteSecs);

        const noteY = noteToY(note, trackTop, trackHeight, track);
        const noteDur = Tone.Time(note.duration).toSeconds();
        const noteWidth = timeToX(noteSecs + noteDur) - noteX;

        // Skip notes scrolled off the (horizontally zoomed) view.
        if (noteX + Math.max(8, noteWidth) < 0 || noteX > canvas.width) return;

        let noteHeight;
        if (track.expanded) {
            noteHeight = Math.max(4, trackHeight * 0.015);
            // Hide if completely outside bounds
            if (noteY + noteHeight/2 < trackTop || noteY - noteHeight/2 > trackTop + trackHeight) return;
        } else {
            const laneHeight = trackHeight / 5;
            noteHeight = laneHeight * 0.8;
        }

        ctx.beginPath();
        if (ctx.roundRect) {
            ctx.roundRect(noteX, noteY - noteHeight/2, Math.max(8, noteWidth), noteHeight, 8);
        } else {
            ctx.rect(noteX, noteY - noteHeight/2, Math.max(8, noteWidth), noteHeight);
        }
        ctx.fill();
        
        // Highlight selected notes
        if (state.selectedNoteIds && state.selectedNoteIds.includes(note.id)) {
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2;
            ctx.stroke();
        }
    });
    ctx.globalAlpha = 1.0;
    
    // Draw Selection Box
    if (state.selectionBox) {
        ctx.fillStyle = 'rgba(150, 150, 200, 0.2)';
        ctx.strokeStyle = 'rgba(150, 150, 200, 0.6)';
        ctx.lineWidth = 1;
        ctx.fillRect(state.selectionBox.x, state.selectionBox.y, state.selectionBox.w, state.selectionBox.h);
        ctx.strokeRect(state.selectionBox.x, state.selectionBox.y, state.selectionBox.w, state.selectionBox.h);
    }
    
    // Playhead
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.fillRect(playheadX, 0, 2, canvas.height);

    // Timeline ruler strip + draggable playhead handle. Drawn last so it sits
    // above notes; grab zone is mirrored in interaction.js via RULER_HEIGHT.
    ctx.fillStyle = 'rgba(0,0,0,0.05)';
    ctx.fillRect(0, 0, canvas.width, RULER_HEIGHT);
    ctx.strokeStyle = 'rgba(0,0,0,0.1)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, RULER_HEIGHT + 0.5);
    ctx.lineTo(canvas.width, RULER_HEIGHT + 0.5);
    ctx.stroke();
    // Handle: a small triangle pointing down from the ruler, at the playhead.
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath();
    ctx.moveTo(playheadX - 5, 2);
    ctx.lineTo(playheadX + 7, 2);
    ctx.lineTo(playheadX + 1, RULER_HEIGHT - 1);
    ctx.closePath();
    ctx.fill();

    // Chord hint: the suggested chord for the bar currently under the playhead.
    // Updates as the playhead moves — a fast way to block out the harmony by ear.
    const chords = state.song.chords;
    if (chords && chords.length) {
        let current = null;
        for (const c of chords) {
            if (c.time <= currentSecs + 1e-6) current = c; else break;
        }
        if (current) {
            ctx.save();
            ctx.font = '600 16px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillStyle = 'rgba(0,0,0,0.4)';
            ctx.fillText(current.name, canvas.width / 2, RULER_HEIGHT + 22);
            ctx.restore();
        }
    }
    
    // Draw pulsating frame for the Takt
    if (state.settings.visualPulse && beatPulse > 0) {
        ctx.strokeStyle = `rgba(0, 0, 0, ${beatPulse * 0.08})`;
        ctx.lineJoin = 'round';
        const frameThickness = 10 + (beatPulse * 15);
        ctx.lineWidth = frameThickness;
        ctx.strokeRect(frameThickness / 2, frameThickness / 2, canvas.width - frameThickness, canvas.height - frameThickness);
    }
}
