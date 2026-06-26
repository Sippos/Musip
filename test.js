import * as Tone from 'tone';
try {
  console.log(Tone.Time(NaN).toBarsBeatsSixteenths());
} catch(e) {
  console.log("ERROR:", e.message);
}
