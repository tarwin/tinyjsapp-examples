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

import { FindBlendedWarpCenter, AdvectPoint } from "./warp.js";
import { WarpMap, g_warp_maps, buildWarpMap, g_override_mode } from "./motion.js";
import { Blur, WaveAligner } from "./wave_align.js"
import { TransformHelper } from "./coords.js"
import { ShowError } from "./error.js"
//xxx - TODO: use kMaxActiveWarps instead of 4 throughout
import { kMaxActiveWarps, kWarpMapSize } from "./const.js"
// [amp addition] worker factory: the tinyjs build packs the whole frontend
// into ONE html file, so "./background_worker.js" would not resolve at
// runtime; the shim inlines the (pre-bundled) worker source as a Blob.
import { CreateGeissWorker } from "./amp_worker_shim.js"

export const GENERAL_TRANSITION_SPEED = 1.0;//1.3;//1.0

const WARP_MAP_DURATION_SEC_MIN = GENERAL_TRANSITION_SPEED * 14.0;
const WARP_MAP_DURATION_SEC_MAX = GENERAL_TRANSITION_SPEED * 26.0;
const WARP_MAP_FADE_SEC_MIN =     GENERAL_TRANSITION_SPEED *  1.5;
const WARP_MAP_FADE_SEC_MAX =     GENERAL_TRANSITION_SPEED * 10.0;

// Keep waveform lifetimes slightly shorter,
// so that they match the motion maps well.
const WAVE_DURATION_SEC_MIN = GENERAL_TRANSITION_SPEED * 13.0;//12.0;
const WAVE_DURATION_SEC_MAX = GENERAL_TRANSITION_SPEED * 24.0;//23.0;
const WAVE_FADE_SEC_MIN = GENERAL_TRANSITION_SPEED * 5.0;//4.0;
const WAVE_FADE_SEC_MAX = GENERAL_TRANSITION_SPEED * 8.0;//6.5;
const NEW_WAVE_MOTION_TIME_LOOKAHEAD_SEC = 
		WAVE_FADE_SEC_MIN * 0.35 + 0.65 * WAVE_FADE_SEC_MAX;

const BASE_MOTION_SCALE = 109.0 * 0.9;//120.0;

const WAVE_STRETCH = 1.5;			// Flat wave only.
const WAVE_MAG_SCALE = 1.1;//1.0     // All waves.  ~The color intensity of the drawn wave points.

const SHIFT_MAGNITUDE = 0.95 * 0.65;//1.0;
const SHIFT_FREQ = 0.7;

const TITLE_EMBED_DURATION_SECONDS = 0.8;//0.79;
const TITLE_EMBED_FADE_IN_POWER = 0.5;//0.3;
const TITLE_EMBED_SIZE = 1.1;

let rms_att = 0.0;

let g_wave0 = null;
let g_wave1 = null;
let g_wave0_start_fade_time = 0.0;
let g_wave0_end_fade_time = 0.1;

let g_re_blend_motion_metadata = true;
let g_last_blended_net_motion = 0.0;
let g_last_blended_net_zoom_motion = 0.0;
let g_last_blended_in_or_out_motion = 0.0;
let g_last_blended_net_clockwise_motion = 0.0;
let g_last_blended_cw_or_ccw_motion = 0.0;

// Type is the result struct from FindBlendedWarpCenter() in warp.js.
let g_last_blended_center_trace = null;

const aligner = new WaveAligner();

let g_fading_dots = new Array(1024);//UNDO (128);
for (let i = 0; i < g_fading_dots.length; i++) {
	g_fading_dots[i] = { 
			x : (Math.random() * 1024) | 0,
			y : (Math.random() * 1024) | 0
	};
}

// Worker for background warp map generation.
// [amp] original: new Worker("./background_worker.js", { type: "module" });
const g_bkg_worker = CreateGeissWorker();

let g_bkg_warp_map = null;
let g_bkg_warp_map_in_progress = false;
const g_bkg_gen_verbose = false;
const g_verbose_warp_slots = false;

g_bkg_worker.onmessage = (e) => {
  if (e.data.type === "done") {
		if (g_bkg_gen_verbose) console.log(`# bkg generation of warp map complete! mode ${e.data.result.mode}, slot ${e.data.result.i}`);
		g_bkg_warp_map_in_progress = false;
    g_bkg_warp_map = e.data.result;
  }
};

function start_job(payload) {
	if (g_bkg_gen_verbose) console.log(`# kicking off bkg generation of a warp map, slot ${payload.i}, mode ${payload.mode}, t0 ${payload.t0}, t3 ${payload.t3}`);
  g_bkg_warp_map = null;
  g_bkg_warp_map_in_progress = true;
  g_bkg_worker.postMessage({ type: "start", payload });
  //console.log(`payload: t0 = ${payload.t0}`);//UNDO
}

function lerp(a, b, t) {
	return a * (1.0 - t) + b * t;
}

function smoothstep(u) {
  return u * u * (3 - 2 * u);
}

//xxx;
// TODO:
// 3. don't let lists grow beyond ~3 entries old.
let g_active_warp_maps = new Array();
for (let i = 0; i < kMaxActiveWarps; i++) {
	g_active_warp_maps.push([]);
}

//xxx - rename
class ActiveWarpMap2 {
  constructor(mode = 0, t0 = 0.0, t1 = 0.0, t2 = 0.0, t3 = 0.0, peak_str = 1.0, warp_map = null) {
  	// TODO: nuke this.mode and instead use this.warp_map.mode everywhere.
    this.mode = mode | 0;          // force int
    if (t0 == t1 || t2 == t3 || t0 == t3) {
			ShowError(`ERROR: ActiveWarpMap constructor: invalid zero time gap (t0, t1, t2, t3)`);    	
    }
    if (t0 == -1.0) {
      ShowError(`ERROR: t0 was -1!`);
    }
    
    if (warp_map != null && warp_map.mode != mode) {
			ShowError(`ERROR: Mismatch: mode (${mode}) != warp_map.mode (${warp_map.mode}).`);
    }

		this.peak_str = peak_str;
    this.t0 = t0;	// str==0
    this.t1 = t1; // str==1
    this.t2 = t2; // str==1
    this.t3 = t3; // str==0

    // Build the warp map: (slow)
		this.warp_map = (warp_map == null) ? buildWarpMap(mode) : warp_map;
  }
}

// Inputs:
//   i in [0..3]  -- which active warp map slot you want to query
//   t = time
// Returns:
//   mode
//   raw_str in [0..1]
//   warp_map
// Note: This only reflects the relative strength of the warp map
// at time t.  The actual motion magnitude will also be further
// adjusted to neutralize the framerate, and adjusted for "breathing".  
function GetWarpAtTime(i, t) {
	let hist = g_active_warp_maps[i];
	let N = hist.length;

	if (N == 0 || t < hist[0].t0 || t > hist[N - 1].t3) {
		return { 
			mode : -1, 
			raw_str : 0.0,
			peak_str : 0.0,
			t0 : -1.0,
			t1 : -1.0,
			t2 : -1.0,
			t3 : -1.0,
			warp_map : null };
		//console.log(`GetWarpAtTime(${i}, ${t} -> NO GOOD`);//UNDO
	}

	let j = N - 1;
	for (j = N - 1; j >= 0; j--) {
		if (t >= hist[j].t0 && t <= hist[j].t3) {
			break;
		}
	}
		
	const mode = hist[j].mode;
	let str = 0.0;
	if (t <= hist[j].t1) {
		// Fading in.
		str = Math.max(0.0, Math.min(1.0, (t - hist[j].t0) / (hist[j].t1 - hist[j].t0)));
	}	else {
		// Fading out.
		str = 1.0 - Math.max(0.0, Math.min(1.0, (t - hist[j].t2) / (hist[j].t3 - hist[j].t2)));		
	}
	str = smoothstep(str);
	
	//console.log(`GetWarpAtTime(${i}, ${t} -> ${str}`);//UNDO
	
	return { 
		  mode : mode, 
		  raw_str : str * hist[j].peak_str,
			peak_str : hist[j].peak_str,
			t0 : hist[j].t0,
			t1 : hist[j].t1,
			t2 : hist[j].t2,
			t3 : hist[j].t3,
		  warp_map : hist[j].warp_map
  };
}

// Returns an array of 4 { mode, raw_str, balanced_str, warp_map } structs.
function GetWarpsAtTime(t) {
	let ret = [];
	for (let i = 0; i < 4; i++) {
		ret.push(GetWarpAtTime(i, t));
	}

	// Adjust the 4 raw strength values for motion-hogging modes,
	// to get the "balanced" strengths.
	let hog_weight_sum = 0.0;
	for (let i = 0; i < 4; i++) {
		const hog_weight = (ret[i].warp_map == null) ? 0.0 : ret[i].warp_map.warp_prefs.hog_motion_weight * ret[i].raw_str;
		hog_weight_sum += hog_weight;
	}
	for (let i = 0; i < 4; i++) {
		const hog_weight = (ret[i].warp_map == null) ? 0.0 : ret[i].warp_map.warp_prefs.hog_motion_weight * ret[i].raw_str;
		let t = hog_weight * 4 / hog_weight_sum;
		ret[i].bal_str = ret[i].raw_str * t;
	}

	return ret;
}

