import { state, getActiveTrack } from './state.js';
import * as Tone from 'tone';
import { LOOP_LENGTH_SECONDS, masterAnalyser } from './audio.js';
import { noteToY } from './pitchMap.js';

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
    
    // Draw notes
    const laneCount = 5;
    const laneHeight = canvas.height / laneCount;
    
    state.notes.forEach(note => {
        const track = state.tracks.find(t => t.id === note.trackId);
        if (!track) return;
        
        const isActive = note.trackId === state.activeTrackId;
        ctx.fillStyle = track.color;
        ctx.globalAlpha = isActive ? 1.0 : 0.2;
        
        const noteSecs = Tone.Time(note.time).toSeconds() % loopDur;
        const noteX = (noteSecs / loopDur) * canvas.width;
        
        const durSecs = Tone.Time(note.duration).toSeconds();
        const noteWidth = (durSecs / loopDur) * canvas.width;
        
        const noteY = noteToY(note.note, canvas.height);
        const noteHeight = Math.max(4, canvas.height * 0.015);
        
        ctx.beginPath();
        // roundRect fallback just in case
        if (ctx.roundRect) {
            ctx.roundRect(noteX, noteY, Math.max(8, noteWidth), noteHeight, 8);
        } else {
            ctx.rect(noteX, noteY, Math.max(8, noteWidth), noteHeight);
        }
        ctx.fill();
    });
    ctx.globalAlpha = 1.0;
    
    // Playhead
    ctx.fillStyle = 'rgba(0,0,0,0.1)';
    ctx.fillRect(playheadX, 0, 2, canvas.height);
    
    // Active key feedback at bottom
    const activeTrack = getActiveTrack();
    if (activeTrack && state.activeKeyIndex !== null && state.activeKeyIndex !== undefined) {
        const laneWidth = canvas.width / laneCount;
        ctx.fillStyle = activeTrack.color;
        ctx.globalAlpha = 0.5;
        ctx.fillRect(state.activeKeyIndex * laneWidth, canvas.height - 20, laneWidth, 20);
        ctx.globalAlpha = 1.0;
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
