/*
 * Geiss HDR
 * Copyright (c) 2026 Ryan Geiss
 * www.geisswerks.com/geiss_hdr
 *
 * License: Apache-2.0 - see /LICENSE.txt
 * 
 * Attribution Notice: see /NOTICE.txt
 *   Derivative works and redistributions must retain this NOTICE file.
 *
 * Naming / Branding Notice: see /NOTICE.txt
 *   "Geiss" and "Geiss HDR" are reserved names for the original Geiss HDR project.
 *   The Apache-2.0 license does not grant permission to use those names, or
 *   confusingly similar names, for derivative works except as needed to describe
 *   the origin of the work or reproduce the content of the NOTICE file.
 * 
 * Output permissions (for still images and still image sequences generated
 *   using this software): see /OUTPUTS.txt
 */

export class AudioInput {
  constructor({ fftSize = 2048 } = {}) {
    this.fftSize = fftSize;
    this.ctx = null;
    this.analyser = null;
    
    this.waveF = null;
    this.spectrum = null;

		this.audio_el = null;
		this.src_node = null;
		this.mode = null;
		
		this.object_url = null;	
			
		this.media_keys_hooked_up = false;
		this.prev_song_requested = false;
		this.next_song_requested = false;
  }

	_revokeObjectURLIfNeeded() {
	  if (this.object_url) {
	    URL.revokeObjectURL(this.object_url);
	    this.object_url = null;
	  }
	}
	
	async startTab() {
		try {
		  this.ctx = new (window.AudioContext || window.webkitAudioContext)();
		
		  const controller = ("CaptureController" in window) ? new CaptureController() : null;
		
		  const stream = await navigator.mediaDevices.getDisplayMedia({
		    video: true,   // required by Chrome for tab capture
		    audio: true,   // tab audio if user checks "Share audio"
		    ...(controller ? { controller } : {}),
		  });
		
		  // Tell Chrome: do NOT focus the captured tab/window.
		  // Must be done immediately after getDisplayMedia resolves.
		  if (controller?.setFocusBehavior) {
		    controller.setFocusBehavior("no-focus-change");
		  }
		
		  for (const vt of stream.getVideoTracks()) vt.stop();
	
			// TODO: Factor out common code between startMic and startTab().	
		  const src = this.ctx.createMediaStreamSource(stream);
		  this.analyser = this.ctx.createAnalyser();
		  this.analyser.fftSize = this.fftSize;
		  this.analyser.smoothingTimeConstant = 0.6;  // TODO: What is this?
		  
			// Optional but recommended for stable mapping:
			this.analyser.minDecibels = -100;
			this.analyser.maxDecibels = -30;
		  
		  src.connect(this.analyser);
		
		  this.waveF = new Float32Array(this.analyser.fftSize);
		  //this.waveU8  = new Uint8Array(this.analyser.fftSize);
		  //this.waveI16 = new Int16Array(this.analyser.fftSize);

			// Note: AGC (automatic gain control) is enabled by default.  To verify:
			//const track = stream.getAudioTracks()[0];
			//console.log("supported:", navigator.mediaDevices.getSupportedConstraints());
			//console.log("constraints:", track.getConstraints?.());
			//console.log("settings:", track.getSettings?.());
			//console.log("capabilities:", track.getCapabilities?.());
		  
			const N = this.analyser.frequencyBinCount; // fftSize / 2
			this.spectrum = new Float32Array(N);
			return { success : true, error : "" };
		} catch (e) {
			console.error("startTab failed:", e);
			return { success : false, error : `startTab failed: ${e}` };
		}
	}

