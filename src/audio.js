import * as Tone from 'tone';
import { state, getPreset, getActiveTrack, DEFAULT_MACROS } from './state.js';
import { SAMPLE_INSTRUMENTS, SAMPLE_BASE_URL, isSampleInstrument } from './sampleLibrary.js';
import * as soundfont from './soundfont.js';
import { snapMidiToScale } from './pitchMap.js';

export const trackSynths = {};
export const trackEffects = {};
// Per-track source-of-truth for the playful sound controls.
export const trackMacros = {};   // synth tracks: { osc, body, bite, air, punch, wobble }
export const trackDrums = {};    // drum tracks: { kickPitch, boom, snap }

export const MACRO_KEYS = ['body', 'bite', 'air', 'punch', 'wobble'];
export const DEFAULT_DRUM_PARAMS = { kickPitch: 0.3, boom: 0.4, snap: 0.5 };

// We will use a dynamic loop length
export let LOOP_LENGTH_MEASURES = 2;
export const LOOP_LENGTH_SECONDS = () => Tone.Time(`${LOOP_LENGTH_MEASURES}m`).toSeconds();

export function setLoopLengthMeasures(measures) {
    LOOP_LENGTH_MEASURES = measures;
    Tone.Transport.loopEnd = `${measures}m`;
    masterPart.loopEnd = `${measures}m`;
    applyReferenceLoop();
    applyStemLoops();
}

// Set the playback tempo. The Transport defaults to 90 BPM; the "Learn a Song"
// flow calls this with the tempo detected from the imported mp3 so the bar grid
// (and everything sized in `Nm` measure notation) lines up with the real song.
// Loop length is stored in measures, so re-applying it recomputes the loop
// region in seconds against the new tempo.
export function setTempo(bpm) {
    if (!bpm || !isFinite(bpm)) return;
    Tone.Transport.bpm.value = bpm;
    state.song.bpm = bpm;
    setLoopLengthMeasures(LOOP_LENGTH_MEASURES);
}

// Load reference audio from an already-decoded AudioBuffer (the transcription
// flow decodes the mp3 once, then reuses that buffer here instead of fetching
// the file a second time). Mirrors loadReferenceAudio's player setup.
export function loadReferenceBuffer(audioBuffer, name) {
    if (referencePlayer) {
        referencePlayer.unsync();
        referencePlayer.dispose();
        referencePlayer = null;
    }
    const player = new Tone.Player(audioBuffer).toDestination();
    player.mute = state.reference.muted;
    referencePlayer = player;
    state.reference.name = name || null;
    applyReferenceLoop();
}

// Reference audio: the original song (or a clip of it) played back unedited
// alongside the user's recreation, so they can A/B by ear instead of trusting
// the MIDI transcription. Synced to the Transport so it loops in lockstep
// with the loop region, starting from a user-chosen offset into the song.
let referencePlayer = null;

export async function loadReferenceAudio(file) {
    if (referencePlayer) {
        referencePlayer.unsync();
        referencePlayer.dispose();
        referencePlayer = null;
    }
    const url = URL.createObjectURL(file);
    const player = new Tone.Player().toDestination();
    await player.load(url);
    player.mute = state.reference.muted;
    referencePlayer = player;
    applyReferenceLoop();
}

function applyReferenceLoop() {
    if (!referencePlayer) return;
    referencePlayer.unsync();
    const bufferDur = referencePlayer.buffer.duration;
    // Clamp to the clip's own length: a reference clip shorter than the loop
    // region (e.g. a 10s hook) would otherwise make Tone.Player throw when
    // loopEnd exceeds buffer.duration.
    const offset = Math.min(state.reference.offsetSeconds || 0, bufferDur);
    const loopEnd = Math.min(offset + LOOP_LENGTH_SECONDS(), bufferDur);
    referencePlayer.loop = true;
    referencePlayer.loopStart = offset;
    referencePlayer.loopEnd = loopEnd;
    if (state.isPlaying) {
        referencePlayer.sync().start(0, offset);
    }
}

