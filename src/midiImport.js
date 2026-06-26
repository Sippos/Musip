import { Midi } from '@tonejs/midi';
import * as Tone from 'tone';
import { state, generateId } from './state.js';
import { setLoopLengthMeasures, syncAudioPart, initTrackSynth, LOOP_LENGTH_MEASURES, setTempo, loadReferenceBuffer, setTrackStem } from './audio.js';
import { getPreset } from './state.js';
import { gmToSampleInstrument } from './sampleLibrary.js';
import { TRACK_MIDI_RANGE, MIN_PITCH_RANGE, MAX_PITCH_RANGE } from './pitchMap.js';

// Snaps note start times to a 16th-note grid, merges near-duplicate note-ons
// (common when a MIDI transcription double-triggers a pitch), and caps each
// note's duration to the next onset *of any pitch* in the same track. A
// pedal-sustained note rarely repeats on its own pitch soon enough for a
// same-pitch-only cap to matter, but it almost always gets cut off audibly
// once the next note (any pitch) starts — so that's the cap that actually
// turns a transcribed sustain-pedal blob into clean, separated note blocks.
// Notes that share an onset (chords) are left untouched against each other.
// Notes shorter than this (seconds) in the SOURCE file are almost always
// transcription transients — hi-hat ticks and vocal fragments that an
// audio→MIDI converter invents from a full mix — not intended musical notes
// (a 16th note even at 200bpm is ~75ms). Dropping them at import removes the
// "cloud of disconnected dots" that makes a transcribed track unworkable.
const TRANSIENT_MAX_SEC = 0.06;

function quantizeNotes(notes, { minTime, grid, getPitchKey, getNoteName, dropShorterThan = 0 }) {
    const groups = new Map();
    const flat = [];
    notes.forEach(note => {
        if (note.duration < dropShorterThan) return;
        const time = Math.max(0, note.time - minTime);
        const pitchKey = getPitchKey(note);
        if (!groups.has(pitchKey)) groups.set(pitchKey, []);
        const n = {
            time: Math.round(time / grid) * grid,
            duration: note.duration,
            name: getNoteName(note),
            pitchKey
        };
        groups.get(pitchKey).push(n);
    });

    // Dedup note-ons that snapped to the same grid slot on the same pitch,
    // keeping the longer one, then flatten into one per-track list.
    groups.forEach(group => {
        group.sort((a, b) => a.time - b.time);
        const deduped = [];
        group.forEach(n => {
            const prev = deduped[deduped.length - 1];
            if (prev && n.time - prev.time < grid * 0.5) {
                if (n.duration > prev.duration) prev.duration = n.duration;
            } else {
                deduped.push(n);
            }
        });
        flat.push(...deduped);
    });

    const onsetTimes = [...new Set(flat.map(n => n.time))].sort((a, b) => a - b);
    const nextOnsetAfter = (time) => {
        for (const t of onsetTimes) {
            if (t > time) return t;
        }
        return null;
    };

    return flat.map(n => {
        let duration = Math.max(grid, Math.round(n.duration / grid) * grid);
        const nextOnset = nextOnsetAfter(n.time);
        if (nextOnset !== null) duration = Math.min(duration, nextOnset - n.time);
        return { time: n.time, duration, name: n.name };
    });
}

// Map a General-MIDI instrument family to one of the app's synth presets. Only
// 'bass' gets the square bass; every other melodic family uses the sine keys as
// a neutral starting point the user can then shape. Percussion is handled
// separately (drums-kit).
const FAMILY_PRESET = {
    bass: 'bass-square'
};

function titleCase(s) {
    return s.replace(/\b\w/g, c => c.toUpperCase());
}

// Centre the 24-semitone expanded piano-roll window on the track's median pitch
// so the imported notes are actually visible when the track is opened, instead
// of a fixed window the notes may sit entirely above/below.
function baseMidiForNotes(notes) {
    if (notes.length === 0) return 48;
    const midis = notes.map(n => n.midi).sort((a, b) => a - b);
    const median = midis[Math.floor(midis.length / 2)];
    return Math.max(0, Math.min(103, Math.round(median) - 12));
}