  async startMic() {
		try {
	    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
	    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
	    const src = this.ctx.createMediaStreamSource(stream);
	
	    this.analyser = this.ctx.createAnalyser();
	    this.analyser.fftSize = this.fftSize;
	    this.analyser.smoothingTimeConstant = 0.6;
	
			// Optional but recommended for stable mapping:
			this.analyser.minDecibels = -100;
			this.analyser.maxDecibels = -30;
	
	    src.connect(this.analyser);
	
		  this.waveF = new Float32Array(this.analyser.fftSize);
	    //this.waveU8 = new Uint8Array(this.analyser.fftSize);
	    //this.waveI16 = new Int16Array(this.analyser.fftSize);
	    
			const N = this.analyser.frequencyBinCount; // fftSize / 2
			this.spectrum = new Float32Array(N);

			// Note: AGC (automatic gain control) is enabled by default.  To verify:
			//const track = stream.getAudioTracks()[0];
			//console.log("supported:", navigator.mediaDevices.getSupportedConstraints());
			//console.log("constraints:", track.getConstraints?.());
			//console.log("settings:", track.getSettings?.());
			//console.log("capabilities:", track.getCapabilities?.());

			return { success : true, error : "" };
		} catch (e) {
			console.error("startMic failed:", e);
			return { success : false, error : `startMic failed; error: ${e}` };
		}
  }
	
	// [amp addition] 2026-07-16: analyze an existing WebAudio source node the
	// host app already owns (amp's silent twin <audio> of the playing track).
	// Connects srcNode -> analyser only — never to the destination, so this
	// input is inaudible; the host app owns audible playback elsewhere.
	startExternal(ctx, srcNode) {
		this.mode = "external";
		this.ctx = ctx;

		this.analyser = this.ctx.createAnalyser();
		this.analyser.fftSize = this.fftSize;
		this.analyser.smoothingTimeConstant = 0.6;
		this.analyser.minDecibels = -100;
		this.analyser.maxDecibels = -30;

		srcNode.connect(this.analyser);

		this.waveF = new Float32Array(this.analyser.fftSize);
		this.spectrum = new Float32Array(this.analyser.frequencyBinCount);
		return { success : true, error : "" };
	}

	async startMP3(url, start_volume, loop) {
	  try {
	    this.mode = "mp3";
	
	    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
	
	    this.analyser = this.ctx.createAnalyser();
	    this.analyser.fftSize = this.fftSize;
	    this.analyser.smoothingTimeConstant = 0.6;
	
	    this.analyser.minDecibels = -100;
	    this.analyser.maxDecibels = -30;
	
	    this.waveF = new Float32Array(this.analyser.fftSize);
	
	    const N = this.analyser.frequencyBinCount;
	    this.spectrum = new Float32Array(N);
	
	    // create audio element
	    const audio = new Audio();
	    audio.src = url;
	    audio.loop = loop;
	    audio.preload = "auto";
	    audio.volume = Math.max(0, Math.min(1, start_volume));

	    // store reference
	    this.audio_el = audio;
	
	    // create source node
	    this.src_node = this.ctx.createMediaElementSource(audio);
	
	    // connect graph
	    this.src_node.connect(this.analyser);
	    this.src_node.connect(this.ctx.destination);
		
			// Browsers can be slightly fussy about audio contexts starting suspended.
			await this.ctx.resume();

			this.HookUpMediaKeys();  // after audio_el exists, but before starting play.

	    await audio.play();
	
			return { success : true, error : "" };	
	  } catch (e) {
	    console.error("startMP3 failed:", e);
			return { success : false, error : `startMP3 failed: ${e}` };
	  }
	}
		
