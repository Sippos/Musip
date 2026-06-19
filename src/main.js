import { state, generateId, getActiveTrack, saveUserPreset, getPreset } from './state.js';
import { initAudio, initTrackSynth, LOOP_LENGTH_SECONDS } from './audio.js';
import { initRenderer } from './renderer.js';
import { initInteraction } from './interaction.js';
import { initExport } from './export.js';
import { importMidiFile } from './midiImport.js';
import * as Tone from 'tone';

const canvas = document.getElementById('sequencer');
const startBtn = document.getElementById('start-btn');
const controls = document.getElementById('controls');
const statusText = document.getElementById('status-text');
const trackTabs = document.getElementById('track-tabs');
const addTrackBtn = document.getElementById('add-track-btn');
const undoBtn = document.getElementById('undo-btn');

const addTrackModal = document.getElementById('add-track-modal');
const closeTrackModalBtn = document.getElementById('close-track-modal-btn');
const trackOptBtns = document.querySelectorAll('.track-opt-btn');

const btnVisPulse = document.getElementById('btn-visual-pulse');
const btnAudPulse = document.getElementById('btn-audio-pulse');

const tweakBtn = document.getElementById('tweak-btn');
const tweakPanel = document.getElementById('tweak-panel');
const closeTweakBtn = document.getElementById('close-tweak-btn');
const magicPad = document.getElementById('magic-pad');
const magicDot = document.getElementById('magic-dot');
const tweakWaveCanvas = document.getElementById('tweak-wave-canvas');
const savePresetBtn = document.getElementById('save-preset-btn');

const brightnessSlider = document.getElementById('brightness-slider');
const spaceSlider = document.getElementById('space-slider');
const dirtSlider = document.getElementById('dirt-slider');



startBtn.addEventListener('click', async () => {
    await initAudio();
    state.isPlaying = true;
    startBtn.style.display = 'none';
    statusText.textContent = 'Session Active. Press A, S, D, F, G to play.';
    controls.classList.remove('hidden');
    
    const onboarding = document.getElementById('onboarding');
    if (onboarding) onboarding.classList.add('hidden');
    
    renderTrackTabs();
    Tone.Transport.start();
});