// Pick the expanded-track pitch window (baseMidi + zoom) so ALL of an imported
// track's notes fit on screen at once — the fix for "I got so many keys I can't
// see them". Widens the zoom (within limits) to span the track's lowest..highest
// note with a little padding, then centres the window on that span.
function fitPitchWindow(notes) {
    if (!notes.length) return { baseMidi: 48, pitchRange: TRACK_MIDI_RANGE };
    let lo = Infinity, hi = -Infinity;
    notes.forEach(n => { if (n.midi < lo) lo = n.midi; if (n.midi > hi) hi = n.midi; });
    const span = (hi - lo) + 3; // +padding so edge notes aren't flush to the border
    const pitchRange = Math.max(MIN_PITCH_RANGE, Math.min(MAX_PITCH_RANGE, span));
    const center = (lo + hi) / 2;
    const baseMidi = Math.max(0, Math.min(127 - pitchRange, Math.round(center - pitchRange / 2)));
    return { baseMidi, pitchRange };
}

// Derive a human label, preset, type and baseMidi from a MIDI track's instrument
// metadata so imported tracks read as the instruments they represent.
function trackMeta(track, fallbackIdx) {
    const isDrums = track.instrument.percussion || track.channel === 9;
    const inst = track.instrument;
    const label = (track.name && track.name.trim())
        || (inst.name ? titleCase(inst.name) : '')
        || (isDrums ? 'Drums' : `Track ${fallbackIdx + 1}`);
    const presetId = isDrums ? 'drums-kit' : (FAMILY_PRESET[inst.family] || 'keys-sine');
    // Pick a realistic sampled instrument from the GM metadata when one fits
    // (piano, bass, guitar, strings, brass...). Tracks with no good sampled
    // match fall back to the oscillator synth engine.
    const sampleInstrument = isDrums ? null : gmToSampleInstrument(inst);
    return {
        isDrums,
        label,
        presetId,
        type: isDrums ? 'drums' : 'synth',
        engine: sampleInstrument ? 'sampler' : 'synth',
        sampleInstrument,
        baseMidi: isDrums ? 36 : baseMidiForNotes(track.notes)
    };
}

export async function importMidiFile(file, renderTrackTabs) {
    const arrayBuffer = await file.arrayBuffer();
    const midi = new Midi(arrayBuffer);
    // Adopt the file's own tempo so the bar grid, loop length and 16th-note
    // quantize grid all line up with the imported material instead of the app's
    // default 90 BPM. setTempo updates the Transport + state.song.bpm and re-fits
    // the loop region; importNoteTracks (below) then sizes the loop in measures
    // against this tempo.
    const sourceBpm = midi.header.tempos[0]?.bpm || 120;
    setTempo(sourceBpm);
    // Derive the key from the file's notes so Scale Snap and the in-key row
    // highlight work on imported songs too (mirrors the "Learn a Song" flow).
    // analysis.js is imported lazily to keep its tempo-detection dependency out
    // of the startup bundle.
    const allNotes = midi.tracks.flatMap(t => t.notes);
    if (allNotes.length) {
        const { detectKey } = await import('./analysis.js');
        state.song.key = detectKey(allNotes);
    }
    importNoteTracks(midi.tracks, { duration: midi.duration, sourceBpm, renderTrackTabs });
}