function DebugWarpSlot(i, motion_time, lookahead) {
	console.log(`time = ${motion_time.toFixed(4)} + ${lookahead.toFixed(4)} = ${(motion_time + lookahead).toFixed(4)}:`);  //UNDO - whole block

	let text = `  i ${i} -> `;
	for (let j = 0; j < g_active_warp_maps[i].length; j++) {		//UNDO
		text += `${g_active_warp_maps[i][j].t0.toFixed(3)} .. ${g_active_warp_maps[i][j].t3.toFixed(3)}, `;
	}
	console.log(text);
}

function DebugWarpSlots(motion_time, lookahead) {
	console.log(`time = ${motion_time.toFixed(4)} + ${lookahead.toFixed(4)} = ${(motion_time + lookahead).toFixed(4)}:`);  //UNDO - whole block
	for (let i = 0; i < 4; i++) {				
		let text = `  i ${i} -> `;
		for (let j = 0; j < g_active_warp_maps[i].length; j++) {		//UNDO
			text += `${g_active_warp_maps[i][j].t0.toFixed(3)} .. ${g_active_warp_maps[i][j].t3.toFixed(3)}, `;
		}
		console.log(text);
	}	
}

function PickRandomWarpMap(avoid_modes) {	
	// Handle override.
	if (g_override_mode >= 0) {
		for (let i = 0; i < g_warp_maps.length; i++) {
			if (g_warp_maps[i].mode == g_override_mode) {
				return g_warp_maps[i].mode;
			}
		}
	}

	//xxx
	//if (g_bkg_warp_map != null) {
	//	return g_bkg_warp_map.mode;
	//}

	// Adjust weights to reflect avoid_modes[],
	// and get the weight sum.
	avoid_modes = avoid_modes || [];		// Make the param optional.
	let adjusted_weights = new Float32Array(g_warp_maps.length);
	let weight_sum = 0.0;
	for (let i = 0; i < g_warp_maps.length; i++) {
		let weight = g_warp_maps[i].weight;
		for (let j = 0; j < avoid_modes.length; j++) {
			if (g_warp_maps[i].mode == avoid_modes[j]) {
				weight = 0;
			}
		}
		adjusted_weights[i] = weight;		
		weight_sum += weight;
	}

	let target = Math.random() * weight_sum;
	let sum = 0.0;
	for (let i = 0; i < g_warp_maps.length; i++) {
		sum += adjusted_weights[i];
		if (sum >= target) {
			return g_warp_maps[i].mode;
		}
	}	
	return g_warp_maps[g_warp_maps.length - 1].mode;
}

// To keep GetNextWarpMapGen deterministic, we generate new values
// here only as needed.
let g_next_fade_in_time = 0.0;
let g_next_duration = 0.0;
let g_next_fade_out_time = 0.0;
function RandomizeNextWarpMapDurations() {
	g_next_fade_in_time = WARP_MAP_FADE_SEC_MIN + 
			(WARP_MAP_FADE_SEC_MAX - WARP_MAP_FADE_SEC_MIN) * Math.random();
	g_next_duration = WARP_MAP_DURATION_SEC_MIN + 
			(WARP_MAP_DURATION_SEC_MAX - WARP_MAP_DURATION_SEC_MIN) * Math.random();
	g_next_fade_out_time = WARP_MAP_FADE_SEC_MIN + 
			(WARP_MAP_FADE_SEC_MAX - WARP_MAP_FADE_SEC_MIN) * Math.random();
}
RandomizeNextWarpMapDurations();

function GetNextWarpMapGen(t, lookahead) {			
	const future_warps = GetWarpsAtTime(t + lookahead); //warp_str = GetBalancedWarpStrengthsAtTime(motion_time);

	// Figure out which warp slot will have 0 strength or be empty FIRST.
	// At the same time, build a list of valid ones at that time, in avoid_modes[].
	let earliest_dead_i = -1;
	let earliest_dead_time = 0.0;
	let avoid_modes = new Array();	
	for (let i = 0; i < 4; i++) {
		if (future_warps[i].mode != -1) {
			// Alive at lookahead time -> add to avoid list.
			avoid_modes.push(future_warps[i].mode);
		} else {
			// Dead at lookahead -> find which one dies first.
			if (g_active_warp_maps[i].length > 0) {
				const last = g_active_warp_maps[i][g_active_warp_maps[i].length - 1];
				if (earliest_dead_i == -1 || last.t3 < earliest_dead_time) {
			    earliest_dead_i = i;
			    earliest_dead_time = last.t3;
				}
			} else {
				// Empty slot -> needs filling immediately.
				if (earliest_dead_i == -1 || t < earliest_dead_time) {
			    earliest_dead_i = i;
			    earliest_dead_time = t - g_next_fade_in_time;
				}
			}
		}
	}

	// If all 4 are alive at the lookahead, then we're fine; do nothing.	

	const mode = PickRandomWarpMap(avoid_modes);
	
	const t0 = (earliest_dead_i >= 0) ? earliest_dead_time : (t - g_next_fade_in_time);
	const t1 = t0 + g_next_fade_in_time;
	const t2 = t1 + g_next_duration;
	const t3 = t2 + g_next_fade_out_time;
	
	return { earliest_dead_i, earliest_dead_time, mode, t0, t1, t2, t3 };
}

//// Returns the z-component of cross(a, b): i.e., sin(theta) with sign.
//// If either vector is zero-length, returns 0 (avoids NaN / Infinity).
//function CrossNormalize2D(ax, ay, bx, by) {
//  const cz = ax * by - ay * bx;
//  const a2 = ax * ax + ay * ay;
//  const b2 = bx * bx + by * by;
//  const denom = Math.sqrt(a2 * b2);
//  return (denom > 0) ? (cz / denom) : 0;
//}
//
//// Assumes both input vectors are already normalized.
//function Cross2D(ax, ay, bx, by) {
//  return ax * by - ay * bx;
//}

function blendStructs(prefs, weights) {
  if (prefs.length !== weights.length) {
    throw new Error(`blendStructs: prefs.length (${prefs.length}) != weights.length (${weights.length})`);
  }
  if (prefs.length === 0) {
    throw new Error("blendStructs: empty prefs array");
  }

  const wsum = weights.reduce((a, b) => a + b, 0);
  if (wsum === 0) {
    throw new Error("blendStructs: weight sum is 0");
  }

  const out = {};

  // Union of keys across all pref objects
  const keys = new Set();
  for (const p of prefs) {
    for (const k of Object.keys(p)) keys.add(k);
  }

  for (const k of keys) {
    let acc = 0;
    let sawNumber = false;

    for (let i = 0; i < prefs.length; i++) {
      const v = prefs[i][k];
      if (typeof v === "number") {
        acc += weights[i] * v;
        sawNumber = true;
      }
    }

    // Numeric keys get blended; non-numeric keys copied from prefs[0] (policy choice).
    out[k] = sawNumber ? (acc / wsum) : prefs[0][k];
  }

  return out;
}

function RandBetween(lo, hi) {
	return lo + (hi - lo) * Math.random();
}

/**
 * Linearly resample a Float32Array to any length.
 * - Upsampling (outLen >= inLen): point-sampled linear interpolation.
 * - Downsampling (outLen <  inLen): integrates the piecewise-linear signal and
 *   outputs the average over each output bin (anti-aliased / area resample).
 * - Preserves endpoints exactly when outLen >= 2 (out[0]=input[0], out[last]=input[last]).
 *
 * @param {Float32Array} input
 * @param {number} outLen  Desired output length (>= 0)
 * @returns {Float32Array}
 */