function renderTrackTabs() {
    trackTabs.innerHTML = '';
    state.tracks.forEach(track => {
        const btn = document.createElement('button');
        btn.className = `inst-btn ${track.id === state.activeTrackId ? 'active' : ''}`;
        btn.innerHTML = `
            <span class="track-name">${track.name}</span>
            <span class="shift-left" style="margin-left: 8px; opacity: 0.7; vertical-align: middle; cursor: pointer;" title="Shift Left 1 Beat">
                <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><polyline points="15 18 9 12 15 6"></polyline></svg>
            </span>
            <span class="shift-right" style="margin-left: 2px; opacity: 0.7; vertical-align: middle; cursor: pointer;" title="Shift Right 1 Beat">
                <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><polyline points="9 18 15 12 9 6"></polyline></svg>
            </span>
            <span class="expand-toggle" style="margin-left: 8px; opacity: 0.7; vertical-align: middle; cursor: pointer;" title="Expand/Collapse Piano Roll">
                ${track.expanded ? 
                    '<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><polyline points="4 14 12 6 20 14"></polyline></svg>' : 
                    '<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><polyline points="6 9 12 15 18 9"></polyline></svg>'
                }
            </span>
            <span class="mute-toggle" style="margin-left: 8px; opacity: 0.7; vertical-align: middle;" title="Mute/Unmute">
                ${track.muted ? 
                    '<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><line x1="1" y1="1" x2="23" y2="23"></line><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M23 9l-6 6"></path><path d="M17 9l6 6"></path></svg>' : 
                    '<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>'
                }
            </span>
            <span class="delete-track" style="margin-left: 8px; opacity: 0.5; vertical-align: middle;" title="Delete Track">
                <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </span>
        `;
        
        // Apply color hint to button border
        btn.style.borderBottom = `3px solid ${track.color}`;
        if (track.muted) {
            btn.style.opacity = '0.5';
        }
        
        const expandToggle = btn.querySelector('.expand-toggle');
        expandToggle.addEventListener('click', (e) => {
            e.stopPropagation(); // prevent track selection
            track.expanded = !track.expanded;
            renderTrackTabs();
        });
        
        const shiftLeft = btn.querySelector('.shift-left');
        shiftLeft.addEventListener('click', (e) => {
            e.stopPropagation();
            const shiftSecs = Tone.Time("4n").toSeconds();
            const loopDur = LOOP_LENGTH_SECONDS();
            state.notes.forEach(n => {
                if (n.trackId === track.id) {
                    let secs = Tone.Time(n.time).toSeconds() - shiftSecs;
                    if (secs < 0) secs += loopDur;
                    n.time = Tone.Time(secs).quantize("32n");
                }
            });
            import('./audio.js').then(module => module.syncAudioPart(state.notes));
        });
        
        const shiftRight = btn.querySelector('.shift-right');
        shiftRight.addEventListener('click', (e) => {
            e.stopPropagation();
            const shiftSecs = Tone.Time("4n").toSeconds();
            const loopDur = LOOP_LENGTH_SECONDS();
            state.notes.forEach(n => {
                if (n.trackId === track.id) {
                    let secs = Tone.Time(n.time).toSeconds() + shiftSecs;
                    if (secs >= loopDur) secs -= loopDur;
                    n.time = Tone.Time(secs).quantize("32n");
                }
            });
            import('./audio.js').then(module => module.syncAudioPart(state.notes));
        });
        
        const muteToggle = btn.querySelector('.mute-toggle');
        muteToggle.addEventListener('click', (e) => {
            e.stopPropagation(); // prevent track selection
            track.muted = !track.muted;
            renderTrackTabs();
        });
        
        const deleteToggle = btn.querySelector('.delete-track');
        deleteToggle.addEventListener('click', (e) => {
            e.stopPropagation(); // prevent track selection
            if (confirm(`Delete track "${track.name}" and all its notes?`)) {
                state.tracks = state.tracks.filter(t => t.id !== track.id);
                state.notes = state.notes.filter(n => n.trackId !== track.id);
                
                if (state.activeTrackId === track.id) {
                    state.activeTrackId = state.tracks.length > 0 ? state.tracks[0].id : null;
                }
                
                import('./audio.js').then(module => {
                    module.syncAudioPart(state.notes);
                });
                
                renderTrackTabs();
                const activeTrack = getActiveTrack();
                if (!activeTrack || activeTrack.type === 'drums') {
                    tweakBtn.style.display = 'none';
                    tweakPanel.classList.add('hidden');
                } else {
                    tweakBtn.style.display = 'inline-block';
                    updateTweakUI();
                }
            }
        });
        
        btn.addEventListener('click', () => {
            state.activeTrackId = track.id;
            renderTrackTabs();
            
            const activeTrack = getActiveTrack();
            if (activeTrack && activeTrack.type === 'drums') {
                tweakBtn.style.display = 'none';
                tweakPanel.classList.add('hidden');
            } else {
                tweakBtn.style.display = 'inline-block';
                updateTweakUI();
            }
        });
        
        if (track.id === state.activeTrackId) {
            btn.style.backgroundColor = track.color;
            btn.style.borderBottom = 'none';
        } else {
            btn.style.backgroundColor = 'transparent';
            btn.style.borderBottom = `3px solid ${track.color}`;
        }
        
        trackTabs.appendChild(btn);
    });
}

window.addEventListener('activeTrackChanged', () => {
    renderTrackTabs();
    const activeTrack = getActiveTrack();
    if (activeTrack && activeTrack.type === 'drums') {
        tweakBtn.style.display = 'none';
        tweakPanel.classList.add('hidden');
    } else {
        tweakBtn.style.display = 'inline-block';
        updateTweakUI();
    }
});

const instrumentSelector = document.querySelector('.instrument-selector');
if (instrumentSelector) {
    instrumentSelector.addEventListener('wheel', (e) => {
        // Only convert vertical scrolling (deltaY) to horizontal scrolling if there is no horizontal delta (deltaX)
        if (e.deltaY !== 0 && e.deltaX === 0) {
            e.preventDefault();
            instrumentSelector.scrollLeft += e.deltaY;
        }
    });
}

addTrackBtn.addEventListener('click', () => {
    addTrackModal.classList.remove('hidden');
});

closeTrackModalBtn.addEventListener('click', () => {
    addTrackModal.classList.add('hidden');
});

trackOptBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        addTrackModal.classList.add('hidden');
        
        const type = btn.dataset.type;
        const newTrackId = 'track-' + generateId();
        
        let presetId;
        if (type === 'drums') {
            presetId = 'drums-kit';
        } else {
            // Randomly choose bass or keys for synth track
            presetId = Math.random() > 0.5 ? 'bass-square' : 'keys-sine';
        }
        
        // Generate a pleasant random pastel color
        const hue = Math.floor(Math.random() * 360);
        const color = `hsl(${hue}, 60%, 75%)`;
        
        const newTrack = {
            id: newTrackId,
            name: `Track ${state.tracks.length + 1}`,
            presetId: presetId,
            color: color,
            type: type,
            muted: false,
            expanded: false
        };
        
        state.tracks.push(newTrack);
        initTrackSynth(newTrackId, getPreset(presetId));
        state.activeTrackId = newTrackId;
        renderTrackTabs();
        
        const activeTrack = getActiveTrack();
        if (activeTrack && activeTrack.type === 'drums') {
            tweakBtn.style.display = 'none';
            tweakPanel.classList.add('hidden');
        } else {
            tweakBtn.style.display = 'inline-block';
            updateTweakUI();
        }
    });
});

// Undo UI Button
undoBtn.addEventListener('click', () => {
    state.notes.pop();
    import('./audio.js').then(module => {
        module.syncAudioPart(state.notes);
    });
});

// Navbar Toggles
btnVisPulse.addEventListener('click', () => {
    state.settings.visualPulse = !state.settings.visualPulse;
    btnVisPulse.classList.toggle('active', state.settings.visualPulse);
});
btnAudPulse.addEventListener('click', () => {
    state.settings.audioPulse = !state.settings.audioPulse;
    btnAudPulse.classList.toggle('active', state.settings.audioPulse);
});

// Tweak Panel UI
tweakBtn.addEventListener('click', () => {
    tweakPanel.classList.toggle('hidden');
    updateTweakUI();
});

closeTweakBtn.addEventListener('click', () => {
    tweakPanel.classList.add('hidden');
});

function updateTweakUI() {
    import('./audio.js').then(module => {
        const params = module.getInstrumentParams(state.activeTrackId);
        if (!params) return;
        
        // Reverse mapping from params to dot position
        // X = oscillator
        const oscMap = { 'sine': 0.125, 'triangle': 0.375, 'square': 0.625, 'sawtooth': 0.875 };
        const px = oscMap[params.oscillator] || 0.5;
        
        // Y = envelope length
        // Y=0 -> attack 0.001, release 0.1
        // Y=1 -> attack 1.0, release 3.0
        const py = Math.min(1, Math.max(0, (params.release - 0.1) / 2.9));
        
        magicDot.style.left = `${px * 100}%`;
        magicDot.style.top = `${py * 100}%`;
        
        brightnessSlider.value = params.brightness !== undefined ? params.brightness : 1.0;
        spaceSlider.value = params.space || 0;
        dirtSlider.value = params.dirt || 0;
        
        drawTweakWave(params.oscillator, params.attack, params.release);
    });
}

function drawTweakWave(oscillator, attack, release) {
    if (!tweakWaveCanvas) return;
    const ctx = tweakWaveCanvas.getContext('2d');
    const width = tweakWaveCanvas.width;
    const height = tweakWaveCanvas.height;
    
    ctx.clearRect(0, 0, width, height);
    ctx.beginPath();
    
    // Track color if active, otherwise black
    const activeTrack = getActiveTrack();
    ctx.strokeStyle = activeTrack ? activeTrack.color : '#2D3436';
    ctx.lineWidth = 4;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    
    const centerY = height / 2;
    const amp = height * 0.3;
    
    const attackX = (attack / 1.0) * (width * 0.3);
    const releaseX = width - ((release / 3.0) * (width * 0.3));
    
    for(let x = 0; x <= width; x += 2) {
        let y = centerY;
        const phase = (x / width) * Math.PI * 4; 
        
        let env = 1.0;
        if (x < attackX) env = x / Math.max(1, attackX);
        if (x > releaseX) env = 1.0 - ((x - releaseX) / (width - releaseX));
        env = Math.max(0, env);
        
        if (oscillator === 'sine') {
            y -= Math.sin(phase) * amp * env;
        } else if (oscillator === 'triangle') {
            y -= (Math.asin(Math.sin(phase)) / (Math.PI / 2)) * amp * env;
        } else if (oscillator === 'square') {
            y -= (Math.sin(phase) > 0 ? 1 : -1) * amp * env;
        } else if (oscillator === 'sawtooth') {
            y -= (2 * (phase / (2 * Math.PI) - Math.floor(0.5 + phase / (2 * Math.PI)))) * amp * env;
        }
        
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.stroke();
}

// Magic Pad & Sliders Interaction
let isDraggingPad = false;
let padPreviewTimeout = null;

tweakWaveCanvas.addEventListener('click', () => {
    import('./audio.js').then(module => {
        const params = module.getInstrumentParams(state.activeTrackId);
        if (!params) return;
        
        const oscs = ['sine', 'triangle', 'square', 'sawtooth'];
        let idx = oscs.indexOf(params.oscillator);
        idx = (idx + 1) % oscs.length;
        const newOsc = oscs[idx];
        
        module.updateInstrumentParams(state.activeTrackId, { oscillator: newOsc });
        module.playSound(state.activeTrackId, "C3", undefined, "16n");
        updateTweakUI();
    });
});

[
    { el: brightnessSlider, param: 'brightness' },
    { el: spaceSlider, param: 'space' },
    { el: dirtSlider, param: 'dirt' }
].forEach(({el, param}) => {
    if (!el) return;
    el.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        import('./audio.js').then(module => {
            module.updateInstrumentParams(state.activeTrackId, { [param]: val });
            
            if (!padPreviewTimeout) {
                module.playSound(state.activeTrackId, "C3", undefined, "16n");
                padPreviewTimeout = setTimeout(() => padPreviewTimeout = null, 150);
            }
        });
    });
});

