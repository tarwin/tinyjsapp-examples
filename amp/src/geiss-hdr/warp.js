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

// TODO: Move this fn to warp.js
export function AdvectPoint(sx0, sy0, xform, warps, warp_str, speed_mult, shift_x, shift_y) {
  // Convert from screen to normalized coordinates.
	const x0 = xform.ScreenToNormX(sx0);
	const y0 = xform.ScreenToNormY(sy0);
	let x = x0;
	let y = y0;
	
	const src1 = warps[0].warp_map.src_dxy;
	const src2 = warps[1].warp_map.src_dxy;
	const src3 = warps[2].warp_map.src_dxy;
	const src4 = warps[3].warp_map.src_dxy;

	// Iterate until we find the point that points exactly TO (x0, y0).
	const iters = 4;  // 3 is plenty; usually accurate to 0.01 pixels, or better.
	for (let k = 0; k < iters; k++) {
  	
		// Convert to warp coordinates.
		const wx = (x * 0.5 + 0.5) * kWarpMapSize;  // [0 .. kWarpMapSize]
		const wy = (y * 0.5 + 0.5) * kWarpMapSize;  // [0 .. kWarpMapSize]

		const iwx0 = Math.max(0, Math.min(kWarpMapSize - 1, wx | 0));
		const iwy0 = Math.max(0, Math.min(kWarpMapSize - 1, wy | 0));
		const iwx1 = Math.max(0, Math.min(kWarpMapSize - 1, (wx + 1) | 0));
		const iwy1 = Math.max(0, Math.min(kWarpMapSize - 1, (wy + 1) | 0));

		const fx = wx - Math.floor(wx);
		const fy = wy - Math.floor(wy);

		// Do a lookup (with manual bilinear interpolation) on each of the 4 warp maps.
		let wx1 = 
  			 src1[(iwx0 + iwy0 * kWarpMapSize) * 2 + 0] * (1 - fx) * (1 - fy) +
  			 src1[(iwx1 + iwy0 * kWarpMapSize) * 2 + 0] * fx * (1 - fy) +
  			 src1[(iwx0 + iwy1 * kWarpMapSize) * 2 + 0] * (1 - fx) * fy +
  			 src1[(iwx1 + iwy1 * kWarpMapSize) * 2 + 0] * fx * fy;
		let wx2 = 
  			 src2[(iwx0 + iwy0 * kWarpMapSize) * 2 + 0] * (1 - fx) * (1 - fy) +
  			 src2[(iwx1 + iwy0 * kWarpMapSize) * 2 + 0] * fx * (1 - fy) +
  			 src2[(iwx0 + iwy1 * kWarpMapSize) * 2 + 0] * (1 - fx) * fy +
  			 src2[(iwx1 + iwy1 * kWarpMapSize) * 2 + 0] * fx * fy;
		let wx3 =                                      
  			 src3[(iwx0 + iwy0 * kWarpMapSize) * 2 + 0] * (1 - fx) * (1 - fy) +
  			 src3[(iwx1 + iwy0 * kWarpMapSize) * 2 + 0] * fx * (1 - fy) +
  			 src3[(iwx0 + iwy1 * kWarpMapSize) * 2 + 0] * (1 - fx) * fy +
  			 src3[(iwx1 + iwy1 * kWarpMapSize) * 2 + 0] * fx * fy;
		let wx4 =                                      
  			 src4[(iwx0 + iwy0 * kWarpMapSize) * 2 + 0] * (1 - fx) * (1 - fy) +
  			 src4[(iwx1 + iwy0 * kWarpMapSize) * 2 + 0] * fx * (1 - fy) +
  			 src4[(iwx0 + iwy1 * kWarpMapSize) * 2 + 0] * (1 - fx) * fy +
  			 src4[(iwx1 + iwy1 * kWarpMapSize) * 2 + 0] * fx * fy;

		let wy1 = 
  			 src1[(iwx0 + iwy0 * kWarpMapSize) * 2 + 1] * (1 - fx) * (1 - fy) +
  			 src1[(iwx1 + iwy0 * kWarpMapSize) * 2 + 1] * fx * (1 - fy) +
  			 src1[(iwx0 + iwy1 * kWarpMapSize) * 2 + 1] * (1 - fx) * fy +
  			 src1[(iwx1 + iwy1 * kWarpMapSize) * 2 + 1] * fx * fy;
		let wy2 =                                    
  			 src2[(iwx0 + iwy0 * kWarpMapSize) * 2 + 1] * (1 - fx) * (1 - fy) +
  			 src2[(iwx1 + iwy0 * kWarpMapSize) * 2 + 1] * fx * (1 - fy) +
  			 src2[(iwx0 + iwy1 * kWarpMapSize) * 2 + 1] * (1 - fx) * fy +
  			 src2[(iwx1 + iwy1 * kWarpMapSize) * 2 + 1] * fx * fy;
		let wy3 =                                    
  			 src3[(iwx0 + iwy0 * kWarpMapSize) * 2 + 1] * (1 - fx) * (1 - fy) +
  			 src3[(iwx1 + iwy0 * kWarpMapSize) * 2 + 1] * fx * (1 - fy) +
  			 src3[(iwx0 + iwy1 * kWarpMapSize) * 2 + 1] * (1 - fx) * fy +
  			 src3[(iwx1 + iwy1 * kWarpMapSize) * 2 + 1] * fx * fy;
		let wy4 =                                    
  			 src4[(iwx0 + iwy0 * kWarpMapSize) * 2 + 1] * (1 - fx) * (1 - fy) +
  			 src4[(iwx1 + iwy0 * kWarpMapSize) * 2 + 1] * fx * (1 - fy) +
  			 src4[(iwx0 + iwy1 * kWarpMapSize) * 2 + 1] * (1 - fx) * fy +
  			 src4[(iwx1 + iwy1 * kWarpMapSize) * 2 + 1] * fx * fy;

		// Combine the 4 weighted warps.  Result is in an XY delta in normalized coords [-1..1].
		let dx = wx1 * warp_str[0] + wx2 * warp_str[1] + wx3 * warp_str[2] + wx4 * warp_str[3];
		let dy = wy1 * warp_str[0] + wy2 * warp_str[1] + wy3 * warp_str[2] + wy4 * warp_str[3];

		// TODO: This 0.5x is needed to make the motion match what happens in
		// gpu_warp.js -- where there is an errant *0.5 on 'warp_vec'.  Need
		// to remove that 0.5x, adjust BASE_MOTION_SCALE to compensate, and
		// then make sure FindBlendedWarpCenter is properly adjusted/calibrated too.
		dx *= 0.5 * speed_mult;
		dy *= 0.5 * speed_mult;

//xxx;
		dx += shift_x * xform.inv_W * xform.x0x1;
		dy += shift_y * xform.inv_H * xform.y0y1;
		
		//if (k == iters - 1) {
		//	console.log(`final iter change in pixels: ${(x0-dx - x) * xform.W * xform.inv_x0x1}, ${(y0-dy - y) * xform.H * xform.inv_y0y1}`);
		//}

		x = (x0 - dx);
		y = (y0 - dy);
	}
		
	// Convert back to screen coords.	
	let sx1 = xform.NormToScreenX(x);
	let sy1 = xform.NormToScreenY(y);
	
	return { x : sx1, y : sy1 };
}