export function linearResampleF(input, outLen) {
  const inLen = input.length;

  if ((outLen | 0) !== outLen || outLen < 0) {
    throw new Error(`linearUpsampleF: outLen must be a non-negative integer (got ${outLen})`);
  }
  if (outLen === inLen) {
    return new Float32Array(input); // copy
  }
  if (outLen === 0 || inLen === 0) {
    return new Float32Array(0);
  }
  if (inLen === 1) {
    const out = new Float32Array(outLen);
    out.fill(input[0]);
    return out;
  }
  if (outLen === 1) {
    // Single output: return the average value of the whole piecewise-linear signal.
    // Domain is [0 .. inLen-1]. Average = integral / (inLen-1).
    const L = inLen - 1;
    let area = 0.0;
    for (let i = 0; i < L; i++) area += 0.5 * (input[i] + input[i + 1]);
    return new Float32Array([area / L]);
  }

  const out = new Float32Array(outLen);
  const L = inLen - 1;

  // If we're upsampling, keep the fast point-sample linear interpolation path.
  if (outLen > inLen) {
    const scale = L / (outLen - 1); // endpoints align
    for (let i = 0; i < outLen; i++) {
      const pos = i * scale;
      const idx = pos | 0;
      if (idx >= L) {
        out[i] = input[L]; // exact endpoint
      } else {
        const frac = pos - idx;
        const a = input[idx];
        const b = input[idx + 1];
        out[i] = a + (b - a) * frac;
      }
    }
    return out;
  }

  // Downsampling (or equal-size handled above): area resample by integrating the
  // piecewise-linear function defined by the samples.
  //
  // Output sample positions (for endpoint matching):
  //   p[i] = i * L / (outLen - 1)
  // Bin edges are midpoints between neighboring p's:
  //   e[0] = 0
  //   e[i] = 0.5*(p[i-1] + p[i]) for 1<=i<=outLen-2
  //   e[outLen-1] = L
  //
  // Then out[i] = (1/(e[i+1]-e[i])) * integral_{e[i]}^{e[i+1]} f(x) dx

  // Prefix areas over integer segments: A[k] = integral from 0 to k.
  // A has length inLen; A[0]=0, A[inLen-1]=total area over [0..L].
  const A = new Float32Array(inLen);
  for (let i = 0; i < L; i++) {
    A[i + 1] = A[i] + 0.5 * (input[i] + input[i + 1]);
  }

  // Antiderivative F(x) for x in [0..L], where f is piecewise-linear between samples.
  function F(x) {
    if (x <= 0) return 0.0;
    if (x >= L) return A[L];

    const i = x | 0;           // floor
    const t = x - i;           // in [0,1)
    const y0 = input[i];
    const y1 = input[i + 1];
    const dy = y1 - y0;

    // Integral from i to i+t of y0 + dy*s is:
    // y0*t + 0.5*dy*t^2
    return A[i] + (y0 * t) + (0.5 * dy * t * t);
  }

  const pos_scale = L / (outLen - 1);

  // Compute p[i] on the fly and bin edges via midpoints.
  // e0 = 0
  let prev_p = 0.0; // p[0]
  let left = 0.0;   // e[0]

  for (let i = 0; i < outLen; i++) {
    const p = i * pos_scale;

    // right edge:
    let right;
    if (i === outLen - 1) {
      right = L; // e[outLen] conceptually; but our last bin's right edge is L
    } else {
      const next_p = (i + 1) * pos_scale;
      right = 0.5 * (p + next_p);
    }

    // Compute average over [left, right]
    const width = right - left;
    if (width <= 0) {
      // Shouldnt happen, but avoid divide-by-zero if something weird occurs.
      out[i] = input[(p + 0.5) | 0];
    } else {
      out[i] = (F(right) - F(left)) / width;
    }

    left = right;
    prev_p = p;
  }

  // For downsampling, the bins already include the ends, but if you want to
  // *force* exact endpoint values you can uncomment these:
  // out[0] = input[0];
  // out[outLen - 1] = input[inLen - 1];

  return out;
}

// Returns B' = B + k*2 such that B' is within +/-  of A (i.e. B' - A  [-, +])
function WrapAngleNear(A, B) {
  const TWO_PI = Math.PI * 2;

  // Shift B by the nearest multiple of 2 to A.
  let B2 = B + TWO_PI * Math.round((A - B) / TWO_PI);

  // If you care about the tie case landing exactly at + (rare), you can force it to -:
  // if (B2 - A > Math.PI) B2 -= TWO_PI;
  // if (B2 - A < -Math.PI) B2 += TWO_PI;

  return B2;
}

// Bias 'theta' toward the nearest multiple of Pi, using smoothstep.
// 'iters' can be non-integer but must be between 0 and 10.
function BiasTowardHorizontal(theta, iters = 1.0) {
	iters = Math.max(0.0, Math.min(10.0, iters));
	const t = theta / Math.PI;
	const base = Math.floor(t);
	let dt = t - base;
	
	while (iters > 0.0) {
		const dt2 = smoothstep(dt);
		const write_frac = Math.min(iters, 1.0);
		dt = dt2 * write_frac + (1.0 - write_frac) * dt;		
		iters -= 1.0;				
	}

	return (base + dt) * Math.PI;
}

function GetDiag(w, h) {
	return Math.sqrt(w * w + h * h) | 0;
}

export class Engine {
  // cw, ch: client size
  // iw, ih: index buffer size (might be 2x smaller, 3x smaller, etc)
  constructor(presenter, cw, ch, iw, ih, motion_time) {
    this.cw = cw;
    this.ch = ch;
    this.iw = iw;
    this.ih = ih;

    // Double buffers of indices
    // TODO: nuke these 4
    this.a = new Uint8Array(this.iw * this.ih);
    this.b = new Uint8Array(this.iw * this.ih);
    this.front = this.a;
    this.back = this.b;

		this.presenter = presenter;

    // Starter: seed with a small blob so feedback has something to warp
    this.seed();
		
		this.RandomizeActiveWarpMaps(motion_time);
		
    // Palette
    this.paletteRGBA = new Float32Array(256 * 4);  // values in [0..1+], where 1 is SDR white.

		
		//this.bass_att = 1.0;
		//this.mid_att = 1.0;
		//this.high_att = 1.0;
		//this.vol_att = 1.0;
		//this.bass_prev = 1.0;
		//this.mid_prev = 1.0;
		//this.high_prev = 1.0;
		//this.vol_prev = 1.0;

		//this.burn_text_time = -1;

    this.t = 0;
  }

	// Does a hard cut.
	RandomizeActiveWarpMaps(motion_time) {
		let avoid_modes = new Array();
		for (let i = 0; i < 4; i++) {
			let mode = PickRandomWarpMap(avoid_modes);

			// Reset the history.
			g_active_warp_maps[i] = [];

			// Compute the normal duration.
			let duration = WARP_MAP_DURATION_SEC_MIN + 
					(WARP_MAP_DURATION_SEC_MAX - WARP_MAP_DURATION_SEC_MIN) * Math.random();
			let fade_time = WARP_MAP_FADE_SEC_MIN + 
					(WARP_MAP_FADE_SEC_MAX - WARP_MAP_FADE_SEC_MIN) * Math.random();

			// Shift times back a bit, randomly, so they don't all fade out at the same time.
			//duration *= 0.4 + 0.6 * Math.random();
			let already_elapsed = duration * Math.random() * 0.6;

			let t0 = motion_time - already_elapsed - fade_time;
			let t1 = motion_time - already_elapsed;
			let t2 = motion_time - already_elapsed + duration;
			let t3 = motion_time - already_elapsed + duration + fade_time;
					
			console.log(`Generating fresh warp map (blocking).`);
			g_active_warp_maps[i].push(new ActiveWarpMap2(mode, t0, t1, t2, t3, 1.0));

			avoid_modes.push(mode);
		}
		
		g_re_blend_motion_metadata = true;	//xxx
	}
	
	SetMotionModeDebug(mode, motion_time) {
		for (let i = 0; i < 4; i++) {
			// Only use 'mode' for the first warp map.
			// The others will all be strength 0, so use a dummy map.
			const this_mode = mode;//((i == 0) ? mode : 99);
			
			// Compute the normal duration.
			let duration = WARP_MAP_DURATION_SEC_MIN + 
					(WARP_MAP_DURATION_SEC_MAX - WARP_MAP_DURATION_SEC_MIN) * Math.random();
			let fade_time = WARP_MAP_FADE_SEC_MIN + 
					(WARP_MAP_FADE_SEC_MAX - WARP_MAP_FADE_SEC_MIN) * Math.random();

			let t0 = motion_time - fade_time;
			let t1 = motion_time;
			let t2 = motion_time + duration;
			let t3 = motion_time + duration + fade_time;
			
			let peak_str = (i == 0) ? 1.0 : 0.0000001;
						
			g_active_warp_maps[i] = [];
			g_active_warp_maps[i].push(new ActiveWarpMap2(this_mode, t0, t1, t2, t3, peak_str));
			g_bkg_warp_map = null;
		}

		g_re_blend_motion_metadata = true;
	}
	