function handlePadMove(e) {
    if (!isDraggingPad) return;
    
    const rect = magicPad.getBoundingClientRect();
    let x = (e.clientX - rect.left) / rect.width;
    let y = (e.clientY - rect.top) / rect.height;
    
    x = Math.max(0, Math.min(1, x));
    y = Math.max(0, Math.min(1, y));
    
    let osc = 'sine';
    if (x > 0.25) osc = 'triangle';
    if (x > 0.5) osc = 'square';
    if (x > 0.75) osc = 'sawtooth';
    
    const attack = 0.001 + (y * 0.999); 
    const release = 0.1 + (y * 2.9);
    
    magicDot.style.left = `${x * 100}%`;
    magicDot.style.top = `${y * 100}%`;
    
    drawTweakWave(osc, attack, release);
    
    import('./audio.js').then(module => {
        module.updateInstrumentParams(state.activeTrackId, {
            oscillator: osc,
            attack: attack,
            release: release
        });
        
        // Debounced preview sound
        if (!padPreviewTimeout) {
            module.playSound(state.activeTrackId, "C3", undefined, "16n");
            padPreviewTimeout = setTimeout(() => {
                padPreviewTimeout = null;
            }, 150); // limit to roughly every 150ms while dragging
        }
    });
}

magicPad.addEventListener('pointerdown', (e) => {
    isDraggingPad = true;
    magicPad.setPointerCapture(e.pointerId);
    handlePadMove(e);
});

magicPad.addEventListener('pointermove', handlePadMove);

magicPad.addEventListener('pointerup', (e) => {
    isDraggingPad = false;
    magicPad.releasePointerCapture(e.pointerId);
});

savePresetBtn.addEventListener('click', () => {
    const name = prompt("Name your preset (e.g. 'Sub Bass'):");
    if (!name) return;
    
    import('./audio.js').then(module => {
        const params = module.getInstrumentParams(state.activeTrackId);
        const presetId = name.toLowerCase().replace(/\s+/g, '-');
        const presetData = {
            name: name,
            type: 'synth',
            oscillator: params.oscillator,
            attack: params.attack,
            release: params.release
        };
        saveUserPreset(presetId, presetData);
        
        const activeTrack = getActiveTrack();
        if(activeTrack) {
            activeTrack.presetId = presetId;
            activeTrack.name = name;
            renderTrackTabs();
        }
        
        alert("Preset saved to your browser!");
    });
});

// Initialize subsystems
initRenderer(canvas);
initInteraction(canvas);
initExport(canvas);

// Setup MIDI Import
const importMidiBtn = document.getElementById('import-midi-btn');
const midiUploadInput = document.getElementById('midi-upload');

if (importMidiBtn && midiUploadInput) {
    importMidiBtn.addEventListener('click', () => {
        midiUploadInput.click();
    });

    midiUploadInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        try {
            await Tone.start();
            await importMidiFile(file, renderTrackTabs);
            midiUploadInput.value = ''; // reset
        } catch (err) {
            console.error("Failed to parse MIDI:", err);
            alert("Fehler beim Laden der MIDI-Datei.");
        }
    });
}
