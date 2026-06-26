// User-imported SoundFont (.sf2/.sf3/.dls) playback. The built-in palette
// (20 orchestral samples + one oscillator synth) doesn't cover the warm/detuned
// pads, keys, bells and leads this kind of music needs, so a track can instead be
// powered by a preset from a SoundFont the user drops in — one file is a whole
// bank of playable instruments.
//
// All SoundFont tracks share ONE spessasynth WorkletSynthesizer (the worklet runs
// the SF2 engine off the main thread). Each track is assigned its own MIDI channel
// with a chosen preset; notes are scheduled sample-accurately through the synth's
// { time } option, driven from the same Tone.Part scheduler as the built-in voices
// (see playSound in audio.js). Output goes straight to the audio context
// destination, like the reference player — independent of the Tone instrument bus.
//
// The engine runs on its OWN native AudioContext rather than Tone's: Tone 15 wraps
// its context with standardized-audio-context, and spessasynth builds its node with
// the native `AudioWorkletNode` constructor, which rejects that polyfill wrapper
// ("Could not create the AudioWorkletNode"). Two contexts means two clocks, so the
// absolute schedule times Tone hands us (in Tone's clock) are converted per note to
// this engine's clock in toEngineOpts() — see there.
import * as Tone from 'tone';
import { WorkletSynthesizer } from 'spessasynth_lib';
// Vite emits the worklet processor as a served asset and gives us its URL.
import workletUrl from 'spessasynth_lib/dist/spessasynth_processor.min.js?url';

// Standard MIDI controllers: bank select (to reach a specific preset) and channel
// volume (used as the mute/solo gate so even ringing notes fall silent).
const CC_BANK_MSB = 0;
const CC_BANK_LSB = 32;
const CC_VOLUME = 7;

// GM puts percussion on channel 9; skip it so melodic presets play normally.
const MELODIC_CHANNELS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15];

let synth = null;
let engineCtx = null;        // The engine's own native AudioContext.
let ready = null;            // Promise resolving once the worklet + synth are up.
const banks = [];            // [{ id, name, presets: [{ bankMSB, bankLSB, program, name, isDrum }] }]
const trackChannels = {};    // trackId -> MIDI channel
let nextBankId = 0;

const patchKey = (p) => `${p.bankMSB}:${p.bankLSB}:${p.program}:${p.name}`;

export function isSoundFontEngineReady() { return !!synth; }

// Boot the shared synth once (idempotent). Spins up a dedicated native
// AudioContext (Tone's is a standardized-audio-context wrapper the native worklet
// node won't accept). Callers reach here from user-gesture flows (SoundFont load /
// preset pick, both after Tone.start()), so resuming the fresh context is allowed.
export function initSoundFontEngine() {
    if (ready) return ready;
    ready = (async () => {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        engineCtx = new Ctx();
        if (engineCtx.state === 'suspended') {
            try { await engineCtx.resume(); } catch (_) { /* resumes on next gesture */ }
        }
        await engineCtx.audioWorklet.addModule(workletUrl);
        synth = new WorkletSynthesizer(engineCtx);
        await synth.isReady;
        synth.connect(engineCtx.destination);
    })();
    return ready;
}

// Convert an absolute schedule time from Tone's clock into this engine's clock.
// The two AudioContexts share the machine's audio hardware rate but started at
// different moments, so we express the target as a delta from "now" and re-anchor
// it on the engine's currentTime — robust to the (near-constant) offset between
// them. Returns the spessasynth options object, or undefined to play immediately.
function toEngineOpts(time) {
    if (time == null || !engineCtx) return undefined;
    const toneNow = Tone.getContext().rawContext.currentTime;
    return { time: engineCtx.currentTime + (time - toneNow) };
}