export function setReferenceOffset(offsetSeconds) {
    state.reference.offsetSeconds = Math.max(0, offsetSeconds);
    applyReferenceLoop();
}

export function setReferenceMuted(muted) {
    state.reference.muted = muted;
    if (referencePlayer) referencePlayer.mute = muted;
}

export function startReferenceIfLoaded() {
    applyReferenceLoop();
}

export function getReferenceDuration() {
    if (!referencePlayer || !referencePlayer.buffer.loaded) return 0;
    return referencePlayer.buffer.duration;
}

// Reduce the loaded reference audio to `bucketCount` absolute-peak buckets so the
// overview waveform can be drawn cheaply regardless of clip length. Returns null
// when no audio is loaded.
export function getReferencePeaks(bucketCount = 800) {
    if (!referencePlayer || !referencePlayer.buffer.loaded) return null;
    const data = referencePlayer.buffer.getChannelData(0);
    const samplesPerBucket = Math.max(1, Math.floor(data.length / bucketCount));
    const peaks = new Float32Array(bucketCount);
    for (let i = 0; i < bucketCount; i++) {
        const start = i * samplesPerBucket;
        const end = Math.min(data.length, start + samplesPerBucket);
        let peak = 0;
        for (let j = start; j < end; j++) {
            const v = Math.abs(data[j]);
            if (v > peak) peak = v;
        }
        peaks[i] = peak;
    }
    return peaks;
}

// Per-track isolated stem audio: the original recording for one separated source
// (bass / drums / "other"), kept from the "Learn a Song" flow so the user can
// hear the real instrument on its track and recreate it by ear. Each is a
// Tone.Player synced + looped exactly like referencePlayer, straight to the
// output (raw audio, not through the instrument bus/compressor). A track plays
// EITHER its synth or its stem (track.source), never both — see playSound and
// updateStemAudibility. Audibility reuses the same mute/solo logic as the synth,
// so soloing a stem-source track = hearing only that real instrument.
const trackStemPlayers = {}; // trackId -> Tone.Player

// Should this track's stem be audible right now? Only when the track is in stem
// mode AND it passes the normal mute/solo test the synth voices use.
function stemShouldPlay(track) {
    return !!track && track.source === 'stem' && isTrackAudible(track);
}

// Loop one stem player over the loop region (stems share the learned clip's t=0
// timeline, so the loop starts at 0) and sync it to the Transport when playing.
function applyStemLoop(trackId) {
    const player = trackStemPlayers[trackId];
    if (!player || !player.buffer.loaded) return;
    player.unsync();
    const bufferDur = player.buffer.duration;
    const loopEnd = Math.min(LOOP_LENGTH_SECONDS(), bufferDur);
    player.loop = true;
    player.loopStart = 0;
    player.loopEnd = loopEnd;
    const track = state.tracks.find(t => t.id === trackId);
    player.mute = !stemShouldPlay(track);
    if (state.isPlaying) player.sync().start(0, 0);
}

function applyStemLoops() {
    Object.keys(trackStemPlayers).forEach(applyStemLoop);
}

// Attach (or replace) the isolated stem recording for a track.
export function setTrackStem(trackId, audioBuffer) {
    disposeTrackStem(trackId);
    const player = new Tone.Player(audioBuffer).toDestination();
    trackStemPlayers[trackId] = player;
    applyStemLoop(trackId);
}

// Refresh every stem player's mute from the current track mute/solo/source.
// Call after any mute, solo, or source toggle.
export function updateStemAudibility() {
    Object.entries(trackStemPlayers).forEach(([trackId, player]) => {
        const track = state.tracks.find(t => t.id === trackId);
        player.mute = !stemShouldPlay(track);
    });
}

// Sync + start all loaded stem players (mirrors startReferenceIfLoaded). Called
// when playback begins so a stem toggled on before pressing play still sounds.
export function startStemsIfLoaded() {
    applyStemLoops();
}

export function hasTrackStem(trackId) {
    return !!trackStemPlayers[trackId];
}