// Build app tracks + notes from raw note tracks shaped like @tonejs/midi tracks
// ({ notes:[{time,duration,midi,name}], instrument:{family,name,percussion},
// channel, name }). Shared by MIDI import and audio transcription so both go
// through the same cleaning, auto-split and track-creation pipeline.
// `stems` (optional) maps a stem key (bass/drums/other) to its decoded
// AudioBuffer. When a rawTrack carries a matching `stemKey`, the created track is
// wired to play that isolated original recording on demand (the "hear original"
// headphone toggle). Only the stem-separation flow passes this; plain MIDI import
// and the full-mix fallback omit it, so those tracks get no stem.
export function importNoteTracks(rawTracks, { duration, sourceBpm, renderTrackTabs, stems = null }) {
    const newTracksStartIdx = state.tracks.length;

    const colors = ['#A8E6CF', '#FFD3B6', '#FFAAA5', '#D4A5FF', '#A5D8FF'];
    let colorIdx = state.tracks.length; // stagger colors based on existing tracks

    // Size the loop to cover the imported material. `1m` resolves against the
    // current Transport tempo (90 by default, or the song's detected tempo when
    // the transcription flow has called setTempo first), so the bar grid lines
    // up with playback either way.
    const measures = Math.ceil(duration / Tone.Time('1m').toSeconds());
    setLoopLengthMeasures(Math.max(LOOP_LENGTH_MEASURES || 2, measures));

    const grid = (60 / sourceBpm) / 4; // 16th note in seconds

    const activeMidiTracks = rawTracks.filter(t => t.notes.length > 0);
    
    // Find the global start time to strip leading silence
    let minTime = Infinity;
    activeMidiTracks.forEach(track => {
        track.notes.forEach(note => {
            if (note.time < minTime) minTime = note.time;
        });
    });
    if (minTime === Infinity) minTime = 0;
    
    if (activeMidiTracks.length === 1 && !activeMidiTracks[0].instrument.percussion && activeMidiTracks[0].channel !== 9) {
        // AUTO-SPLIT Single Track MIDI
        const srcTrack = activeMidiTracks[0];
        
        const bassNotes = srcTrack.notes.filter(n => n.midi < 48);
        const midNotes = srcTrack.notes.filter(n => n.midi >= 48 && n.midi <= 72);
        const leadNotes = srcTrack.notes.filter(n => n.midi > 72);
        
        const addSplitTrack = (notes, name, preset, sampleInstrument, colorIdx) => {
            if (notes.length === 0) return;
            const trackId = `track-${generateId()}`;
            // Open melodic tracks in the piano-roll so the real pitches show (the
            // collapsed 5-lane view distorts an imported melody's contour), with the
            // zoom auto-fitted so all of this track's notes are visible at once.
            // Start collapsed (open later with the track's expand toggle); the
            // pitch window is pre-fitted so when opened, all notes are visible.
            const win = fitPitchWindow(notes);
            state.tracks.push({ id: trackId, name: name, presetId: preset, color: colors[colorIdx % colors.length], type: 'synth', engine: 'sampler', sampleInstrument, expanded: false, muted: false, solo: false, source: 'synth', baseMidi: win.baseMidi, pitchRange: win.pitchRange });
            
            const cleaned = quantizeNotes(notes, {
                minTime,
                grid,
                getPitchKey: note => note.midi,
                getNoteName: note => note.name,
                dropShorterThan: TRANSIENT_MAX_SEC
            });
            cleaned.forEach(note => {
                state.notes.push({
                    id: generateId(),
                    trackId: trackId,
                    note: note.name,
                    time: note.time,
                    duration: note.duration
                });
            });
            initTrackSynth(trackId, getPreset(preset));
        };
        
        addSplitTrack(bassNotes, 'Bass (Auto-Split)', 'bass-square', 'bass-electric', 0);
        addSplitTrack(midNotes, 'Mid (Auto-Split)', 'keys-sine', 'piano', 1);
        addSplitTrack(leadNotes, 'Lead (Auto-Split)', 'keys-sine', 'piano', 2);
        
    } else {
        // STANDARD IMPORT
        activeMidiTracks.forEach((track, i) => {
            const meta = trackMeta(track, i);
            const isDrums = meta.isDrums;
            const trackId = `track-${generateId()}`;
            // Auto-fit the piano-roll zoom to melodic tracks so all their notes are
            // visible at once; drums keep the fixed compact window.
            const win = isDrums ? { baseMidi: meta.baseMidi, pitchRange: TRACK_MIDI_RANGE } : fitPitchWindow(track.notes);

            state.tracks.push({
                id: trackId,
                name: meta.label,
                presetId: meta.presetId,
                color: colors[colorIdx % colors.length],
                type: meta.type,
                engine: meta.engine,
                sampleInstrument: meta.sampleInstrument,
                // Start collapsed; the user opens a track with its expand toggle.
                // The fitted pitch window (below) means it's zoomed to show all the
                // track's notes the moment it's opened.
                expanded: false,
                muted: false,
                solo: false,
                source: 'synth',
                baseMidi: win.baseMidi,
                pitchRange: win.pitchRange
            });
            colorIdx++;

            // Keep the isolated original recording for this source so the user
            // can A/B it against their recreation (defaults to the synth voice;
            // the headphone toggle switches to the stem).
            if (stems && track.stemKey && stems[track.stemKey]) {
                setTrackStem(trackId, stems[track.stemKey]);
            }

            const drumLane = midiPitch => {
                if (midiPitch >= 35 && midiPitch <= 40) return 'C2';
                if (midiPitch >= 41 && midiPitch <= 49) return 'D2';
                return 'F#2';
            };
            const cleaned = quantizeNotes(track.notes, {
                minTime,
                grid,
                getPitchKey: note => isDrums ? drumLane(note.midi) : note.midi,
                getNoteName: note => isDrums ? drumLane(note.midi) : note.name,
                // Drum hits are legitimately short; only de-noise pitched tracks.
                dropShorterThan: isDrums ? 0 : TRANSIENT_MAX_SEC
            });
            cleaned.forEach(note => {
                state.notes.push({
                    id: generateId(),
                    trackId: trackId,
                    note: note.name,
                    time: note.time,
                    duration: note.duration
                });
            });

            initTrackSynth(trackId, getPreset(meta.presetId));
        });
    }
    
    if (state.tracks.length > newTracksStartIdx) {
        state.activeTrackId = state.tracks[newTracksStartIdx].id; // Select the first newly added track
    } else if (state.tracks.length === 0) {
        // Fallback if empty
        state.tracks.push({ id: 'track-1', name: 'Bass', presetId: 'bass-square', color: '#A8E6CF', type: 'synth', expanded: false, muted: false, baseMidi: 36 });
        state.activeTrackId = 'track-1';
        initTrackSynth('track-1', getPreset('bass-square'));
    }
    
    renderTrackTabs();
    syncAudioPart(state.notes);

    // The loop may have grown; refresh the reference overview window width.
    if (typeof window !== 'undefined' && window.redrawReferenceWave) {
        window.redrawReferenceWave();
    }
}

