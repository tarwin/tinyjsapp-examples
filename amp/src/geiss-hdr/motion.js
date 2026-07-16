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

import { TransformHelper } from "./coords.js"
import { kWarpMapSize } from "./const.js"

// Static warp map: each dest pixel samples 1% closer to center.
// Outputs:
//  base: Uint32Array absolute upper-left source index (sx + sy*W)
//  w00,w10,w01,w11: Uint8Array weights summing to 256

// The size of the random number bank generated each time
// we make a new warp map.  All "randomness" must them come
// from these values (deterministically).  If the user then
// resizes the window, the map can be rebuilt with the same
// "randomness" by just passing in the mode # and the 
// existing random numbers, instead of generating new ones.
const WarpMapRandomNumberCount = 256;  // Must be a power of 2.
const WarpMapRandomNumberMask = WarpMapRandomNumberCount - 1;

var _count = 0;
export class WarpMap {
  constructor(mode = 0, weight = 0.0, str_lo = -1.0, str_hi = 2.0) {
    this.mode = mode | 0;        // force int
    // TODO: Rename to freq
    this.weight = +weight;       // force number
    this.index = _count++;
  }
}

export const g_override_mode = -1;//15;//-1;//17;	// -1 to disable

// Precompute one of each warp map.
export const g_warp_maps = [
  // freq = weight ~ probability of being picked
  //       mode   freq  str_lo str_hi
  new WarpMap(0,  0.55),	// flat zoom
  new WarpMap(1,  2.25),	// power zoom
  new WarpMap(2,  0.53),	// ~zooming over terrain
  new WarpMap(3,  2.00),	// heavy rotate
  new WarpMap(4,  1.30),	// N randomly-placed swirls; can overlap
  new WarpMap(5,  0.30),	// swirlie grid 2
  new WarpMap(6,  0.30),	// swirlie grid
  new WarpMap(7,  0.04),	// sphere (was: egg)
  new WarpMap(8,  1.50),	// radial swirl (sonic)
  new WarpMap(9,  0.95),	// angular ripples (pond splash)
  new WarpMap(10, 0.15),	// starfish
  new WarpMap(11, 0.05),	// black hole (-)
  new WarpMap(12, 1.66),	// 1/Z zoom
  new WarpMap(13, 0.06),	// ROUNDED SQUARE ROTATION
  new WarpMap(14, 0.30),	// VORTEX
  new WarpMap(15, 0.25),	// FISSURE.  This mode "hogs" the motion when active, so make it less common.   
  new WarpMap(16, 1.30),	// LOW FREQ SINE WAVES
  //new WarpMap(17, 3.30),	// Name of the Wind
  //new WarpMap(99,  0.04),	// cubism
];

function NormalizeQuaternion(quat) {
  const qlen = Math.hypot(quat.x, quat.y, quat.z, quat.w);
  if (qlen === 0) return null; // invalid rotation
  const inv = 1.0 / qlen;
  return { 
  	x: quat.x * inv, 
  	y: quat.y * inv, 
  	z: quat.z * inv, 
  	w: quat.w * inv 
  };
}

function lerp(a, b, t) {
	return a * (1.0 - t) + b * t;
}

function smoothstep(x) {
	return x * x * (3 - 2 * x);
}

function ApplyRot2D(x, y, rot) {
	const cos_rot = Math.cos(rot);
	const sin_rot = Math.sin(rot);
	let x2 = x * cos_rot - y * sin_rot;
	let y2 = x * sin_rot + y * cos_rot;
	return { x: x2, y: y2 };
}

// 't' should be between 0 and 1, but it can go outside.
// 'lo' and 'hi' must both be > 0.
function LogInterp(lo, hi, t) {
	//return Math.exp(Math.ln(lo) + t * (Math.log(hi) - Math.log(lo)));
  return lo * Math.pow(hi / lo, t);
}

function LinearInterp(lo, hi, t) {
	return lo + (hi - lo) * t;
}