export function disposeTrackStem(trackId) {
    const player = trackStemPlayers[trackId];
    if (player) {
        player.unsync();
        player.dispose();
        delete trackStemPlayers[trackId];
    }
}

export const masterPart = new Tone.Part((time, noteValue) => {
    playSound(noteValue.trackId, noteValue.note, time, noteValue.duration);
}, []).start(0);

// Metronome Synth
const metronomeSynth = new Tone.MembraneSynth({
    pitchDecay: 0.008,
    octaves: 2,
    envelope: { attack: 0.001, decay: 0.1, sustain: 0, release: 0.1 }
}).toDestination();
metronomeSynth.volume.value = -10;

export const masterAnalyser = new Tone.Analyser('waveform', 256);
export const masterRecorder = new Tone.Recorder();
Tone.Destination.connect(masterAnalyser);
Tone.Destination.connect(masterRecorder);

// All instrument voices (synths + drums) run through a gentle bus compressor
// into a brickwall limiter before the output. Without this, many overlapping
// notes from a dense MIDI import sum past 0dB and hard-clip ("notes that don't
// get supported"). The reference player and metronome stay on Destination so
// they aren't pumped by the instrument mix.
export const masterCompressor = new Tone.Compressor({ threshold: -18, ratio: 3, attack: 0.005, release: 0.1 });
export const masterLimiter = new Tone.Limiter(-1);
masterCompressor.connect(masterLimiter);
masterLimiter.toDestination();

// One shared reverb for ALL tracks. Tone.Freeverb is CPU-heavy; spinning up a
// separate one per track (the old design) meant a multi-track MIDI import
// instantiated many at once and overran the audio buffer -> crackling. Now each
// track sends a dry signal straight to the compressor and a wet copy (level set
// by its Air macro) into this single reverb.
export const masterReverb = new Tone.Freeverb({ roomSize: 0.7, dampening: 3000 });
masterReverb.connect(masterCompressor);

export async function initAudio() {
    await Tone.start();
    Tone.Transport.bpm.value = state.song.bpm || 90;
    Tone.Transport.loop = true;
    Tone.Transport.loopStart = 0;
    Tone.Transport.loopEnd = `${LOOP_LENGTH_MEASURES}m`;
    
    masterPart.loop = true;
    masterPart.loopEnd = `${LOOP_LENGTH_MEASURES}m`;
    
    // Initialize synths for existing tracks
    state.tracks.forEach(track => {
        initTrackSynth(track.id, getPreset(track.presetId));
    });
    
    // Metronome tick
    Tone.Transport.scheduleRepeat((time) => {
        if (state.settings.audioPulse) {
            metronomeSynth.triggerAttackRelease("C6", "32n", time);
        }
    }, "4n");
}

