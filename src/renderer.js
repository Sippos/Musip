import { state, getActiveTrack } from './state.js';
import * as Tone from 'tone';
import { LOOP_LENGTH_SECONDS, masterAnalyser } from './audio.js';
import { noteToY, getTrackLayout } from './pitchMap.js';

let canvas, ctx;
let bgLightness = 96;
let lastBeat = -1;
let beatPulse = 0;

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
    const currentSecs = (Tone.Transport.seconds % loopDur);
    const playheadX = (currentSecs / loopDur) * canvas.width;
    
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
            // Draw 24-note piano roll grid
            const baseMidi = track.baseMidi || 48;
            for (let i = 0; i < 24; i++) {
                const midi = baseMidi + i;
                const noteInOctave = midi % 12;
                const isBlackKey = [1, 3, 6, 8, 10].includes(noteInOctave);
                
                const yBottom = trackTop + ((1.0 - (i / 24)) * trackHeight);
                const yTop = trackTop + ((1.0 - ((i + 1) / 24)) * trackHeight);
                
                if (isBlackKey) {
                    ctx.fillStyle = 'rgba(0,0,0,0.03)';
                    ctx.fillRect(0, yTop, canvas.width, yBottom - yTop);
                }
                
                ctx.strokeStyle = 'rgba(0,0,0,0.02)';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(0, yTop);
                ctx.lineTo(canvas.width, yTop);
                ctx.stroke();
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
    
    // Draw notes
    state.notes.forEach(note => {
        const trackLayout = layout.find(l => l.track.id === note.trackId);
        if (!trackLayout) return;
        
        const { track, top: trackTop, height: trackHeight } = trackLayout;
        
        // Don't draw notes if they are scrolled off screen
        if (trackTop > canvas.height || trackTop + trackHeight < 0) return;
        
        const isActive = note.trackId === state.activeTrackId;
        ctx.fillStyle = track.color;
        if (track.muted) {
            ctx.fillStyle = '#999999';
            ctx.globalAlpha = isActive ? 0.3 : 0.05;
        } else {
            ctx.globalAlpha = isActive ? 1.0 : 0.5; // Inactive tracks are more visible now since they don't overlap
        }
        
        const noteSecs = Tone.Time(note.time).toSeconds() % loopDur;
        const noteX = (noteSecs / loopDur) * canvas.width;
        
        const noteY = noteToY(note, trackTop, trackHeight, track);
        const noteDur = Tone.Time(note.duration).toSeconds();
        const noteWidth = (noteDur / loopDur) * canvas.width;
        
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
    
    // Draw pulsating frame for the Takt
    if (state.settings.visualPulse && beatPulse > 0) {
        ctx.strokeStyle = `rgba(0, 0, 0, ${beatPulse * 0.08})`;
        ctx.lineJoin = 'round';
        const frameThickness = 10 + (beatPulse * 15);
        ctx.lineWidth = frameThickness;
        ctx.strokeRect(frameThickness / 2, frameThickness / 2, canvas.width - frameThickness, canvas.height - frameThickness);
    }
}
