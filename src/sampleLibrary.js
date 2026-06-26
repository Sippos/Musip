// Realistic, recorded-instrument samples for the "sampled" sound engine.
//
// These are the multi-sampled instruments from the open tonejs-instruments
// project (N.P. Brosowsky, MIT), hosted on GitHub Pages. A Tone.Sampler loads a
// handful of these per instrument and pitch-shifts between them, so a track can
// sound like a real piano/bass/guitar/strings instead of a raw oscillator.
//
// Note->file maps below are copied verbatim from the upstream library so every
// URL resolves (a wrong filename is a silent 404 = a dead instrument). The
// upstream `.[mp3|ogg]` placeholder is materialised to `.mp3` here.
//
// Tradeoff: samples stream from a CDN, so the first time a track uses an
// instrument it needs a network connection. The sampler loads asynchronously
// and notes simply stay silent until the buffers arrive; the engine falls back
// to the synth if a track has no matching sampled instrument.

export const SAMPLE_BASE_URL = 'https://nbrosowsky.github.io/tonejs-instruments/samples/';

// Raw upstream maps (values still hold the `.[mp3|ogg]` placeholder).
const RAW = {
    'bass-electric': { 'A#1': 'As1.[mp3|ogg]', 'A#2': 'As2.[mp3|ogg]', 'A#3': 'As3.[mp3|ogg]', 'A#4': 'As4.[mp3|ogg]', 'C#1': 'Cs1.[mp3|ogg]', 'C#2': 'Cs2.[mp3|ogg]', 'C#3': 'Cs3.[mp3|ogg]', 'C#4': 'Cs4.[mp3|ogg]', 'E1': 'E1.[mp3|ogg]', 'E2': 'E2.[mp3|ogg]', 'E3': 'E3.[mp3|ogg]', 'E4': 'E4.[mp3|ogg]', 'G1': 'G1.[mp3|ogg]', 'G2': 'G2.[mp3|ogg]', 'G3': 'G3.[mp3|ogg]', 'G4': 'G4.[mp3|ogg]' },
    'bassoon': { 'A4': 'A4.[mp3|ogg]', 'C3': 'C3.[mp3|ogg]', 'C4': 'C4.[mp3|ogg]', 'C5': 'C5.[mp3|ogg]', 'E4': 'E4.[mp3|ogg]', 'G2': 'G2.[mp3|ogg]', 'G3': 'G3.[mp3|ogg]', 'G4': 'G4.[mp3|ogg]', 'A2': 'A2.[mp3|ogg]', 'A3': 'A3.[mp3|ogg]' },
    'cello': { 'E3': 'E3.[mp3|ogg]', 'E4': 'E4.[mp3|ogg]', 'F2': 'F2.[mp3|ogg]', 'F3': 'F3.[mp3|ogg]', 'F4': 'F4.[mp3|ogg]', 'F#3': 'Fs3.[mp3|ogg]', 'F#4': 'Fs4.[mp3|ogg]', 'G2': 'G2.[mp3|ogg]', 'G3': 'G3.[mp3|ogg]', 'G4': 'G4.[mp3|ogg]', 'G#2': 'Gs2.[mp3|ogg]', 'G#3': 'Gs3.[mp3|ogg]', 'G#4': 'Gs4.[mp3|ogg]', 'A2': 'A2.[mp3|ogg]', 'A3': 'A3.[mp3|ogg]', 'A4': 'A4.[mp3|ogg]', 'A#2': 'As2.[mp3|ogg]', 'A#3': 'As3.[mp3|ogg]', 'B2': 'B2.[mp3|ogg]', 'B3': 'B3.[mp3|ogg]', 'B4': 'B4.[mp3|ogg]', 'C2': 'C2.[mp3|ogg]', 'C3': 'C3.[mp3|ogg]', 'C4': 'C4.[mp3|ogg]', 'C5': 'C5.[mp3|ogg]', 'C#3': 'Cs3.[mp3|ogg]', 'C#4': 'Cs4.[mp3|ogg]', 'D2': 'D2.[mp3|ogg]', 'D3': 'D3.[mp3|ogg]', 'D4': 'D4.[mp3|ogg]', 'D#2': 'Ds2.[mp3|ogg]', 'D#3': 'Ds3.[mp3|ogg]', 'D#4': 'Ds4.[mp3|ogg]', 'E2': 'E2.[mp3|ogg]' },
    'clarinet': { 'D4': 'D4.[mp3|ogg]', 'D5': 'D5.[mp3|ogg]', 'D6': 'D6.[mp3|ogg]', 'F3': 'F3.[mp3|ogg]', 'F4': 'F4.[mp3|ogg]', 'F5': 'F5.[mp3|ogg]', 'F#6': 'Fs6.[mp3|ogg]', 'A#3': 'As3.[mp3|ogg]', 'A#4': 'As4.[mp3|ogg]', 'A#5': 'As5.[mp3|ogg]', 'D3': 'D3.[mp3|ogg]' },
    'contrabass': { 'C2': 'C2.[mp3|ogg]', 'C#3': 'Cs3.[mp3|ogg]', 'D2': 'D2.[mp3|ogg]', 'E2': 'E2.[mp3|ogg]', 'E3': 'E3.[mp3|ogg]', 'F#1': 'Fs1.[mp3|ogg]', 'F#2': 'Fs2.[mp3|ogg]', 'G1': 'G1.[mp3|ogg]', 'G#2': 'Gs2.[mp3|ogg]', 'G#3': 'Gs3.[mp3|ogg]', 'A2': 'A2.[mp3|ogg]', 'A#1': 'As1.[mp3|ogg]', 'B3': 'B3.[mp3|ogg]' },
    'flute': { 'A6': 'A6.[mp3|ogg]', 'C4': 'C4.[mp3|ogg]', 'C5': 'C5.[mp3|ogg]', 'C6': 'C6.[mp3|ogg]', 'C7': 'C7.[mp3|ogg]', 'E4': 'E4.[mp3|ogg]', 'E5': 'E5.[mp3|ogg]', 'E6': 'E6.[mp3|ogg]', 'A4': 'A4.[mp3|ogg]', 'A5': 'A5.[mp3|ogg]' },
    'french-horn': { 'D3': 'D3.[mp3|ogg]', 'D5': 'D5.[mp3|ogg]', 'D#2': 'Ds2.[mp3|ogg]', 'F3': 'F3.[mp3|ogg]', 'F5': 'F5.[mp3|ogg]', 'G2': 'G2.[mp3|ogg]', 'A1': 'A1.[mp3|ogg]', 'A3': 'A3.[mp3|ogg]', 'C2': 'C2.[mp3|ogg]', 'C4': 'C4.[mp3|ogg]' },
    'guitar-acoustic': { 'F4': 'F4.[mp3|ogg]', 'F#2': 'Fs2.[mp3|ogg]', 'F#3': 'Fs3.[mp3|ogg]', 'F#4': 'Fs4.[mp3|ogg]', 'G2': 'G2.[mp3|ogg]', 'G3': 'G3.[mp3|ogg]', 'G4': 'G4.[mp3|ogg]', 'G#2': 'Gs2.[mp3|ogg]', 'G#3': 'Gs3.[mp3|ogg]', 'G#4': 'Gs4.[mp3|ogg]', 'A2': 'A2.[mp3|ogg]', 'A3': 'A3.[mp3|ogg]', 'A4': 'A4.[mp3|ogg]', 'A#2': 'As2.[mp3|ogg]', 'A#3': 'As3.[mp3|ogg]', 'A#4': 'As4.[mp3|ogg]', 'B2': 'B2.[mp3|ogg]', 'B3': 'B3.[mp3|ogg]', 'B4': 'B4.[mp3|ogg]', 'C3': 'C3.[mp3|ogg]', 'C4': 'C4.[mp3|ogg]', 'C5': 'C5.[mp3|ogg]', 'C#3': 'Cs3.[mp3|ogg]', 'C#4': 'Cs4.[mp3|ogg]', 'C#5': 'Cs5.[mp3|ogg]', 'D2': 'D2.[mp3|ogg]', 'D3': 'D3.[mp3|ogg]', 'D4': 'D4.[mp3|ogg]', 'D5': 'D5.[mp3|ogg]', 'D#2': 'Ds2.[mp3|ogg]', 'D#3': 'Ds3.[mp3|ogg]', 'E2': 'E2.[mp3|ogg]', 'E3': 'E3.[mp3|ogg]', 'E4': 'E4.[mp3|ogg]', 'F2': 'F2.[mp3|ogg]', 'F3': 'F3.[mp3|ogg]' },
    'guitar-electric': { 'D#3': 'Ds3.[mp3|ogg]', 'D#4': 'Ds4.[mp3|ogg]', 'D#5': 'Ds5.[mp3|ogg]', 'E2': 'E2.[mp3|ogg]', 'F#2': 'Fs2.[mp3|ogg]', 'F#3': 'Fs3.[mp3|ogg]', 'F#4': 'Fs4.[mp3|ogg]', 'F#5': 'Fs5.[mp3|ogg]', 'A2': 'A2.[mp3|ogg]', 'A3': 'A3.[mp3|ogg]', 'A4': 'A4.[mp3|ogg]', 'A5': 'A5.[mp3|ogg]', 'C3': 'C3.[mp3|ogg]', 'C4': 'C4.[mp3|ogg]', 'C5': 'C5.[mp3|ogg]', 'C6': 'C6.[mp3|ogg]', 'C#2': 'Cs2.[mp3|ogg]' },
    'guitar-nylon': { 'F#2': 'Fs2.[mp3|ogg]', 'F#3': 'Fs3.[mp3|ogg]', 'F#4': 'Fs4.[mp3|ogg]', 'F#5': 'Fs5.[mp3|ogg]', 'G3': 'G3.[mp3|ogg]', 'G#2': 'Gs2.[mp3|ogg]', 'G#4': 'Gs4.[mp3|ogg]', 'G#5': 'Gs5.[mp3|ogg]', 'A2': 'A2.[mp3|ogg]', 'A3': 'A3.[mp3|ogg]', 'A4': 'A4.[mp3|ogg]', 'A5': 'A5.[mp3|ogg]', 'A#5': 'As5.[mp3|ogg]', 'B1': 'B1.[mp3|ogg]', 'B2': 'B2.[mp3|ogg]', 'B3': 'B3.[mp3|ogg]', 'B4': 'B4.[mp3|ogg]', 'C#3': 'Cs3.[mp3|ogg]', 'C#4': 'Cs4.[mp3|ogg]', 'C#5': 'Cs5.[mp3|ogg]', 'D2': 'D2.[mp3|ogg]', 'D3': 'D3.[mp3|ogg]', 'D5': 'D5.[mp3|ogg]', 'D#4': 'Ds4.[mp3|ogg]', 'E2': 'E2.[mp3|ogg]', 'E3': 'E3.[mp3|ogg]', 'E4': 'E4.[mp3|ogg]', 'E5': 'E5.[mp3|ogg]' },
    'harmonium': { 'C2': 'C2.[mp3|ogg]', 'C3': 'C3.[mp3|ogg]', 'C4': 'C4.[mp3|ogg]', 'C5': 'C5.[mp3|ogg]', 'C#2': 'Cs2.[mp3|ogg]', 'C#3': 'Cs3.[mp3|ogg]', 'C#4': 'Cs4.[mp3|ogg]', 'C#5': 'Cs5.[mp3|ogg]', 'D2': 'D2.[mp3|ogg]', 'D3': 'D3.[mp3|ogg]', 'D4': 'D4.[mp3|ogg]', 'D5': 'D5.[mp3|ogg]', 'D#2': 'Ds2.[mp3|ogg]', 'D#3': 'Ds3.[mp3|ogg]', 'D#4': 'Ds4.[mp3|ogg]', 'E2': 'E2.[mp3|ogg]', 'E3': 'E3.[mp3|ogg]', 'E4': 'E4.[mp3|ogg]', 'F2': 'F2.[mp3|ogg]', 'F3': 'F3.[mp3|ogg]', 'F4': 'F4.[mp3|ogg]', 'F#2': 'Fs2.[mp3|ogg]', 'F#3': 'Fs3.[mp3|ogg]', 'G2': 'G2.[mp3|ogg]', 'G3': 'G3.[mp3|ogg]', 'G4': 'G4.[mp3|ogg]', 'G#2': 'Gs2.[mp3|ogg]', 'G#3': 'Gs3.[mp3|ogg]', 'G#4': 'Gs4.[mp3|ogg]', 'A2': 'A2.[mp3|ogg]', 'A3': 'A3.[mp3|ogg]', 'A4': 'A4.[mp3|ogg]', 'A#2': 'As2.[mp3|ogg]', 'A#3': 'As3.[mp3|ogg]', 'A#4': 'As4.[mp3|ogg]' },
    'harp': { 'C5': 'C5.[mp3|ogg]', 'D2': 'D2.[mp3|ogg]', 'D4': 'D4.[mp3|ogg]', 'D6': 'D6.[mp3|ogg]', 'D7': 'D7.[mp3|ogg]', 'E1': 'E1.[mp3|ogg]', 'E3': 'E3.[mp3|ogg]', 'E5': 'E5.[mp3|ogg]', 'F2': 'F2.[mp3|ogg]', 'F4': 'F4.[mp3|ogg]', 'F6': 'F6.[mp3|ogg]', 'F7': 'F7.[mp3|ogg]', 'G1': 'G1.[mp3|ogg]', 'G3': 'G3.[mp3|ogg]', 'G5': 'G5.[mp3|ogg]', 'A2': 'A2.[mp3|ogg]', 'A4': 'A4.[mp3|ogg]', 'A6': 'A6.[mp3|ogg]', 'B1': 'B1.[mp3|ogg]', 'B3': 'B3.[mp3|ogg]', 'B5': 'B5.[mp3|ogg]', 'B6': 'B6.[mp3|ogg]', 'C3': 'C3.[mp3|ogg]' },
    'organ': { 'C3': 'C3.[mp3|ogg]', 'C4': 'C4.[mp3|ogg]', 'C5': 'C5.[mp3|ogg]', 'C6': 'C6.[mp3|ogg]', 'D#1': 'Ds1.[mp3|ogg]', 'D#2': 'Ds2.[mp3|ogg]', 'D#3': 'Ds3.[mp3|ogg]', 'D#4': 'Ds4.[mp3|ogg]', 'D#5': 'Ds5.[mp3|ogg]', 'F#1': 'Fs1.[mp3|ogg]', 'F#2': 'Fs2.[mp3|ogg]', 'F#3': 'Fs3.[mp3|ogg]', 'F#4': 'Fs4.[mp3|ogg]', 'F#5': 'Fs5.[mp3|ogg]', 'A1': 'A1.[mp3|ogg]', 'A2': 'A2.[mp3|ogg]', 'A3': 'A3.[mp3|ogg]', 'A4': 'A4.[mp3|ogg]', 'A5': 'A5.[mp3|ogg]', 'C1': 'C1.[mp3|ogg]', 'C2': 'C2.[mp3|ogg]' },
    'piano': { 'A7': 'A7.[mp3|ogg]', 'A1': 'A1.[mp3|ogg]', 'A2': 'A2.[mp3|ogg]', 'A3': 'A3.[mp3|ogg]', 'A4': 'A4.[mp3|ogg]', 'A5': 'A5.[mp3|ogg]', 'A6': 'A6.[mp3|ogg]', 'A#7': 'As7.[mp3|ogg]', 'A#1': 'As1.[mp3|ogg]', 'A#2': 'As2.[mp3|ogg]', 'A#3': 'As3.[mp3|ogg]', 'A#4': 'As4.[mp3|ogg]', 'A#5': 'As5.[mp3|ogg]', 'A#6': 'As6.[mp3|ogg]', 'B7': 'B7.[mp3|ogg]', 'B1': 'B1.[mp3|ogg]', 'B2': 'B2.[mp3|ogg]', 'B3': 'B3.[mp3|ogg]', 'B4': 'B4.[mp3|ogg]', 'B5': 'B5.[mp3|ogg]', 'B6': 'B6.[mp3|ogg]', 'C7': 'C7.[mp3|ogg]', 'C1': 'C1.[mp3|ogg]', 'C2': 'C2.[mp3|ogg]', 'C3': 'C3.[mp3|ogg]', 'C4': 'C4.[mp3|ogg]', 'C5': 'C5.[mp3|ogg]', 'C6': 'C6.[mp3|ogg]', 'C#7': 'Cs7.[mp3|ogg]', 'C#1': 'Cs1.[mp3|ogg]', 'C#2': 'Cs2.[mp3|ogg]', 'C#3': 'Cs3.[mp3|ogg]', 'C#4': 'Cs4.[mp3|ogg]', 'C#5': 'Cs5.[mp3|ogg]', 'C#6': 'Cs6.[mp3|ogg]', 'D7': 'D7.[mp3|ogg]', 'D1': 'D1.[mp3|ogg]', 'D2': 'D2.[mp3|ogg]', 'D3': 'D3.[mp3|ogg]', 'D4': 'D4.[mp3|ogg]', 'D5': 'D5.[mp3|ogg]', 'D6': 'D6.[mp3|ogg]', 'D#7': 'Ds7.[mp3|ogg]', 'D#1': 'Ds1.[mp3|ogg]', 'D#2': 'Ds2.[mp3|ogg]', 'D#3': 'Ds3.[mp3|ogg]', 'D#4': 'Ds4.[mp3|ogg]', 'D#5': 'Ds5.[mp3|ogg]', 'D#6': 'Ds6.[mp3|ogg]', 'E7': 'E7.[mp3|ogg]', 'E1': 'E1.[mp3|ogg]', 'E2': 'E2.[mp3|ogg]', 'E3': 'E3.[mp3|ogg]', 'E4': 'E4.[mp3|ogg]', 'E5': 'E5.[mp3|ogg]', 'E6': 'E6.[mp3|ogg]', 'F7': 'F7.[mp3|ogg]', 'F1': 'F1.[mp3|ogg]', 'F2': 'F2.[mp3|ogg]', 'F3': 'F3.[mp3|ogg]', 'F4': 'F4.[mp3|ogg]', 'F5': 'F5.[mp3|ogg]', 'F6': 'F6.[mp3|ogg]', 'F#7': 'Fs7.[mp3|ogg]', 'F#1': 'Fs1.[mp3|ogg]', 'F#2': 'Fs2.[mp3|ogg]', 'F#3': 'Fs3.[mp3|ogg]', 'F#4': 'Fs4.[mp3|ogg]', 'F#5': 'Fs5.[mp3|ogg]', 'F#6': 'Fs6.[mp3|ogg]', 'G7': 'G7.[mp3|ogg]', 'G1': 'G1.[mp3|ogg]', 'G2': 'G2.[mp3|ogg]', 'G3': 'G3.[mp3|ogg]', 'G4': 'G4.[mp3|ogg]', 'G5': 'G5.[mp3|ogg]', 'G6': 'G6.[mp3|ogg]', 'G#7': 'Gs7.[mp3|ogg]', 'G#1': 'Gs1.[mp3|ogg]', 'G#2': 'Gs2.[mp3|ogg]', 'G#3': 'Gs3.[mp3|ogg]', 'G#4': 'Gs4.[mp3|ogg]', 'G#5': 'Gs5.[mp3|ogg]', 'G#6': 'Gs6.[mp3|ogg]' },
    'saxophone': { 'D#5': 'Ds5.[mp3|ogg]', 'E3': 'E3.[mp3|ogg]', 'E4': 'E4.[mp3|ogg]', 'E5': 'E5.[mp3|ogg]', 'F3': 'F3.[mp3|ogg]', 'F4': 'F4.[mp3|ogg]', 'F5': 'F5.[mp3|ogg]', 'F#3': 'Fs3.[mp3|ogg]', 'F#4': 'Fs4.[mp3|ogg]', 'F#5': 'Fs5.[mp3|ogg]', 'G3': 'G3.[mp3|ogg]', 'G4': 'G4.[mp3|ogg]', 'G5': 'G5.[mp3|ogg]', 'G#3': 'Gs3.[mp3|ogg]', 'G#4': 'Gs4.[mp3|ogg]', 'G#5': 'Gs5.[mp3|ogg]', 'A4': 'A4.[mp3|ogg]', 'A5': 'A5.[mp3|ogg]', 'A#3': 'As3.[mp3|ogg]', 'A#4': 'As4.[mp3|ogg]', 'B3': 'B3.[mp3|ogg]', 'B4': 'B4.[mp3|ogg]', 'C4': 'C4.[mp3|ogg]', 'C5': 'C5.[mp3|ogg]', 'C#3': 'Cs3.[mp3|ogg]', 'C#4': 'Cs4.[mp3|ogg]', 'C#5': 'Cs5.[mp3|ogg]', 'D3': 'D3.[mp3|ogg]', 'D4': 'D4.[mp3|ogg]', 'D5': 'D5.[mp3|ogg]', 'D#3': 'Ds3.[mp3|ogg]', 'D#4': 'Ds4.[mp3|ogg]' },
    'trombone': { 'A#3': 'As3.[mp3|ogg]', 'C3': 'C3.[mp3|ogg]', 'C4': 'C4.[mp3|ogg]', 'C#2': 'Cs2.[mp3|ogg]', 'C#4': 'Cs4.[mp3|ogg]', 'D3': 'D3.[mp3|ogg]', 'D4': 'D4.[mp3|ogg]', 'D#2': 'Ds2.[mp3|ogg]', 'D#3': 'Ds3.[mp3|ogg]', 'D#4': 'Ds4.[mp3|ogg]', 'F2': 'F2.[mp3|ogg]', 'F3': 'F3.[mp3|ogg]', 'F4': 'F4.[mp3|ogg]', 'G#2': 'Gs2.[mp3|ogg]', 'G#3': 'Gs3.[mp3|ogg]', 'A#1': 'As1.[mp3|ogg]', 'A#2': 'As2.[mp3|ogg]' },
    'trumpet': { 'C6': 'C6.[mp3|ogg]', 'D5': 'D5.[mp3|ogg]', 'D#4': 'Ds4.[mp3|ogg]', 'F3': 'F3.[mp3|ogg]', 'F4': 'F4.[mp3|ogg]', 'F5': 'F5.[mp3|ogg]', 'G4': 'G4.[mp3|ogg]', 'A3': 'A3.[mp3|ogg]', 'A5': 'A5.[mp3|ogg]', 'A#4': 'As4.[mp3|ogg]', 'C4': 'C4.[mp3|ogg]' },
    'tuba': { 'A#2': 'As2.[mp3|ogg]', 'A#3': 'As3.[mp3|ogg]', 'D3': 'D3.[mp3|ogg]', 'D4': 'D4.[mp3|ogg]', 'D#2': 'Ds2.[mp3|ogg]', 'F1': 'F1.[mp3|ogg]', 'F2': 'F2.[mp3|ogg]', 'F3': 'F3.[mp3|ogg]', 'A#1': 'As1.[mp3|ogg]' },
    'violin': { 'A3': 'A3.[mp3|ogg]', 'A4': 'A4.[mp3|ogg]', 'A5': 'A5.[mp3|ogg]', 'A6': 'A6.[mp3|ogg]', 'C4': 'C4.[mp3|ogg]', 'C5': 'C5.[mp3|ogg]', 'C6': 'C6.[mp3|ogg]', 'C7': 'C7.[mp3|ogg]', 'E4': 'E4.[mp3|ogg]', 'E5': 'E5.[mp3|ogg]', 'E6': 'E6.[mp3|ogg]', 'G4': 'G4.[mp3|ogg]', 'G5': 'G5.[mp3|ogg]', 'G6': 'G6.[mp3|ogg]' },
    'xylophone': { 'C8': 'C8.[mp3|ogg]', 'G4': 'G4.[mp3|ogg]', 'G5': 'G5.[mp3|ogg]', 'G6': 'G6.[mp3|ogg]', 'G7': 'G7.[mp3|ogg]', 'C5': 'C5.[mp3|ogg]', 'C6': 'C6.[mp3|ogg]', 'C7': 'C7.[mp3|ogg]' }
};