// Stem-first "Learn a Song": separate the song into vocals/drums/bass/other via
// the local Demucs backend, then transcribe each clean stem on its own. Melodic
// stems go through Basic Pitch; the drum stem goes through onset detection. Each
// stem becomes its own editable track via the shared multi-track import path,
// which is far cleaner than transcribing a full mix. Falls back to the legacy
// full-mix path (transcribeAndImport) when the stem server isn't reachable.
//
// `onProgress({ stage, percent, label })` drives the multi-stage overlay.
export async function separateTranscribeAndImport(file, renderTrackTabs, onProgress) {
    const { separateStems } = await import('./stemSeparation.js');
    const { transcribeBuffer } = await import('./audioTranscribe.js');
    const { transcribeDrums } = await import('./drumTranscribe.js');
    const { detectTempo, detectKey, suggestChords } = await import('./analysis.js');

    // Separation is the long step; map its progress into the first 70%.
    const { stems, original } = await separateStems(file, ({ percent }) => {
        if (onProgress) onProgress({ stage: 'separating', percent: 0.7 * (percent || 0), label: 'Separating stems…' });
    });

    const { bpm } = await detectTempo(original);
    setTempo(bpm);

    // Each melodic stem -> one raw track for the shared import pipeline. Metadata
    // drives the sampled instrument + label (see trackMeta / gmToSampleInstrument).
    // Vocals are intentionally skipped: a monophonic, heavily-pitch-bent vocal
    // line transcribes into a messy "cloud of dots" that's rarely worth editing,
    // and the user still hears the real vocal in the reference mix. We focus on
    // the instrumental stems the user is actually recreating.
    // The bass stem is one instrument, so it maps to one track. The "other" stem
    // is everything left over (keys, guitars, synths, pads, leads) mixed
    // together — forcing that onto a single instrument is why it never sounds
    // like the song. We split it by register into Chords (harmony/pads) and Lead
    // (the top melodic line) so each gets its own matchable timbre, mirroring the
    // old full-mix Bass/Mid/Lead split the user found closer to the original.
    const STEM_PLAN = [
        {
            key: 'bass',
            tracks: (notes) => [{ name: 'Bass', instrument: { family: 'bass', name: 'bass', percussion: false }, channel: 0, notes }]
        },
        {
            key: 'other',
            // notes -> sub-tracks, split at C5 (midi 72). Each gets a distinct
            // default instrument so the layers don't all read as one piano.
            tracks: (notes) => [
                { name: 'Chords', range: n => n.midi <= 72, instrument: { family: 'piano', name: '', percussion: false }, channel: 0 },
                { name: 'Lead', range: n => n.midi > 72, instrument: { family: 'guitar', name: 'electric guitar', percussion: false }, channel: 0 }
            ].map(t => ({ ...t, notes: notes.filter(t.range) }))
             .filter(t => t.notes.length)
        }
    ];

    const rawTracks = [];
    const melodicNotes = []; // pooled for key/chord analysis
    let step = 0;
    const melodicCount = STEM_PLAN.filter(p => stems[p.key]).length + (stems.drums ? 1 : 0);
    const bump = (label) => {
        if (onProgress) onProgress({ stage: 'transcribing', percent: 0.7 + 0.3 * (step / Math.max(1, melodicCount)), label });
        step++;
    };

    for (const plan of STEM_PLAN) {
        const buffer = stems[plan.key];
        if (!buffer) continue;
        bump(`Transcribing ${plan.key}…`);
        const { notes } = await transcribeBuffer(buffer);
        if (!notes.length) continue;
        melodicNotes.push(...notes);
        for (const t of plan.tracks(notes)) {
            // stemKey ties the track back to its isolated recording (both Chords
            // and Lead come from the single "other" stem).
            rawTracks.push({ name: t.name, channel: t.channel, instrument: t.instrument, notes: t.notes, stemKey: plan.key });
        }
    }

    if (stems.drums) {
        bump('Transcribing drums…');
        const drumNotes = transcribeDrums(stems.drums);
        if (drumNotes.length) {
            rawTracks.push({
                name: 'Drums',
                channel: 9,
                instrument: { family: '', name: '', percussion: true },
                notes: drumNotes,
                stemKey: 'drums'
            });
        }
    }

    if (!rawTracks.length) {
        throw new Error('No notes were found in this audio.');
    }

    // Key/chords from the pooled melodic notes on the same zero-based timeline
    // importNoteTracks uses (leading silence stripped), so hints stay aligned.
    if (melodicNotes.length) {
        const minTime = melodicNotes.reduce((m, n) => Math.min(m, n.time), Infinity) || 0;
        const shifted = melodicNotes.map(n => ({ ...n, time: n.time - minTime }));
        state.song.key = detectKey(shifted);
        state.song.chords = suggestChords(shifted, { bpm, offsetSeconds: 0 });
    }

    importNoteTracks(rawTracks, { duration: original.duration, sourceBpm: bpm, renderTrackTabs, stems });

    // The dropped mp3 doubles as the reference track for ear A/B-ing.
    loadReferenceBuffer(original, file.name);
}

