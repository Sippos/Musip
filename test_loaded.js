import * as Tone from 'tone';
const buf = new Tone.ToneAudioBuffer(new Float32Array(44100), 1, 44100);
const p = new Tone.Player(buf);
console.log('loaded property:', p.buffer.loaded);