// Note that the image is W * H in size,
// but the warp map is kWarpMapSize x kWarpMapSize.
export function FindBlendedWarpCenter(
    warp1, warp2, warp3, warp4, 
    str1, str2, str3, str4,
    W, H) {
	const xform = new TransformHelper(W, H);

	const src1 = warp1.src_dxy;
	const src2 = warp2.src_dxy;
	const src3 = warp3.src_dxy;
	const src4 = warp4.src_dxy;

	const diagonal = Math.sqrt(W * W + H * H);
	const warp_diagonal = Math.sqrt(kWarpMapSize * kWarpMapSize + kWarpMapSize * kWarpMapSize);

	const count = 64;
	const steps = 32;
	const step_len_scale = 8.0;

	let cx = 0.0;
	let cy = 0.0;
	let end_xy = new Array(count);

	const dxy_scale = step_len_scale;
	for (let k = 0; k < count; k++) {
		// Pick a random point on the screen.
  	// Bias samples toward the center (pyramid-shaped distribution).
  	const start_x = ((Math.random() + Math.random()) * 0.5 * W) | 0;
  	const start_y = ((Math.random() + Math.random()) * 0.5 * H) | 0;
  	
  	// Convert that to normalized coordinates.
		let sx = xform.ScreenToNormX(start_x);  // [-1..1]
		let sy = xform.ScreenToNormY(start_y);  // [-1..1]

		// Convert to warp coordinates.
		let wx = (sx * 0.5 + 0.5) * (kWarpMapSize - 1);  // [0 .. kWarpMapSize]
		let wy = (sy * 0.5 + 0.5) * (kWarpMapSize - 1);  // [0 .. kWarpMapSize]

		for (let step = 0; step < steps; step++) {
			//if (k==0) console.log(`step ${step} ${wx} ${wy}`);//FIXME
			const iwx = (wx + 0.5) | 0;
			const iwy = (wy + 0.5) | 0;
			const i = (iwy * kWarpMapSize + iwx) * 2;
    	let dx = 
    			 src1[i + 0] * str1 +
    			 src2[i + 0] * str2 +
    			 src3[i + 0] * str3 +
    			 src4[i + 0] * str4;
    	let dy = 
    			 src1[i + 1] * str1 +
    			 src2[i + 1] * str2 +
    			 src3[i + 1] * str3 +
    			 src4[i + 1] * str4;
    	
    	// Convert the *relative* offsets (dx,dy) 
    	// from normalized coords to warp map coords.
			dx = (dx * 0.5 * kWarpMapSize);
			dy = (dy * 0.5 * kWarpMapSize);
    	
		  const wx2 = (wx + dx * dxy_scale + 0.5) | 0;		// +0.5 to round.
		  const wy2 = (wy + dy * dxy_scale + 0.5) | 0;
			wx = Math.max(0, Math.min(kWarpMapSize - 1, wx2));		
			wy = Math.max(0, Math.min(kWarpMapSize - 1, wy2));
		}
	
		cx += wx;
		cy += wy;
		end_xy[k] = { wx, wy };
		//console.log(`end ${k} ${wx} ${wy}`);
	}
		
	// Compute the average center.
	cx /= count;
	cy /= count;

	// Do a 2nd pass over to get the average radius.
	let rad = 0.0;
	for (let k = 0; k < count; k++) {
		const dx = cx - end_xy[k].wx;
		const dy = cy - end_xy[k].wy;
		const dist = Math.sqrt(dx * dx + dy * dy);
		rad += dist;
	}
	rad /= count;
	rad /= warp_diagonal;
	
	// (cx, cy) is in warp coordinates; convert it to normalized coords,
	// so that the results are independent of screen size.
	cx = cx * (2.0 / (kWarpMapSize - 1)) - 1.0;
	cy = cy * (2.0 / (kWarpMapSize - 1)) - 1.0;

	return { cx, cy, rad, end_xy };
}

