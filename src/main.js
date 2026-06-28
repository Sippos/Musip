import { state, generateId, getActiveTrack, saveUserPreset, getPreset, undoNote, redoNote, clearRedo, defaultPresets, loadUserPresets } from './state.js';
import { initAudio, initTrackSynth, LOOP_LENGTH_SECONDS, LOOP_LENGTH_MEASURES, setLoopLengthMeasures, setTempo, getReferencePeaks, getReferenceDuration, hasTrackStem, updateStemAudibility, disposeTrackStem, updateSoundFontAudibility, setTrackStem, getChopBuffer } from './audio.js';
import { NOTE_NAMES, makeKey } from './pitchMap.js';
import { DRUM_PATTERNS, CHORD_PROGRESSIONS, buildDrumNotes, buildChordNotes } from './presets.js';
import { loadSoundFont, listSoundFonts, getPresets, releaseChannel as releaseSoundFontChannel } from './soundfont.js';
import { initRenderer } from './renderer.js';
import { initInteraction } from './interaction.js';
import { startTour } from './tour.js';
import { initExport } from './export.js';
import { importMidiFile, transcribeAndImport, separateTranscribeAndImport } from './midiImport.js';
import { StemServerUnavailableError, separateStems } from './stemSeparation.js';
import { drawReferenceWave, pxToOffset, hitTestWindow, pxToSeconds } from './referenceWave.js';
import { decodeAudioFile, computePeaks, wavFileFromSlice } from './cropClip.js';
import { SAMPLE_INSTRUMENT_LABELS, SAMPLE_INSTRUMENT_IDS } from './sampleLibrary.js';
import * as Tone from 'tone';

const SYNTH_ENGINE_VALUE = '__synth__';

const canvas = document.getElementById('sequencer');
const startBtn = document.getElementById('start-btn');
const controls = document.getElementById('controls');
const statusText = document.getElementById('status-text');
const trackTabs = document.getElementById('track-tabs');
const undoBtn = document.getElementById('undo-btn');

const addTrackModal = document.getElementById('add-track-modal');
const closeTrackModalBtn = document.getElementById('close-track-modal-btn');
const trackOptBtns = document.querySelectorAll('.track-opt-btn');

const btnVisPulse = document.getElementById('btn-visual-pulse');
const btnAudPulse = document.getElementById('btn-audio-pulse');

const tweakPanel = document.getElementById('tweak-panel');
const closeTweakBtn = document.getElementById('close-tweak-btn');
const tweakWaveCanvas = document.getElementById('tweak-wave-canvas');
const savePresetBtn = document.getElementById('save-preset-btn');

const synthControls = document.getElementById('synth-controls');
const drumControls = document.getElementById('drum-controls');
const macroSliders = document.querySelectorAll('.macro-slider');
const drumSliders = document.querySelectorAll('.drum-slider');
const instrumentSelect = document.getElementById('instrument-select');
const oscWaveSection = document.getElementById('osc-wave-section');
const designedControls = document.getElementById('designed-controls');

// Ordered list the track-tab arrows cycle through: every sampled instrument,
// then the oscillator synth. (Drum tracks don't participate — they have no
// instrument list.)
const INSTRUMENT_CYCLE = [...SAMPLE_INSTRUMENT_IDS, SYNTH_ENGINE_VALUE];

// A SoundFont preset is encoded in the instrument picker as
// `sf:<soundfontId>:<bankMSB>:<bankLSB>:<program>`.
function soundFontValue(soundfontId, patch) {
    return `sf:${soundfontId}:${patch.bankMSB}:${patch.bankLSB}:${patch.program}`;
}
function parseSoundFontValue(value) {
    if (typeof value !== 'string' || !value.startsWith('sf:')) return null;
    const [, soundfontId, bankMSB, bankLSB, program] = value.split(':');
    return { soundfontId, bankMSB: +bankMSB, bankLSB: +bankLSB, program: +program };
}

// The instrument "value" of a track: a SoundFont preset, a sampled-instrument id,
// or the synth sentinel. Drum tracks have no melodic instrument.
function trackInstrumentValue(track) {
    if (track.engine === 'soundfont' && track.soundfontId && track.sfProgram) {
        return soundFontValue(track.soundfontId, track.sfProgram);
    }
    if (track.engine === 'chop') return 'chop';
    if (track.engine === 'sampler' && track.sampleInstrument) return track.sampleInstrument;
    if (track.engine === 'synth' && track.presetId) return `preset:${track.presetId}`;
    return SYNTH_ENGINE_VALUE;
}

function instrumentLabel(track) {
    if (track.type === 'drums') return 'Drum Kit';
    if (track.engine === 'soundfont' && track.sfProgram) return track.sfProgram.name || 'SoundFont';
    const value = trackInstrumentValue(track);
    if (value.startsWith('preset:')) {
        const p = getPreset(track.presetId);
        return p ? p.name : 'Custom Synth';
    }
    if (value === 'chop') return 'Sampler (Chop)';
    return value === SYNTH_ENGINE_VALUE ? 'Custom Synth' : (SAMPLE_INSTRUMENT_LABELS[value] || value);
}

// Switch a track to a new instrument (sampled id or the synth sentinel),
// rebuild its audio node, refresh the tabs + panel, and audition it.
function setTrackInstrument(track, value, { preview = true } = {}) {
    const sf = parseSoundFontValue(value);
    if (sf) {
        const preset = getPresets(sf.soundfontId).find(p =>
            p.bankMSB === sf.bankMSB && p.bankLSB === sf.bankLSB && p.program === sf.program);
        track.engine = 'soundfont';
        track.soundfontId = sf.soundfontId;
        track.sfProgram = { bankMSB: sf.bankMSB, bankLSB: sf.bankLSB, program: sf.program, name: preset ? preset.name : 'SoundFont' };
    } else if (value.startsWith('preset:')) {
        track.engine = 'synth';
        track.presetId = value.split(':')[1];
        track.source = 'synth';
    } else if (value === 'chop') {
        track.engine = 'chop';
        track.source = 'synth';
    } else if (value === SYNTH_ENGINE_VALUE) {
        track.engine = 'synth';
        track.presetId = 'keys-sine'; // fallback default
        track.source = 'synth';
    } else {
        track.engine = 'sampler';
        track.sampleInstrument = value;
        track.source = 'synth';
    }
    initTrackSynth(track.id, getPreset(track.presetId));
    renderTrackTabs();
    if (track.id === state.activeTrackId) updateTweakUI();
    if (preview) import('./audio.js').then(module => module.playSound(track.id, 'C3', undefined, '8n'));
}

// Step the track's instrument forward/back through INSTRUMENT_CYCLE.
function cycleTrackInstrument(track, dir) {
    if (track.type === 'drums') return;
    const cur = trackInstrumentValue(track);
    const i = INSTRUMENT_CYCLE.indexOf(cur);
    const next = INSTRUMENT_CYCLE[(i + dir + INSTRUMENT_CYCLE.length) % INSTRUMENT_CYCLE.length];
    setTrackInstrument(track, next);
}

// Select a track and open its Sound Settings panel (replaces the old Tweak
// button — the instrument label on the track tab is now the way in).
function openInstrumentSettings(track) {
    state.activeTrackId = track.id;
    renderTrackTabs();
    tweakPanel.classList.remove('hidden');
    updateTweakUI();
}