export function initTrackSynth(trackId, preset) {
    // Cleanup old synth if it exists. Clear the references after disposing so a
    // later init can't dispose the same (already-disposed) nodes again — Tone
    // throws InvalidAccessError on a double dispose, which previously aborted the
    // instrument change mid-way (the soundfont/drums branches below return without
    // recreating these, so the stale references would otherwise linger).
    if (trackSynths[trackId]) {
        if (trackSynths[trackId].dispose) trackSynths[trackId].dispose();
        else {
            if(trackSynths[trackId].kick) trackSynths[trackId].kick.dispose();
            if(trackSynths[trackId].snare) trackSynths[trackId].snare.dispose();
            if(trackSynths[trackId].hat) trackSynths[trackId].hat.dispose();
        }
        trackSynths[trackId] = null;
    }
    if (trackEffects[trackId]) {
        trackEffects[trackId].vibrato.dispose();
        trackEffects[trackId].filter.dispose();
        trackEffects[trackId].chorus.dispose();
        trackEffects[trackId].reverbSend.dispose();
        delete trackEffects[trackId];
    }

    const track = state.tracks.find(t => t.id === trackId);

    if (track && track.engine === 'soundfont') {
        // SoundFont tracks are voiced by the shared spessasynth engine, not a Tone
        // node. The cleanup above already disposed any previous Tone synth/effects
        // for this track (e.g. when switching from the sampler). Just point the
        // track's MIDI channel at the chosen preset.
        trackSynths[trackId] = null;
        if (track.sfProgram) soundfont.setTrackProgram(trackId, track.sfProgram);
        return;
    }

    if (preset.type === 'drums') {
        trackSynths[trackId] = {
            kick: new Tone.MembraneSynth({ pitchDecay: 0.05, octaves: 4 }).connect(masterCompressor),
            snare: new Tone.NoiseSynth({
                noise: { type: 'white' },
                envelope: { attack: 0.005, decay: 0.2, sustain: 0 }
            }).connect(masterCompressor),
            hat: new Tone.NoiseSynth({
                noise: { type: 'pink' },
                envelope: { attack: 0.005, decay: 0.05, sustain: 0 }
            }).connect(masterCompressor),
            kickNote: 'C1'
        };
        trackSynths[trackId].kick.volume.value = 5;
        trackDrums[trackId] = { ...DEFAULT_DRUM_PARAMS };
        applyDrumParams(trackId);
    } else {
        // Shared voice chain: instrument -> vibrato -> filter -> chorus (gentle
        // warmth) -> master bus, with a parallel send into the shared reverb.
        // Both the oscillator synth and the sampled instruments run through this,
        // so the Bite/Air/Wobble macros shape either engine. No distortion node —
        // distortion was the main source of the old "robotic" sound. The reverb
        // is a single shared node (see masterReverb) rather than one per track,
        // which is what was overloading the audio engine on dense imports.
        const vibrato = new Tone.Vibrato(5, 0);
        const filter = new Tone.Filter(12000, "lowpass");
        const chorus = new Tone.Chorus({ frequency: 0.6, delayTime: 3.5, depth: 0.3, wet: 0.12 }).start();
        const reverbSend = new Tone.Gain(0);

        vibrato.connect(filter);
        filter.connect(chorus);
        chorus.connect(masterCompressor); // dry path
        chorus.connect(reverbSend);       // wet send -> shared reverb
        reverbSend.connect(masterReverb);

        trackEffects[trackId] = { vibrato, filter, chorus, reverbSend };

        const sampleId = track && track.engine === 'sampler' ? track.sampleInstrument : null;

        if (sampleId && isSampleInstrument(sampleId)) {
            // Sampled instrument: a Tone.Sampler streams a handful of real
            // recordings and pitch-shifts between them. Loads async — notes stay
            // silent until the buffers arrive, then onload refreshes the UI.
            const sampler = new Tone.Sampler({
                urls: SAMPLE_INSTRUMENTS[sampleId],
                baseUrl: `${SAMPLE_BASE_URL}${sampleId}/`,
                release: 1,
                onload: () => {
                    if (typeof window !== 'undefined' && window.onSamplerLoaded) {
                        window.onSamplerLoaded(trackId);
                    }
                }
            }).connect(vibrato);
            sampler.volume.value = -6;
            trackSynths[trackId] = sampler;
        } else {
            const synth = new Tone.PolySynth(Tone.Synth).connect(vibrato);
            synth.volume.value = -8;
            trackSynths[trackId] = synth;
        }

        trackMacros[trackId] = {
            osc: preset.osc || 'sine',
            ...DEFAULT_MACROS,
            ...(preset.macros || {})
        };
        applyMacros(trackId);
    }
}

// Is this track's melodic instrument a sampled (recorded) one, vs the synth?
export function isSamplerTrack(trackId) {
    const inst = trackSynths[trackId];
    return !!inst && inst instanceof Tone.Sampler;
}

export function syncAudioPart(notes) {
    masterPart.clear();
    notes.forEach(note => {
        masterPart.add(note.time, note);
    });
}

export function quantize(time) {
    return Tone.Time(time).quantize("32n");
}

export const scales = {
    synth: ["C2", "Eb2", "F2", "G2", "Bb2"], // Generic pentatonic, could be octaved based on track
    drums: ["C2", "D2", "F#2", "F#2", "C2"]
};