// Resolve once the synth's preset list contains entries that weren't there
// `before` the load — i.e. the bank we just added has finished parsing in the
// worklet. The worklet syncs its list to the main thread via presetListChange,
// but big SF2/SF3 files can take many seconds to parse, so we also poll the list
// as a backstop (in case the event doesn't land) and only give up after a
// generous bound. Resolving on "new presets appeared" instead of a fixed delay is
// what stops a slow font from being falsely reported as containing no presets.
function waitForNewPresets(before, timeoutMs = 30000) {
    const hasNew = (list) => (list || []).some((p) => !before.has(patchKey(p)));
    return new Promise((resolve) => {
        const evId = `musip-${Math.random().toString(36).slice(2)}`;
        let done = false;
        let poll = null;
        const finish = (list) => {
            if (done) return;
            done = true;
            if (poll) clearInterval(poll);
            try { synth.eventHandler.removeEvent('presetListChange', evId); } catch (_) { /* noop */ }
            resolve(list || synth.presetList || []);
        };
        // Already there (event may have landed during addSoundBank): take it now.
        if (hasNew(synth.presetList)) { finish(synth.presetList); return; }
        synth.eventHandler.addEvent('presetListChange', evId, (list) => {
            if (hasNew(list)) finish(list);
        });
        poll = setInterval(() => { if (hasNew(synth.presetList)) finish(synth.presetList); }, 150);
        // Give up eventually; resolve with whatever we have so the caller reports
        // an honest "no presets" only when none ever arrived.
        setTimeout(() => finish(synth.presetList), timeoutMs);
    });
}

// Load a SoundFont from a dropped file's ArrayBuffer. Each bank gets a distinct
// bankOffset so multiple loaded fonts don't collide in bank/program space; the
// bank's own presets are isolated by diffing the synth's global preset list before
// and after the load. Returns { id, name, presets }.
export async function loadSoundFont(arrayBuffer, name) {
    await initSoundFontEngine();
    const id = `sf-${nextBankId++}`;
    const before = new Set((synth.presetList || []).map(patchKey));
    const newPresets = waitForNewPresets(before); // listen before loading
    await synth.soundBankManager.addSoundBank(arrayBuffer, id, banks.length);
    const full = await newPresets;
    const presets = full
        .filter((p) => !before.has(patchKey(p)))
        .map((p) => ({ bankMSB: p.bankMSB, bankLSB: p.bankLSB, program: p.program, name: p.name, isDrum: p.isDrum }));
    const bank = { id, name: name || id, presets };
    banks.push(bank);
    return bank;
}

export function listSoundFonts() { return banks.map((b) => ({ id: b.id, name: b.name })); }
export function getPresets(id) {
    const bank = banks.find((b) => b.id === id);
    return bank ? bank.presets : [];
}

function assignChannel(trackId) {
    if (trackChannels[trackId] != null) return trackChannels[trackId];
    const used = new Set(Object.values(trackChannels));
    const free = MELODIC_CHANNELS.find((c) => !used.has(c));
    // Roll over if every channel is taken (>15 SoundFont tracks — unlikely here).
    const ch = free != null ? free : MELODIC_CHANNELS[Object.keys(trackChannels).length % MELODIC_CHANNELS.length];
    trackChannels[trackId] = ch;
    return ch;
}

export function releaseChannel(trackId) {
    const ch = trackChannels[trackId];
    if (ch != null && synth) synth.controllerChange(ch, CC_VOLUME, 0);
    delete trackChannels[trackId];
}

// Point a track's channel at a preset: bank select, then program change. The
// channel is reserved synchronously (before any await) so a preview note fired
// right after this call still finds the track's channel; the actual MIDI messages
// are sent once the engine is ready (a microtask later, well before any scheduled
// note sounds).
export function setTrackProgram(trackId, patch) {
    const ch = assignChannel(trackId);
    return initSoundFontEngine().then(() => {
        synth.controllerChange(ch, CC_BANK_MSB, patch.bankMSB || 0);
        synth.controllerChange(ch, CC_BANK_LSB, patch.bankLSB || 0);
        synth.programChange(ch, patch.program || 0);
        synth.controllerChange(ch, CC_VOLUME, 100);
    });
}

// `time` is an absolute time in Tone's clock (the value Tone's Part hands us); it's
// re-anchored onto the engine's clock so the synth schedules it sample-accurately.
export function noteOn(trackId, midi, velocity = 100, time) {
    const ch = trackChannels[trackId];
    if (!synth || ch == null) return;
    synth.noteOn(ch, Math.round(midi), Math.round(velocity), toEngineOpts(time));
}

export function noteOff(trackId, midi, time) {
    const ch = trackChannels[trackId];
    if (!synth || ch == null) return;
    synth.noteOff(ch, Math.round(midi), toEngineOpts(time));
}

// Mute/solo gate: channel volume to 0 silences even sustained notes.
export function setChannelAudible(trackId, audible) {
    const ch = trackChannels[trackId];
    if (!synth || ch == null) return;
    synth.controllerChange(ch, CC_VOLUME, audible ? 100 : 0);
}

export function stopAll() {
    if (synth) synth.stopAll(true);
}