// (Re)populate the instrument picker: every imported SoundFont's presets, then
// the sampled (recorded) instruments, then the oscillator-synth fallback. Called
// once at startup and again whenever a SoundFont is loaded.
function populateInstrumentSelect() {
    if (!instrumentSelect) return;
    instrumentSelect.innerHTML = '';

    listSoundFonts().forEach(sf => {
        const group = document.createElement('optgroup');
        group.label = `SoundFont · ${sf.name}`;
        getPresets(sf.id).forEach(preset => {
            const opt = document.createElement('option');
            opt.value = soundFontValue(sf.id, preset);
            opt.textContent = preset.name + (preset.isDrum ? ' (drums)' : '');
            group.appendChild(opt);
        });
        instrumentSelect.appendChild(group);
    });

    const sampledGroup = document.createElement('optgroup');
    sampledGroup.label = 'Sampled (realistic)';
    SAMPLE_INSTRUMENT_IDS.forEach(id => {
        const opt = document.createElement('option');
        opt.value = id;
        opt.textContent = SAMPLE_INSTRUMENT_LABELS[id];
        sampledGroup.appendChild(opt);
    });
    instrumentSelect.appendChild(sampledGroup);

    const synthGroup = document.createElement('optgroup');
    synthGroup.label = 'Designed';
    
    const allPresets = { ...defaultPresets, ...loadUserPresets() };
    Object.keys(allPresets).forEach(id => {
        const p = allPresets[id];
        if (p.type === 'synth') {
            const opt = document.createElement('option');
            opt.value = `preset:${id}`;
            opt.textContent = p.name;
            synthGroup.appendChild(opt);
        }
    });

    const synthOpt = document.createElement('option');
    synthOpt.value = SYNTH_ENGINE_VALUE;
    synthOpt.textContent = 'Custom Synth (oscillator)';
    synthGroup.appendChild(synthOpt);
    instrumentSelect.appendChild(synthGroup);
    
    const stemGroup = document.createElement('optgroup');
    stemGroup.id = 'stem-optgroup';
    stemGroup.label = 'Stem Slicing';
    const chopOpt = document.createElement('option');
    chopOpt.value = 'chop';
    chopOpt.textContent = 'Sampler (Chop Engine)';
    stemGroup.appendChild(chopOpt);
    instrumentSelect.appendChild(stemGroup);
}

if (instrumentSelect) {
    populateInstrumentSelect();
    instrumentSelect.addEventListener('change', (e) => {
        const track = getActiveTrack();
        if (!track) return;
        setTrackInstrument(track, e.target.value);
    });
}

// "Load SoundFont": read the dropped .sf2/.sf3/.dls, register its presets, refresh
// the picker, and assign the bank's first preset to the active track so it's
// audible immediately.
const loadSoundFontBtn = document.getElementById('load-soundfont-btn');
const soundFontUpload = document.getElementById('soundfont-upload');
if (loadSoundFontBtn && soundFontUpload) {
    loadSoundFontBtn.addEventListener('click', () => soundFontUpload.click());
    soundFontUpload.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        soundFontUpload.value = '';
        if (!file) return;
        const prevLabel = loadSoundFontBtn.textContent;
        loadSoundFontBtn.textContent = 'Loading SoundFont…';
        loadSoundFontBtn.disabled = true;
        try {
            await Tone.start(); // ensure the audio context (and worklet) can start
            const buffer = await file.arrayBuffer();
            const bank = await loadSoundFont(buffer, file.name.replace(/\.[^.]+$/, ''));
            populateInstrumentSelect();
            const track = getActiveTrack();
            const firstMelodic = bank.presets.find(p => !p.isDrum) || bank.presets[0];
            if (track && track.type !== 'drums' && firstMelodic) {
                setTrackInstrument(track, soundFontValue(bank.id, firstMelodic));
            }
            if (!bank.presets.length) alert('That SoundFont loaded but contained no presets.');
        } catch (err) {
            console.error('Failed to load SoundFont:', err);
            alert('Could not load that SoundFont: ' + (err && err.message ? err.message : err));
        } finally {
            loadSoundFontBtn.textContent = prevLabel;
            loadSoundFontBtn.disabled = false;
        }
    });
}

// When a sampler finishes streaming its buffers, refresh the panel if it's the
// active track so any "loading…" hint clears.
window.onSamplerLoaded = (trackId) => {
    if (trackId === state.activeTrackId) updateTweakUI();
};



const ONBOARDED_KEY = 'musip_onboarded';
let sessionStarted = false;

// Unlock audio (must run from a user gesture) and reveal the editor. Shared by
// the legacy Start button and the welcome-choice buttons. `blank: true` clears
// the starter tracks so the guided tour begins on an empty canvas.
async function beginSession({ blank = false } = {}) {
    if (blank) {
        state.tracks = [];
        state.notes = [];
        state.activeTrackId = null;
    }

    if (!sessionStarted) {
        sessionStarted = true;
        await initAudio();
        state.isPlaying = true;
        startBtn.style.display = 'none';
        statusText.textContent = 'Session Active. Press A, S, D, F, G to play.';
        controls.classList.remove('hidden');
        Tone.Transport.start();
        import('./audio.js').then(module => {
            module.startReferenceIfLoaded();
            module.startStemsIfLoaded();
        });
    }

    const onboarding = document.getElementById('onboarding');
    if (onboarding) onboarding.classList.add('hidden');

    renderTrackTabs();
}

startBtn.addEventListener('click', () => beginSession());

const welcomeTourBtn = document.getElementById('welcome-tour-btn');
const welcomeFreshBtn = document.getElementById('welcome-fresh-btn');
const tourReplayBtn = document.getElementById('tour-replay-btn');

if (welcomeFreshBtn) {
    welcomeFreshBtn.addEventListener('click', async () => {
        await beginSession();
        try { localStorage.setItem(ONBOARDED_KEY, 'true'); } catch (e) { /* private mode */ }
    });
}
if (welcomeTourBtn) {
    welcomeTourBtn.addEventListener('click', async () => {
        await beginSession({ blank: true });
        startTour();
    });
}
if (tourReplayBtn) {
    // Replay works mid-session: it highlights whatever's live now (it won't wipe
    // existing tracks). Make sure audio is unlocked first if they never started.
    tourReplayBtn.addEventListener('click', async () => {
        if (!sessionStarted) await beginSession();
        startTour();
    });
}

// Returning visitors skip the welcome card and land on the normal Start flow.
if (localStorage.getItem(ONBOARDED_KEY)) {
    const onboarding = document.getElementById('onboarding');
    if (onboarding) onboarding.classList.add('hidden');
}

