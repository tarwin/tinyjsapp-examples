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

// src/audio/wave_align.js
// Multiscale waveform alignment.
// Caller supplies ORIG_SAMPLE_COUNT; we align to the previous frame's ALIGNED_SAMPLE_COUNT
// where ALIGNED_SAMPLE_COUNT = floor(ORIG_SAMPLE_COUNT * ALIGN_FRAC).

// Range: [0..1].
// Lower value -> better alignment, but fewer aligned wave samples. (wider wave!)
//             -> CAREFUL: our AnalyserNode sends is a rolling window of
//                  the most recent ~2048 samples, in ~128-sample quanta;
//                  if we give too much room for alignment, it'll just
//                  snap exactly to the previous waveform, and visually
//                  it'll look like the same wave again for 2,3,4 frames.
//                  So don't blindly lower this without watching for that!
// Good test song for jumping bass waves:  "03 - IDB (With Sayr).mp3"
//export const ALIGN_FRAC = 0.55;//0.55;
// song / bass wave alignment suddenly fails at ALIGN_FRAC:
//  Deadmau5 - Random Album Title - 10 - Not Exactly     good at 0.55; reasonable at 0.75; 
// 0.55: frequent repeats because the wave is fully shifted to match prev frame
// 0.65: bass waves sometimes jump around; some repeats, but less.
// 0.75: bass waves sometimes jump around; still some repeats
// 0.85: reasonable alignment, still very occasionally a repeat (ok)
// 0.95: no repeats, but also some alignment fails

// wave should be a Float32Array of size > radius.
// 'radius' should be an integer specifying how wide the blur should be.
// the blur is a simple box blur covering +/- 'radius' samples.
// Edge behavior: the window shrinks near the ends (no clamping/replication).
export function Blur(wave, radius) {
  const N = wave.length;
  const r = radius | 0;

	if (r <= 0) {
		return wave;		
	}

  const ret = new Float32Array(N);

  if (r <= 0) { ret.set(wave); return ret; }
  if (N <= r) {
  	return wave;
  }

  const fullW = 2 * r + 1;

  // If radius is so large that a full window never fits, abort.
  if (fullW >= N) {
  	return wave;
  }

  let sum = 0.0;

  // Phase 1: ramp up (window grows) for i = 0..r
  // For i=0, window is [0..r]
  for (let j = 0; j <= r; j++) {
  	sum += wave[j];
  }
  ret[0] = sum / (r + 1);

  // As i increases to r, we only add the new rightmost sample each step
  for (let i = 1; i <= r; i++) {
    sum += wave[i + r];
    ret[i] = sum / (i + r + 1); // window size = (i+r - 0 + 1)
  }

  // Phase 2: steady state (full window) for i = r+1 .. N-r-1
  const invFullW = 1.0 / fullW;
  for (let i = r + 1; i <= N - r - 1; i++) {
    sum += wave[i + r] - wave[i - r - 1];
    ret[i] = sum * invFullW;
  }

  // Phase 3: ramp down (window shrinks) for i = N-r .. N-1
  // Right edge stops growing; we only subtract the leaving leftmost sample.
  for (let i = N - r; i < N; i++) {
    sum -= wave[i - r - 1];
    ret[i] = sum / (N - i + r); // window size = (N-1 - (i-r) + 1)
  }

  return ret;
}

// 't' should be in [0..1] and represents where you are in
// the aligned chunk of the wave.  Function returns a weighting
// from 0..15 expressing how much relative weight you want to
// put on the alignment for that sample.
function weightQ4(t) {
	let pyramid = 1.0 - Math.abs(t - 0.5) * 2;		// [0..1..0]
	let exag = pyramid * 5 - 2;
	return Math.max(0, Math.min(15, exag * 15));
}

function downsample2(src) {
  const n2 = src.length >> 1;
  const dst = new Float32Array(n2);
  for (let i = 0, j = 0; j < n2; j++, i += 2) {
    dst[j] = (src[i] + src[i + 1]) * 0.5;
  }
  return dst;
}

function corrAt(S, T, Wq4, off) {
  let acc = 0.0;
  if (!Wq4) {
    for (let i = 0; i < T.length; i++) acc += S[off + i] * T[i] * 15.0;
  } else {
    for (let i = 0; i < T.length; i++) acc += S[off + i] * T[i] * Wq4[i];
  }
  return acc;
}

