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

// This class helps you convert between two coordinate spaces:
// 1. Screen space:      [0 .. W-1] x [0 .. H-1] 
// 2. Normalized space:  [-1 .. 1] x [-1 .. 1]
//      ...but normalized space is aspect-ratio-aware.
//      It is a crop of a square.  So if you have a 2:1
//      wide window, the normalized X coordinates will
//      span [-1 .. 1], but the normalized Y coordinates
//      will only span [-0.5 ... 0.5].
export class TransformHelper {
  constructor(W, H) {
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
	
		this.W = W;
		this.H = H;
		this.inv_W = 1.0 / W;
		this.inv_H = 1.0 / H;
		
		this.x0x1 = x1 - x0;
		this.y0y1 = y1 - y0;
		this.inv_x0x1 = 1.0 / this.x0x1;
		this.inv_y0y1 = 1.0 / this.y0y1;
	}		
	
	// General conversion formula for converting
	//   from: normalized space [-1..1]
	//   to:   screen space [0..W, 0..H]
	// dx [0..W]  = (fx * inv_x0x1 + 0.5) * W
	// dy [0..H]  = (fy * inv_y0y1 + 0.5) * H
	NormToScreenX(fx) {
		return (fx * this.inv_x0x1 + 0.5) * this.W;
	}
	NormToScreenY(fy) {
		return (fy * this.inv_y0y1 + 0.5) * this.H;
	}

	// General conversion formula for converting
	//   from: screen space [0..W, 0..H]
	//   to:   normalized space [-1..1]
	// fx [-1..1] = (dx * inv_W - 0.5) * x0x1
	// fy [-1..1] = (dy * inv_H - 0.5) * y0y1
	ScreenToNormX(dx) {
		return (dx * this.inv_W - 0.5) * this.x0x1;
	}
	ScreenToNormY(dy) {
		return (dy * this.inv_H - 0.5) * this.y0y1;
	}
}