function renderTrackTabs() {
    trackTabs.innerHTML = '';
    state.tracks.forEach(track => {
        const isDrums = track.type === 'drums';
        const btn = document.createElement('button');
        btn.className = `inst-btn ${track.id === state.activeTrackId ? 'active' : ''}`;
        btn.style.display = 'flex';
        btn.style.flexDirection = 'column';
        btn.style.alignItems = 'center';
        btn.style.gap = '3px';
        btn.innerHTML = `
            <div class="track-top" style="display:flex; align-items:center;">
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
                <span class="solo-toggle" style="margin-left: 8px; opacity: ${track.solo ? '1' : '0.5'}; color: ${track.solo ? '#1b9e6e' : 'currentColor'}; vertical-align: middle; cursor: pointer;" title="Solo (focus this instrument)">
                    <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><path d="M3 18v-6a9 9 0 0 1 18 0v6"></path><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"></path></svg>
                </span>
                ${hasTrackStem(track.id) ? `<span class="stem-toggle" style="margin-left: 8px; opacity: ${track.source === 'stem' ? '1' : '0.5'}; color: ${track.source === 'stem' ? '#1b9e6e' : 'currentColor'}; vertical-align: middle; cursor: pointer;" title="Hear the original isolated instrument (toggle synth vs. real recording)">
                    <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><path d="M3 18v-6a9 9 0 0 1 18 0v6"></path><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"></path><circle cx="12" cy="13" r="3" fill="currentColor" stroke="none"></circle></svg>
                </span>` : ''}
                <span class="mute-toggle" style="margin-left: 8px; opacity: 0.7; vertical-align: middle;" title="Mute/Unmute">
                    ${track.muted ?
                        '<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><line x1="1" y1="1" x2="23" y2="23"></line><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M23 9l-6 6"></path><path d="M17 9l6 6"></path></svg>' :
                        '<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>'
                    }
                </span>
                <span class="delete-track" style="margin-left: 8px; opacity: 0.5; vertical-align: middle;" title="Delete Track">
                    <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </span>
            </div>
            <div class="track-instrument" style="display:flex; align-items:center; justify-content:center; gap:4px;">
                ${isDrums ? '' : `<span class="inst-prev" title="Previous Instrument" style="cursor:pointer; opacity:0.7; display:flex;">
                    <svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2.5" fill="none"><polyline points="15 18 9 12 15 6"></polyline></svg>
                </span>`}
                <span class="inst-label" title="Open Sound Settings" style="cursor:pointer; font-size:0.72rem; font-weight:600; padding:1px 7px; border-radius:5px; background:rgba(0,0,0,0.07); white-space:nowrap;">${instrumentLabel(track)}</span>
                ${isDrums ? '' : `<span class="inst-next" title="Next Instrument" style="cursor:pointer; opacity:0.7; display:flex;">
                    <svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2.5" fill="none"><polyline points="9 18 15 12 9 6"></polyline></svg>
                </span>`}
            </div>
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
        
        const soloToggle = btn.querySelector('.solo-toggle');
        soloToggle.addEventListener('click', (e) => {
            e.stopPropagation(); // prevent track selection
            track.solo = !track.solo;
            updateStemAudibility(); // solo gates the stem players too
            updateSoundFontAudibility();
            renderTrackTabs();
        });

        const stemToggle = btn.querySelector('.stem-toggle');
        if (stemToggle) stemToggle.addEventListener('click', (e) => {
            e.stopPropagation(); // prevent track selection
            track.source = track.source === 'stem' ? 'synth' : 'stem';
            updateStemAudibility();
            renderTrackTabs();
        });

        const muteToggle = btn.querySelector('.mute-toggle');
        muteToggle.addEventListener('click', (e) => {
            e.stopPropagation(); // prevent track selection
            track.muted = !track.muted;
            updateStemAudibility(); // a muted stem-source track must fall silent too
            updateSoundFontAudibility();
            renderTrackTabs();
        });
        
        const deleteToggle = btn.querySelector('.delete-track');
        deleteToggle.addEventListener('click', (e) => {
            e.stopPropagation(); // prevent track selection
            if (confirm(`Delete track "${track.name}" and all its notes?`)) {
                disposeTrackStem(track.id); // free its isolated-stem player, if any
                releaseSoundFontChannel(track.id); // free its SoundFont MIDI channel, if any
                state.tracks = state.tracks.filter(t => t.id !== track.id);
                state.notes = state.notes.filter(n => n.trackId !== track.id);
                
                if (state.activeTrackId === track.id) {
                    state.activeTrackId = state.tracks.length > 0 ? state.tracks[0].id : null;
                }
                
                import('./audio.js').then(module => {
                    module.syncAudioPart(state.notes);
                });
                
                renderTrackTabs();
                refreshTweakForActiveTrack();
            }
        });

        // Instrument selector row: arrows cycle the preset, the label opens
        // Sound Settings. (Absent on drum tracks.)
        const instPrev = btn.querySelector('.inst-prev');
        if (instPrev) instPrev.addEventListener('click', (e) => {
            e.stopPropagation();
            cycleTrackInstrument(track, -1);
        });
        const instNext = btn.querySelector('.inst-next');
        if (instNext) instNext.addEventListener('click', (e) => {
            e.stopPropagation();
            cycleTrackInstrument(track, 1);
        });
        const instLabel = btn.querySelector('.inst-label');
        if (instLabel) instLabel.addEventListener('click', (e) => {
            e.stopPropagation();
            openInstrumentSettings(track);
        });

        btn.addEventListener('click', () => {
            state.activeTrackId = track.id;
            renderTrackTabs();
            refreshTweakForActiveTrack();
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

    // Trailing "+" tile: add a new instrument track. Lives at the end of the
    // track row so adding a track happens where the tracks already are.
    const addBtn = document.createElement('button');
    addBtn.className = 'inst-btn add-track-tile';
    addBtn.title = 'Add a new instrument track';
    addBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
        <span class="add-track-label">Track</span>
    `;
    addBtn.addEventListener('click', openAddTrackModal);
    trackTabs.appendChild(addBtn);
}

window.addEventListener('activeTrackChanged', () => {
    renderTrackTabs();
    refreshTweakForActiveTrack();
});

// Sound Settings is opened from a track tab's instrument label, not a toolbar
// button. This just keeps an already-open panel in sync with the active track
// (and closes it if no track is selected); it never force-opens the panel.
function refreshTweakForActiveTrack() {
    const activeTrack = getActiveTrack();
    if (!activeTrack) {
        tweakPanel.classList.add('hidden');
        return;
    }
    if (!tweakPanel.classList.contains('hidden')) updateTweakUI();
}

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

function openAddTrackModal() {
    addTrackModal.classList.remove('hidden');
}

closeTrackModalBtn.addEventListener('click', () => {
    addTrackModal.classList.add('hidden');
});

const selectBtn = document.getElementById('tool-select');

if (selectBtn) {
    const updateSelectTitle = () => {
        const on = state.activeTool === 'select';
        selectBtn.title = on
            ? 'Select mode: on — drag to select notes (S)'
            : 'Select mode: off — drag to select notes (S)';
    };
    selectBtn.addEventListener('click', () => {
        if (state.activeTool === 'select') {
            state.activeTool = 'draw';
            selectBtn.classList.remove('active');
            state.selectedNoteIds = [];
        } else {
            state.activeTool = 'select';
            selectBtn.classList.add('active');
        }
        updateSelectTitle();
    });
}

// Scale Lock: when on, note placement/drag snaps to the detected key so what you
// put down is in tune. The actual snapping lives in interaction.js.
const scaleLockBtn = document.getElementById('tool-scale-lock');
if (scaleLockBtn) {
    const updateScaleLockTitle = () => {
        scaleLockBtn.title = state.scaleLock
            ? 'Scale snap: on — new notes snap to the song\'s key'
            : 'Scale snap: off — notes can land anywhere (chromatic)';
    };
    scaleLockBtn.classList.toggle('active', state.scaleLock);
    updateScaleLockTitle();
    scaleLockBtn.addEventListener('click', () => {
        state.scaleLock = !state.scaleLock;
        scaleLockBtn.classList.toggle('active', state.scaleLock);
        updateScaleLockTitle();
    });
}

// Tempo + key controls in the toolbar. These are always visible: they show the
// current tempo/key (set by "Learn a Song" or by hand) and drive the loop
// length, bar grid and Scale Snap. The canvas re-renders every frame, so just
// updating state + the Transport is enough — no explicit redraw needed.
const bpmInput = document.getElementById('bpm-input');
const keySelect = document.getElementById('key-select');

// Reflect state.song into the toolbar controls (called after a song is learned
// and on startup). Doesn't fire the change handlers, so it's safe to call any
// time without echoing back into setTempo/setKey.
function updateSongReadout() {
    if (bpmInput) bpmInput.value = Math.round(state.song.bpm || Tone.Transport.bpm.value);
    if (keySelect && state.song.key) {
        keySelect.value = `${state.song.key.tonic}:${state.song.key.mode}`;
    }
}

function initSongControls() {
    if (keySelect) {
        // Build the 24 key options (12 tonics × major/minor).
        ['major', 'minor'].forEach(mode => {
            NOTE_NAMES.forEach((name, tonic) => {
                const opt = document.createElement('option');
                opt.value = `${tonic}:${mode}`;
                opt.textContent = `${name} ${mode}`;
                keySelect.appendChild(opt);
            });
        });
        keySelect.addEventListener('change', () => {
            const [tonic, mode] = keySelect.value.split(':');
            state.song.key = makeKey(Number(tonic), mode);
        });
    }

    if (bpmInput) {
        const MIN_BPM = 20, MAX_BPM = 300;
        const applyBpm = (value) => {
            const bpm = Math.round(Math.min(MAX_BPM, Math.max(MIN_BPM, value)));
            if (!isFinite(bpm)) return;
            setTempo(bpm); // updates Transport, state.song.bpm and re-fits the loop
            bpmInput.value = bpm;
        };
        bpmInput.addEventListener('change', () => applyBpm(parseFloat(bpmInput.value)));
        // Scroll over the field to nudge tempo, so you can feel it affect the loop.
        bpmInput.addEventListener('wheel', (e) => {
            e.preventDefault();
            applyBpm((parseFloat(bpmInput.value) || 90) + (e.deltaY < 0 ? 1 : -1));
        }, { passive: false });
        document.getElementById('bpm-up')?.addEventListener('click', () =>
            applyBpm((parseFloat(bpmInput.value) || 90) + 1));
        document.getElementById('bpm-down')?.addEventListener('click', () =>
            applyBpm((parseFloat(bpmInput.value) || 90) - 1));
    }

    updateSongReadout();
}
initSongControls();

document.addEventListener('keydown', (e) => {
    // Tool shortcuts
    if (e.target.tagName !== 'INPUT' && !e.ctrlKey && !e.metaKey) {
        if (e.key.toLowerCase() === 's') selectBtn?.click();

        // Send the playhead back to the start of the loop
        if (e.key === 'Enter' && state.isPlaying) {
            e.preventDefault();
            Tone.Transport.seconds = 0;
        }

        // Delete selection
        if (e.key === 'Delete' || e.key === 'Backspace') {
            if (state.selectedNoteIds.length > 0) {
                state.notes = state.notes.filter(n => !state.selectedNoteIds.includes(n.id));
                state.selectedNoteIds = [];
                import('./audio.js').then(module => {
                    module.syncAudioPart(state.notes);
                });
            }
        }
    }
});

// Create a new track of the given type ('drums' or 'synth'), select it, and
// refresh the UI. Returns the new track. Shared by the Add Track modal and the
// presets flow (which creates a target track when none of the right type exists).
function createTrack(type) {
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
        // Melodic tracks start on the sampled piano so they sound realistic
        // out of the box; switch to a custom synth in Sound Settings.
        engine: type === 'drums' ? undefined : 'sampler',
        sampleInstrument: type === 'drums' ? null : 'piano',
        muted: false,
        solo: false,
        expanded: false,
        baseMidi: type === 'drums' ? 36 : 48
    };

    state.tracks.push(newTrack);
    initTrackSynth(newTrackId, getPreset(presetId));
    state.activeTrackId = newTrackId;
    renderTrackTabs();
    refreshTweakForActiveTrack();
    return newTrack;
}

trackOptBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        addTrackModal.classList.add('hidden');
        createTrack(btn.dataset.type);
    });
});