function buildPyr(a, levels) {
  const pyr = [a];
  for (let i = 1; i <= levels; i++) pyr.push(downsample2(pyr[i - 1]));
  return pyr;
}

function buildWeightsQ4(len) {
  const w = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    const rel = (i + 0.5) / len; // center of sample
    w[i] = weightQ4(rel) & 15;
  }
  return w;
}

function downsample2_q4(src) {
  const n2 = src.length >> 1;
  const dst = new Uint8Array(n2);
  for (let i = 0, j = 0; j < n2; j++, i += 2) {
    // average pair, keep in 0..15
    dst[j] = ((src[i] + src[i + 1] + 1) >> 1) & 15;
  }
  return dst;
}

function buildPyr_q4(w0, levels) {
  const pyr = [w0];
  for (let i = 1; i <= levels; i++) pyr.push(downsample2_q4(pyr[i - 1]));
  return pyr;
}

function findBestOffsetMultiscale(S_pyr, T_pyr, W_pyr, maxOffFull) {
  const levels = T_pyr.length - 1;

  // Coarsest brute-force
  const S = S_pyr[levels];
  const T = T_pyr[levels];
  const Wq4 = W_pyr[levels];
  const maxOffCoarse = S.length - T.length;

  let bestOff = 0;
  let bestScore = -Infinity;

  for (let off = 0; off <= maxOffCoarse; off++) {
    const sc = corrAt(S, T, Wq4, off);
    if (sc > bestScore) { bestScore = sc; bestOff = off; }
  }

  // Refine with +/-1 at each level up
  for (let lev = levels - 1; lev >= 0; lev--) {
    const S2 = S_pyr[lev];
    const T2 = T_pyr[lev];
    const W2 = W_pyr[lev];
    const maxOff = S2.length - T2.length;

    const pred = bestOff << 1;

    let o0 = pred - 1;
    let o1 = pred;
    let o2 = pred + 1;

    if (o0 < 0) o0 = 0;
    if (o2 > maxOff) o2 = maxOff;
    if (o1 < 0) o1 = 0;
    if (o1 > maxOff) o1 = maxOff;

    let best = o1;
    let scBest = corrAt(S2, T2, W2, o1);

    if (o0 !== o1) {
      const sc = corrAt(S2, T2, W2, o0);
      if (sc > scBest) { scBest = sc; best = o0; }
    }
    if (o2 !== o1 && o2 !== o0) {
      const sc = corrAt(S2, T2, W2, o2);
      if (sc > scBest) { scBest = sc; best = o2; }
    }

    bestOff = best;
    bestScore = scBest;
  }

  if (bestOff < 0) bestOff = 0;
  if (bestOff > maxOffFull) bestOff = maxOffFull;

  return { offset: bestOff, score: bestScore };
}
function chooseLevels(orig, aligned) {
  // You originally wanted 4 downsamples (1/16), but only if it remains meaningful.
  // Coarsest should still have enough samples to correlate. We'll keep at least ~48 samples.
  let levels = 0;
  let a = aligned;
  while (levels < 4 && (a >> 1) >= 48 && (orig >> 1) > (aligned >> 1)) {
    levels++;
    a >>= 1;
  }
  return levels;
}

export class WaveAligner {
  constructor() {
    this.ORIG_SAMPLE_COUNT = 0;
    this.ALIGNED_SAMPLE_COUNT = 0;
    this.MAX_OFF = 0;
    this.levels = 0;

    this.prevAligned = null; // Float32Array(ALIGNED_SAMPLE_COUNT)
    this.tmpOrig = null;     // Float32Array(ORIG_SAMPLE_COUNT)
  }

  _reinit(ORIG_SAMPLE_COUNT) {
    this.ORIG_SAMPLE_COUNT = ORIG_SAMPLE_COUNT;

    this.prevAligned = null;
    this.tmpOrig = new Float32Array(this.ORIG_SAMPLE_COUNT);
  }