// Materialise `.[mp3|ogg]` -> `.mp3` once, so the Sampler gets ready-to-fetch
// filenames.
export const SAMPLE_INSTRUMENTS = Object.fromEntries(
    Object.entries(RAW).map(([id, urls]) => [
        id,
        Object.fromEntries(Object.entries(urls).map(([note, file]) => [note, file.replace('.[mp3|ogg]', '.mp3')]))
    ])
);

// Human labels + the order they appear in the Sound Settings dropdown.
export const SAMPLE_INSTRUMENT_LABELS = {
    'piano': 'Piano',
    'guitar-acoustic': 'Acoustic Guitar',
    'guitar-electric': 'Electric Guitar',
    'guitar-nylon': 'Nylon Guitar',
    'bass-electric': 'Electric Bass',
    'contrabass': 'Contrabass',
    'cello': 'Cello',
    'violin': 'Violin',
    'harp': 'Harp',
    'organ': 'Organ',
    'harmonium': 'Harmonium',
    'trumpet': 'Trumpet',
    'trombone': 'Trombone',
    'french-horn': 'French Horn',
    'tuba': 'Tuba',
    'saxophone': 'Saxophone',
    'clarinet': 'Clarinet',
    'bassoon': 'Bassoon',
    'flute': 'Flute',
    'xylophone': 'Xylophone'
};