// Presets: drop a ready-made drum beat or chord progression onto a track so a
// beginner starts from something musical instead of a blank grid. Everything
// placed stays fully editable (see presets.js for the pattern/progression data).
const presetsBtn = document.getElementById('presets-btn');
const presetsModal = document.getElementById('presets-modal');
const closePresetsBtn = document.getElementById('close-presets-btn');
const drumPresetList = document.getElementById('drum-preset-list');
const chordPresetList = document.getElementById('chord-preset-list');
const presetKeyHint = document.getElementById('preset-key-hint');

// Find a track of the right kind to drop a preset on — prefer the active track,
// then any existing track of that kind, otherwise create one.
function findOrCreateTrack(kind /* 'drums' | 'melodic' */) {
    const wantDrums = kind === 'drums';
    const active = getActiveTrack();
    if (active && (active.type === 'drums') === wantDrums) return active;
    const match = state.tracks.find(t => (t.type === 'drums') === wantDrums);
    if (match) return match;
    return createTrack(wantDrums ? 'drums' : 'synth');
}

// Replace a track's notes with a freshly built preset (asking first if the track
// already has notes, so browsing presets can't silently wipe work). Returns
// whether the notes were applied.
function applyNotesToTrack(track, newNotes) {
    const existing = state.notes.filter(n => n.trackId === track.id);
    if (existing.length && !confirm(`Replace the ${existing.length} note(s) already on "${track.name}"?`)) {
        return false;
    }
    state.notes = state.notes.filter(n => n.trackId !== track.id);
    clearRedo();
    newNotes.forEach(n => state.notes.push({ id: generateId(), trackId: track.id, ...n }));
    state.activeTrackId = track.id;
    renderTrackTabs();
    refreshTweakForActiveTrack();
    import('./audio.js').then(module => module.syncAudioPart(state.notes));
    return true;
}

function applyDrumPattern(pattern) {
    const track = findOrCreateTrack('drums');
    const bars = Math.max(1, LOOP_LENGTH_MEASURES);
    if (applyNotesToTrack(track, buildDrumNotes(pattern, { bars }))) {
        presetsModal.classList.add('hidden');
    }
}

function applyChordProgression(progression) {
    const track = findOrCreateTrack('melodic');
    // Grow the loop so the whole progression is heard at least once, then tile
    // it across however many bars the loop now spans.
    const needBars = progression.degrees.length;
    if (LOOP_LENGTH_MEASURES < needBars) {
        setLoopLengthMeasures(needBars);
        if (window.redrawReferenceWave) window.redrawReferenceWave();
    }
    const bars = Math.max(LOOP_LENGTH_MEASURES, needBars);
    if (applyNotesToTrack(track, buildChordNotes(progression, state.song.key, { bars }))) {
        presetsModal.classList.add('hidden');
    }
}

function presetCard(preset, onClick) {
    const card = document.createElement('button');
    card.className = 'preset-card';
    card.innerHTML = `
        <span class="preset-icon"><svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">${preset.icon || ''}</svg></span>
        <strong>${preset.name}</strong>
        ${preset.desc ? `<span class="preset-desc">${preset.desc}</span>` : ''}
    `;
    card.addEventListener('click', onClick);
    return card;
}