	alignFromF(waveF, align_frac, ORIG_SAMPLE_COUNT) {
    this.ALIGNED_SAMPLE_COUNT = Math.floor(ORIG_SAMPLE_COUNT * align_frac);

    // Max offset for sliding window alignment
    this.MAX_OFF = this.ORIG_SAMPLE_COUNT - this.ALIGNED_SAMPLE_COUNT;
    if (this.MAX_OFF < 0) this.MAX_OFF = 0;

    this.levels = chooseLevels(this.ORIG_SAMPLE_COUNT, this.ALIGNED_SAMPLE_COUNT);


	  if ((ORIG_SAMPLE_COUNT | 0) <= 0) {
	    throw new Error(`ORIG_SAMPLE_COUNT must be > 0, got ${ORIG_SAMPLE_COUNT}`);
	  }
	  if (!waveF || waveF.length < ORIG_SAMPLE_COUNT) {
	    throw new Error(`waveF.length (${waveF ? waveF.length : "null"}) < ORIG_SAMPLE_COUNT (${ORIG_SAMPLE_COUNT})`);
	  }
	
	  // Reinit if needed
	  if (this.ORIG_SAMPLE_COUNT !== ORIG_SAMPLE_COUNT ||
	      !this.tmpOrig ||
	      this.tmpOrig.length !== ORIG_SAMPLE_COUNT) {
	    this._reinit(ORIG_SAMPLE_COUNT);
	  }
	
	  // Copy current waveform (already float)
	  // (We copy so pyramids can downsample without touching the caller's buffer.)
	  this.tmpOrig.set(waveF.subarray(0, ORIG_SAMPLE_COUNT));
	
	  // First frame after (re)init: pick centered window
	  if (!this.prevAligned) {
	    const off = (this.MAX_OFF >> 1);
	    const out = new Float32Array(this.ALIGNED_SAMPLE_COUNT);
	    out.set(this.tmpOrig.subarray(off, off + this.ALIGNED_SAMPLE_COUNT));
	    this.prevAligned = out;
	    return out;
	  }
	
	  const T_pyr = buildPyr(this.prevAligned, this.levels);

		// build weights for the template, and downsample them to match T_pyr
		//const w0 = buildWeightsQ4(this.ALIGNED_SAMPLE_COUNT);
		//const W_pyr = buildPyr_q4(w0, this.levels);
		const w0 = buildWeightsQ4(T_pyr[0].length);
		const W_pyr = [w0];
		for (let lev = 1; lev < T_pyr.length; lev++) {
		  W_pyr.push(downsample2_q4(W_pyr[lev - 1]));
		}
	
		if (W_pyr.length !== T_pyr.length) {
		  throw new Error(`W_pyr length mismatch: W=${W_pyr.length} T=${T_pyr.length} levels=${this.levels} aligned=${this.ALIGNED_SAMPLE_COUNT}`);
		}

		if (1) {
			// Align to all 4 possible flips of the new waveform.
			// This helps alignment match up better when we have large,
			//   very low frequency bass waves.
			
			const N = this.tmpOrig.length;
			
			// Build the 4 flipped versions.
			let flipped = [];
			for (let flip = 0; flip < 4; flip++) {
				flipped.push(new Float32Array(N));
			}
			for (let i = 0; i < N; i++) {
				flipped[0][i] = this.tmpOrig[i];
				flipped[1][i] = this.tmpOrig[N - 1 - i];
				flipped[2][i] = -this.tmpOrig[i];
				flipped[3][i] = -this.tmpOrig[N - 1 - i];
			}

			// Evaluate each one.
			let best_flip = -1;
			let best_score = -Infinity;
			let best_offset = -1;
			for (let flip = 0; flip < 4; flip++) {
			  // Build pyramids and search offset
			  const S_pyr = buildPyr(flipped[flip], this.levels);			  
			  const result = findBestOffsetMultiscale(S_pyr, T_pyr, W_pyr, this.MAX_OFF);
			  if (result.score > best_score) {
			  	best_flip = flip;
			  	best_score = result.score;
			  	best_offset = result.offset;			  	
			  }
			}
			
		  const out = new Float32Array(this.ALIGNED_SAMPLE_COUNT);
		  out.set(flipped[best_flip].subarray(best_offset, best_offset + this.ALIGNED_SAMPLE_COUNT));
		  this.prevAligned = out;
		
		  return out;
		} else {
			// Regular alignment (no flipping).
	
		  // Build pyramids and search offset
		  const S_pyr = buildPyr(this.tmpOrig, this.levels);
		
		  const result = findBestOffsetMultiscale(S_pyr, T_pyr, W_pyr, this.MAX_OFF);
		  const off = result.offset;
		  const score = result.score;
		  const out = new Float32Array(this.ALIGNED_SAMPLE_COUNT);
		  out.set(this.tmpOrig.subarray(off, off + this.ALIGNED_SAMPLE_COUNT));
		  this.prevAligned = out;
		
		  return out;
			
		}
	}
}