// TODO: Delete this function.
// Perform the grayscale image warp.
// Inputs are *indices/intensities* in 0..255.
let prev_avg = 0.0;
export function warpBilinearCarryRows(
    //srcIdx, dstIdx, base, w00, w10, w01, w11, W, H) { 
    srcIdx, dstIdx, 
    warp1, warp2, warp3, warp4, 
    str1, str2, str3, str4,
    shift_mag,
    shift_time,
    W, H) {

	//const RandomNumberBankSize = 4096;		// Must be power of 2.
	//const random_numbers = new Uint8Array(RandomNumberBankSize);
	//for (let i = 0; i < random_numbers.length; i++) {
	//  random_numbers[i] = (Math.random() * 255) | 0;
	//}

	const src1 = warp1.src_dxy_q8;
	const src2 = warp2.src_dxy_q8;
	const src3 = warp3.src_dxy_q8;
	const src4 = warp4.src_dxy_q8;

  // Basic auto-exposure is tuned via scale_q10:
  //   1020 = almost no darkening
  //   1010 = good typical value
  //    990 = aggressive darkening 
	// Lower clamp_thresh -> faster decay to black on dark scenes (calm motion).
	// If you want faster decay toward black on dark scenes (calm motion):
	//   -> decrease clamp_thresh	 
	// If you want faster decay toward black on intense zoom scenes:
	//   -> decrease divisor
	const clamp_thresh = 1.2;//1.3;	
	// Lower divisor -> quicker decay to black *of very bright stuff* over time
  const divisor = 6.3;//9;
  const prev_avg_clamped = Math.max(prev_avg - clamp_thresh, 0.0);
  const scale_q10 = (1024.0 - (prev_avg_clamped / divisor)) | 0;

	const diag = Math.sqrt(W * W + H * H);

	const speed = 0.7;
	const t = shift_time * 60;
	const shift_x = shift_mag *
			(Math.cos(t * 0.01171 * speed + 0) * 2 +
			 Math.cos(t * 0.00111 * speed + 3) * 2);
	const shift_y = shift_mag *
			(Math.cos(t * 0.00874 * speed + 1) * 1.3 +
			 Math.cos(t * 0.00351 * speed + 2) * 1.3);

	const global_shift_x = (shift_x * (256)) | 0;
	const global_shift_y = (shift_y * (256)) | 0;  
  
  const str1_q8 = (str1 * 256) | 0;
  const str2_q8 = (str2 * 256) | 0;
  const str3_q8 = (str3 * 256) | 0;
  const str4_q8 = (str4 * 256) | 0;

	const max_x = W - 2;
	const max_y = H - 2;			
	const max_offset = max_y * W + max_x;
  
  //let randoms = new Uint8Array(256);
  //for (let i = 0; i < 256; i++) {
  	//randoms[i] = (Math.random() * 255) | 0;
  //}
  const inv_W = 1.0 / W;
  const inv_H = 1.0 / H;
  
  let i = 0;
  let global_sum = 0;
  for (let y = 0; y < H; y++) {
  	let randIdx = (Math.random() * 255) | 0;
  	
		//let rand_idx = (Math.random() * (RandomNumberBankSize - 1)) | 0;
    let carry = 0;
    for (let x = 0; x < W; x++) {
      //const src_x_q8 = (x << 8) + src_dxy_q8[i + 0] + global_shift_x;
      //const src_y_q8 = (y << 8) + src_dxy_q8[i + 1] + global_shift_y;
    	
    	const dx_q8 = 
    			(src1[i + 0] * str1_q8 +
    			 src2[i + 0] * str2_q8 +
    			 src3[i + 0] * str3_q8 +
    			 src4[i + 0] * str4_q8) >> 8;
    	const dy_q8 = 
    			(src1[i + 1] * str1_q8 +
    			 src2[i + 1] * str2_q8 +
    			 src3[i + 1] * str3_q8 +
    			 src4[i + 1] * str4_q8) >> 8;
    	
// Painterly effects:
//const v = srcIdx[y * W + x];
//dx_q8 = (dx_q8 * (256 + v)) >> 8;
//dy_q8 = (dy_q8 * (256 + v)) >> 8;
//dx_q8 = (dx_q8 * (64 + v*2)) >> 8;
//dy_q8 = (dy_q8 * (64 + v*2)) >> 8;
//dx_q8 = (dx_q8 * (320 - v)) >> 8;
//dy_q8 = (dy_q8 * (320 - v)) >> 8;
//dx_q8 -= (dx_q8 * v * 2) >> 8;
//dy_q8 -= (dy_q8 * v * 2) >> 8;
    	
      const src_x_q8 = (x << 8) + global_shift_x + dx_q8;
      const src_y_q8 = (y << 8) + global_shift_y + dy_q8;

		  let sx = src_x_q8 >> 8;
		  let sy = src_y_q8 >> 8;
		  const fx = src_x_q8 & 255;
		  const fy = src_y_q8 & 255;

		  // Note: branches (predicated writes) are allegedly 
		  // faster than Math.min/max.
			// const b = Math.max(0, Math.min(max_offset, sy * W + sx));
		  //let b = sy * W + sx;
		  //if (b < 0) b = 0;
		  //if (b > max_offset) b = max_offset;		  
		  //if (sx < 0) sx += W;
		  //if (sx > W) sx -= W;
		  //if (sy < 0) sy += H;
		  //if (sy > H) sy -= H;
		  //sx = Math.max(0, Math.min(W - 2, sx));
		  //sy = Math.max(0, Math.min(H - 2, sy));
		  
		  // Wrap in both X and Y.  Faster and looks better.
		  sx = (sx - (Math.floor(sx * inv_W) * W)) | 0;
		  sy = (sy - (Math.floor(sy * inv_H) * H)) | 0;

		  const b = sy * W + sx;
      
      const s00 = srcIdx[b];
      const s01 = srcIdx[b + 1];
      const s10 = srcIdx[b + W];
      const s11 = srcIdx[b + W + 1];
	
		  const sum_q16 = 
		      (s00 * (256 - fx) +
		       s01 * (fx      )) * (256 - fy) +
		      (s10 * (256 - fx) +
		       s11 * (fx      )) * fy;
		       
		  let avg_q8 = (sum_q16 >> 8) + carry;
		  
		  // Add noise:
		  //avg_q8 = avg_q8 + ((random_numbers[rand_idx] - 120) >> 1);
		  //if (avg_q8 < 0) avg_q8 = 0;
		  //rand_idx = (rand_idx + 1) & (RandomNumberBankSize - 1);

			// Decay:
      avg_q8 = (avg_q8 * scale_q10 + 512) >> 10;
      const avg = avg_q8 >> 8;

 			global_sum += avg;

			// To confirm that sampling is working as expected:
			//dstIdx[y * W + x] = (((((x/2)|0) + ((y/2)|0)) & 1) | 0) * 63;
			dstIdx[y * W + x] = avg;
			carry = avg_q8 & 255;
			
			//if (x < W / 2) {
			//	randIdx = (randIdx + 1) & 255;
			//	carry = randoms[randIdx];
			//}
			
			i += 2;
    }
  }
    
  prev_avg = global_sum * 1.0 / (W * H);
}