if (presetsBtn && presetsModal) {
    DRUM_PATTERNS.forEach(p => drumPresetList.appendChild(presetCard(p, () => applyDrumPattern(p))));
    CHORD_PROGRESSIONS.forEach(p => chordPresetList.appendChild(presetCard(p, () => applyChordProgression(p))));

    presetsBtn.addEventListener('click', () => {
        // Chords match the learned song's key when one is loaded; say so.
        presetKeyHint.textContent = state.song.key
            ? `In the song's key: ${state.song.key.name}.`
            : 'No song loaded — chords use C major. Learn a Song first to match its key.';
        presetsModal.classList.remove('hidden');
    });
    closePresetsBtn.addEventListener('click', () => presetsModal.classList.add('hidden'));
    presetsModal.addEventListener('click', (e) => {
        if (e.target === presetsModal) presetsModal.classList.add('hidden');
    });
}

// Undo / Redo nav buttons
undoBtn.addEventListener('click', () => {
    undoNote();
    import('./audio.js').then(module => {
        module.syncAudioPart(state.notes);
    });
});
const redoBtn = document.getElementById('redo-btn');
if (redoBtn) {
    redoBtn.addEventListener('click', () => {
        redoNote();
        import('./audio.js').then(module => {
            module.syncAudioPart(state.notes);
        });
    });
}

// Bottom-right "Menu" dropdown: holds Presets / Import / Export so the bar stays
// uncluttered. The items themselves are wired up by their own listeners (keyed by
// id); here we just toggle the panel open/closed.
const moreMenuBtn = document.getElementById('more-menu-btn');
const moreMenu = document.getElementById('more-menu');
if (moreMenuBtn && moreMenu) {
    const closeMoreMenu = () => {
        moreMenu.classList.add('hidden');
        moreMenuBtn.setAttribute('aria-expanded', 'false');
    };
    moreMenuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const open = moreMenu.classList.toggle('hidden');
        moreMenuBtn.setAttribute('aria-expanded', String(!open));
    });
    // Pick an item → run its action (its own listener) and close the menu.
    moreMenu.addEventListener('click', () => closeMoreMenu());
    // Click anywhere else closes it.
    document.addEventListener('click', (e) => {
        if (!moreMenu.classList.contains('hidden') && !e.target.closest('.more-menu-wrap')) {
            closeMoreMenu();
        }
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeMoreMenu();
    });
}

// Navbar Toggles
btnVisPulse.addEventListener('click', () => {
    state.settings.visualPulse = !state.settings.visualPulse;
    btnVisPulse.classList.toggle('active', state.settings.visualPulse);
});
btnAudPulse.addEventListener('click', () => {
    state.settings.audioPulse = !state.settings.audioPulse;
    btnAudPulse.classList.toggle('active', state.settings.audioPulse);
});

// Tweak Panel UI (opened via a track tab's instrument label).
closeTweakBtn.addEventListener('click', () => {
    tweakPanel.classList.add('hidden');
});

function updateTweakUI() {
    const activeTrack = getActiveTrack();
    if (!activeTrack) return;
    const isDrums = activeTrack.type === 'drums';
    const isChop = activeTrack.engine === 'chop';
    
    synthControls.classList.toggle('hidden', isDrums || isChop);
    drumControls.classList.toggle('hidden', !isDrums || isChop);
    const chopControls = document.getElementById('chop-controls');
    if (chopControls) chopControls.classList.toggle('hidden', !isChop);

    import('./audio.js').then(module => {
        const hasStem = module.hasTrackStem(state.activeTrackId);
        
        if (isDrums) {
            const d = module.getDrumParams(state.activeTrackId);
            if (!d) return;
            drumSliders.forEach(el => { el.value = d[el.dataset.drum]; });
            
            const dStemRow = document.getElementById('drum-stem-pitch-row');
            if (dStemRow) dStemRow.style.display = hasStem ? 'flex' : 'none';
        } else if (activeTrack.engine === 'soundfont') {
            // The SoundFont preset defines the timbre, so the oscillator wave and
            // macro knobs don't apply — hide them and just reflect the preset.
            if (instrumentSelect) instrumentSelect.value = trackInstrumentValue(activeTrack);
            if (designedControls) designedControls.classList.add('hidden');
            const modeHint = document.getElementById('instrument-mode-hint');
            if (modeHint) modeHint.textContent = 'SoundFont · imported';
        } else {
            if (designedControls) designedControls.classList.remove('hidden');
            
            const stemGroup = document.getElementById('stem-optgroup');
            if (stemGroup) stemGroup.style.display = hasStem ? '' : 'none';
            
            const isSampler = module.isSamplerTrack(state.activeTrackId);
            const isChop = activeTrack.engine === 'chop';
            
            // Reflect the engine in the picker, and only show the oscillator
            // wave editor for the synth engine.
            if (instrumentSelect) {
                if (isChop) {
                    instrumentSelect.value = 'chop';
                } else {
                    instrumentSelect.value = isSampler ? (activeTrack.sampleInstrument || '') : SYNTH_ENGINE_VALUE;
                }
            }
            if (oscWaveSection) oscWaveSection.classList.toggle('hidden', isSampler || isChop);
            // The wave editor only shapes the oscillator synth; recorded
            // instruments ignore it. Reflect that in the hint so it's clear why
            // the curve isn't shown / doesn't apply.
            const modeHint = document.getElementById('instrument-mode-hint');
            if (modeHint) modeHint.textContent = isChop ? 'sliced · playable' : (isSampler ? 'recorded · realistic' : 'designed · synth');

            const m = module.getMacros(state.activeTrackId);
            if (!m) return;
            macroSliders.forEach(el => { el.value = m[el.dataset.macro]; });
            if (!isSampler) drawTweakWave(m);
            
            const mStemRow = document.getElementById('stem-pitch-row');
            if (mStemRow) mStemRow.style.display = hasStem ? 'flex' : 'none';
        }
        
        if (isChop) {
            const speedSlider = document.getElementById('chop-speed');
            if (speedSlider) {
                // we will map this to the activeTrack state
                speedSlider.value = activeTrack.samplePlaybackRate || 1.0;
            }
            drawChopWave(activeTrack, module.getChopBuffer(state.activeTrackId));
        }

    });
}

function drawChopWave(track, buffer) {
    const canvas = document.getElementById('chop-wave-canvas');
    if (!canvas || !buffer) return;
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    // If slice offsets aren't defined, create 16 equal slices
    if (!track.sliceOffsets) {
        track.sliceOffsets = [];
        const sliceLength = buffer.duration / 16;
        for (let i = 0; i < 16; i++) {
            track.sliceOffsets.push(i * sliceLength);
        }
    }

    // Draw simple waveform representation (using computePeaks if we want, but for now we can just draw lines or we can use the computePeaks imported from cropClip.js)
    ctx.fillStyle = track.color;
    ctx.globalAlpha = 0.5;
    ctx.fillRect(0, height / 4, width, height / 2); // placeholder for actual peaks
    
    // Actually let's just draw the slices
    ctx.globalAlpha = 1.0;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    for (let i = 0; i < track.sliceOffsets.length; i++) {
        const offset = track.sliceOffsets[i];
        const x = (offset / buffer.duration) * width;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
        
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.font = '9px sans-serif';
        ctx.fillText(i + 1, x + 2, 10);
    }
}


// Base oscillator shape, -1..1, before brightness shaping.
function oscSample(osc, phase) {
    if (osc === 'sine') return Math.sin(phase);
    if (osc === 'triangle') return Math.asin(Math.sin(phase)) / (Math.PI / 2);
    if (osc === 'square') return Math.sin(phase) > 0 ? 1 : -1;
    // sawtooth
    return 2 * (phase / (2 * Math.PI) - Math.floor(0.5 + phase / (2 * Math.PI)));
}

