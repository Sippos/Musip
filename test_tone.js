import * as Tone from 'tone';
const buf = new Tone.ToneAudioBuffer();
const p = new Tone.Player(buf);
console.log('has restart:', typeof p.restart === 'function');