	// 'file' should be a Blob, File, or MediaSource object.
	async loadLocalFile(file, start_volume = 1.0, loop = true) {
	  if (!file) return { success : false, error : `loadLocalFile failed: no file specified` };
	
	  // Be somewhat permissive: MIME can be empty on some systems.
	  const name = file.name || "";
	  const type = file.type || "";
	  const looks_like_audio =
	    type.startsWith("audio/") ||
	    /\.mp3$/i.test(name) ||
	    /\.wav$/i.test(name) ||
	    /\.m4a$/i.test(name) ||
	    /\.ogg$/i.test(name);
	
	  if (!looks_like_audio) {
	    console.warn("loadLocalFile: not an audio file:", file);
	    return { success : false, error : "loadLocalFile failed: file ${file} is not an audio file" };
	  }
	
	  // Revoke old blob URL, if any.
	  this._revokeObjectURLIfNeeded();
	
	  const url = URL.createObjectURL(file);
	  this.object_url = url;
	
	  // If we're already in local/mp3 mode and have an audio element,
	  // just replace the current song.
	  if (this.mode === "mp3" && this.audio_el) {
	    try {
	      this.audio_el.pause();
	      this.audio_el.src = url;
	      this.audio_el.currentTime = 0;
	      this.audio_el.volume = Math.max(0, Math.min(1, start_volume));
	      this.audio_el.loop = loop;
	      //this.mode = "local";
	      
  			this.HookUpMediaKeys();  // after audio_el exists, but before starting play.
	      
	      await this.audio_el.play();
				return { success : true, error : "" };
	    } catch (e) {
	      console.error("loadLocalFile replace failed:", e);
				return { success : false, error : `loadLocalFile failed: ${e}` };
	    }
	  }
	
	  // Otherwise start fresh.
	  return await this.startMP3(url, start_volume, loop);
	}
		
	//isLocalMode() {
	//  return this.mode === "local";
	//}
	
	setVolume(v) {
	  if (this.audio_el) {
	    this.audio_el.volume = Math.max(0, Math.min(1, v));
	  }
	}	
	
	isPaused() {
		return this.audio_el.paused;
	}
	
	togglePause() {
		if (this.audio_el.paused) {
	    this.audio_el.play();
	    return true;			
		} else {
	    this.audio_el.pause();
	    return false;
		}
	}
	
	adjustVolume(delta) {
	  if (this.audio_el) {
	    this.setVolume(this.audio_el.volume + delta);
	  }
	}

	rewindCurrentSong() {
		this.audio_el.currentTime = 0.0;	
		//if (songHasEnded()) {
		//	await this.audio_el.play();
		//}
	}

	play() {
		this.audio_el.play();
	}

	songHasEnded() {
		return this.audio_el.ended;
	}

	getCurrentSongTimeInSeconds() {
		return this.audio_el.currentTime;	
	}
	
	getCurrentSongLengthInSeconds() {
		return this.audio_el.duration;
	}
	
	seekRelative(seconds) {
		//console.log("this.audio_el = ", this.audio_el,
		//            "currentTime =", this.audio_el.currentTime,
		//            "duration =", this.audio_el.duration,
		//            "readyState =", this.audio_el.readyState);		
	  if (this.audio_el) {
	    this.audio_el.currentTime += seconds;
	  }
	}
	//seekRelative(seconds) {
	//  if (!this.audio_el) return;
	//
	//  const a = this.audio_el;
	//  const old_t = a.currentTime;
	//  let new_t = old_t + seconds;
	//  new_t = Math.max(0, Math.min(a.duration, new_t));
	//
	//  console.log("seekRelative BEFORE:", { old_t, new_t, duration: a.duration });
	//
	//  a.currentTime = new_t;
	//
	//  console.log("seekRelative AFTER set:", {
	//    currentTime: a.currentTime,
	//    duration: a.duration
	//  });
	//
	//  setTimeout(() => {
	//    console.log("seekRelative 200ms later:", {
	//      currentTime: a.currentTime,
	//      duration: a.duration
	//    });
	//  }, 200);
	//}
	
	HookUpMediaKeys() {
		if (this.media_keys_hooked_up) {
			return;
		}
		
		this.media_keys_hooked_up = true;

		if (!('mediaSession' in navigator)) return;

    //navigator.mediaSession.setActionHandler('play', async () => {
    //  await audio_el.play();
    //});
    //navigator.mediaSession.setActionHandler('pause', () => {
    //  audio_el.pause();
    //});
    navigator.mediaSession.setActionHandler('previoustrack', () => {
      this.prev_song_requested = true;
    });
    navigator.mediaSession.setActionHandler('nexttrack', () => {
      this.next_song_requested = true;
    });		
	}
	