export function getTrackScale(track) {
    if (track.type === 'drums') return scales.drums;
    
    // Spread the 5 typing/drawing lanes evenly across the 24-semitone default pitch range
    // starting from the track's base pitch, so drawn notes match imported tracks visually and audibly.
    const minMidi = track.baseMidi || 48;
    const offsets = [2, 7, 12, 17, 22];
    
    return offsets.map(offset => {
        let midi = minMidi + offset;
        // Snap to the song's key if one is detected
        if (state.song && state.song.key && state.song.key.scalePitchClasses) {
            midi = snapMidiToScale(midi, state.song.key.scalePitchClasses);
        }
        return Tone.Frequency(Math.max(0, Math.min(127, midi)), "midi").toNote();
    });
}

// When any track is soloed, only soloed tracks are audible (solo overrides
// mute). This is the focus loop: solo one instrument and recreate it against
// the reference audio without the rest of the mix in the way.
export function isTrackAudible(track) {
    if (!track) return false;
    const anySolo = state.tracks.some(t => t.solo);
    if (anySolo) return !!track.solo;
    return !track.muted;
}

// Push the current mute/solo state to every SoundFont track's channel so even
// already-ringing notes fall silent (the scheduled note-on path is gated by
// isTrackAudible, but sustained voices need the channel-volume gate). Call after
// any mute or solo change.
export function updateSoundFontAudibility() {
    state.tracks.forEach(track => {
        if (track.engine === 'soundfont') soundfont.setChannelAudible(track.id, isTrackAudible(track));
    });
}

export function playSound(trackId, noteKey, time = Tone.now(), duration = "8n") {
    const track = state.tracks.find(t => t.id === trackId);
    if (!isTrackAudible(track)) return;
    // In stem mode the real recording plays instead of this track's instrument.
    if (track && track.source === 'stem') return;

    // SoundFont tracks are voiced by the shared spessasynth engine: schedule the
    // note-on at `time` and the note-off `duration` later, both sample-accurate.
    if (track && track.engine === 'soundfont') {
        const midi = Tone.Frequency(noteKey).toMidi();
        soundfont.noteOn(trackId, midi, 100, time);
        soundfont.noteOff(trackId, midi, time + Tone.Time(duration).toSeconds());
        return;
    }

    const synth = trackSynths[trackId];
    if (!synth) return;

    // Check if it's drums
    if (synth.kick) {
        if (noteKey === "C2" || noteKey === "kick") synth.kick.triggerAttackRelease(synth.kickNote || "C1", "8n", time);
        else if (noteKey === "D2" || noteKey === "snare") synth.snare.triggerAttackRelease("16n", time);
        else if (noteKey === "F#2" || noteKey === "Gb2" || noteKey === "hat") synth.hat.triggerAttackRelease("32n", time);
    } else {
        // A freshly-switched Tone.Sampler streams its buffers from the CDN; until
        // they arrive `loaded` is false and triggering it throws "buffer is not
        // loaded". Skip silently rather than throw inside the Part callback.
        if (synth instanceof Tone.Sampler && !synth.loaded) return;
        synth.triggerAttackRelease(noteKey, duration, time);
    }
}

export function instrumentsStart(trackId, noteVal) {
    const track = state.tracks.find(t => t.id === trackId);
    if (!isTrackAudible(track)) return;
    if (track && track.source === 'stem') return;

    if (track && track.engine === 'soundfont') {
        soundfont.noteOn(trackId, Tone.Frequency(noteVal).toMidi());
        return;
    }

    const synth = trackSynths[trackId];
    if (synth instanceof Tone.Sampler && !synth.loaded) return; // buffers still streaming
    if (synth && synth.triggerAttack) {
        synth.triggerAttack(noteVal, Tone.now());
    }
}

export function instrumentsStop(trackId, noteVal) {
    const track = state.tracks.find(t => t.id === trackId);
    if (track && track.engine === 'soundfont') {
        soundfont.noteOff(trackId, Tone.Frequency(noteVal).toMidi());
        return;
    }

    const synth = trackSynths[trackId];
    if (synth && synth.triggerRelease) {
        synth.triggerRelease(noteVal, Tone.now());
    }
}