// "Learn a Song" (legacy full-mix fallback): transcribe an mp3 in-browser,
// analyze it (tempo/key/chords), set the playback tempo, build editable tracks
// through the shared import pipeline, and reuse the same decoded audio as the
// reference track to A/B against. Used when the stem server is unavailable; a
// full-mix transcription is a rough sketch to refine, not a faithful score.
export async function transcribeAndImport(file, renderTrackTabs, onProgress) {
    const { transcribeAudioFile } = await import('./audioTranscribe.js');
    const { detectTempo, detectKey, suggestChords } = await import('./analysis.js');

    const { notes, audioBuffer } = await transcribeAudioFile(file, (pct) => {
        if (onProgress) onProgress({ stage: 'transcribing', percent: pct, label: 'Transcribing…' });
    });
    if (!notes.length) {
        throw new Error('No notes were found in this audio.');
    }

    // Tempo first: setTempo changes the Transport BPM that the loop-length and
    // bar-grid math below resolve against.
    const { bpm } = await detectTempo(audioBuffer);
    setTempo(bpm);

    // importNoteTracks strips the leading silence (shifts the first note to t=0),
    // so analyze on the same zero-based timeline to keep chord hints aligned with
    // the notes/grid the user actually sees and hears.
    const minTime = notes.reduce((m, n) => Math.min(m, n.time), Infinity) || 0;
    const shifted = notes.map(n => ({ ...n, time: n.time - minTime }));
    state.song.key = detectKey(shifted);
    state.song.chords = suggestChords(shifted, { bpm, offsetSeconds: 0 });

    // Hand the flat note list to the shared pipeline as a single melodic track,
    // which triggers the Bass/Mid/Lead auto-split — exactly what a one-shot
    // transcription of a full mix wants.
    const synthTrack = {
        name: file.name.replace(/\.[^.]+$/, ''),
        channel: 0,
        instrument: { family: '', name: '', percussion: false },
        notes: notes.map(n => ({ time: n.time, duration: n.duration, midi: n.midi, name: n.name }))
    };
    importNoteTracks([synthTrack], { duration: audioBuffer.duration, sourceBpm: bpm, renderTrackTabs });

    // The dropped mp3 doubles as the reference track for ear A/B-ing.
    loadReferenceBuffer(audioBuffer, file.name);
}