	GetMotionDebugInfo(motion_time) {
		let text = new Array();
		//let single_warp_active = true;

		const warps = GetWarpsAtTime(motion_time); //balanced_warp_str = GetBalancedWarpStrengthsAtTime(motion_time);
		
	  for (let i = 0; i < 4; i++) {
			let mode = warps[i].mode;
			let raw_str = warps[i].raw_str;
			let bal_str = warps[i].bal_str;
			let mode_as_text = `${mode}`;
	  	text.push(`warp ${i}:  mode ${mode_as_text.padStart(2, " ")}  raw_str ${raw_str.toFixed(2)}  bal_str ${bal_str.toFixed(2)}`);
	  }

		text.push(`last blended net_motion           ${g_last_blended_net_motion.toFixed(2)}`);
		text.push(`last blended net_zoom_motion      ${g_last_blended_net_zoom_motion.toFixed(2)}`);
		text.push(`last blended in_or_out_motion     ${g_last_blended_in_or_out_motion.toFixed(2)}`);
		text.push(`last blended net_clockwise_motion ${g_last_blended_net_clockwise_motion.toFixed(2)}`);
		text.push(`last blended cw_or_ccw_motion     ${g_last_blended_cw_or_ccw_motion.toFixed(2)}`);
		
		if (g_last_blended_center_trace != null) {
			text.push(`last blended cx  ${g_last_blended_center_trace.cx.toFixed(2)}`);
			text.push(`last blended cy  ${g_last_blended_center_trace.cy.toFixed(2)}`);
			text.push(`last blended rad ${g_last_blended_center_trace.rad.toFixed(3)}`);
		}
		
		return text;	
	}

  // cw, ch: client size
  // iw, ih: index buffer size (might be 2x smaller, 3x smaller, etc)
  resize(cw, ch, iw, ih) {
    this.cw = cw;
    this.ch = ch;
    this.iw = iw;
    this.ih = ih;

		// TODO: resample the old image into the new one.
    this.a = new Uint8Array(this.iw * this.ih);
    this.b = new Uint8Array(this.iw * this.ih);
    this.front = this.a;
    this.back = this.b;

    this.seed();
  }

  seed() {  
    // Full-frame random noise so warp is immediately visible
    for (let i = 0; i < this.front.length; i++) {
      this.front[i] = Math.random() * 31 | 0;
    }
  }

  update(dt, audioFrame) {
    this.t += dt;
    this.audio = audioFrame;
  }
	
