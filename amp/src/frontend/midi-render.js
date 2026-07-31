// midi-render.js — module worker: SoundFont bank + .mid bytes in, WAV out.
// Rendering is pure computation (SpessaSynth, vendored), so it never touches
// an audio device — which is what keeps this Linux-safe: the deck plays the
// finished wav through a plain media element like any other file, and the
// "no Web Audio to ctx.destination on Linux" rule never comes into play.
// The parsed bank is cached here across renders; a new bank replaces it.
import {
  audioToWav, BasicMIDI, SoundBankLoader, SpessaSynthProcessor, SpessaSynthSequencer,
} from './spessasynth_core.min.js';

let bank = null, bankId = null;

// what the file says about itself: the track name plus any text/copyright
// events — Track Info shows them the way it shows a tracker module's greetz
function midiMeta(midi) {
  const lines = [];
  const dec = new TextDecoder();
  try { const n = (midi.getName() || '').trim(); if (n) lines.push(n); } catch (e) {}
  try {
    for (const x of midi.getExtraMetadata() || []) {
      const s = (typeof x === 'string' ? x : x && x.data ? dec.decode(x.data) : '').trim();
      if (s) lines.push(s);
    }
  } catch (e) {}
  return lines.length ? { message: lines.join('\n') } : null;
}

onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.sf) { bank = SoundBankLoader.fromArrayBuffer(m.sf); bankId = m.sfId; }
    if (!m.mid) { postMessage({ ready: true, sfId: bankId }); return; }
    const midi = BasicMIDI.fromArrayBuffer(m.mid);
    const meta = midiMeta(midi);
    // a cache hit still wants the file's words — no bank needed to read them
    if (m.metaOnly) { postMessage({ meta }); return; }
    if (!bank) throw new Error('no soundfont loaded');
    const sampleRate = 44100;
    // a fresh processor per render: no note/controller state leaks between songs
    const synth = new SpessaSynthProcessor(sampleRate, { eventsEnabled: false });
    synth.soundBankManager.addSoundBank(bank, 'main');
    await synth.processorInitialized;
    const seq = new SpessaSynthSequencer(synth);
    seq.loadNewSongList([midi]);
    seq.play();
    // +1s of tail so releases/reverb don't clip at the end
    const total = Math.ceil(sampleRate * (midi.duration + 1));
    const L = new Float32Array(total), R = new Float32Array(total);
    let filled = 0, lastPct = -1;
    while (filled < total) {
      seq.processTick();
      // small buffer by design: it's the modulator/LFO update interval
      const n = Math.min(128, total - filled);
      synth.process(L, R, filled, n);
      filled += n;
      const pct = Math.floor((filled / total) * 100);
      if (pct !== lastPct && pct % 5 === 0) { lastPct = pct; postMessage({ pct }); }
    }
    const wav = audioToWav([L, R], sampleRate);
    postMessage({ wav, duration: midi.duration, meta }, [wav]);
  } catch (err) {
    postMessage({ error: String((err && err.message) || err) });
  }
};