// Draw a preview that reflects the WHOLE sound, not just the envelope tail:
//   Punch -> attack slope (how fast it rises on the left)
//   Body  -> sustain plateau height across the middle + release tail length
//   Bite  -> brightness: adds a higher-frequency shimmer on top of the wave
//   Air   -> a faint ghosted echo of the tail
function drawTweakWave(m) {
    if (!tweakWaveCanvas) return;
    const ctx = tweakWaveCanvas.getContext('2d');
    const width = tweakWaveCanvas.width;
    const height = tweakWaveCanvas.height;

    ctx.clearRect(0, 0, width, height);
    const activeTrack = getActiveTrack();
    const color = activeTrack ? activeTrack.color : '#2D3436';

    const centerY = height / 2;
    const maxAmp = height * 0.34;
    const cycles = 3.5;

    // Envelope across the full width, driven by the macros.
    const attackEnd = 0.04 + (1 - m.punch) * 0.33;   // punchy = steeper, earlier peak
    const sustain = 0.35 + m.body * 0.6;             // Body raises the whole plateau
    const releaseStart = 0.55 + m.body * 0.35;       // Body lengthens the tail
    const envAt = (t) => {
        if (t < attackEnd) return (t / attackEnd);                 // rise to 1.0
        if (t > releaseStart) return sustain * (1 - (t - releaseStart) / (1 - releaseStart));
        return sustain + (1 - sustain) * 0;                        // plateau at sustain
    };

    const drawWave = (ampScale, alpha) => {
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.globalAlpha = alpha;
        ctx.lineWidth = 3;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        for (let x = 0; x <= width; x += 2) {
            const t = x / width;
            const phase = t * Math.PI * 2 * cycles;
            let s = oscSample(m.osc, phase);
            // Bite adds a brighter overtone shimmer.
            s = s + m.bite * 0.35 * Math.sin(phase * 4);
            const y = centerY - s * maxAmp * ampScale * envAt(t);
            if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
    };

    // Air: faint ghost echo behind the main wave.
    if (m.air > 0.02) drawWave(0.85, m.air * 0.4);
    drawWave(1.0, 1.0);
    ctx.globalAlpha = 1.0;
}

// Throttle preview notes while dragging a knob.
let previewTimeout = null;
function previewNote(module, note) {
    if (previewTimeout) return;
    module.playSound(state.activeTrackId, note, undefined, "16n");
    previewTimeout = setTimeout(() => { previewTimeout = null; }, 150);
}

// Click the waveform to cycle the oscillator shape.
tweakWaveCanvas.addEventListener('click', () => {
    import('./audio.js').then(module => {
        const m = module.getMacros(state.activeTrackId);
        if (!m) return;
        const oscs = ['sine', 'triangle', 'square', 'sawtooth'];
        const newOsc = oscs[(oscs.indexOf(m.osc) + 1) % oscs.length];
        module.setOscillator(state.activeTrackId, newOsc);
        module.playSound(state.activeTrackId, "C3", undefined, "16n");
        updateTweakUI();
    });
});

// Synth macro knobs.
macroSliders.forEach(el => {
    el.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        import('./audio.js').then(module => {
            module.setMacro(state.activeTrackId, el.dataset.macro, val);
            const m = module.getMacros(state.activeTrackId);
            if (m && !module.isSamplerTrack(state.activeTrackId)) drawTweakWave(m);
            previewNote(module, "C3");
        });
    });
});

// Drum tuning knobs.
drumSliders.forEach(el => {
    el.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        import('./audio.js').then(module => {
            module.setDrumParam(state.activeTrackId, el.dataset.drum, val);
            previewNote(module, el.dataset.drum === 'snap' ? 'D2' : 'C2');
        });
    });
});