	async loadNewSong(url) {
	  if (!this.audio_el) return;
	
	  this.audio_el.src = url;
	  this.audio_el.currentTime = 0;
	
	  try {
	    await this.audio_el.play();
	  } catch (e) {
	    console.error("loadNewSong failed:", e);
	  }
	}

	_hzToBin(hz) {
	  const nyquist = this.ctx.sampleRate / 2;
	  const N = this.analyser.frequencyBinCount;
	  const clamped = Math.max(0, Math.min(nyquist, hz));
	  return Math.round((clamped / nyquist) * (N - 1));
	}
	
	_binToHz(bin) {
	  const nyquist = this.ctx.sampleRate / 2;
	  const N = this.analyser.frequencyBinCount;
	  return bin * (nyquist / (N - 1));
	}

	// Converts a db reading to a value in a perceptually-flat spectrum.
	_dbToPerceptual(db, freq) {
		// dB value -> linear power (not amplitude)
	  // db = 10*log10(P)  =>  P = 10^(db/10)
	  let value = Math.pow(10, db / 10);
	  
	  // Rough perceptual equalization: apply  == 1 power-law tilt.
	  value *= freq;
	  
	  return value;
	}

	// Modifies 'spectrum' to go from dB to perceptually flat,
	// and then extracts the average value in each desired band.
	NormalizeSpectrumAndSumBands(spectrum, bands) {
	  let out = new Array(4);
	  const N = spectrum.length;

		// Normalize the (entire) spectrum.
		for (let i = 0; i < N; i++) {
      let freq = this._binToHz(i);
      spectrum[i] = this._dbToPerceptual(spectrum[i], freq);
		}

		// Sum the bands.
		if (bands != null) {
			out = new Float32Array(bands.length);
			for (let b = 0; b < bands.length; b++) {
		    const i0 = this._hzToBin(bands[b].f0);
		    const i1 = this._hzToBin(bands[b].f1);
		
		    const lo = Math.max(0, Math.min(i0, i1));
		    const hi = Math.min(N - 1, Math.max(i0, i1));
		
		    let sumP = 0;
		    for (let i = lo; i <= hi; i++) {
		      sumP += spectrum[i];
		    }
		
		    // Normalize by number of bins so bands are comparable.
		    const norm = (hi >= lo) ? (hi - lo + 1) : 1;
		    out[b] = sumP / norm;
		  }
		}
	
	  return out;
	}
	
	isPrevSongRequested() {
		if (this.prev_song_requested) {
			this.prev_song_requested = false;
			return true;
		}
		return false;
	}
	isNextSongRequested() {
		if (this.next_song_requested) {
			this.next_song_requested = false;
			return true;
		}
		return false;
	}

	getFrame({ waveScale = 1.0, wantWave = true, wantSpec = true, bandsHz = null } = {}) {
	  if (!this.analyser) return null;
  
		// --- waveform ---
	  let rms = null;
	  if (wantWave) {
			// float source data:
	    this.analyser.getFloatTimeDomainData(this.waveF);
	    
	    let sumSq = 0.0;
			for (let i = 0; i < this.waveF.length; i++) {
			  let v = this.waveF[i] * waveScale;          // -1..+1
			  this.waveF[i] = v;
	      sumSq += v * v;
			}
	    rms = Math.sqrt(sumSq / this.waveF.length);
	    //console.log(rms);
		}

	  // --- spectrum ---
	  let spectrum = null;
	  let bandEnergy = null;
	
	  if (wantSpec) {
	    this.analyser.getFloatFrequencyData(this.spectrum);
	    spectrum = this.spectrum;	
	    bandEnergy = this.NormalizeSpectrumAndSumBands(spectrum, bandsHz);
	  }
  
	  return {
	    wave: wantWave ? this.waveF : null,
	    rms,
	    spectrum,      // (Float32Array)
	    bandEnergy     // {bass, mid, treble} or whatever bandsHz names you pass
	  };
  }
}