  render(time_now, motion_time, wave_time, shift_time, frame, randomize_motion, randomize_wave, fps, 
  			 wave_smoothing, user_wave_point_size, xy_oscilloscope_gap, beat, user_motion_scale,
  			 frozen, experiment, embed_string, darkening, align_frac,
     		 toggle_grid_dots, toggle_fading_dots, toggle_random_beat_dots, toggle_radial_beat_dots,
  			 last_param) {
  			 //bpm, bpm_confidence) {
		const W = this.iw;
		const H = this.ih;
		const diagonal = Math.sqrt(W * W + H * H) | 0;

		if (last_param != "this_is_the_last_param") {
			console.log("ERROR: Parameter integrity check failed");
			ShowError("ERROR: Parameter integrity check failed (Engine::render)");
			return;
		}
  	
    //const { W, H } = this;

		if (randomize_motion) {
			this.RandomizeActiveWarpMaps(motion_time);
		}

		const bkg_gen_lookahead = NEW_WAVE_MOTION_TIME_LOOKAHEAD_SEC + 4.0;

		// Kick off bkg warp map generation, if needed.
		//console.log(`### ${g_bkg_warp_map_in_progress}, ${g_bkg_warp_map}`); //UNDO
		if (!g_bkg_warp_map_in_progress && g_bkg_warp_map == null) {
			// Are any warp maps not yet generated at the lookahead time?
			const next_gen = GetNextWarpMapGen(motion_time, bkg_gen_lookahead);
			
			if (next_gen.earliest_dead_i >= 0) {
				//console.log(`### starting bkg job, t0 = ${next_gen.t0}`);//UNDO
				const payload = { 
					mode : next_gen.mode, 
					i : next_gen.earliest_dead_i,
					t0 : next_gen.t0, 
					t1 : next_gen.t1, 
					t2 : next_gen.t2, 
					t3 : next_gen.t3 };
				start_job(payload);
			}	else {
				//console.log(`### nothing needed to generate`);//UNDO
			}
		}



		// Use the bkg warp map, if it is ready.
		if (g_bkg_warp_map != null) {
			// Check if the background map's slot still needs a map at lookahead time,
			// rather than requiring it to be the *earliest* dead slot.
			const i = g_bkg_warp_map.i;
	    const future_warp_i = GetWarpAtTime(i, motion_time + bkg_gen_lookahead);
	    if (future_warp_i.mode == -1) {
        // This slot is dead at lookahead time, so the bkg map is still useful.
        if (g_verbose_warp_slots) console.log(`Using bkg-generated warp map, slot ${i}`);
        g_active_warp_maps[i].push(new ActiveWarpMap2(
            g_bkg_warp_map.mode,
            g_bkg_warp_map.t0,
            g_bkg_warp_map.t1,
            g_bkg_warp_map.t2,
            g_bkg_warp_map.t3,
            1.0,
            g_bkg_warp_map.warp_map));
        g_bkg_warp_map = null;
        RandomizeNextWarpMapDurations();
	    } else {
        // The slot got filled by something else in the meantime -- discard.
        console.log(`Clearing g_bkg_warp_map as slot ${i} is already covered at lookahead time.`);
        g_bkg_warp_map = null;
	    }
		}

		// Generate new warp map(s) on-demand if needed.
		const lookahead = NEW_WAVE_MOTION_TIME_LOOKAHEAD_SEC;
		let next_gen = GetNextWarpMapGen(motion_time, lookahead);
		while (next_gen.earliest_dead_i >= 0) {
			// We need a new map, but it hasn't been background-generated yet.
			const i = next_gen.earliest_dead_i;
			//xxx - this seems to be happening way too often...
			console.log(`Generating warp map on demand (slot ${i}, time ${motion_time + lookahead}, `);
			//console.log(`Background warp map was not ready, g_bkg_warp_map_in_progress=${g_bkg_warp_map_in_progress}, time ${motion_time}, (slot ${i}, t0 ${next_gen.t0}) -> generated one in PRIMARY thread.`);

			if (g_verbose_warp_slots) DebugWarpSlot(i, motion_time, lookahead);//UNDO				
			
			g_active_warp_maps[i].push(new ActiveWarpMap2(
					next_gen.mode, next_gen.t0, next_gen.t1, next_gen.t2, next_gen.t3, 1.0));

			RandomizeNextWarpMapDurations();

			// Check to see if we need to make ANOTHER one.			
			next_gen = GetNextWarpMapGen(motion_time, lookahead);			
		}





		// Generate a new waveform?
		const set_wave0 = (randomize_wave || g_wave0 == null);
		const set_wave1 = (wave_time > g_wave0_start_fade_time && g_wave1 == null);
		if (set_wave0 || set_wave1 || g_re_blend_motion_metadata) {
			// Blend the wave preferences together for the 4 current warp maps.
			const time = (set_wave1) 
					? (motion_time + NEW_WAVE_MOTION_TIME_LOOKAHEAD_SEC)
					: (motion_time);
			let warps = GetWarpsAtTime(time); //warp_str = GetBalancedWarpStrengthsAtTime(motion_time);
			let warp_bal_str = new Float32Array(4);  //xxx - rename to warp_bal_str
			let prefs = new Array(4);
			let weights = new Float32Array(4);			
			for (let i = 0; i < 4; i++) {
				warp_bal_str[i] = Math.max(0.00001, warps[i].bal_str);
//xxx; - warp_map is sometimes null here, when you go super fast.				
//...probably because we don't generate the needed new maps until further down.
				prefs[i] = warps[i].warp_map.warp_prefs;
				weights[i] = warp_bal_str[i] * prefs[i].wave_prefs_weight;
			}
			const p = blendStructs(prefs, weights);

			let params = {
				wave_flat_str   : 0.0,		  // [0..1]
				wave_flat_angle : 0.0,	  	// [0..2PI]
				wave_flat_scale : 1.0,      // ~1
				wave_flat_is_stereo : 0,		// [0..1]
				wave_flat_stereo_sep : 0.6,  // [0..1]
				wave_flat_stereo_amplitude_scale : 1.0,  // ~1
				wave_flat_cx    : 0.0,		// [1..1]
				wave_flat_cy    : 0.0,		// [1..1]
				
				wave_circ_str   : 0.0,		// [0..1]
				wave_circ_rad   : 1.0,		// ~1
				wave_circ_scale : 1.0,    // ~1
				wave_circ_angle : 0.0,    // [0 .. 2PI]
				wave_circ_cx    : 0.0,		// [1..1]
				wave_circ_cy    : 0.0,		// [1..1]

				radial_beat_dots : 0.0,		// Note: further reduced dynamically when motion is not zoomy.
				random_beat_dots : 0.0,		
				fading_dots      : 0.0,
				grid_dots        : 0.0,
			};

		  // Compute the *weighted sum* (not weighted average) 
		  //   of the motion metadata for the 4 active warp maps,
		  //   with their current weights, to get the net motion
		  //   at the desired (~lookahead) time.
		  // Then use the net motion metadata to decide whether we 
		  //   use a flat or circular wave.
		  let flat_w = 1.0;
		  let circ_w = 0.25;
		  let both_w = 0.01;
		  {
				let net_motion = 0.0;
				let net_zoom_motion = 0.0;
				let in_or_out_motion = 0.0;
				let net_clockwise_motion = 0.0;
				let cw_or_ccw_motion = 0.0;
				for (let i = 0; i < 4; i++) {
					net_motion           += prefs[i].net_motion * warp_bal_str[i];
					net_zoom_motion      += prefs[i].net_zoom_motion * warp_bal_str[i];
					in_or_out_motion     += prefs[i].in_or_out_motion * warp_bal_str[i];
					net_clockwise_motion += prefs[i].net_clockwise_motion * warp_bal_str[i];
					cw_or_ccw_motion     += prefs[i].cw_or_ccw_motion * warp_bal_str[i];
				}
				g_last_blended_net_motion = net_motion;
				g_last_blended_net_zoom_motion = net_zoom_motion;
				g_last_blended_in_or_out_motion = in_or_out_motion;
				g_last_blended_net_clockwise_motion = net_clockwise_motion;
				g_last_blended_cw_or_ccw_motion = cw_or_ccw_motion;

				g_last_blended_center_trace = FindBlendedWarpCenter(
			      warps[0].warp_map,
			      warps[1].warp_map,
			      warps[2].warp_map,
			      warps[3].warp_map,
			      warp_bal_str[0],
			      warp_bal_str[1],
			      warp_bal_str[2],
			      warp_bal_str[3],
			      this.iw,
			      this.ih
    		);				

				g_re_blend_motion_metadata = false;

				


				const zoom_thresh_scale = 1.8;

				// Crush the circular wave probability to 0 unless we have
				// a lot of radial motion.
				{
					const lo = zoom_thresh_scale * 0.2;
					const hi = zoom_thresh_scale * 0.35;
					let t = Math.max(0.0, Math.min(1.0, (in_or_out_motion	- lo) / (hi - lo)));	
					circ_w *= t;
				  both_w *= t;
				}

				// If very zoomy, (randomly) decrease the stereo separation.
				// TODO: Also decrease the amplitude -- but only for the stereo case.
				{
					const lo = zoom_thresh_scale * 0.25;
					const hi = zoom_thresh_scale * 0.35;
					let t = Math.max(0.0, Math.min(1.0, (net_zoom_motion	- lo) / (hi - lo)));	
					t = 1 - 0.5 * t * Math.random();
					p.flat_stereo_sep_lo *= t;
					p.flat_stereo_sep_hi *= t;
				}

				// If VERY zoomy, (randomly) decrease the circle radius.
				{
					const lo = zoom_thresh_scale * 0.3;
					const hi = zoom_thresh_scale * 0.5;
					let t = Math.max(0.0, Math.min(1.0, (net_zoom_motion	- lo) / (hi - lo)));	
					t = 1 - 0.5 * t * Math.random();
					p.circ_rad_lo *= t;
					p.circ_rad_hi *= t;
				}
				
				// Sometimes center the wave at the center of the motion.
				{
					// Only do it sometimes.
					let t = (Math.random() < p.use_motion_center_as_wave_center_prob) ? 1.0 : 0.0;
					
					// When we do it, sometimes do it fractionally.
					t *= Math.pow(Math.random(), p.use_motion_center_as_wave_center_power);
										
					p.flat_cx_lo = lerp(p.flat_cx_lo, g_last_blended_center_trace.cx, t);
					p.flat_cx_hi = lerp(p.flat_cx_hi, g_last_blended_center_trace.cx, t);
					p.flat_cy_lo = lerp(p.flat_cy_lo, g_last_blended_center_trace.cy, t);
					p.flat_cy_hi = lerp(p.flat_cy_hi, g_last_blended_center_trace.cy, t);
					p.circ_cx_lo = lerp(p.circ_cx_lo, g_last_blended_center_trace.cx, t);
					p.circ_cx_hi = lerp(p.circ_cx_hi, g_last_blended_center_trace.cx, t);
					p.circ_cy_lo = lerp(p.circ_cy_lo, g_last_blended_center_trace.cy, t);
					p.circ_cy_hi = lerp(p.circ_cy_hi, g_last_blended_center_trace.cy, t);
				} 
		  	
				//warp_prefs.type_circ_prob = 0.01 + warp_prefs.type_flat_prob * very_zoomy;
			}

			// Choose the wave type: flat, circular, or both -
			// and set the strength values accordingly.
			let t = Math.random() * (flat_w + circ_w + both_w);
			if (t < flat_w) {
				params.wave_flat_str = 1.0;
			} else if (t < flat_w + circ_w) {
				params.wave_circ_str = 1.0;
			} else {
				params.wave_flat_str = 1.0;
				params.wave_circ_str = 1.0;
			}
			
			if (params.wave_flat_str > 0.0001) {
				params.wave_flat_angle = BiasTowardHorizontal(
						RandBetween(p.flat_angle_lo, p.flat_angle_hi), 
						p.flat_angle_bias_toward_horizontal_angles);
				params.wave_flat_scale = p.flat_scale;
				params.wave_flat_is_stereo = (Math.random() < p.flat_is_stereo_chance) ? 1 : 0;
				params.wave_flat_stereo_sep = RandBetween(p.flat_stereo_sep_lo, p.flat_stereo_sep_hi);
				params.wave_flat_stereo_amplitude_scale = p.flat_stereo_amplitude_scale;
				params.wave_flat_cx = RandBetween(p.flat_cx_lo, p.flat_cx_hi);
				params.wave_flat_cy = RandBetween(p.flat_cy_lo, p.flat_cy_hi);
				//console.log(`wave_flat_angle lo..hi = ${p.flat_angle_lo} .. ${p.flat_angle_hi}`);
				//console.log(`wave_flat_angle = ${params.wave_flat_angle}`);
			}

			if (params.wave_circ_str > 0.0001) {
				params.wave_circ_rad = RandBetween(p.circ_rad_lo, p.circ_rad_hi);
				params.wave_circ_scale = p.circ_scale;
				params.wave_circ_angle = Math.random() * 6.28;		
				params.wave_circ_cx = RandBetween(p.circ_cx_lo, p.circ_cx_hi);
				params.wave_circ_cy = RandBetween(p.circ_cy_lo, p.circ_cy_hi);
			}

			// Special case: Wrap the angle.
			// Do this always -- even if params.wave_flat_str is 0.
			if (set_wave1 && g_wave0 != null) {
				if (g_wave0.wave_flat_str > 0.0001) {
					if (params.wave_flat_str > 0.0001) {
						// Fading flat -> flat; wrap the angle.
						params.wave_flat_angle = WrapAngleNear(g_wave0.wave_flat_angle, params.wave_flat_angle);
					} else {
						// Fading from flat to circ -> just clone the angle,
						// to prevent unnecessary rotation of the flat wave.
						params.wave_flat_angle = g_wave0.wave_flat_angle;					
					}
				} else {
					if (params.wave_flat_str > 0.0001) {
						// Fading from circ to flat -> match old flat angle to new,
						// to avoid unnecessary rotation of the flat wave.
						g_wave0.wave_flat_angle = params.wave_flat_angle;
					} else {
						// Fading from circ to circ -> do nothing.
					}
				}
			}
			
			params.radial_beat_dots = (Math.random() < p.radial_beat_dots_prob) ? 1.0 : 0.0;
			params.random_beat_dots = (Math.random() < p.random_beat_dots_prob) ? 1.0 : 0.0; 
			params.fading_dots = (Math.random() < p.fading_dots_prob) ? 1.0 : 0.0;     
			params.grid_dots = (Math.random() < p.grid_dots_prob) ? 1.0 : 0.0;
			
			
			//console.log(`grid_dots_prob ${p.grid_dots_prob}`);
			//console.log(`grid_dots ${params.grid_dots}`);
			//console.log(`cx, cy  ${cx}, ${cy}`);
			//console.log(`stereo ${params.wave_flat_is_stereo}   sep ${params.wave_flat_stereo_sep}`);

			if (set_wave0) {
				g_wave0 = params;
				// Note: for waveforms, we intentionally wait to select the
				// next one until the last possible moment.
				g_wave1 = null;
				g_wave0_start_fade_time = wave_time + RandBetween(WAVE_DURATION_SEC_MIN, WAVE_DURATION_SEC_MAX);
				g_wave0_end_fade_time = g_wave0_start_fade_time + RandBetween(WAVE_FADE_SEC_MIN, WAVE_FADE_SEC_MAX);
			}
			if (set_wave1) {
				g_wave1 = params;
			}
		}

//			g_wave0 = { wave_flat, wave_circ };
//			g_wave1 = null;
//			g_wave0_start_fade_time = wave_time + RandBetween(WAVE_DURATION_SEC_MIN, WAVE_DURATION_SEC_MAX);
//			g_wave0_end_fade_time = g_wave0_start_fade_time + RandBetween(WAVE_FADE_SEC_MIN, WAVE_FADE_SEC_MAX);

		if (toggle_grid_dots) {
			if (wave_time < g_wave0_start_fade_time) {
				g_wave0.grid_dots = !g_wave0.grid_dots;	
			} else if (wave_time < (g_wave0_start_fade_time + g_wave0_end_fade_time) * 0.5) {
				g_wave0.grid_dots = !g_wave0.grid_dots;	
				g_wave1.grid_dots = g_wave0.grid_dots;		// [sic]
			} else {
				g_wave1.grid_dots = !g_wave1.grid_dots;	
				g_wave0.grid_dots = g_wave1.grid_dots;		// [sic]
			}
		}
		if (toggle_fading_dots) {
			if (wave_time < g_wave0_start_fade_time) {
				g_wave0.fading_dots = !g_wave0.fading_dots;	
			} else if (wave_time < (g_wave0_start_fade_time + g_wave0_end_fade_time) * 0.5) {
				g_wave0.fading_dots = !g_wave0.fading_dots;	
				g_wave1.fading_dots = g_wave0.fading_dots;		// [sic]
			} else {
				g_wave1.fading_dots = !g_wave1.fading_dots;	
				g_wave0.fading_dots = g_wave1.fading_dots;		// [sic]
			}
		}
		if (toggle_random_beat_dots) {
			if (wave_time < g_wave0_start_fade_time) {
				g_wave0.random_beat_dots = !g_wave0.random_beat_dots;	
			} else if (wave_time < (g_wave0_start_fade_time + g_wave0_end_fade_time) * 0.5) {
				g_wave0.random_beat_dots = !g_wave0.random_beat_dots;	
				g_wave1.random_beat_dots = g_wave0.random_beat_dots;		// [sic]
			} else {
				g_wave1.random_beat_dots = !g_wave1.random_beat_dots;	
				g_wave0.random_beat_dots = g_wave1.random_beat_dots;		// [sic]
			}
		}
		if (toggle_radial_beat_dots) {
			if (wave_time < g_wave0_start_fade_time) {
				g_wave0.radial_beat_dots = !g_wave0.radial_beat_dots;	
			} else if (wave_time < (g_wave0_start_fade_time + g_wave0_end_fade_time) * 0.5) {
				g_wave0.radial_beat_dots = !g_wave0.radial_beat_dots;	
				g_wave1.radial_beat_dots = g_wave0.radial_beat_dots;		// [sic]
			} else {
				g_wave1.radial_beat_dots = !g_wave1.radial_beat_dots;	
				g_wave0.radial_beat_dots = g_wave1.radial_beat_dots;		// [sic]
			}
		}



		// Blend between g_wave0 and g_wave1.
		let params = g_wave0;
		if (wave_time > g_wave0_start_fade_time) {
			if (wave_time < g_wave0_end_fade_time) {
				// Blend the two structs.
				let t = Math.max(0.0, Math.min(1.0,
						(wave_time - g_wave0_start_fade_time) /
						(g_wave0_end_fade_time - g_wave0_start_fade_time)));

				t = smoothstep(t);
	
				let weights = [ 1.0 - t, t ];
	
				let structs = [ g_wave0, g_wave1 ];
				params = blendStructs(structs, weights);
			} else {
				// The blend is complete.
				g_wave0 = g_wave1;
				g_wave1 = null;
				g_wave0_start_fade_time = wave_time + RandBetween(WAVE_DURATION_SEC_MIN, WAVE_DURATION_SEC_MAX);
				g_wave0_end_fade_time = g_wave0_start_fade_time + RandBetween(WAVE_FADE_SEC_MIN, WAVE_FADE_SEC_MAX);				
	
				params = g_wave0;
			}
		}

		


		// Band analysis:
		// (this.audio.bandEnergy.bass, this.audio.bandEnergy.mid, this.audio.bandEnergy.high)
		//...
//		let bass = this.audio.bandEnergy.bass;
//		let mid  = this.audio.bandEnergy.mid;
//		let high = this.audio.bandEnergy.high;
//		let vol  = this.audio.bandEnergy.vol;
//		const att = 0.99;
//		this.bass_att = this.bass_att * att + (1 - att) * bass;
//		this.mid_att  = this.mid_att  * att + (1 - att) * mid;
//		this.high_att = this.high_att * att + (1 - att) * high;
//		this.vol_att  = this.vol_att  * att + (1 - att) * vol;
//
//		const decay = 0.98;
//		bass = Math.max(this.bass_att * decay, bass);
//		mid  = Math.max(this.mid_att  * decay, mid);
//		high = Math.max(this.high_att * decay, high);
//		vol  = Math.max(this.vol_att  * decay, vol);
//
//		this.bass_prev = bass;
//		this.bass_mid  = mid;
//		this.bass_high = high;
//		this.bass_vol  = vol;





		const warps = GetWarpsAtTime(motion_time); //warp_str = this.GetBalancedWarpStrengthsAtTime(motion_time);
		let final_warp_str = new Float32Array(4);
		for (let i = 0; i < 4; i++) {
			// Adjust for FPS.
			final_warp_str[i] = warps[i].bal_str * BASE_MOTION_SCALE * user_motion_scale / fps;
			
			// Breathing:
			final_warp_str[i] *= 1.0 + 0.2 * Math.cos(shift_time * 0.7 + i * 6.28 / 4);

			// Update warp map (if needed).
			this.presenter.SetWarpMap(i, warps[i].warp_map.src_dxy);			
		}




		// Determine shift_x and shift_y, in pixels.
		let shift_x = 0.0;
		let shift_y = 0.0;
		{
			const shift_mag = 
					BASE_MOTION_SCALE * user_motion_scale * diagonal / fps * 0.000121 * SHIFT_MAGNITUDE;
			
			const speed = SHIFT_FREQ;
			const t = shift_time * 60;
			shift_x = shift_mag *
					(Math.cos(t * 0.01171 * speed + 0) * 2 +
					 Math.cos(t * 0.00111 * speed + 3) * 2);
			shift_y = shift_mag *
					(Math.cos(t * 0.00874 * speed + 1) * 1.3 +
					 Math.cos(t * 0.00351 * speed + 2) * 1.3);

			// Hacked no-motion modes:
			if (g_active_warp_maps[0].mode == 98) {
				shift_x = 0.0;
				shift_y = 0.0;
			}
			if (g_active_warp_maps[0].mode == 99) {
				shift_x = 0.0;
				shift_y = -5.0;
			}

		}
				
		// Base this on real time, not motion_time, which looks funny if the user
		// cranks the transition speed way up.


		const wave_mag_scale = 1.0;

		// This is the diagonal size at which we jump from 1x1 dots 
		//   to proportionally larger, anti-aliased dots.
		// Note that below this, the wave doesn't need adjustment, since
		//   extra samples are not drawn more densely -- the wave is essentially
		//   cropped (more samples end up offscreen).
  	const diag1 = GetDiag(2060, 1430);
  	//const diag2 = GetDiag(3024, 1964);  // macbook @ highest res
  	//const diag2 = GetDiag(6016, 3384);  // XDR display max res
		const wave_point_size_in_pixels = Math.max(1.0, diagonal / diag1);    // > 2.0
		
		
    let dots = 
    		this.generateWaveformPoints(params, wave_point_size_in_pixels, wave_smoothing, xy_oscilloscope_gap, wave_mag_scale, align_frac, experiment);



		if (beat) {
			let beat_dots = {
				dot_rad : 0.0025 + Math.random() * 0.0025*10,
				dot_count : Math.pow(2.0, 4 + 3 * Math.random()),
				intensity : 32 + Math.random() * 128,
			};
			let intensity = beat_dots.dot_rad * beat_dots.dot_rad * beat_dots.dot_count * beat_dots.intensity;
			const kTargetIntensity = (0.08 + 0.08 * Math.random()) * 1.5;
			const adj = Math.pow(kTargetIntensity / intensity, 0.25);
			beat_dots.dot_rad *= adj * adj;
			beat_dots.dot_count *= adj;
			beat_dots.intensity *= adj;

			const r = (beat_dots.dot_rad * diagonal) | 0;			
			const flat_shading = (Math.random() < 0.25);

			const inv_r = 1.0 / r;
			
			if (params.radial_beat_dots > 0.001) {	
				const v = (beat_dots.intensity * params.radial_beat_dots) | 0;
				const circ_rad = 0.2 + 0.35 * Math.random();
				const count = (beat_dots.dot_count / 2) | 0;
				for (let i = 0; i < count; i++) {
					let theta = i * Math.PI * 2 / count;
					let fcx = Math.cos(theta) * circ_rad;
					let fcy = Math.sin(theta) * circ_rad;
					let xform = new TransformHelper(W, H);
					const cx = xform.NormToScreenX(fcx) | 0;
					const cy = xform.NormToScreenY(fcy) | 0;
					
		      dots.push(cx, cy, r * 2, v * (1.0 / 255));
				}
			}
		
			if (params.random_beat_dots > 0.001) {
				const v = (beat_dots.intensity * params.random_beat_dots) | 0;	
				for (let i = 0; i < beat_dots.dot_count; i++) {
					let cx = (Math.random() * (W - 1)) | 0;
					let cy = (Math.random() * (H - 1)) | 0;
		      dots.push(cx, cy, r * 2, v * (1.0 / 255));
				}
			}
		}

		if (params.fading_dots > 0.001) {
			let xform = new TransformHelper(W, H);
			let warps = GetWarpsAtTime(motion_time); //warp_str = GetBalancedWarpStrengthsAtTime(motion_time);
			
			const fade_speed = 6.5;	// The speed at which they fade in and out.
			const pan_speed = 30.0; // pixels per second.
			for (let i = 0; i < g_fading_dots.length; i++) {
				const phase = i * Math.PI * 2 / g_fading_dots.length;
				const str = Math.max(0.0, Math.min(1.0, 
						0.5 + 0.6 * Math.cos(time_now * fade_speed + phase))) * 
						params.fading_dots * 0.6 * 0.5;
				if (str < 0.0001) {
					// Move it while hidden.
					g_fading_dots[i].x = Math.random() * W;	
					g_fading_dots[i].y = Math.random() * H;	
				} else {
					//g_fading_dots[i].x += pan_speed / fps;
					
					let speed_mult = 1.0;//Math.pow(2.0, (i / g_fading_dots.length) * 2 - 1);
					
					// Advect each point.
					let ret = AdvectPoint(g_fading_dots[i].x, g_fading_dots[i].y, xform, warps, final_warp_str, speed_mult, shift_x, shift_y);
					g_fading_dots[i].x = ret.x;
					g_fading_dots[i].y = ret.y;
					
					const x = g_fading_dots[i].x | 0;
					const y = g_fading_dots[i].y | 0;
		      dots.push(x, y, wave_point_size_in_pixels, str);
				}
			}
		}

		// Grid
		if (params.grid_dots > 0.001) {
			const diagonal = Math.sqrt(W * W + H * H) | 0;
			const points_along_diagonal = 24;
			const v = (96 * params.grid_dots) | 0;
			
			let phase = time_now * 0.7;
			phase -= Math.floor(phase);
			
			const step = (diagonal / points_along_diagonal) | 0;
			const start_x = (step * phase) | 0;
			const start_y = (step / 2) | 0;
			
			for (let y = start_y; y < H; y += step) {
				for (let x = start_x; x < W; x += step) {
		      dots.push(x, y, wave_point_size_in_pixels, v * (1.0 / 255));
				}				
			}
		}
		
		// Embed song title.
		if (embed_string != "") {
			// Rarely: rebuild/upload bitmap
			const text_size = Math.max(8, diagonal * TITLE_EMBED_SIZE / Math.max(36, embed_string.length));
			this.presenter.gpu_warp.set_overlay_text(
				embed_string, 
				text_size|0, 
				{
				  center_x: W / 2,
				  center_y: H / 2,
				  intensity: 1.0,
				  font_family: "Arial",
				  font_weight: "bold",
				  supersample: 1,
				  duration: TITLE_EMBED_DURATION_SECONDS,
				  fade_in_power: TITLE_EMBED_FADE_IN_POWER,
				});			
		}
		
		let intensity = this.presenter.gpu_warp.text_overlay.get_intensity();
		if (intensity >= 1.0) {
			this.presenter.gpu_warp.burn_overlay_text(W / 2, H / 2, 1.0);
		}

		
		// -------------------------------------------------------------------
		// -------------------------------------------------------------------
		// -------------------------------------------------------------------
		// Run the Warp on the GPU and then draw all this stuff into it..
		// TODO: add shift_mag, shift_time.
		// -------------------------------------------------------------------
		const repacked_points = new Float32Array(dots);
		if (!frozen) {
			this.presenter.warpAndDrawWaveform(
 	        final_warp_str[0], final_warp_str[1], final_warp_str[2], final_warp_str[3], 
					shift_x, shift_y, repacked_points, darkening);
		}
		// -------------------------------------------------------------------
		// -------------------------------------------------------------------
		// -------------------------------------------------------------------


		/*
		// Show the center trace points:
		if (g_last_blended_center_trace != null) {	
			for (let i = 0; i < g_last_blended_center_trace.end_xy.length; i++) {
				const x = g_last_blended_center_trace.end_xy[i].x;
				const y = g_last_blended_center_trace.end_xy[i].y;
				this.back[y * this.iw + x] = (Math.random() * 255) | 0;
			}
		}
		*/
		
		// Prune active warp maps history, to free memory.
		for (let i = 0; i < 4; i++) {
			const orig_len = g_active_warp_maps[i].length;
			let new_list = Array();
			for (let j = 0; j < g_active_warp_maps[i].length; j++) {
				if (motion_time <= g_active_warp_maps[i][j].t3) {
					new_list.push(g_active_warp_maps[i][j]);
				}
			}
			const new_len = new_list.length;

			g_active_warp_maps[i] = new_list;

			if (orig_len != new_len && g_verbose_warp_slots) {
				console.log(`Pruning warp slot ${i} from ${orig_len} to ${new_len} entries`);
				DebugWarpSlot(i, motion_time, 0.0);
			}
		}


    // Swap
    const tmp = this.front;
    this.front = this.back;
    this.back = tmp;
  }