savePresetBtn.addEventListener('click', () => {
    const name = prompt("Name your preset (e.g. 'Sub Bass'):");
    if (!name) return;

    import('./audio.js').then(module => {
        const m = module.getMacros(state.activeTrackId);
        if (!m) return;
        const presetId = name.toLowerCase().replace(/\s+/g, '-');
        const { osc, ...macros } = m;
        saveUserPreset(presetId, { name, type: 'synth', osc, macros });

        const activeTrack = getActiveTrack();
        if (activeTrack) {
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
            updateSongReadout(); // reflect the imported file's tempo + detected key
            midiUploadInput.value = ''; // reset
        } catch (err) {
            console.error("Failed to parse MIDI:", err);
            alert("Fehler beim Laden der MIDI-Datei.");
        }
    });
}

// Setup Reference Audio Import
const importReferenceBtn = document.getElementById('import-reference-btn');
const referenceUploadInput = document.getElementById('reference-upload');
const referenceBar = document.getElementById('reference-bar');
const referenceName = document.getElementById('reference-name');
const referenceMuteBtn = document.getElementById('reference-mute-btn');
const referenceOffsetInput = document.getElementById('reference-offset');
const referenceWaveCanvas = document.getElementById('reference-wave');

let referencePeaks = null;

// Redraw the overview from current state. Exposed on window so the loop-length
// change (after MIDI import grows the loop) can refresh the window width.
function redrawReferenceWave() {
    if (!referencePeaks || !referenceWaveCanvas) return;
    drawReferenceWave(referenceWaveCanvas, referencePeaks, {
        duration: getReferenceDuration(),
        offsetSeconds: state.reference.offsetSeconds,
        loopSeconds: LOOP_LENGTH_SECONDS()
    });
}
window.redrawReferenceWave = redrawReferenceWave;

function updateReferenceMuteIcon() {
    referenceMuteBtn.innerHTML = state.reference.muted
        ? '<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><line x1="1" y1="1" x2="23" y2="23"></line><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M23 9l-6 6"></path><path d="M17 9l6 6"></path></svg>'
        : '<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>';
    referenceMuteBtn.classList.toggle('active', state.reference.muted);
}

// Reveal + populate the reference bar from the currently loaded reference audio.
// Shared by the explicit "Import Reference Audio" button and the "Learn a Song"
// flow (which reuses the dropped mp3 as the reference).
function revealReference(name) {
    state.reference.name = name;
    if (referenceName) referenceName.textContent = name;
    if (referenceOffsetInput) referenceOffsetInput.value = state.reference.offsetSeconds;
    updateReferenceMuteIcon();
    if (referenceBar) referenceBar.classList.remove('hidden');
    referencePeaks = getReferencePeaks();
    redrawReferenceWave();
}

// "Learn a Song": drop an mp3 -> transcribe + analyze + build tracks + reference.
const learnSongBtn = document.getElementById('learn-song-btn');
const songUploadInput = document.getElementById('song-upload');
const transcribeOverlay = document.getElementById('transcribe-overlay');
const transcribeFill = document.getElementById('transcribe-fill');
const transcribeStatus = document.getElementById('transcribe-status');

// Crop modal: show the dropped mp3's waveform and let the user pick a short
// section to learn. Resolves with a trimmed WAV File (the chosen loop), the
// original File ("use whole song", or when decoding fails), or null (cancel).
// Trimming before upload is what shortens the slow stem-separation step.
const clipCropModal = document.getElementById('clip-crop-modal');
const clipCropWave = document.getElementById('clip-crop-wave');
const clipCropStart = document.getElementById('clip-crop-start');
const clipCropLength = document.getElementById('clip-crop-length');
const clipCropReadout = document.getElementById('clip-crop-readout');
const clipCropConfirm = document.getElementById('clip-crop-confirm');
const clipCropWhole = document.getElementById('clip-crop-whole');
const clipCropCancel = document.getElementById('clip-crop-cancel');

const DEFAULT_CLIP_SECONDS = 10;

function openClipCropper(file) {
    return new Promise(async (resolve) => {
        let buffer;
        try {
            buffer = await decodeAudioFile(file);
        } catch (err) {
            // Can't decode (unusual codec) — skip the trim step, learn the whole file.
            console.warn('Could not decode for cropping; using whole file.', err);
            resolve(file);
            return;
        }

        const duration = buffer.duration;
        const peaks = computePeaks(buffer);
        let cropStart = 0;
        let cropLength = Math.min(DEFAULT_CLIP_SECONDS, duration);

        const clampWindow = () => {
            cropLength = Math.max(1, Math.min(cropLength, duration));
            cropStart = Math.max(0, Math.min(cropStart, duration - cropLength));
        };

        const MIN_CLIP = 1;
        const redraw = () => {
            clampWindow();
            clipCropStart.value = cropStart.toFixed(1);
            clipCropLength.value = cropLength.toFixed(1);
            clipCropLength.max = duration.toFixed(1);
            clipCropReadout.textContent =
                `${cropStart.toFixed(1)}–${(cropStart + cropLength).toFixed(1)}s of ${duration.toFixed(1)}s`;
            drawReferenceWave(clipCropWave, peaks, {
                duration,
                offsetSeconds: cropStart,
                loopSeconds: cropLength,
                handles: true
            });
        };

        const onStartInput = () => {
            cropStart = parseFloat(clipCropStart.value) || 0;
            redraw();
        };
        const onLengthInput = () => {
            cropLength = parseFloat(clipCropLength.value) || MIN_CLIP;
            redraw();
        };

        // Drag the window body to move it, or grab an edge handle to resize.
        let dragMode = 'none';   // 'move' | 'start' | 'end'
        let grabSec = 0;         // pointer offset within the window when moving
        const localX = (e) => {
            const rect = clipCropWave.getBoundingClientRect();
            return { x: Math.max(0, Math.min(rect.width, e.clientX - rect.left)), width: rect.width };
        };
        const onPointerDown = (e) => {
            const { x, width } = localX(e);
            const hit = hitTestWindow(x, width, duration, cropStart, cropLength);
            dragMode = (hit === 'start' || hit === 'end') ? hit : 'move';
            grabSec = pxToSeconds(x, width, duration) - cropStart;
            clipCropWave.setPointerCapture(e.pointerId);
            if (hit === 'none') {
                // Clicked outside the window — recenter it under the cursor.
                cropStart = pxToOffset(x, width, duration, cropLength);
                grabSec = cropLength / 2;
            }
            redraw();
        };
        const onPointerMove = (e) => {
            if (dragMode === 'none') {
                // Hover feedback: resize cursor over the edges.
                const { x, width } = localX(e);
                const hit = hitTestWindow(x, width, duration, cropStart, cropLength);
                clipCropWave.style.cursor = (hit === 'start' || hit === 'end') ? 'ew-resize' : 'grab';
                return;
            }
            const { x, width } = localX(e);
            const sec = pxToSeconds(x, width, duration);
            if (dragMode === 'move') {
                cropStart = sec - grabSec;
            } else if (dragMode === 'start') {
                const end = cropStart + cropLength;
                cropStart = Math.min(sec, end - MIN_CLIP);
                cropLength = end - cropStart;
            } else if (dragMode === 'end') {
                cropLength = Math.max(MIN_CLIP, sec - cropStart);
            }
            redraw();
        };
        const onPointerUp = (e) => {
            dragMode = 'none';
            try { clipCropWave.releasePointerCapture(e.pointerId); } catch (_) {}
        };

        const close = (result) => {
            clipCropStart.removeEventListener('change', onStartInput);
            clipCropLength.removeEventListener('change', onLengthInput);
            clipCropWave.removeEventListener('pointerdown', onPointerDown);
            clipCropWave.removeEventListener('pointermove', onPointerMove);
            clipCropWave.removeEventListener('pointerup', onPointerUp);
            clipCropConfirm.removeEventListener('click', onConfirm);
            clipCropWhole.removeEventListener('click', onWhole);
            clipCropCancel.removeEventListener('click', onCancel);
            window.removeEventListener('resize', redraw);
            clipCropModal.classList.add('hidden');
            resolve(result);
        };
        const onConfirm = () => {
            clampWindow();
            // Whole song selected anyway — no need to re-encode, upload the original.
            const result = cropLength >= duration - 0.05
                ? file
                : wavFileFromSlice(buffer, cropStart, cropLength, file.name);
            close(result);
        };
        const onWhole = () => close(file);
        const onCancel = () => close(null);

        clipCropStart.addEventListener('change', onStartInput);
        clipCropLength.addEventListener('change', onLengthInput);
        clipCropWave.addEventListener('pointerdown', onPointerDown);
        clipCropWave.addEventListener('pointermove', onPointerMove);
        clipCropWave.addEventListener('pointerup', onPointerUp);
        clipCropConfirm.addEventListener('click', onConfirm);
        clipCropWhole.addEventListener('click', onWhole);
        clipCropCancel.addEventListener('click', onCancel);
        window.addEventListener('resize', redraw);

        // Reveal before drawing so the canvas has a measurable width.
        clipCropModal.classList.remove('hidden');
        redraw();
    });
}

if (learnSongBtn && songUploadInput) {
    learnSongBtn.addEventListener('click', () => songUploadInput.click());

    songUploadInput.addEventListener('change', async (e) => {
        const picked = e.target.files[0];
        if (!picked) return;

        // Let the user trim to a short loop first so stem separation stays fast.
        const file = await openClipCropper(picked);
        songUploadInput.value = '';
        if (!file) return; // cancelled

        transcribeOverlay.classList.remove('hidden');
        transcribeFill.style.width = '0%';
        transcribeStatus.textContent = 'Separating stems — this can take a moment.';

        const onProgress = ({ percent, label }) => {
            transcribeFill.style.width = `${Math.round((percent || 0) * 100)}%`;
            if (label) transcribeStatus.textContent = label;
        };

        try {
            await Tone.start();
            try {
                // Preferred path: separate into stems, transcribe each cleanly.
                await separateTranscribeAndImport(file, renderTrackTabs, onProgress);
            } catch (err) {
                if (err instanceof StemServerUnavailableError) {
                    // No stem server running — degrade to in-browser full-mix.
                    console.warn('Stem server unavailable, falling back to full-mix transcription.');
                    transcribeFill.style.width = '0%';
                    transcribeStatus.textContent = 'Stem server offline — quick transcription…';
                    await transcribeAndImport(file, renderTrackTabs, onProgress);
                } else {
                    throw err;
                }
            }
            updateSongReadout();
            revealReference(file.name);
        } catch (err) {
            console.error('Transcription failed:', err);
            alert('Could not learn this song: ' + (err && err.message ? err.message : err));
        } finally {
            transcribeOverlay.classList.add('hidden');
            songUploadInput.value = '';
        }
    });
}

if (importReferenceBtn && referenceUploadInput) {
    importReferenceBtn.addEventListener('click', () => {
        referenceUploadInput.click();
    });

    referenceUploadInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
            await Tone.start();
            const module = await import('./audio.js');
            await module.loadReferenceAudio(file);
            revealReference(file.name);
            referenceUploadInput.value = ''; // reset
        } catch (err) {
            console.error("Failed to load reference audio:", err);
            alert("Failed to load reference audio.");
        }
    });

    referenceMuteBtn.addEventListener('click', () => {
        state.reference.muted = !state.reference.muted;
        import('./audio.js').then(module => module.setReferenceMuted(state.reference.muted));
        updateReferenceMuteIcon();
    });

    referenceOffsetInput.addEventListener('change', (e) => {
        const offset = Math.max(0, parseFloat(e.target.value) || 0);
        import('./audio.js').then(module => {
            module.setReferenceOffset(offset);
            referenceOffsetInput.value = state.reference.offsetSeconds.toFixed(1);
            redrawReferenceWave();
        });
    });

    // Drag the loop window across the waveform to align it with the song.
    let isDraggingWave = false;
    const applyWaveDrag = (e) => {
        if (!referencePeaks) return;
        const rect = referenceWaveCanvas.getBoundingClientRect();
        const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
        const offset = pxToOffset(x, rect.width, getReferenceDuration(), LOOP_LENGTH_SECONDS());
        import('./audio.js').then(module => {
            module.setReferenceOffset(offset);
            referenceOffsetInput.value = state.reference.offsetSeconds.toFixed(1);
            redrawReferenceWave();
        });
    };
    referenceWaveCanvas.addEventListener('pointerdown', (e) => {
        isDraggingWave = true;
        referenceWaveCanvas.setPointerCapture(e.pointerId);
        applyWaveDrag(e);
    });
    referenceWaveCanvas.addEventListener('pointermove', (e) => {
        if (isDraggingWave) applyWaveDrag(e);
    });
    referenceWaveCanvas.addEventListener('pointerup', (e) => {
        isDraggingWave = false;
        referenceWaveCanvas.releasePointerCapture(e.pointerId);
    });
    window.addEventListener('resize', redrawReferenceWave);
}

