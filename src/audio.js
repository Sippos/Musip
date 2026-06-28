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

export const MACRO_KEYS = ['body', 'bite', 'air', 'punch', 'wobble', 'crush', 'stemPitch'];
export const DEFAULT_DRUM_PARAMS = { kickPitch: 0.3, boom: 0.4, snap: 0.5, crush: 0.0, stemPitch: 0.0 };

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
export const trackStemEffects = {}; // trackId -> { pitchShift, bitcrusher, distortion }
export const trackChopPlayers = {}; // trackId -> Tone.Player (monophonic, for choking chops)

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
    
    const pitchShift = new Tone.PitchShift(0);
    const bitcrusher = new Tone.BitCrusher(8);
    const distortion = new Tone.Distortion(0);
    
    pitchShift.connect(bitcrusher);
    bitcrusher.connect(distortion);
    distortion.connect(masterCompressor); // Connect to master bus so it is limited alongside synths
    
    trackStemEffects[trackId] = { pitchShift, bitcrusher, distortion };
    
    const player = new Tone.Player(audioBuffer).connect(pitchShift);
    trackStemPlayers[trackId] = player;
    applyStemLoop(trackId);
    
    // Chop players use vinyl-style pitch (playbackRate), so bypass PitchShift
    const chopPlayer = new Tone.Player(audioBuffer).connect(bitcrusher);
    trackChopPlayers[trackId] = chopPlayer;
    
    // Apply macros to stem immediately
    applyStemFx(trackId);
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

export function updateChopSpeed(trackId) {
    const player = trackChopPlayers[trackId];
    const track = state.tracks.find(t => t.id === trackId);
    if (player && track && track.engine === 'chop') {
        player.playbackRate = track.samplePlaybackRate || 1.0;
    }
}