export const SAMPLE_INSTRUMENT_IDS = Object.keys(SAMPLE_INSTRUMENT_LABELS);

export function isSampleInstrument(id) {
    return !!id && Object.prototype.hasOwnProperty.call(SAMPLE_INSTRUMENTS, id);
}

// Default General-MIDI family -> sampled instrument. Families with no convincing
// sampled match (synth pads/leads, ethnic, percussive, sfx) return null so the
// track falls back to the oscillator synth engine.
const FAMILY_TO_SAMPLE = {
    'piano': 'piano',
    'chromatic percussion': 'xylophone',
    'organ': 'organ',
    'guitar': 'guitar-acoustic',
    'bass': 'bass-electric',
    'strings': 'violin',
    'ensemble': 'violin',
    'brass': 'trumpet',
    'reed': 'saxophone',
    'pipe': 'flute'
};

// More specific overrides keyed by substrings of the GM program name, so e.g.
// "Cello" beats the generic "strings -> violin" default.
const NAME_KEYWORDS = [
    ['nylon', 'guitar-nylon'],
    ['electric guitar', 'guitar-electric'],
    ['overdrive', 'guitar-electric'],
    ['distortion', 'guitar-electric'],
    ['clarinet', 'clarinet'],
    ['bassoon', 'bassoon'],
    ['flute', 'flute'],
    ['piccolo', 'flute'],
    ['cello', 'cello'],
    ['contrabass', 'contrabass'],
    ['double bass', 'contrabass'],
    ['violin', 'violin'],
    ['viola', 'violin'],
    ['fiddle', 'violin'],
    ['trombone', 'trombone'],
    ['tuba', 'tuba'],
    ['french horn', 'french-horn'],
    ['horn', 'french-horn'],
    ['trumpet', 'trumpet'],
    ['sax', 'saxophone'],
    ['harmonium', 'harmonium'],
    ['accordion', 'harmonium'],
    ['harpsichord', 'piano'],
    ['harp', 'harp'],
    ['marimba', 'xylophone'],
    ['xylophone', 'xylophone'],
    ['vibraphone', 'xylophone'],
    ['glockenspiel', 'xylophone'],
    ['celesta', 'xylophone'],
    ['organ', 'organ']
];

// Pick the best sampled instrument for a @tonejs/midi `instrument` object, or
// null when the synth engine is the better default.
export function gmToSampleInstrument(inst) {
    if (!inst) return null;
    const name = (inst.name || '').toLowerCase();
    for (const [keyword, id] of NAME_KEYWORDS) {
        if (name.includes(keyword)) return id;
    }
    return FAMILY_TO_SAMPLE[inst.family] || null;
}