	// TODO: move to wave_draw.js
  generateWaveformPoints(params, point_size_in_pixels, wave_smoothing, xy_oscilloscope_gap,
                         mag_scale, align_frac, experiment) {
    const a = this.audio;
    if (!a) return;

		// TODO: make this fixed size so it's not constantly reallocating.
		let buf = [];

    const W = this.iw;
    const H = this.ih;
    const wave = a.wave; // Int16Array [-16384..16384]
    const rms = a.rms;   // 0..1
		
		// The largest # of samples we'll need is
		// proportional to the diagonal of the image. 
		const diagonal = Math.sqrt(W * W + H * H) | 0;
		
		//const align_frac = experiment ? 0.55 : ALIGN_FRAC;
		
		// This will return the 75% of the wave back that
		// aligns best to the previous (aligned) wave.
		let waveform = null;
		if (params.wave_flat_str > 0 || params.wave_circ_str > 0) {
			// Align and smooth.
			let aligned = aligner.alignFromF(wave, align_frac, wave.length);
			waveform = Blur(aligned, wave_smoothing);	
		}

		if (params.wave_flat_str > 0) {
			// Flat waveform

			// Angle:
			const cosx = Math.cos(params.wave_flat_angle);
			const sinx = Math.sin(params.wave_flat_angle);

			// If we don't have enough samples to fill the screen, upsample it.
			const target_sample_count = (diagonal * WAVE_STRETCH * (align_frac/0.55) / point_size_in_pixels) | 0;
			let resampled = waveform;
			if (resampled.length != target_sample_count) {
				resampled = linearResampleF(resampled, target_sample_count);
			}
	    const N = resampled.length;

			const sep = params.wave_flat_is_stereo * params.wave_flat_stereo_sep;

			const amplitude = 2.0 * 0.7 * params.wave_flat_scale *
					// quickly decrease amplitude when stereo separation is active:
					(1.0 - 0.7 * Math.sqrt(sep));

			// Opacity:
	    const mag0 = Math.min(255, (Math.min(255, rms * 20000 + 16) * params.wave_flat_str)) * mag_scale * WAVE_MAG_SCALE;

			let cx = params.wave_flat_cx;
			let cy = params.wave_flat_cy;

			// Slide the wave, if needed, so that we see the full thing.
			{
				let t = cx * cosx + cy * sinx;
				cx -= cosx * t;
				cy -= sinx * t;
			}


			let xform = new TransformHelper(W, H);
			let midx = xform.NormToScreenX(cx);
			let midy = xform.NormToScreenY(cy);			
	    
	    // Just pluck the center of the aligned part:
	    const sample0 = Math.max(0, N - target_sample_count) / 2;
	    const sample_count = Math.min(target_sample_count, N);

			const second_channel_opacity = Math.max(0.0, params.wave_flat_is_stereo * 2 - 1);
	    
	    for (let pass = 0; pass < 2; pass++) {
	    	if (pass == 1 && (params.wave_flat_is_stereo < 0.0001 || params.wave_flat_stereo_sep < 0.0001)) {
	    		break;
	    	}
	    	
	    	let mag = mag0;
	    	let stereo_offset = 0.0;
	    	
	    	if (pass == 1) {
	    		// Fade the second wave in late and out early.
	    		mag = (mag * second_channel_opacity) | 0;
	    	}
    		stereo_offset = ((-0.5 + pass) * sep);
	    
	    	const amplitude2 = amplitude * 
	    			(second_channel_opacity * params.wave_flat_stereo_amplitude_scale +
	    			 (1.0 - second_channel_opacity) * 1.0);
	    
	    	mag = Math.min(mag * (1.0 / 255), 1.0);
	    
		    for (let k = 0; k < sample_count; k++) {
		      const i = (k + sample0) | 0;
		      const v = resampled[i] * amplitude2; // -1..1
		
					// The pixel coordinates (relative to the center of the screen)
					// of the un-rotated wave:
					let x0 = (k - sample_count * 0.5) * point_size_in_pixels;
					let y0 = (v + stereo_offset) * (diagonal * 0.3);
		
					// Take rotation of point (x0, y0) by 'angle'; 
					let fx = x0 * cosx - y0 * sinx;
		      let fy = x0 * sinx + y0 * cosx;
		      	      
		      let x = midx + fx;
		      let y = midy + fy;	      
		      buf.push(x, y, point_size_in_pixels, mag);
		    }
		  }
	  }

		if (params.wave_circ_str > 0) {
			// Circular waveform

			const circ_rad = params.wave_circ_rad * 1.15;		// 0.8 ... 1.5
			const circ_ampl_scale = params.wave_circ_scale * 0.85;	// 0.5 ... 1.2

			// This will return the 75% of the wave back that
			// aligns best to the previous (aligned) wave.

			// Use half as many samples for circular waves; otherwise, they draw
			// too cluttered and dense.
			const target_sample_count = (diagonal * 0.45) | 0;

			// If we don't have enough samples to fill the screen, upsample it.
			let resampled = waveform;
			if (resampled.length != target_sample_count) {
				resampled = linearResampleF(resampled, target_sample_count);
			}
	    const N = resampled.length;

			const amplitude = 2.2 * params.wave_circ_scale * params.wave_circ_rad;

			// Opacity:
	    let mag = Math.min(255, (Math.min(255, rms * 20000 * 0.16 + 12) * 0.6) * params.wave_circ_str) | 0; 
	    mag = Math.min(mag * (1.0 / 255), 1.0) * mag_scale;

			let xform = new TransformHelper(W, H);
			const midx = xform.NormToScreenX(params.wave_circ_cx);
			const midy = xform.NormToScreenY(params.wave_circ_cy);
	    
	    // Just pluck the center of the aligned part:
	    const sample0 = (Math.max(0, N - target_sample_count) / 2) | 0;
	    const sample_count = Math.min(target_sample_count, N);
	    const overlap = (sample_count / 8) | 0;
	    
	    for (let k = 0; k < sample_count - overlap; k++) {
	      const i = (k + sample0) | 0;
	      let v = resampled[i] * amplitude; // -1..1
	      
	      if (k < overlap) {
	      	const t = k * (1.0 / overlap);
	      	const i2 = (k + sample0 + sample_count - overlap) | 0;
	      	const v2 = resampled[i2] * amplitude;
	      	v = v2 * (1 - t) + v * (t);
	      }
	
				// The pixel coordinates (relative to the center of the screen)
				// of the un-rotated wave:
				let fx = k - sample_count * 0.5;
				let fy = v * (diagonal * 0.3);
	
	      // Make circular.
	      {
	      	let t = k * (1.0 / (sample_count - overlap));  // [0..1]
	      	let r = diagonal * (0.1 * circ_rad) + fy * (0.2 * circ_ampl_scale);  //TWEAK	      	
	      	fx = r * Math.cos(t * (3.1415927 * 2) + params.wave_circ_angle);
	      	fy = r * Math.sin(t * (3.1415927 * 2) + params.wave_circ_angle);
	      }

	      let x = midx + fx;
	      let y = midy + fy;	      
	      buf.push(x, y, point_size_in_pixels, mag);
	    }
		}
		
	  if (0) {
	  	// XY oscilloscope

			//let aligned = linearUpsampleF(wave, wave.length * 2);


// We probably need to smooth (upsample) AFTER the blur.  Perhaps multiple passes.
// Ideal:
//    1. choose the ideal gap.  Small pref to match prev frame.
//    2. try to align to previous frame.
//    3. draw it


// TODO: Does auto gap code work well?  Play with manually setting, vs. it.
	  	let gap = xy_oscilloscope_gap;
	  	if (1) {
	  		// Determine optimal gap.
// TODO: Factor out into a function.
	  		let best_gap = 4;
	  		let best_avg = 0;
	  		for (let gap = 32; gap < 192; gap += 4) {
	  			let sum = 0;
	  			let samples = 0;
	  			let prev_sum = 0;

  				let p_prev = { x : waveform[0], y : waveform[gap] };

	  			for (let j = 0; j < waveform.length - gap; j += 4) {
	  				let p = { x : waveform[j], y : waveform[j + gap] };

						// Take the cross product of this point and the previous point.
						// This should give a high value when faraway points make angular movement,
						//   and a low value when the points are close, or don't make angular
						//   movement.
						sum += Math.abs(p.x * p_prev.y - p.y * p_prev.x);  // 2D cross product ~ area

						p_prev = p;
					
						samples++;
	  			}
	  			let avg = sum / samples;
	  			
	  			if (avg > best_avg) {
	  				best_avg = avg;
	  				best_gap = gap;
	  			}
	  		}
	  		//console.log(`best_gap ${best_gap}, best_avg ${best_avg}`);
	  		gap = best_gap;
	  	} 

			// If we don't have enough samples to fill the screen, upsample it.
			//let old_len = waveform.length;
			//if (old_len.length < 2048) {
			//	waveform = linearUpsampleF(waveform, 2048);
			//	gap = (gap * waveform.length / old_len) | 0;
			//}
	    const N = waveform.length;

			// Opacity:
	    //let mag = Math.min(63, rms * 20000 + 16);
	  	
	  	const xy_amplitude = 1.0 * 0.75;
	  	const max_count = 850;  //TWEAK
	  	const count = Math.min(N - gap, max_count);

			/*
			// Pass 1: determine the average radius of the points we'll draw,
			// relative to the screen.
			let avg_rad = 0.0;
			let fx = new Float32Array(count);
			let fy = new Float32Array(count);
	    for (let i = 0; i < count; i++) {
	      let ix = waveform[i];
	      let iy = waveform[i + gap];
	      const vx = ix * xy_amplitude; // -1..1
	      const vy = iy * xy_amplitude; // -1..1
	      const rad = Math.sqrt(vx * vx + vy * vy);
	      avg_rad += rad;
	      fx[i] = vx;
	      fy[i] = vy;
	    }
	    avg_rad /= count;
	    */

			// Determine the opacity.
			//console.log(`avg_rad ${avg_rad}`);
			//let mag = 16;//Math.max(1, Math.min(255, avg_rad * avg_rad * 300));

			// Pass 2: draw it.
			for (let i = 0; i < count; i++) {
	      let fx = waveform[i      ] * xy_amplitude;
	      let fy = waveform[i + gap] * xy_amplitude;
	      
	      //let rad = Math.sqrt(fx * fx + fy * fy);
	      //fx *= Math.pow(rad, -0.5) * 0.3;
	      //fy *= Math.pow(rad, -0.5) * 0.3;
	      
	      let vx = fx * (diagonal * 0.5);
	      let vy = fy * (diagonal * 0.5);
	      vx = (W * 0.5 + vx) | 0;
	      vy = (H * 0.5 + vy) | 0;
	      //const vx = (W / 2 + ix * amplitude * H * 0.5) | 0; // -1..1
	      //const vy = (H / 2 + iy * amplitude * H * 0.5) | 0; // -1..1
	      let rad_sq = (fx * fx + fy * fy);
	      let r = rad_sq;//Math.pow(rad_sq, 1.5) * 32;
	      //let mag = Math.max(1, Math.min(32, r * 4096)) | 0;
	      let mag = Math.max(8, Math.min(128, r * 8000 * WAVE_MAG_SCALE)) | 0;
	
	      //if (vx < 0 || vy < 0 || vx >= W || vy >= H) continue;	
	      //const idx = vy * W + vx;	
	      //buf[idx] = Math.min(255, buf[idx] + mag);
	      
	      buf.push(vx, vy, point_size_in_pixels, mag * (1.0 / 255));
	    }
	  }

		return buf;	  
  }   	 
}