// "Add Sample" workflow: upload an mp3, optionally separate it into stems,
// and create a chop track for each stem (or one for the whole file).
const addSampleBtn = document.getElementById('add-sample-btn');
const sampleUploadInput = document.getElementById('sample-upload');

if (addSampleBtn && sampleUploadInput) {
    addSampleBtn.addEventListener('click', () => sampleUploadInput.click());

    sampleUploadInput.addEventListener('change', async (e) => {
        const picked = e.target.files[0];
        if (!picked) return;

        // Optionally let user crop the sample first
        const file = await openClipCropper(picked);
        sampleUploadInput.value = '';
        if (!file) return;

        const useStems = confirm("Do you want to separate this sample into stems (Vocals, Drums, Bass, Other)?\n\nIf Cancel, it will load as a single Chop track.");

        transcribeOverlay.classList.remove('hidden');
        transcribeFill.style.width = '0%';
        transcribeStatus.textContent = useStems ? 'Separating stems — this can take a moment.' : 'Processing sample...';

        const onProgress = ({ percent, label }) => {
            transcribeFill.style.width = `${Math.round((percent || 0) * 100)}%`;
            if (label) transcribeStatus.textContent = label;
        };

        try {
            await Tone.start();
            
            if (useStems) {
                try {
                    const result = await separateStems(file, onProgress);
                    
                    ['vocals', 'bass', 'drums', 'other'].forEach(stemName => {
                        const buffer = result.stems[stemName];
                        if (!buffer) return;
                        
                        const track = createTrack('synth');
                        track.name = `${stemName.charAt(0).toUpperCase() + stemName.slice(1)} Chop`;
                        track.engine = 'chop';
                        
                        // We set the stem audio as the track's stem. 
                        // Our audio.js setTrackStem logic will initialize trackChopPlayers.
                        setTrackStem(track.id, buffer);
                    });
                } catch (err) {
                    if (err instanceof StemServerUnavailableError) {
                        alert("Stem server is unavailable. You must run the backend server for stem separation. Loading as a single sample instead.");
                        await loadSingleSample(file);
                    } else {
                        throw err;
                    }
                }
            } else {
                await loadSingleSample(file);
            }
        } catch (err) {
            console.error('Add Sample failed:', err);
            alert('Could not process this sample: ' + (err && err.message ? err.message : err));
        } finally {
            transcribeOverlay.classList.add('hidden');
        }
    });
}

async function loadSingleSample(file) {
    const buffer = await decodeAudioFile(file);
    const track = createTrack('synth');
    track.name = `Sample Chop`;
    track.engine = 'chop';
    setTrackStem(track.id, buffer);
}

const chopSpeedSlider = document.getElementById('chop-speed');
if (chopSpeedSlider) {
    chopSpeedSlider.addEventListener('input', (e) => {
        const track = getActiveTrack();
        if (track && track.engine === 'chop') {
            track.samplePlaybackRate = parseFloat(e.target.value);
            import('./audio.js').then(module => {
                module.updateChopSpeed(track.id);
            });
        }
    });
}


const chopWaveCanvas = document.getElementById('chop-wave-canvas');
if (chopWaveCanvas) {
    let draggingSliceIndex = -1;
    
    chopWaveCanvas.addEventListener('pointerdown', (e) => {
        const track = getActiveTrack();
        if (!track || track.engine !== 'chop' || !track.sliceOffsets) return;
        
        import('./audio.js').then(module => {
            const buffer = module.getChopBuffer(track.id);
            if (!buffer) return;
            
            const rect = chopWaveCanvas.getBoundingClientRect();
            const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
            const clickTime = (x / rect.width) * buffer.duration;
            
            let closestIdx = -1;
            let minDiff = Infinity;
            
            for (let i = 0; i < track.sliceOffsets.length; i++) {
                const diff = Math.abs(track.sliceOffsets[i] - clickTime);
                if (diff < minDiff && diff < (buffer.duration / rect.width) * 10) {
                    minDiff = diff;
                    closestIdx = i;
                }
            }
            
            if (closestIdx !== -1) {
                draggingSliceIndex = closestIdx;
                chopWaveCanvas.setPointerCapture(e.pointerId);
            }
        });
    });
    
    chopWaveCanvas.addEventListener('pointermove', (e) => {
        if (draggingSliceIndex === -1) return;
        const track = getActiveTrack();
        if (!track || track.engine !== 'chop' || !track.sliceOffsets) return;
        
        import('./audio.js').then(module => {
            const buffer = module.getChopBuffer(track.id);
            if (!buffer) return;
            
            const rect = chopWaveCanvas.getBoundingClientRect();
            const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
            const newTime = (x / rect.width) * buffer.duration;
            
            const minTime = draggingSliceIndex > 0 ? track.sliceOffsets[draggingSliceIndex - 1] + 0.01 : 0;
            const maxTime = draggingSliceIndex < track.sliceOffsets.length - 1 ? track.sliceOffsets[draggingSliceIndex + 1] - 0.01 : buffer.duration;
            
            track.sliceOffsets[draggingSliceIndex] = Math.max(minTime, Math.min(maxTime, newTime));
            drawChopWave(track, buffer);
        });
    });
    
    chopWaveCanvas.addEventListener('pointerup', (e) => {
        if (draggingSliceIndex !== -1) {
            draggingSliceIndex = -1;
            chopWaveCanvas.releasePointerCapture(e.pointerId);
        }
    });
}