export function buildWarpMap(new_mode) {
  // See also: size forced in gpu_warp.js.
	const W = kWarpMapSize;
	const H = kWarpMapSize;
	
	// Flat waveform
	//   wave_flat.str					[0 .. 1]
	//   wave_flat.angle				[0 .. 2PI]
	//   wave_flat.scale				~1
	//   wave_flat.is_stereo		[0..1]
	//   wave_flat.stereo_sep   [0..1]
	//   wave_flat.cx           [-1..1]
	//   wave_flat.cy           [-1..1]
	// Circular waveform
	//   wave_circ.str 					[0..1]
	//   wave_circ.rad					~1
	//   wave_circ.scale				~1
	//   wave_circ.angle				[0 .. 2PI]
	//   wave_circ.cx           [-1..1]
	//   wave_circ.cy           [-1..1]
  let warp_prefs = {
		// How much this motion map cares about selecting the wave data.
		// >= 0.  A higher weight will cause it to be more aggressive in
		// the weighted decision (when multiple motion maps are active at 
		// once).
		wave_prefs_weight : 1.0,

		// How much this warp map will try to dominate the others in terms
		// of motion.  If this value is > 1, it will (increasingly) suppress
		// the motion of other warp maps, when active, as it doesn't play
		// well with others.
		hog_motion_weight : 1.0,

		// These are all relative weights.  They don't have to sum to 1.
		// Note that the primary logic for the wave type (flat vs. circ)
		//   is driven by a function of the weighted average motion 
		//   metadata of the 4 active maps.  These 'prob' values basically
		//   serve as gates, to completely shut off certain wave types
		//   for certain modes, if desired.
		//type_flat_prob : 1.0,		// Do not change.
		//type_circ_prob : 1.0,		// Do not change.
		//type_flat_plus_circ : 0.01,
		//type_xy : 0.0,
		
		flat_angle_lo : -3.141592,
		flat_angle_hi :  3.141592,
		// Since most people watch in widescreen:
		flat_angle_bias_toward_horizontal_angles : 1.7,   // 0+
		flat_scale : 1.0,
		flat_is_stereo_chance : 0.18,		// [0..1]
		flat_stereo_sep_lo : 0.55,
		flat_stereo_sep_hi : 0.85,
		flat_stereo_amplitude_scale : 1.0,
		// see also: use_motion_center_as_wave_center_on_zoomy_combos_prob
		flat_cx_lo : -0.2,
		flat_cx_hi :  0.2,
		flat_cy_lo : -0.2,
		flat_cy_hi :  0.2,

		circ_rad_lo : 0.75,// 0.45,
		circ_rad_hi : 1.3,//0.75
		circ_scale :  1.0,
		// see also: use_motion_center_as_wave_center_on_zoomy_combos_prob
		circ_cx_lo : -0.05,
		circ_cx_hi :  0.05,
		circ_cy_lo : -0.05,
		circ_cy_hi :  0.05,

		// Most of the time, we ignore the (cx, cy) for the wave and
		// just stick it at the center of motion.  You can control
		// how often that happens here.  Or, for certain modes, you
		// can fine-tune it.
		use_motion_center_as_wave_center_prob : 0.93,
		// When we do it, don't always just do it 100%; sometimes
		// do it fractionally, according to:
		//   [random in 0..1] ^ use_motion_center_as_wave_center_power
		use_motion_center_as_wave_center_power : 0.4,
		
		//radial_beat_dots_prob : 0.035,
		//random_beat_dots_prob : 0.01,		
		//fading_dots_prob      : 0.003,
		//grid_dots_prob        : 0.005,
		radial_beat_dots_prob : 0.03,
		random_beat_dots_prob : 0.01,		
		fading_dots_prob      : 0.09,
		grid_dots_prob        : 0.005,

		// Metadata computed from the resulting warp map:
		net_motion : 0.0,
		net_zoom_motion : 0.0,
		in_or_out_motion : 0.0,
		net_clockwise_motion : 0.0,
		cw_or_ccw_motion : 0.0,
		
		angular_motion_mag : 0.0,     // ~clockwise rotation
		radial_motion_mag : 0.0,      // ~zoom out
		abs_radial_motion_mag : 0.0,  // ~motion in or out
		abs_angular_motion_mag : 0.0,  // ~rotation in any direction
	};

  const n = W * H;

	// Store interlaved: { dx, dy, dx, dy ... }  
  const src_dxy = new Float32Array(n * 2);

	// TODO: Factor out this common code (which is duplicated 
	// in both motion.js and warp.js), and coordinate transform
	// helper functions.
	  
	// Compute the aspect-ratio-independent coordinates
	// of the point on the screen.  The window is fitted
	// maximally to a [-1..1] x [-1..1] square.
	const aspect = W * 1.0 / H;  // 1.6
	
	let x0 = -1.0;
	let y0 = -1.0;
	let x1 = 1.0;
	let y1 = 1.0;
	
	if (aspect > 1.0) {
	  // wide
	  y0 /= aspect;
	  y1 /= aspect;
	} else {
	  // tall
	  x0 *= aspect;
	  x1 *= aspect;
	}

	const inv_W = 1.0 / W;
	const inv_H = 1.0 / H;
	
	const x0x1 = x1 - x0;	//2
	const y0y1 = y1 - y0; //1
	const inv_x0x1 = 1.0 / x0x1;	//0.5
	const inv_y0y1 = 1.0 / y0y1;	//1

	// Generate a bank of random numbers that this warp map
	// can draw from.  Try not to use Math.random() after
	// this point in this function.
	let randoms = new Float32Array(WarpMapRandomNumberCount);
	for (let i = 0; i < WarpMapRandomNumberCount; i++) {
		randoms[i] = Math.random();
	}
	let rand_idx = 0;

  let write_offset = 0;

	if (g_override_mode >= 0) {
		new_mode = g_override_mode;
	}

	// TODO: Optimize (simplify) the math for computing fdy, fdx.

	if (new_mode < 0) {
		// Generate a quick dummy map with no motion.
		// (...nothing to do; default for a new array is to fill with zeroes)
	}
	else if (new_mode == 4) {
		// N randomly-placed swirls; can overlap
		//warp_prefs.type_circ_prob *= 0.1;
		
		// Clear the motion map to zero everywhere.
		for (let dy = 0; dy < H; dy++) {
	    for (let dx = 0; dx < W; dx++, write_offset += 2) {
		    src_dxy[write_offset + 0] = 0.0;
		    src_dxy[write_offset + 1] = 0.0;	    
      }
    }			  		

		// Add a few big swirles, that can overlap.
		const N = (2 + 34 * randoms[rand_idx++]) | 0;
		for (let n = 0; n < N; n++) {
			const cx = (randoms[rand_idx++] - 0.5) * x0x1;
			const cy = (randoms[rand_idx++] - 0.5) * y0y1;
			const rad = 0.3 + 0.5 * randoms[rand_idx++] * Math.min(1.0, 10.0 / N);
			const str = (0.4 + 0.4 * randoms[rand_idx++]) * 
					((randoms[rand_idx++] > 0.5) ? 1 : -1) *
					0.1 * Math.pow(Math.min(1.0, (3.0 / N)), 0.7); //0.7; 
			
		  const dx0 = Math.max(0, Math.min(W, ((cx - rad) * inv_x0x1 + 0.5) * W)) | 0;
		  const dy0 = Math.max(0, Math.min(H, ((cy - rad) * inv_y0y1 + 0.5) * H)) | 0;
		  const dx1 = Math.max(0, Math.min(W, ((cx + rad) * inv_x0x1 + 0.5) * W)) | 0;
		  const dy1 = Math.max(0, Math.min(H, ((cy + rad) * inv_y0y1 + 0.5) * H)) | 0;

			for (let dy = dy0; dy < dy1; dy++) {
			  let fdy = (dy * (2.0 / H) - 1.0) * (y0y1 * 0.5);
			  write_offset = (dy * W + dx0) * 2;
		    for (let dx = dx0; dx < dx1; dx++, write_offset += 2) {
				  let fdx = (dx * (2.0 / W) - 1.0) * (x0x1 * 0.5);		// -1 .. 1

					let rad_sq = ((fdx - cx) * (fdx - cx) + (fdy - cy) * (fdy - cy)) * (1.0 / (rad * rad));
					if (rad_sq < 1) {
						let r = Math.pow(rad_sq, 0.333);
						
						let sdx = fdx;
						let sdy = fdy;
						
						r = smoothstep(r);
						let zx = fdx - cx;
						let zy = fdy - cy;
						let rot = (1.0 - r) * str;//rad_sq * 0.15;
						let zx2 = (zx * Math.cos(rot) - zy * Math.sin(rot));
						let zy2 = (zx * Math.sin(rot) + zy * Math.cos(rot));
						sdx = cx + zx2;
						sdy = cy + zy2;

				    src_dxy[write_offset + 0] += (sdx - fdx);
				    src_dxy[write_offset + 1] += (sdy - fdy);
					}
				}   
      }
    }			  		
	} else if (new_mode == 5) {
		// SWIRLIE GRID 2
		//warp_prefs.type_circ_prob *= 0.1;
		const N = 0.5 + randoms[rand_idx++] * 3.5;
		const offset_x = randoms[rand_idx++] * (1.0 / N);
		const offset_y = randoms[rand_idx++] * (1.0 / N);
		const str = (0.1 + 0.9 * randoms[rand_idx++] * randoms[rand_idx++]) * 
				((randoms[rand_idx++] > 0.5) ? 1 : -1) *
				0.25; //0.7; 
		const rot0 = randoms[rand_idx++] * 6.28;
		const variety = (randoms[rand_idx++] > 0.5);

		for (let dy = 0; dy < H; dy++) {
		  let fdy = (dy * (2.0 / H) - 1.0) * (y0y1 * 0.5);
		  fdy += offset_y;
	    for (let dx = 0; dx < W; dx++, write_offset += 2) {
			  let fdx = (dx * (2.0 / W) - 1.0) * (x0x1 * 0.5);		// -1 .. 1
			  fdx += offset_x;

				// Note: If you rotate at the start like this,
				// you also have to counter-rotate the final displacement.
				let p = ApplyRot2D(fdx, fdy, rot0);
				let fx = p.x;
				let fy = p.y;

				let nx = Math.floor(fx * N);  // -N .. N
				let ny = Math.floor(fy * N);

				let k = (nx * 3 + ny * 7) | 0;
				let att = variety ? (randoms[k & WarpMapRandomNumberMask] * 2 - 1) : 1.0;

				let cx = (nx + 0.5) * (1.0 / N);		// -1 .. 1
				let cy = (ny + 0.5) * (1.0 / N);

				let rad_sq = ((fx - cx) * (fx - cx) + (fy - cy) * (fy - cy)) * (N * N * 4);
				let r = Math.pow(rad_sq, 0.333);
				let sdx = fx;
				let sdy = fy;
				if (r < 1) {
					r = smoothstep(r);
					let zx = fx - cx;
					let zy = fy - cy;
					let rot = (1.0 - r) * str;//rad_sq * 0.15;
					let zx2 = (zx * Math.cos(rot * att) - zy * Math.sin(rot * att));
					let zy2 = (zx * Math.sin(rot * att) + zy * Math.cos(rot * att));
					sdx = cx + zx2;
					sdy = cy + zy2;
				}

				sdx -= fx;
				sdy -= fy;
				
				// Rotate back at the end -- so that the displacement
				// is in the original coordinate space.
				let p2 = ApplyRot2D(sdx, sdy, -rot0);   // back to original basis
				sdx = p2.x;
				sdy = p2.y;
				      	
		    src_dxy[write_offset + 0] = sdx;
		    src_dxy[write_offset + 1] = sdy;
      }
    }			  		
	} else if (new_mode == 6) {
		// GRID OF SWIRLIES
		//warp_prefs.type_circ_prob *= 0.1;
		const N = (2 + randoms[rand_idx++] * 8);		//VAR
		const offset_x = randoms[rand_idx++] * (1.0 / N);
		const offset_y = randoms[rand_idx++] * (1.0 / N);
		const scale = 1.0;//0.99 + 0.02 * randoms[rand_idx++];	//VAR
		const rot = (0.002 + 0.028 * randoms[rand_idx++]) * ((randoms[rand_idx++] < 0.5) ? 1 : -1) * Math.min(1.0, 4.0 / N);		//VAR
		const power = 0.5 + 2.5 * randoms[rand_idx++];
		const variety = Math.max(0.0, Math.min(1.0, randoms[rand_idx++] * 3 - 1));  // [0..1]
		
		const rot0 = randoms[rand_idx++] * 6.28;
		for (let dy = 0; dy < H; dy++) {
		  const orig_fdy = (dy * (2.0 / H) - 1.0) * (y0y1 * 0.5);

	    for (let dx = 0; dx < W; dx++, write_offset += 2) {
			  const orig_fdx = (dx * (2.0 / W) - 1.0) * (x0x1 * 0.5);	

				// Note: If you rotate at the start like this,
				// you also have to counter-rotate the final displacement.
				let p = ApplyRot2D(orig_fdx, orig_fdy, rot0);
				let fdx = p.x;
				let fdy = p.y;

				fdx += offset_x;
				fdx = (fdx * N * 0.5);
				const nx = Math.floor(fdx);
				fdx -= nx;	 // [0..1]
				fdx = fdx * 2 - 1;			 // [-1..1]

				fdy += offset_y;
				fdy = (fdy * N * 0.5);
				const ny = Math.floor(fdy);
				fdy -= ny;			// [0..1]
				fdy = fdy * 2 - 1;					// [-1..1]

				// GRADED VARIETY:
				const k = (nx * 3 + ny * 7) | 0;
	
				const tx = fdx;// - cx;
				const ty = fdy;// + cy;
				var rad = Math.sqrt(tx*tx + ty*ty);
				rad = Math.pow(rad, power);
				const rot2 = rot * Math.max(0.0, 1 - rad);
				// graded variety:
				const rot3 = rot2 * lerp(1.0, randoms[k & WarpMapRandomNumberMask] * 2 - 1, variety);
				let sdx = (fdx * Math.cos(rot3) - fdy * Math.sin(rot3)) * scale;
				let sdy = (fdx * Math.sin(rot3) + fdy * Math.cos(rot3)) * scale;
      	
				sdx -= fdx;
				sdy -= fdy;
				
				// Rotate back at the end -- so that the displacement
				// is in the original coordinate space.
				let p2 = ApplyRot2D(sdx, sdy, -rot0);   // back to original basis
				sdx = p2.x;
				sdy = p2.y;
				      	
		    src_dxy[write_offset + 0] = sdx;
		    src_dxy[write_offset + 1] = sdy;
      }
    }			  	
    			  		
	} else if (new_mode == 10) {
		// STARFISH
		
		let str = 0.4 + 1.6 * randoms[rand_idx++];
		if (randoms[rand_idx++] < 0.3) {
			str = str * -0.25;
		}
		
		const fins = 3 + Math.floor(randoms[rand_idx++] * 6);
		const cx = (randoms[rand_idx++] * 2 - 1) * 0.12;
		const cy = (randoms[rand_idx++] * 2 - 1) * 0.12;
		for (let dy = 0; dy < H; dy++) {
		  let fdy = (dy * (2.0 / H) - 1.0) * (y0y1 * 0.5);
	    for (let dx = 0; dx < W; dx++, write_offset += 2) {
			  let fdx = (dx * (2.0 / W) - 1.0) * (x0x1 * 0.5);	
	
				const tx = fdx - cx;
				const ty = fdy - cy;
				//const scale = 1.0 / Math.sqrt(tx * tx + ty * ty + 0.0000001);
				const ang = Math.atan2(tx, ty);	
				const scale = 0.987 + 0.010 * Math.cos(ang * fins);
				let sdx = fdx * scale;
				let sdy = fdy * scale;

				// Attenuate motion near the center, to avoid discontinuities.
				const rad = Math.sqrt(tx * tx + ty * ty);
				const att = Math.max(0, Math.min(1.0, (rad - 0.05) * 4));
				sdx = fdx + (sdx - fdx) * att * str;
				sdy = fdy + (sdy - fdy) * att * str;
      	
	      
		    src_dxy[write_offset + 0] = (sdx - fdx);
		    src_dxy[write_offset + 1] = (sdy - fdy);	    
      }
    }			  
	/*} else if (new_mode == 9) {
		for (let dy = 0; dy < H; dy++) {
		  let fdy = (dy * (2.0 / H) - 1.0) * (y0y1 * 0.5);
	    for (let dx = 0; dx < W; dx++, write_offset += 2) {
			  let fdx = (dx * (2.0 / W) - 1.0) * (x0x1 * 0.5);	

				// NOISY BLUR
				let sdx = fdx + (randoms[rand_idx++] * 2 - 1) * 0.02;
				rand_idx &= WarpMapRandomNumberMask;
				let sdy = fdy + (randoms[rand_idx++] * 2 - 1) * 0.02;
				rand_idx &= WarpMapRandomNumberMask;
		
	      
		    src_dxy[write_offset + 0] = (sdx - fdx);
		    src_dxy[write_offset + 1] = (sdy - fdy);	    
      }
    }*/			  
	} else if (new_mode == 9) {
		warp_prefs.circ_scale = 4.0;

		const cx = (randoms[rand_idx++] * 2 - 1) * 0.35;
		const cy = (randoms[rand_idx++] * 2 - 1) * 0.35;
		const freq = 6 + 18 * randoms[rand_idx++];
		const phase = randoms[rand_idx++] * 6.28;
		const mag = (0.00012 + 0.00005 * randoms[rand_idx++]) / freq * 100.0 *
				((randoms[rand_idx++] < 0.5) ? 1.0 : -1.0);
		const bias = randoms[rand_idx++] * 2 - 1;
		for (let dy = 0; dy < H; dy++) {
		  let fdy = (dy * (2.0 / H) - 1.0) * (y0y1 * 0.5);
	    for (let dx = 0; dx < W; dx++, write_offset += 2) {
			  let fdx = (dx * (2.0 / W) - 1.0) * (x0x1 * 0.5);	
	
				// RADIAL RIPPLES
				const tx = fdx - cx;
				const ty = fdy - cy;
				const rad = Math.sqrt(tx*tx + ty*ty);
				const scale = 1.0 + mag * (Math.cos(rad * freq + phase) + bias);
				let sdx = fdx * scale;
				let sdy = fdy * scale;
      	
	      
		    src_dxy[write_offset + 0] = (sdx - fdx);
		    src_dxy[write_offset + 1] = (sdy - fdy);	    
      }
    }			  
	} else if (new_mode == 8) {
		warp_prefs.circ_scale = 4.0;

		const cx = (randoms[rand_idx++] * 2 - 1) * 0.45;
		const cy = (randoms[rand_idx++] * 2 - 1) * 0.45;
		const rad_freq = 5 + 19 * randoms[rand_idx++];
		const rot_str = (0.001 + 0.004 * randoms[rand_idx++] * randoms[rand_idx++]) * 
										((randoms[rand_idx++] < 0.5) ? -1.0 : 1.0) * 0.21 * 
										Math.pow(13 / rad_freq, 0.6) * 4;		// partially compensate for freq
		const rot_bias = randoms[rand_idx] * 2 - 1;
		for (let dy = 0; dy < H; dy++) {
		  let fdy = (dy * (2.0 / H) - 1.0) * (y0y1 * 0.5);
	    for (let dx = 0; dx < W; dx++, write_offset += 2) {
			  let fdx = (dx * (2.0 / W) - 1.0) * (x0x1 * 0.5);	
	
				// SWIRL
				// TODO: If we oversize the warp maps a little bit,
				// maybe we could shift them individually??
				const tx = fdx - cx;
				const ty = fdy - cy;
				const rad = Math.sqrt(tx*tx + ty*ty);
				const rot = (Math.cos(rad * rad_freq) + rot_bias) * rot_str;
				let sdx = tx * Math.cos(rot) - ty * Math.sin(rot) + cx;
				let sdy = tx * Math.sin(rot) + ty * Math.cos(rot) + cy;
      	
	      
		    src_dxy[write_offset + 0] = (sdx - fdx);
		    src_dxy[write_offset + 1] = (sdy - fdy);	    
      }
    }			  
	} else if (new_mode == 2) {
		// LANDING
  	warp_prefs.wave_prefs_weight *= 5;
  	
  	let str = 0.027 * (0.1 + 0.9 * randoms[rand_idx++]);
		let angle = randoms[rand_idx++] * 6.28;
		const cos_angle = Math.cos(angle);
		const sin_angle = Math.sin(angle);

		// Add in a very mild rotation.
		const rot = (randoms[rand_idx++] * 2 - 1) * 0.0015;
		const cos_rot = Math.cos(rot);
		const sin_rot = Math.sin(rot);
  	
		for (let dy = 0; dy < H; dy++) {
		  let fdy = (dy * (2.0 / H) - 1.0) * (y0y1 * 0.5);
	    for (let dx = 0; dx < W; dx++, write_offset += 2) {
			  let fdx = (dx * (2.0 / W) - 1.0) * (x0x1 * 0.5);	

				let rx = fdx * cos_angle - fdy * sin_angle;
				let ry = fdx * sin_angle + fdy * cos_angle;
					
				let sdx = fdx;
      	let sdy = fdy;
      	//let zoom = 1.0 - (1.0 / (-fdy + 1.01)) * 0.015;	-> led to weird behavior near fdy==1
      	let zoom = 1.0 - (1.0 / (-ry + 1.4)) * str;
      	sdx *= zoom;
      	sdy *= zoom;

				rx = sdx * cos_rot - sdy * sin_rot;
				ry = sdx * sin_rot + sdy * cos_rot;
				sdx = rx;
				sdy = ry;
      	
	      
		    src_dxy[write_offset + 0] = (sdx - fdx);
		    src_dxy[write_offset + 1] = (sdy - fdy);	    
      }
    }			  
  } 
  /*else if (new_mode == 7) {
		// EGG - removed because it's a subset of 13 (sphere)
		motion_mag_scale_lo = 0.5;
		motion_mag_scale_hi = 1.5;
  	warp_prefs.wave_prefs_weight *= 10;  // Very dominant effect.
  	//warp_prefs.type_circ_prob = warp_prefs.type_flat_prob;
		warp_prefs.circ_rad_lo = 0.5;
		warp_prefs.circ_rad_hi = 1.25;

		for (let dy = 0; dy < H; dy++) {
		  let fdy = (dy * (2.0 / H) - 1.0) * (y0y1 * 0.5);
	    for (let dx = 0; dx < W; dx++, write_offset += 2) {
			  let fdx = (dx * (2.0 / W) - 1.0) * (x0x1 * 0.5);	
	
				let sdx = fdx;
      	let sdy = fdy;
      	let rad = Math.sqrt(fdx*fdx + fdy*fdy);
      	let scale = 0.97 + 0.1*rad;
      	scale = Math.pow(scale, 4);
      	sdx *= scale;
      	sdy *= scale;
      	
      	sdx = fdx + (sdx - fdx) * 0.5;
      	sdy = fdy + (sdy - fdy) * 0.5;
      	
	      
		    src_dxy[write_offset + 0] = (sdx - fdx);
		    src_dxy[write_offset + 1] = (sdy - fdy);	    
      }
    }			  
  }*/ 
  else if (new_mode == 11) {
		// BLACK HOLE
  	warp_prefs.wave_prefs_weight *= 10;  // Very dominant effect.
  	//warp_prefs.type_circ_prob = warp_prefs.type_flat_prob;
		warp_prefs.circ_rad_lo = 0.9;
		warp_prefs.circ_rad_hi = 1.5;

		// 0.5 -> just a strong perspective zoom
		// 1.0 -> black hole
		// 1.5 -> black hole, but showing hints of sphere
		// 2.0 -> 
		let str = (0.75 + 1.5 * randoms[rand_idx++]);

		for (let dy = 0; dy < H; dy++) {
		  let fdy = (dy * (2.0 / H) - 1.0) * (y0y1 * 0.5);
	    for (let dx = 0; dx < W; dx++, write_offset += 2) {
			  let fdx = (dx * (2.0 / W) - 1.0) * (x0x1 * 0.5);	
	
				let sdx = fdx;
      	let sdy = fdy;
      	let rad = Math.sqrt(fdx*fdx + fdy*fdy);
      	let scale = 0.97 + 0.1*rad;
      	scale = Math.pow(scale, 4);
      	sdx *= scale;
      	sdy *= scale;
      	
      	sdx = fdx + (sdx - fdx) * -str;
      	sdy = fdy + (sdy - fdy) * -str;
      	
	      
		    src_dxy[write_offset + 0] = (sdx - fdx);
		    src_dxy[write_offset + 1] = (sdy - fdy);	    
      }
    }			  
  } 
  /*else if (new_mode == 99) {
		motion_mag_scale_lo = 0.0;
		motion_mag_scale_hi = 1.0;
		const count = ((8 + 8 * randoms[rand_idx++]) | 0);		
	  for (let dy = 0; dy < H; dy++) {
		  let fdy = (dy * (2.0 / H) - 1.0) * (y0y1 * 0.5);
	    for (let dx = 0; dx < W; dx++, write_offset += 2) {
			  let fdx = (dx * (2.0 / W) - 1.0) * (x0x1 * 0.5);	
	
				// CUBISM 1
				const str = 0.05;
				let tx = (((fdx + 1) * (count * 0.5) + 0.5) | 0) * (1.0 / (count * 0.5)) - 1;
      	let ty = (((fdy + 1) * (count * 0.5) + 0.5) | 0) * (1.0 / (count * 0.5)) - 1;
      	tx = tx * str + fdx * (1.0 - str);
      	ty = ty * str + fdy * (1.0 - str);      	
      	let sdx = tx;
      	let sdy = ty;
      	
	      
		    src_dxy[write_offset + 0] = (sdx - fdx);
		    src_dxy[write_offset + 1] = (sdy - fdy);	    
      }
    }			  
  }*/
  else if (new_mode == 0) {
		// SIMPLE ZOOM
  	warp_prefs.wave_prefs_weight *= 10;
		//warp_prefs.type_circ_prob *= 10;
		warp_prefs.type_flat_plus_circ *= 1.4;

		let zoom = 0.004 + 0.016 * randoms[rand_idx++];
		if (randoms[rand_idx++] < 0.1) {
			zoom *= -0.25;
		}

		// Add in a very mild rotation.
		const rot = (randoms[rand_idx++] * 2 - 1) * 0.0015;
		const cos_rot = Math.cos(rot);
		const sin_rot = Math.sin(rot);

	  for (let dy = 0; dy < H; dy++) {
		  let fdy = (dy * (2.0 / H) - 1.0) * (y0y1 * 0.5);
	    for (let dx = 0; dx < W; dx++, write_offset += 2) {
			  let fdx = (dx * (2.0 / W) - 1.0) * (x0x1 * 0.5);	
	
      	let sdx = fdx + (0.0 - fdx) * zoom;
      	let sdy = fdy + (0.0 - fdy) * zoom;

				let rx = sdx * cos_rot - sdy * sin_rot;
				let ry = sdx * sin_rot + sdy * cos_rot;
				sdx = rx;
				sdy = ry;
      	
	      
		    src_dxy[write_offset + 0] = (sdx - fdx);
		    src_dxy[write_offset + 1] = (sdy - fdy);	    
      }
    }
  } else if (new_mode == 1) {
		// POWER ZOOM
  	warp_prefs.wave_prefs_weight *= 10;
		//warp_prefs.type_circ_prob *= 10;
		warp_prefs.type_flat_plus_circ *= 1.4;

		let zoom = (0.4 + 1.6 * randoms[rand_idx++]) * 0.03 * 1.8;
		if (randoms[rand_idx++] < 0.1) {
			zoom *= -0.4;
		}

		// Add in a very mild rotation.
		const rot = (randoms[rand_idx++] * 2 - 1) * 0.0015;
		const cos_rot = Math.cos(rot);
		const sin_rot = Math.sin(rot);

	  for (let dy = 0; dy < H; dy++) {
		  let fdy = (dy * (2.0 / H) - 1.0) * (y0y1 * 0.5);
	    for (let dx = 0; dx < W; dx++, write_offset += 2) {
			  let fdx = (dx * (2.0 / W) - 1.0) * (x0x1 * 0.5);	
  	
				let r = (fdx*fdx + fdy*fdy);
      	let sdx = fdx + (0.0 - fdx) * r * zoom;
      	let sdy = fdy + (0.0 - fdy) * r * zoom;				

				let rx = sdx * cos_rot - sdy * sin_rot;
				let ry = sdx * sin_rot + sdy * cos_rot;
				sdx = rx;
				sdy = ry;

	      
		    src_dxy[write_offset + 0] = (sdx - fdx);
		    src_dxy[write_offset + 1] = (sdy - fdy);	    
      }
    }
  } else if (new_mode == 3) {
		// ROTATE
  	warp_prefs.wave_prefs_weight *= 0.01;
		//warp_prefs.type_circ_prob *= 0.1;
  	
		var rot1 = 0.002 + 0.008 * randoms[rand_idx++];		// center
		if (randoms[rand_idx++] < 0.5) rot1 *= -1;

		var rot2 = rot1;	 	// edge
		if (randoms[rand_idx++] < 0.3) {
			rot2 = rot1 * randoms[rand_idx++] * 2;
			if (randoms[rand_idx++] < 0.5) rot2 *= -1;
		}
	  for (let dy = 0; dy < H; dy++) {
		  let fdy = (dy * (2.0 / H) - 1.0) * (y0y1 * 0.5);
	    for (let dx = 0; dx < W; dx++, write_offset += 2) {
			  let fdx = (dx * (2.0 / W) - 1.0) * (x0x1 * 0.5);	
  	
				const rad = Math.sqrt(fdx * fdx + fdy * fdy);
				const rot = rot1 + (rot2 - rot1) * rad;
				let sdx = fdx * Math.cos(rot) - fdy * Math.sin(rot);
				let sdy = fdx * Math.sin(rot) + fdy * Math.cos(rot);

	      
		    src_dxy[write_offset + 0] = (sdx - fdx);
		    src_dxy[write_offset + 1] = (sdy - fdy);
      }
    }
  } else if (new_mode == 12) {
		// 1/Z ZOOM
  	warp_prefs.wave_prefs_weight *= 10;

		const speed_min = 0.015;
		const speed_max = 0.080;
		const t = Math.pow(randoms[rand_idx++], 3.0);
		//const speed = LogInterp(speed_min, speed_max, randoms[rand_idx++]);
		const speed = LinearInterp(speed_min, speed_max, randoms[rand_idx++]);

		// Add in a very mild rotation.
		const rot = (randoms[rand_idx++] * 2 - 1) * 0.0015;
		const cos_rot = Math.cos(rot);
		const sin_rot = Math.sin(rot);

	  for (let dy = 0; dy < H; dy++) {
		  let fdy = (dy * (2.0 / H) - 1.0) * (y0y1 * 0.5);
	    for (let dx = 0; dx < W; dx++, write_offset += 2) {
			  let fdx = (dx * (2.0 / W) - 1.0) * (x0x1 * 0.5);	

				// RAD = 1/Z  ->  Z = 1 / RAD  	
				let orig_rad = Math.sqrt(fdx*fdx + fdy*fdy + 0.00001);
  			let inv_rad = 1.0 / orig_rad;
  			let nx = fdx * inv_rad; 
  			let ny = fdy * inv_rad;  			
  			
    		let dist = inv_rad;
    		dist += speed;
    		let rad = 1.0 / dist;
    		let sdx = fdx + nx * (rad - orig_rad);
    		let sdy = fdy + ny * (rad - orig_rad);

				let rx = sdx * cos_rot - sdy * sin_rot;
				let ry = sdx * sin_rot + sdy * cos_rot;
				sdx = rx;
				sdy = ry;

	      
		    src_dxy[write_offset + 0] = (sdx - fdx);
		    src_dxy[write_offset + 1] = (sdy - fdy);	    
      }
    }
  } else if (new_mode == 7) {
		// SPHERE
  	warp_prefs.wave_prefs_weight *= 10;
  	
  	const power = LinearInterp(1.03, 1.10, randoms[rand_idx++]);
  	// <1 == ~crop of a supersized sphere
  	//  1 == sphere fitted to screen
  	// >1 == ~egg
  	const t = (randoms[rand_idx++] + randoms[rand_idx++]) * 0.5;
  	const scale = LogInterp(1.5, 4.0, t);
  	const inv_scale = 1.0 / scale;
  	const str = 0.1 + 0.4 * randoms[rand_idx++];

	  for (let dy = 0; dy < H; dy++) {
		  let fdy = (dy * (2.0 / H) - 1.0) * (y0y1 * 0.5);
	    for (let dx = 0; dx < W; dx++, write_offset += 2) {
			  let fdx = (dx * (2.0 / W) - 1.0) * (x0x1 * 0.5);	

				let orig_rad = Math.sqrt(fdx*fdx + fdy*fdy + 0.00001);
  			let rad = Math.pow(orig_rad * scale, power) * inv_scale;
  			let inv_rad = 1.0 / orig_rad;
  			let nx = fdx * inv_rad; 
  			let ny = fdy * inv_rad;  			
  			
    		let sdx = fdx + nx * (rad - orig_rad) * str;
    		let sdy = fdy + ny * (rad - orig_rad) * str;


	      
		    src_dxy[write_offset + 0] = (sdx - fdx);
		    src_dxy[write_offset + 1] = (sdy - fdy);	    
      }
    }
  } else if (new_mode == 13) {
		// ROUNDED SQUARE ROTATION
  	warp_prefs.wave_prefs_weight *= 10;
  	
	  const speed = LinearInterp(0.003, 0.01, randoms[rand_idx++]) *
	                ((randoms[rand_idx++] > 0.5) ? 1.0 : -1.0);
  	
	  for (let dy = 0; dy < H; dy++) {
		  let fdy = (dy * (2.0 / H) - 1.0) * (y0y1 * 0.5);
	    for (let dx = 0; dx < W; dx++, write_offset += 2) {
			  let fdx = (dx * (2.0 / W) - 1.0) * (x0x1 * 0.5);	

				const rad = Math.sqrt(fdx * fdx + fdy * fdy);

				let nx = fdy;
				let ny = -fdx;
				let nx_sign = (nx < 0) ? -1.0 : 1.0;
				let ny_sign = (ny < 0) ? -1.0 : 1.0;
				nx *= nx * nx_sign;
				ny *= ny * ny_sign;
				const norm_scale = 1.0 / Math.sqrt(nx * nx + ny * ny + 0.00001);
				nx *= norm_scale;
				ny *= norm_scale;
				
    		let sdx = fdx + nx * speed * rad;
    		let sdy = fdy + ny * speed * rad;

	      
		    src_dxy[write_offset + 0] = (sdx - fdx);
		    src_dxy[write_offset + 1] = (sdy - fdy);	    
      }
    }
	} else if (new_mode == 14) {
		// VORTEX
		const cx = (randoms[rand_idx++] * 2 - 1) * 0.08;
		const cy = (randoms[rand_idx++] * 2 - 1) * 0.08;
		const str = LinearInterp(0.008, 0.025, randoms[rand_idx++]) * 
							  ((randoms[rand_idx++] > 0.5) ? 1 : -1);
		for (let dy = 0; dy < H; dy++) {
		  let fdy = (dy * (2.0 / H) - 1.0) * (y0y1 * 0.5);
	    for (let dx = 0; dx < W; dx++, write_offset += 2) {
			  let fdx = (dx * (2.0 / W) - 1.0) * (x0x1 * 0.5);	
	
				const tx = fdx - cx;
				const ty = fdy - cy;
								
				const rad = Math.sqrt(tx * tx + ty * ty);
				const rot = rad * str;

				const rotated = ApplyRot2D(tx, ty, rot);
				
				let sdx = cx + rotated.x;
				let sdy = cy + rotated.y;
      	
	      
		    src_dxy[write_offset + 0] = (sdx - fdx);
		    src_dxy[write_offset + 1] = (sdy - fdy);	    
      }
    }			  		
  }
	/*} else if (new_mode == 15) {
		// radial & angular swirls, vel normalized, with center attenuation to avoid discontinuity
		const cx = (randoms[rand_idx++] * 2 - 1) * 0.08;
		const cy = (randoms[rand_idx++] * 2 - 1) * 0.08;
		const fins = (3 + randoms[rand_idx++] * 11) | 0;
		const ripples = randoms[rand_idx++] * 45 + 15;
		
		for (let dy = 0; dy < H; dy++) {
		  let fdy = (dy * (2.0 / H) - 1.0) * (y0y1 * 0.5);
	    for (let dx = 0; dx < W; dx++, write_offset += 2) {
			  let fdx = (dx * (2.0 / W) - 1.0) * (x0x1 * 0.5);	
	
				const tx = fdx - cx;
				const ty = fdy - cy;
				
				//const zx = 0.01 * Math.cos(tx * 17 - ty * 22 + 1);
				//const zy = 0.01 * Math.cos(tx * 13 + ty * 7  + 2);
				
				const rad = Math.sqrt(tx * tx + ty * ty + 0.00001);
				const ang = Math.atan2(ty, tx);	
				
				const att = Math.max(0, Math.min(1.0, (rad - 0.05) * 4));
				
				const rad2 = rad + Math.cos(ang * fins) * 0.005;
				const rot = 0.003 * (Math.cos(rad * ripples) + 1);
				
				const rotated = ApplyRot2D(tx, ty, rot);
				
				const scale = rad2 / rad;
				let sdx = rotated.x * scale;
				let sdy = rotated.y * scale;

				//sdx = LinearInterp(fdx - cx, sdx, att);
				//sdy = LinearInterp(fdy - cy, sdy, att);

      	sdx += cx;
      	sdy += cy;
      	
      	sdx -= fdx;
      	sdy -= fdy;
      	
      	const t = 1.0 / Math.sqrt(sdx * sdx + sdy * sdy + 0.00001);
      	sdx *= att * t * 0.002;
      	sdy *= att * t * 0.002;

      	sdx += fdx;
      	sdy += fdy;
      	
      	
	      
		    src_dxy[write_offset + 0] = (sdx - fdx);
		    src_dxy[write_offset + 1] = (sdy - fdy);	    
      }
    }
	}
	else if (new_mode == 15) {
		// LF WAVES
		const rot1 = randoms[rand_idx++];
		const rot2 = randoms[rand_idx++];
		const rot3 = randoms[rand_idx++];
		const rot4 = randoms[rand_idx++];
		
		for (let dy = 0; dy < H; dy++) {
		  let fdy = (dy * (2.0 / H) - 1.0) * (y0y1 * 0.5);
	    for (let dx = 0; dx < W; dx++, write_offset += 2) {
			  let fdx = (dx * (2.0 / W) - 1.0) * (x0x1 * 0.5);	

				let x = fdx;
				let y = fdy;

				x += Math.cos(fdx *  0.17 + fdy *  0.29 + 3) * 0.002;
				y += Math.cos(fdx * -0.08 + fdy *  0.17 + 2) * 0.002;
				x += Math.cos(fdx * -0.05 + fdy *  0.29 + 4) * 0.002;
				y += Math.cos(fdx *  0.21 + fdy * -0.12 + 1) * 0.002;

				let sdx = x;
				let sdy = y;
      	
	      
		    src_dxy[write_offset + 0] = (sdx - fdx);
		    src_dxy[write_offset + 1] = (sdy - fdy);	    
      }
    }			  		
  }*/
  else if (new_mode == 15) {
		// FISSURE - aka TWO-PLANE ZOOM
  	warp_prefs.wave_prefs_weight *= 10;
  	
  	// When this mode is active, it suppresses the motion of other modes!
  	// (Doesn't play nice with others)
  	warp_prefs.hog_motion_weight *= 10;

		const theta = randoms[rand_idx++] * 6.28;
	  const cos_theta = Math.cos(theta);
	  const sin_theta = Math.sin(theta);
	  const cos_minus_theta = Math.cos(-theta);
	  const sin_minus_theta = Math.sin(-theta);
	  const dz = (0.015 + 0.015 * randoms[rand_idx++]) * 1.0;
	  const plane_y = 1.01 + 0.5 * randoms[rand_idx++];
	  
	  // (cx, cy) serves as the center for both the fissure
	  //   and the waveform.
	  // Only vary the center position perpendicular
	  //   to the fissure direction; this will keep the wave
	  //   more centered.
	  const wave_offset = (randoms[rand_idx++] * 2 - 1) * 0.6;
	  const cx = wave_offset * Math.cos(-theta + Math.PI / 2);
	  const cy = wave_offset * Math.sin(-theta + Math.PI / 2);

		if (randoms[rand_idx++] < 0.99) {
			warp_prefs.flat_angle_lo = -theta; 
			warp_prefs.flat_angle_hi = -theta;
			warp_prefs.flat_cx_lo = cx;
			warp_prefs.flat_cx_hi = cx;
			warp_prefs.flat_cy_lo = cy;
			warp_prefs.flat_cy_hi = cy;
			warp_prefs.flat_angle_bias_toward_horizontal_angles = 0.0;
			warp_prefs.flat_stereo_sep_lo *= 0.3;
			warp_prefs.flat_stereo_sep_hi *= 0.75;
			warp_prefs.flat_stereo_amplitude_scale *= 0.6;
			warp_prefs.circ_cx_lo = cx;
			warp_prefs.circ_cx_hi = cx;
			warp_prefs.circ_cy_lo = cy;
			warp_prefs.circ_cy_hi = cy;
		}
		
	  for (let dy = 0; dy < H; dy++) {
		  let fdy = (dy * (2.0 / H) - 1.0) * (y0y1 * 0.5);
	    for (let dx = 0; dx < W; dx++, write_offset += 2) {
			  let fdx = (dx * (2.0 / W) - 1.0) * (x0x1 * 0.5);	
			
				// Rotate around the Z axis.
				let rrx = fdx - cx;
				let rry = fdy - cy;
				let rx = rrx * cos_theta - rry * sin_theta;
				let ry = rrx * sin_theta + rry * cos_theta;
				
				// Camera at ws (cx,cy,cz) = (0,0,0)
				// Virtual screen plane spanning ws ([-1..1], [-1..1], 1)
				// Infinite XZ planes at Y = +/- plane_y
			  
			  // Compute the WS view ray direction and normalize it.
			  let sx = rx;
			  let sy = ry;
			  let sz = 1.0;
			  let vx = sx;
			  let vy = sy;
			  let vz = sz;
			  let v_norm_scale = 1.0 / Math.sqrt(vx * vx + vy * vy + vz * vz);
			  vx *= v_norm_scale;
			  vy *= v_norm_scale;
			  vz *= v_norm_scale;
			  
			  // Compute WS intersection of the ray with y == plane_y
			  // cy + vy * t = plane_y
			  // cy + vy * t = plane_y
			  const which_plane_y = plane_y * ((ry < 0) ? -1 : 1);
			  let t = which_plane_y / vy;
			  
			  // Compute the WS point of intersection.
			  let ix = vx * t;
			  let iy = vy * t;
			  let iz = vz * t;

				// Move the WS point of intersection.
				iz += dz;				

				// Compute the new ray direction.
			  vx = ix;
			  vy = iy;
			  vz = iz;
			  v_norm_scale = 1.0 / Math.sqrt(vx * vx + vy * vy + vz * vz);
			  vx *= v_norm_scale;
			  vy *= v_norm_scale;
			  vz *= v_norm_scale;
				
			  
			  // Re-project that WS point back onto the WS screen plane.
			  // cz + vz * t = 1
			  t = 1 / vz;
			  
			  // Compute the final WS point of intersection.
			  let fx = vx * t;
			  let fy = vy * t;

				// Reverse-rotate the point back, so the displacement makes sense.			  
				let sdx = fx * cos_minus_theta - fy * sin_minus_theta;
				let sdy = fx * sin_minus_theta + fy * cos_minus_theta;

				sdx += cx;
				sdy += cy;

	      
		    src_dxy[write_offset + 0] = (sdx - fdx);
		    src_dxy[write_offset + 1] = (sdy - fdy);	    
      }
    }
  }  
  else if (new_mode == 16) {
		// LOW FREQ SINE WAVES
		
  	warp_prefs.wave_prefs_weight *= 0.1;

		const N = 5;

		const str = 0.4 + 0.6 * randoms[rand_idx++];
  	
  	let theta = new Float32Array(N);
  	let cos_theta = new Float32Array(N);
  	let sin_theta = new Float32Array(N);
  	let freq = new Float32Array(N);
  	let amp = new Float32Array(N);

		let theta_sum = 0.0;
		for (let i = 0; i < N; i++) {
	  	theta[i] = randoms[rand_idx++] * 6.28;
	  	cos_theta[i] = Math.cos(theta[i]);
	  	sin_theta[i] = Math.sin(theta[i]);
	  	amp[i] = randoms[rand_idx++] * str * 0.002 * 0.5 * 1.3;
	  	freq[i] = randoms[rand_idx++] * 12 * 2;

	  	theta_sum += theta[i];
		}
  	
  	const cos_undo = Math.cos(-theta_sum);
  	const sin_undo = Math.sin(-theta_sum);

		// We generate it first at reduced resolution, then upsample it.
		const SCALE = 4;
		const W2 = (W / SCALE + 1) | 0;
		const H2 = (H / SCALE + 1) | 0;
		let temp_x = new Float32Array(W2 * H2);
		let temp_y = new Float32Array(W2 * H2);
  	
	  for (let dy = 0; dy < H2; dy++) {
		  let fdy = (dy * (2.0 / H2) - 1.0) * (y0y1 * 0.5);
	    for (let dx = 0; dx < W2; dx++) {
			  let fdx = (dx * (2.0 / W2) - 1.0) * (x0x1 * 0.5);	

				let x = fdx;
				let y = fdy;
				
				for (let i = 0; i < N; i++) {
					let x2 = x * cos_theta[i] - y * sin_theta[i];
		      let y2 = x * sin_theta[i] + y * cos_theta[i];
		      x = x2;
		      y = y2;
	
		      x += Math.cos(y * freq[i]) * amp[i];					
				}
				
				let sdx = x * cos_undo - y * sin_undo;
	      let sdy = x * sin_undo + y * cos_undo;

		    temp_x[dy * W2 + dx] = sdx - fdx;
		    temp_y[dy * W2 + dx] = sdy - fdy;
      }
    }

		// Now upsample.
		// Note that if we had SIMD, it would be faster 
		// to upsample first in X, then in Y.
		write_offset = 0;
	  for (let dy = 0; dy < H; dy++) {
	  	const fsy = dy * (H2 - 1) / H;
	  	const sy = Math.floor(fsy);
	  	const fy = fsy - sy;
	    for (let dx = 0; dx < W; dx++, write_offset += 2) {
		  	const fsx = dx * (W2 - 1) / W;
		  	const sx = Math.floor(fsx);
		  	const fx = fsx - sx;
        
        const o1 = (sy + 0) * W2 + (sx + 0);
        const o2 = (sy + 0) * W2 + (sx + 1);
        const o3 = (sy + 1) * W2 + (sx + 0);
        const o4 = (sy + 1) * W2 + (sx + 1);
        
				const w1 = (1 - fy) * (1 - fx);
				const w2 = (1 - fy) * (    fx);
				const w3 = (    fy) * (1 - fx);
				const w4 = (    fy) * (    fx);

				const vx = temp_x[o1] * w1 +
									 temp_x[o2] * w2 +
				           temp_x[o3] * w3 +
									 temp_x[o4] * w4;
				const vy = temp_y[o1] * w1 +
									 temp_y[o2] * w2 +
				           temp_y[o3] * w3 +
									 temp_y[o4] * w4;

				//if (!Number.isFinite(vx) || !Number.isFinite(vy)) {
				//  console.error("NaN/Inf in upsample", { dx, dy, sx, sy, fx, fy, o1, o2, o3, o4 });
				//  break;
				//}
					    	
		    src_dxy[write_offset + 0] = vx;
		    src_dxy[write_offset + 1] = vy;
		  }
		}
	}
	else if (new_mode == 98 || new_mode == 99) {
		warp_prefs.wave_prefs_weight = 100.0;
		warp_prefs.hog_motion_weight = 100.0;
		
		warp_prefs.flat_angle_lo = 0.0;
		warp_prefs.flat_angle_hi = 0.0;
		warp_prefs.flat_is_stereo_chance = 0.0;
		warp_prefs.flat_cx_lo = -0.1,
		warp_prefs.flat_cx_hi =  0.1,
		warp_prefs.flat_cy_lo = -0.2,
		warp_prefs.flat_cy_hi =  0.2,

		warp_prefs.use_motion_center_as_wave_center_prob = 0.0;
	}
  /*else if (new_mode == 17) {
		// Name of the Wind
		
  	warp_prefs.hog_motion_weight *= 10;
  	
  	//warp_prefs.wave_prefs_weight *= 0.1;

		const N = 3;

		const str = 0.4 + 0.6 * randoms[rand_idx++];  // strength of the LF waves

		const wind = 
				(0.5 + 0.5 * randoms[rand_idx++]) * 
				((randoms[rand_idx++] < 0.5) ? 1.0 : -1.0) * 
				0.012;
  	
  	let theta = new Float32Array(N);
  	let cos_theta = new Float32Array(N);
  	let sin_theta = new Float32Array(N);
  	let freq = new Float32Array(N);
  	let amp = new Float32Array(N);

		let theta_sum = 0.0;
		for (let i = 0; i < N; i++) {
	  	theta[i] = randoms[rand_idx++] * 6.28;
	  	cos_theta[i] = Math.cos(theta[i]);
	  	sin_theta[i] = Math.sin(theta[i]);
	  	amp[i] = randoms[rand_idx++] * str * 0.002;
	  	freq[i] = randoms[rand_idx++] * 12;

	  	theta_sum += theta[i];
		}
  	
  	const cos_undo = Math.cos(-theta_sum);
  	const sin_undo = Math.sin(-theta_sum);
  	
	  for (let dy = 0; dy < H; dy++) {
		  let fdy = (dy * (2.0 / H) - 1.0) * (y0y1 * 0.5);
	    for (let dx = 0; dx < W; dx++, write_offset += 2) {
			  let fdx = (dx * (2.0 / W) - 1.0) * (x0x1 * 0.5);	

				let x = fdx;
				let y = fdy;
				
				for (let i = 0; i < N; i++) {
					let x2 = x * cos_theta[i] - y * sin_theta[i];
		      let y2 = x * sin_theta[i] + y * cos_theta[i];
		      x = x2;
		      y = y2;
	
		      x += Math.cos(y * freq[i]) * amp[i];					
				}
				
				let sdx = x * cos_undo - y * sin_undo;
	      let sdy = x * sin_undo + y * cos_undo;
	      
	      // Add wind:
	      sdx += wind;

	      
		    src_dxy[write_offset + 0] = (sdx - fdx);
		    src_dxy[write_offset + 1] = (sdy - fdy);	    
      }
    }
	}
  else if (new_mode == 17) {
  	// JUPITER STRIPES
  	
  	//warp_prefs.wave_prefs_weight *= 0.1;
  	warp_prefs.hog_motion_weight *= 3;

		const wind = 
				(0.5 + 0.5 * randoms[rand_idx++]) * 
				((randoms[rand_idx++] < 0.5) ? 1.0 : -1.0) * 
				0.01;

		const phase = randoms[rand_idx++] * 6.28;
		const freq = 5.0 + 9.0 * randoms[rand_idx++];
		const amp = 0.3 + 0.7 * randoms[rand_idx++];
		const dir = (randoms[rand_idx++] < 0.5) ? -1.0 : 1.0;
  	
	  for (let dy = 0; dy < H; dy++) {
		  let fdy = (dy * (2.0 / H) - 1.0) * (y0y1 * 0.5);
	    for (let dx = 0; dx < W; dx++, write_offset += 2) {
			  let fdx = (dx * (2.0 / W) - 1.0) * (x0x1 * 0.5);	

				let t = 0.5 + 0.5 * Math.cos(fdy * freq + phase);
				t *= t;
				t *= t;
				t *= amp;

				let sdx = fdx + t * dir * wind;
				let sdy = fdy;

	      
		    src_dxy[write_offset + 0] = (sdx - fdx);
		    src_dxy[write_offset + 1] = (sdy - fdy);	    
      }
    }
	}*/
	else if (new_mode == 17) {
		// VORTEX
		const cx = (randoms[rand_idx++] * 2 - 1) * 0.08;
		const cy = (randoms[rand_idx++] * 2 - 1) * 0.08;
		for (let dy = 0; dy < H; dy++) {
		  let fdy = (dy * (2.0 / H) - 1.0) * (y0y1 * 0.5);
	    for (let dx = 0; dx < W; dx++, write_offset += 2) {
			  let fdx = (dx * (2.0 / W) - 1.0) * (x0x1 * 0.5);	
	
				const tx = fdx - cx;
				const ty = fdy - cy;

				const rad1 = Math.sqrt(tx * tx + ty * ty);
				
				const inv_rad1 = 1.0 / (rad1 + 0.0001);
				const nx = tx * inv_rad1;
				const ny = ty * inv_rad1;
				
				const dist1 = inv_rad1;
				const dist2 = dist1 + 0.01;
				const rad2 = 1.0 / dist2 - 0.0001;

				let tx2 = rad2 * nx;
				let ty2 = rad2 * ny;				
			
				//const rot = 0.02;

				//const rotated = ApplyRot2D(tx, ty, rot);
				
				let sdx = cx + tx2;
				let sdy = cy + ty2;
      	
	      
		    src_dxy[write_offset + 0] = (sdx - fdx);
		    src_dxy[write_offset + 1] = (sdy - fdy);	    
      }
    }			  		
  }
	
	//----------------------------------------------------------------------
	//----------------------------------------------------------------------
	//----------------------------------------------------------------------
	
  if (rand_idx > WarpMapRandomNumberCount) {
  	throw new Error("Too many random numbers used when generating warp map for mode ", new_mode);
  }
    
  // Populate motion metadata by sampling some of the motion.
	{
		// Reminder that W,H here are both kWarpMapSize.
		const diagonal = Math.sqrt(W * W + H * H);
		const sample_count = 256;
		const scale = 100.0 / diagonal;
		const cx = W / 2;
		const cy = H / 2;
		let net_motion = 0.0;
		let net_zoom_motion = 0.0;
		let in_or_out_motion = 0.0;
		let net_clockwise_motion = 0.0;
		let cw_or_ccw_motion = 0.0;
	  for (let k = 0; k < sample_count; k++) {
	  	// Pick a random pixel on the (square) warp map.
	  	// Bias samples toward the center (pyramid-shaped distribution).
	  	const fx = (Math.random() + Math.random()) * 0.5;
	  	const fy = (Math.random() + Math.random()) * 0.5;
	  	const dx = (fx * (W - 1)) | 0;
	  	const dy = (fy * (H - 1)) | 0;
	  	const read_offset = (dy * W + dx) * 2;
	  	const sx = dx + src_dxy[read_offset + 0] * (0.5 * W);
	  	const sy = dy + src_dxy[read_offset + 1] * (0.5 * H);
	  	
	  	// r: vector from center of screen, to the destination point,
	  	// *normalized to unit length*.  We can dot against this
	  	// vector to determine how radial motion is.
	  	let rx = dx - cx;
	  	let ry = dy - cy;
	  	let r_norm_scale = 1.0 / Math.sqrt(rx * rx + ry * ry + 0.00001);
	  	rx *= r_norm_scale;
	  	ry *= r_norm_scale;
	
			// t: tangent vector.  Also of unit length.
			// We can dot against this vector to determine how angular 
			// the motion is.
			const tx = -ry;
			const ty = rx;
	  	
	  	// v: vector from the source point, to the destination point -
	  	// i.e. the direction of motion, at this point on the screen.
	  	const vx = (dx - sx) * scale;
	  	const vy = (dy - sy) * scale;

			// This dot product (v dot r) gives us the amount of radial motion.
			const outward   = rx * vx + ry * vy;
	
			// This dot product (v dot t) gives us the amount of clockwise (angular) motion.
			const clockwise = tx * vx + ty * vy;
	
			net_motion           += Math.sqrt(vx * vx + vy * vy);
			net_zoom_motion      += outward;
			in_or_out_motion     += Math.abs(outward);
			net_clockwise_motion += clockwise;
			cw_or_ccw_motion     += Math.abs(clockwise);
	  }
		warp_prefs.net_motion           = net_motion / sample_count;
		warp_prefs.net_zoom_motion      = net_zoom_motion / sample_count;
		warp_prefs.in_or_out_motion     = in_or_out_motion / sample_count;
		warp_prefs.net_clockwise_motion = net_clockwise_motion / sample_count;
		warp_prefs.cw_or_ccw_motion     = cw_or_ccw_motion / sample_count;
	}
	  
  return { mode : new_mode, 
				   // TODO: Remove W,H return params?
  				 W : W,
  				 H : H,
  				 warp_prefs : warp_prefs,
  	       src_dxy, 
  	       randoms };
}