export function getChopBuffer(trackId) {
    const player = trackChopPlayers[trackId];
    return player ? player.buffer : null;
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
    const chopPlayer = trackChopPlayers[trackId];
    if (chopPlayer) {
        chopPlayer.dispose();
        delete trackChopPlayers[trackId];
    }
    const fx = trackStemEffects[trackId];
    if (fx) {
        fx.pitchShift.dispose();
        fx.bitcrusher.dispose();
        fx.distortion.dispose();
        delete trackStemEffects[trackId];
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
        if(trackEffects[trackId].vibrato) trackEffects[trackId].vibrato.dispose();
        if(trackEffects[trackId].filter) trackEffects[trackId].filter.dispose();
        if(trackEffects[trackId].chorus) trackEffects[trackId].chorus.dispose();
        if(trackEffects[trackId].reverbSend) trackEffects[trackId].reverbSend.dispose();
        if(trackEffects[trackId].bitcrusher) trackEffects[trackId].bitcrusher.dispose();
        if(trackEffects[trackId].distortion) trackEffects[trackId].distortion.dispose();
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
        const bitcrusher = new Tone.BitCrusher(8);
        const distortion = new Tone.Distortion(0);
        bitcrusher.connect(distortion);
        distortion.connect(masterCompressor);

        trackEffects[trackId] = { bitcrusher, distortion };

        trackSynths[trackId] = {
            kick: new Tone.MembraneSynth({ pitchDecay: 0.05, octaves: 4 }).connect(bitcrusher),
            snare: new Tone.NoiseSynth({
                noise: { type: 'white' },
                envelope: { attack: 0.005, decay: 0.2, sustain: 0 }
            }).connect(bitcrusher),
            hat: new Tone.NoiseSynth({
                noise: { type: 'pink' },
                envelope: { attack: 0.005, decay: 0.05, sustain: 0 }
            }).connect(bitcrusher),
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
        const bitcrusher = new Tone.BitCrusher(8);
        const distortion = new Tone.Distortion(0);
        const chorus = new Tone.Chorus({ frequency: 0.6, delayTime: 3.5, depth: 0.3, wet: 0.12 }).start();
        const reverbSend = new Tone.Gain(0);

        vibrato.connect(filter);
        filter.connect(bitcrusher);
        bitcrusher.connect(distortion);
        distortion.connect(chorus);
        chorus.connect(masterCompressor); // dry path
        chorus.connect(reverbSend);       // wet send -> shared reverb
        reverbSend.connect(masterReverb);

        trackEffects[trackId] = { vibrato, filter, bitcrusher, distortion, chorus, reverbSend };

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
    if (track.engine === 'chop') {
        const notes = [];
        const baseMidi = track.baseMidi || 48; // C3
        for (let i = 0; i < 16; i++) {
            notes.push(Tone.Frequency(baseMidi + i, "midi").toNote());
        }
        return notes;
    }
    
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

    if (track && track.engine === 'chop') {
        const player = trackChopPlayers[trackId];
        if (!player || !player.buffer.loaded) return;
        
        const midi = Tone.Frequency(noteKey).toMidi();
        const baseMidi = track.baseMidi || 48;
        const sliceIndex = Math.max(0, Math.min(15, midi - baseMidi));
        
        let offset, maxDur;
        if (track.slices && track.slices.length > sliceIndex) {
            const slice = track.slices[sliceIndex];
            offset = slice.startTime;
            maxDur = slice.endTime - slice.startTime;
        } else {
            const sliceLength = player.buffer.duration / 16;
            offset = sliceIndex * sliceLength;
            maxDur = sliceLength;
        }
        
        const playbackRate = track.samplePlaybackRate || 1.0;
        const maxPlayTime = maxDur / playbackRate;
        const finalDuration = maxPlayTime; // Play the full slice, choked by the next note
        
        // Stop the player first to enforce choking, then start it
        player.stop(time);
        player.start(time, offset, finalDuration);
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

    if (track && track.engine === 'chop') {
        const player = trackChopPlayers[trackId];
        if (!player || !player.buffer.loaded) return;
        
        const midi = Tone.Frequency(noteVal).toMidi();
        const baseMidi = track.baseMidi || 48;
        const sliceIndex = Math.max(0, Math.min(15, midi - baseMidi));
        
        let offset, maxDur;
        if (track.slices && track.slices.length > sliceIndex) {
            const slice = track.slices[sliceIndex];
            offset = slice.startTime;
            maxDur = slice.endTime - slice.startTime;
        } else {
            const sliceLength = player.buffer.duration / 16;
            offset = sliceIndex * sliceLength;
            maxDur = sliceLength;
        }
        
        const playbackRate = track.samplePlaybackRate || 1.0;
        const maxPlayTime = maxDur / playbackRate;
        
        // Stop the player first to enforce choking
        player.stop(Tone.now());
        player.start(Tone.now(), offset, maxPlayTime);
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

    if (track && track.engine === 'chop') {
        const player = trackChopPlayers[trackId];
        if (player) player.stop(Tone.now());
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
    
    // Crush: bitcrusher bits (8 down to 2) and distortion amount
    fx.bitcrusher.bits.value = 8 - Math.floor(m.crush * 6); // 8 -> 2
    fx.distortion.distortion = m.crush * 0.8;
    
    applyStemFx(trackId);
}

export function applyStemFx(trackId) {
    const fx = trackStemEffects[trackId];
    if (!fx) return;
    
    const m = trackMacros[trackId];
    const d = trackDrums[trackId];
    const crush = m ? m.crush : (d ? d.crush : 0);
    const stemPitch = m ? m.stemPitch : (d ? d.stemPitch : 0);
    
    // Convert -1..1 stemPitch slider to semitones (-12..12) if it was designed 0..1? 
    // Wait, the slider will be 0..1 in state.js or -12..12?
    // DEFAULT_MACROS in state.js has stemPitch: 0.0. A 0..1 slider is typical. 
    // Let's assume slider is -1..1 or 0..1? Standard macros are 0..1. 
    // If stemPitch is -12..12, we can just use the value. 
    // Let's assume the UI sends the raw semitone value (-12 to +12) or we scale it.
    // If it's a standard macro 0..1, then (stemPitch - 0.5) * 24 maps to -12..+12.
    // I'll assume the UI sends -12 to +12 directly, so stemPitch is the exact semitone value.
    fx.pitchShift.pitch = stemPitch;
    fx.bitcrusher.bits.value = 8 - Math.floor(crush * 6);
    fx.distortion.distortion = crush * 0.8;
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
    
    const fx = trackEffects[trackId];
    if (fx && fx.bitcrusher) {
        fx.bitcrusher.bits.value = 8 - Math.floor(d.crush * 6);
        fx.distortion.distortion = d.crush * 0.8;
    }
    
    applyStemFx(trackId);
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