// Translate the 5 macro knobs (+ oscillator) into the underlying Tone params.
// Each macro owns a disjoint group of params so they never fight each other.
export function applyMacros(trackId) {
    const synth = trackSynths[trackId];
    const fx = trackEffects[trackId];
    const m = trackMacros[trackId];
    if (!synth || synth.kick || !fx || !m) return;

    if (synth instanceof Tone.Sampler) {
        // Sampled instruments carry their own recorded attack/decay/sustain, so
        // Punch/Body only ride the sampler's fade-in/fade-out envelope around the
        // recording rather than synthesising one.
        synth.attack = 0.005 + (1 - m.punch) * 0.25;
        // Release is capped (~1.5s max, was ~2.9s): a long tail on a recorded
        // instrument meant dense imported parts stacked dozens of ringing voices
        // at once, which summed and clipped into a cracking noise.
        synth.release = 0.3 + m.body * 1.2;
    } else {
        synth.set({
            oscillator: { type: m.osc },
            envelope: {
                // Punch: snappier attack + shorter decay as it rises. Min attack
                // is 5ms (not ~0) so notes don't click.
                attack: 0.005 + (1 - m.punch) * 0.3,
                decay: 0.08 + (1 - m.punch) * 0.5,
                // Body: fuller sustain + longer release. Sustain floors at 0.3 so
                // notes never sound thin/robotic.
                sustain: 0.3 + m.body * 0.65,
                release: 0.2 + m.body * 2.8
            }
        });
    }

    // Bite: filter cutoff, exponential ~300Hz..12kHz (capped below harsh highs),
    // with a fixed low Q so there's no ringing/resonant peak.
    fx.filter.frequency.value = 300 * Math.pow(40, m.bite);
    fx.filter.Q.value = 0.7;
    // Air: how much of this track is sent into the shared reverb (capped so it's
    // never washed out). Room size is now a fixed global on masterReverb.
    fx.reverbSend.gain.value = m.air * 0.6;
    // Wobble: vibrato depth + rate.
    fx.vibrato.depth.value = m.wobble * 0.4;
    fx.vibrato.frequency.value = 4 + m.wobble * 3;
}

export function setMacro(trackId, key, value) {
    const m = trackMacros[trackId];
    if (!m) return;
    m[key] = value;
    applyMacros(trackId);
}

export function setOscillator(trackId, osc) {
    const m = trackMacros[trackId];
    if (!m) return;
    m.osc = osc;
    applyMacros(trackId);
}

export function getMacros(trackId) {
    const m = trackMacros[trackId];
    return m ? { ...m } : null;
}

// Drum tuning: 3 feel-based knobs mapped onto the kick/snare/hat synths.
export function applyDrumParams(trackId) {
    const kit = trackSynths[trackId];
    const d = trackDrums[trackId];
    if (!kit || !kit.kick || !d) return;

    // Kick Pitch: base note C0..C2 (lower = deeper sub).
    const kickMidi = Math.round(12 + d.kickPitch * 24); // C0(12)..C2(36)
    kit.kickNote = Tone.Frequency(kickMidi, 'midi').toNote();
    // Boom: pitch sweep length + octave range -> longer, boomier kick.
    kit.kick.set({ pitchDecay: 0.01 + d.boom * 0.18, octaves: 2 + d.boom * 6 });
    // Snap: snare + hat decay (more snap = shorter, tighter).
    kit.snare.set({ envelope: { decay: 0.35 - d.snap * 0.3 } });
    kit.hat.set({ envelope: { decay: 0.12 - d.snap * 0.1 } });
}

export function setDrumParam(trackId, key, value) {
    const d = trackDrums[trackId];
    if (!d) return;
    d[key] = value;
    applyDrumParams(trackId);
}

export function getDrumParams(trackId) {
    const d = trackDrums[trackId];
    return d ? { ...d } : null;
}
