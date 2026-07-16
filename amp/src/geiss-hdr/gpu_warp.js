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

// gpu_warp.js
// Reliability-first: ping-pong rgba8unorm, pack u16 into RG bytes.
// Warp maps: rg16float (FP16), sampled bilinear.

import { kWarpMapSize, kNoiseTexSize, kMaxActiveWarps } from "./const.js"
import { TransformHelper } from "./coords.js"
import { DotRenderer } from "./dot_renderer.js";
import { create_noise_textures, get_noise_index_for_frame } from "./noise_textures.js";
import { GpuTextOverlay } from "./gpu_text_overlay.js";

// Shared uniforms:
const kUniforms = 
`struct WarpUniforms {
  // strengths for each warp map (in pixels per pixel, if warp maps are in pixels)
  w0 : f32,
  w1 : f32,
  w2 : f32,
  w3 : f32,

  // Optional global shift in pixels (can leave 0)
  shift_x : f32,
  shift_y : f32,

  // dimensions (float for convenience)
  warp_width  : f32,
  warp_height : f32,
  index_width  : f32,
  index_height : f32,
  index_width_inv  : f32,
  index_height_inv : f32,
  x0x1 : f32,
  y0y1 : f32,
  inv_x0x1 : f32,
  inv_y0y1 : f32,

	noise_offset_x : f32,
	noise_offset_y : f32,
  darkening : f32,		// [-1..1]
  _pad2 : f32,
};
`;

//-----------------------------------------------------------------------------------
//-----------------------------------------------------------------------------------
// warp_pass.wgsl
//-----------------------------------------------------------------------------------
//-----------------------------------------------------------------------------------
export const kWarpWGSL = kUniforms + 
`
struct ExposureOut {
  decay : f32,
  _pad0 : f32,
  _pad1 : f32,
  _pad2 : f32,
};

@group(0) @binding(0) var old_tex : texture_2d<f32>;        // rgba8unorm view (sampleType float)
@group(0) @binding(1) var warp0   : texture_2d<f32>;        // rg16float
@group(0) @binding(2) var warp1   : texture_2d<f32>;
@group(0) @binding(3) var warp2   : texture_2d<f32>;
@group(0) @binding(4) var warp3   : texture_2d<f32>;
@group(0) @binding(5) var samp    : sampler;               // filtering sampler
@group(0) @binding(6) var<uniform> u : WarpUniforms;
@group(0) @binding(7) var noise_tex : texture_2d<f32>;      // r8unorm, loaded via textureLoad
@group(0) @binding(8) var<storage, read> exposure : ExposureOut;
//@group(0) @binding(7) var noise_tex0 : texture_2d<f32>;      // r8unorm, loaded via textureLoad
//@group(0) @binding(9) var noise_samp : sampler;

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> @builtin(position) vec4f {
  var pos = array<vec2f, 3>(
    vec2f(-1.0, -1.0),
    vec2f(-1.0,  3.0),
    vec2f( 3.0, -1.0)
  );
  let p = pos[vid];
  return vec4f(p, 0.0, 1.0);
}

fn clamp_i32(x: i32, lo: i32, hi: i32) -> i32 {
  return max(lo, min(hi, x));
}

// Decode packed u16 from RG of an rgba8unorm textureLoad result.
// c.r and c.g are floats in [0..1].
fn decode_u16_from_rg(c: vec4f) -> u32 {
  // Round to nearest byte.
  let hi: u32 = u32(clamp(floor(c.r * 255.0 + 0.5), 0.0, 255.0));
  let lo: u32 = u32(clamp(floor(c.g * 255.0 + 0.5), 0.0, 255.0));
  return (hi << 8) | lo;
}

// Encode u16 (0..65535) into RG bytes in [0..1] for rgba8unorm output.
fn encode_rg_from_u16(v: u32) -> vec4f {
  let hi: u32 = (v >> 8) & 255u;
  let lo: u32 =  v       & 255u;
  return vec4f(f32(hi) * (1.0 / 255.0),
               f32(lo) * (1.0 / 255.0),
               0.0,
               1.0);
}

// Wrap an integer into [0..n-1] (works for negative too).
fn wrap_i32(x: i32, n: i32) -> i32 {
  // WGSL % keeps the sign of x, so fix negatives.
  let r = x % n;
  return select(r, r + n, r < 0);
}

// Manual bilinear sampling from old_tex for packed-u16 scalar, with WRAP on all edges.
// Caller is responsible for biasing pixel coords by (+0.5, +0.5) before calling.
fn sample_old_u16_bilinear(src_pos: vec2f) -> f32 {
  let w = i32(u.index_width);
  let h = i32(u.index_height);

  // Floor to get base texel (can be negative / outside).
  let x0f = floor(src_pos.x);
  let y0f = floor(src_pos.y);

  // Fraction within the cell [0..1).
  // (Caller bias ensures "no drift" when sampling texel centers.)
  let fx = src_pos.x - x0f;
  let fy = src_pos.y - y0f;

  // Wrap base texel and its neighbor.
  let x0 = wrap_i32(i32(x0f), w);
  let y0 = wrap_i32(i32(y0f), h);
  let x1 = wrap_i32(x0 + 1, w);
  let y1 = wrap_i32(y0 + 1, h);

  let c00 = textureLoad(old_tex, vec2i(x0, y0), 0);
  let c01 = textureLoad(old_tex, vec2i(x1, y0), 0);
  let c10 = textureLoad(old_tex, vec2i(x0, y1), 0);
  let c11 = textureLoad(old_tex, vec2i(x1, y1), 0);

  let v00 = f32(decode_u16_from_rg(c00));
  let v01 = f32(decode_u16_from_rg(c01));
  let v10 = f32(decode_u16_from_rg(c10));
  let v11 = f32(decode_u16_from_rg(c11));

  // Bilinear lerp.
  let a0 = v00 + (v01 - v00) * fx;
  let a1 = v10 + (v11 - v10) * fx;
  return a0 + (a1 - a0) * fy;
}

//fn fetcher(src_pos: vec2f, dx: i32, dy: i32) -> f32 {
//	let s1 = vec2i(i32(floor(src_pos.x + 0.5)), i32(floor(src_pos.y + 0.5)));
//	let s2 = vec2i(s1.x + dx, s1.y + dy);
//	let packed = textureLoad(old_tex, s2, 0);
//	return f32(decode_u16_from_rg(packed));	
//}



// p.xy : the output coordinates in [0..index_width - 1, 0 .. index_height - 1]
@fragment
fn fs_main(@builtin(position) p: vec4f) -> @location(0) vec4f {

  // Destination pixel coords in the index texture space (assume 1:1 for now).
  let dx = p.x;		// [0 .. u.index_width - 1]
  let dy = p.y;		// [0 .. u.index_height - 1]

  // UV in [0..1] for sampling warp maps with bilinear.
	// General conversion formula:  (screen [0..W]x[0..H] -> normalized [-1..1])
	//   fx [-1..1] = (dx * inv_W - 0.5) * x0x1
	//   fy [-1..1] = (dy * inv_H - 0.5) * y0y1
  var uv = vec2f(dx * (1.0 / (u.index_width - 1)), 
                 dy * (1.0 / (u.index_height - 1)));		// [0..1]
	uv = (uv - 0.5) * vec2f(u.x0x1, u.y0y1);  // -> Now in normalized coordinate space.
	uv = uv * 0.5 + 0.5;          // -> Now go back to [0..1] UV sampling space. 
  uv += vec2f(0.5 / u.warp_width, 0.5 / u.warp_height);		// (Doesn't really matter) //TODO

  // Sample 4 warp maps (rg16float), bilinear.
  let wv0 = textureSampleLevel(warp0, samp, uv, 0.0).xy;
  let wv1 = textureSampleLevel(warp1, samp, uv, 0.0).xy;
  let wv2 = textureSampleLevel(warp2, samp, uv, 0.0).xy;
  let wv3 = textureSampleLevel(warp3, samp, uv, 0.0).xy;

  // Combined warp vector (in pixels if your warp maps are in pixels).
  var warp_vec =
      (wv0 * u.w0 +
       wv1 * u.w1 +
       wv2 * u.w2 +
       wv3 * u.w3);

	// General conversion formula:  (normalized [-1..1] -> screen [0..W]x[0..H])
	//   dx [0..W]  = (fx * inv_x0x1 * 0.5 + 0.5) * W
	//   dy [0..H]  = (fy * inv_y0y1 * 0.5 + 0.5) * H
	// TODO: This *0.5 should not be here; remove it.
	//   *** see similar TODO in AdvectPoint().
  warp_vec = warp_vec
       * vec2f(u.inv_x0x1 * 0.5 * u.index_width,
               u.inv_y0y1 * 0.5 * u.index_height)
       ;

	//warp_vec = vec2f(0.0, -5);     // IN PIXELS

	//let warp_noise_vec = vec2f(
	//    textureSample(noise_tex0, noise_samp, uv * 0.2                  ).r * 2 - 1,
	//    textureSample(noise_tex0, noise_samp, uv * 0.2 + vec2f(0.5, 0.5)).r * 2 - 1
	//) * vec2f(u.index_width, u.index_height) * 0.00015 * 0.0;

  // Source position -- in pixel space.
  let src_pos = 
  		vec2f(dx, dy) 
      + warp_vec
      //+ warp_noise_vec
  		+ vec2f(u.shift_x, u.shift_y)
      - vec2f(0.5, 0.5)
  		;

  // Sample old image (packed u16) manually with bilinear.
  var v = sample_old_u16_bilinear(src_pos);


	//// Experiment: sharpen.
	//// -> fails because src_pos is in-between 2x2 pixels, and we're just
	//      always reading 3x3 snapped pixels, and comparing them.
  //let blurred =                                                    
  //		(fetcher(src_pos, -1, -1)     +
  //		 fetcher(src_pos, -1,  0) * 2 +
  //		 fetcher(src_pos, -1,  1)     +
  //		 fetcher(src_pos,  0, -1) * 2 +
  //		 fetcher(src_pos,  0,  0) * 4 +
  //		 fetcher(src_pos,  0,  1) * 2 +
  //		 fetcher(src_pos,  1, -1)     +
  //		 fetcher(src_pos,  1,  0) * 2 +
  //		 fetcher(src_pos,  1,  1)) * (1.0 / 16);
	//v = v * 0.1 + 0.9 * blurred;
  //

	//let checkerboard = (u32(floor(dx * 0.02)) & 1) * 256 - 128;

  // Round to nearest u16 and write back packed into RG.
  var v_u = clamp(floor(v + 0.5), 0.0, 65535.0);// + checkerboard;



	// Add noise.
  // Tiny unfiltered noise (textureLoad). Wrap by & (size-1) since size is 256.
  // p.xy are pixel coords in the output render target space.
  let nx = (u32(p.x) + u32(u.noise_offset_x)) & (256u - 1u);
  let ny = (u32(p.y) + u32(u.noise_offset_y)) & (256u - 1u);
  let n01 = textureLoad(noise_tex, vec2u(nx, ny), 0).r;  // [0,1]
  let noise = n01 * 2.0 - 1.0;                               // [-1,1]

  // Sprinkle: pick a *tiny* scale. Tune later.
  const kNoiseStrength = 1.015;//1.015;//1.005;
	v_u *= pow(kNoiseStrength, noise);



	// TODO: Put in a better decay.
	//let decay = 0.99;//0.997;
	let decay = exposure.decay;
	v_u *= decay;	
	//v_u *= 0.0;//FIXME_WAVEFORM
  
  let rounded = u32(max(0.0, min(65535.0, v_u + 0.5)));
  
  return encode_rg_from_u16(rounded);
}`;

//-----------------------------------------------------------------------------------
//-----------------------------------------------------------------------------------
//-----------------------------------------------------------------------------------

export const kAutoExposureWGSL = kUniforms + 
`
@group(0) @binding(0) var old_tex : texture_2d<f32>;
@group(0) @binding(1) var<uniform> u : WarpUniforms;

struct ExposureOut {
  decay : f32,
  _pad0 : f32,
  _pad1 : f32,
  _pad2 : f32,
};
@group(0) @binding(2) var<storage, read_write> out_exposure : ExposureOut;

fn decode_u16_from_rg(c: vec4f) -> u32 {
  let hi: u32 = u32(clamp(floor(c.r * 255.0 + 0.5), 0.0, 255.0));
  let lo: u32 = u32(clamp(floor(c.g * 255.0 + 0.5), 0.0, 255.0));
  return (hi << 8) | lo;
}

// Simple integer hash (good enough for sampling coords)
fn hash_u32(x: u32) -> u32 {
  var v = x;
  v ^= v >> 16u;
  v *= 0x7feb352du;
  v ^= v >> 15u;
  v *= 0x846ca68bu;
  v ^= v >> 16u;
  return v;
}

const kWG: u32 = 256u;
const kSamplesPerThread: u32 = 16u; // 256*16 = 4096 samples total

var<workgroup> wg_sum : array<f32, 256>;

@compute @workgroup_size(256)
fn cs_main(@builtin(local_invocation_id) lid: vec3u) {
  let tid = lid.x;

  let w = u32(u.index_width);
  let h = u32(u.index_height);

  // Seed from tid + per-frame noise offsets (you update these each frame)
  // (note: u.noise_offset_x/y are floats; convert safely)
  let sx_seed = u32(u.noise_offset_x);
  let sy_seed = u32(u.noise_offset_y);
  var seed = hash_u32(tid ^ (sx_seed * 1315423911u) ^ (sy_seed * 2654435761u));

  var sum: f32 = 0.0;

  // Strided random samples
  for (var i: u32 = 0u; i < kSamplesPerThread; i++) {
    seed = hash_u32(seed + 0x9e3779b9u);

    // Derive coords from seed
    let x = (seed      ) % w;
    let y = (seed >> 16) % h;

    let c = textureLoad(old_tex, vec2u(x, y), 0);
    let v_u16 = f32(decode_u16_from_rg(c));
    sum += v_u16;
  }

  wg_sum[tid] = sum;
  workgroupBarrier();

  // Reduce within workgroup
  var stride = 128u;
  while (stride > 0u) {
    if (tid < stride) {
      wg_sum[tid] += wg_sum[tid + stride];
    }
    workgroupBarrier();
    stride >>= 1u;
  }

  // Thread 0 writes final average and converts to decay
  if (tid == 0u) {
    let total_samples = f32(kWG * kSamplesPerThread);
    let avg_u16 = wg_sum[0] / total_samples;         // [0..65535]ish

		// DECAY TUNING:
		/*
    let avg01 = avg_u16 * (1.0 / 65535.0);    
		const clamp_thresh = 1.2 / 255.0;//1.3;	
		// Lower divisor -> quicker decay to black *of very bright stuff* over time
		const divisor = 6.3;//9;
		let prev_avg_clamped = max(avg01 - clamp_thresh, 0.0);
		let decay = 1.0 - 0.25 * (prev_avg_clamped / divisor);    
    */

		/*
    let avg8 = avg_u16 * (1.0 / 256.0);    		// [0..255]
		// Tune this first, to the decay you want when the image is already dark.
		const base_decay = 1.0;    
		const clamp_thresh = 1.2;	
		// Lower divisor -> quicker decay to black *of very bright stuff* over time
		const divisor = 1613;
		let prev_avg_clamped = max(avg8 - clamp_thresh, 0.0);
		let decay = base_decay - 0.25 * (prev_avg_clamped / divisor);    
		*/
		
    let avg8 = avg_u16 * (1.0 / 256.0);    		// [0..255]
		// Tune this first, to the decay you want when the image is already dark.
		const base_decay = 0.997;//1.0;
		const fast_decay = 0.990;
		let exp_base = select(base_decay, fast_decay, u.darkening >= 0);
		let adj_base_decay = base_decay * pow(exp_base, u.darkening);
					
		let min_level_for_extra_decay = 30 * (1 - u.darkening);//1.2;  	// [0..255]
		// Lower divisor -> quicker decay to black *of very bright stuff* over time
		const extra_decay_strength = 0.000075;//0.000155
		let prev_avg_clamped = max(avg8 - min_level_for_extra_decay, 0.0);
		let decay = max(0.0, adj_base_decay - (prev_avg_clamped * extra_decay_strength));        
    
    out_exposure.decay = decay;
  }
}
`;

//-----------------------------------------------------------------------------------
//-----------------------------------------------------------------------------------
//-----------------------------------------------------------------------------------

// Fast path (native Float16Array) when available; fallback to JS bit-pack.
// Returns Uint16Array of float16 bit patterns (len = input.length).
const _f32_scratch = new Float32Array(1);
const _u32_scratch = new Uint32Array(_f32_scratch.buffer);

// Scalar fallback: no allocations, reused scratch views.
function float32_to_float16_bits_fast_fallback(val) {
  _f32_scratch[0] = val;
  const x = _u32_scratch[0];

  const sign = (x >>> 16) & 0x8000;
  let mant = x & 0x007fffff;
  let exp  = (x >>> 23) & 0xff;

  // NaN/Inf
  if (exp === 0xff) {
    if (mant !== 0) return sign | 0x7e00; // canonical NaN
    return sign | 0x7c00;                 // Inf
  }

  // Re-bias exponent from f32 (127) to f16 (15)
  exp = exp - 127 + 15;

  // Subnormal / underflow
  if (exp <= 0) {
    if (exp < -10) return sign; // too small => +/-0
    mant = (mant | 0x00800000) >>> (1 - exp);
    // round to nearest
    if (mant & 0x00001000) mant += 0x00002000;
    return sign | (mant >>> 13);
  }

  // Overflow => Inf
  if (exp >= 0x1f) return sign | 0x7c00;

  // Normalized: round mantissa
  if (mant & 0x00001000) {
    mant += 0x00002000;
    if (mant & 0x00800000) {
      mant = 0;
      exp += 1;
      if (exp >= 0x1f) return sign | 0x7c00;
    }
  }

  return sign | (exp << 10) | (mant >>> 13);
}

export function pack_f32_to_rg16f(f32_xy_interleaved) {
  const n = f32_xy_interleaved.length;

  // Fast path: Chrome / browsers that have Float16Array
  if (typeof Float16Array !== "undefined") {
    const f16 = new Float16Array(n);
    f16.set(f32_xy_interleaved);
    // Copy out the bits so caller gets an owning Uint16Array
    return new Uint16Array(f16.buffer, f16.byteOffset, n).slice();
  }

  // Fallback: Safari
  console.log("WARNING: Native Float16Array not supported by browser; warp map uploads will be slow and might cause brief pauses.");
  const out = new Uint16Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = float32_to_float16_bits_fast_fallback(f32_xy_interleaved[i]);
  }
  return out;
}

// Pack old 8-bit index (0..255) into RG16 with hi byte = idx, lo byte = 0.
// Output is RGBA8 bytes for uploading into rgba8unorm texture.
function pack_u8_to_rg16_in_rgba8(index_u8) {
  const n = index_u8.length;
  const out = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const v = index_u8[i] & 255;
    out[i * 4 + 0] = v;    // R = hi byte
    out[i * 4 + 1] = 0;    // G = lo byte
    out[i * 4 + 2] = 0;    // B unused
    out[i * 4 + 3] = 255;  // A
  }
  return out;
}

export class GPUWarp {
  constructor(device, width, height, shader_code_wgsl) {
    this.device = device;
    this.W = width;
    this.H = height;

    this.shader_code = shader_code_wgsl;

    this.index_tex = [null, null];
    this.index_view = [null, null];
    this.ping = 0; // old = ping, new = ping^1

    this.warp_tex = [null, null, null, null];
    this.warp_view = [null, null, null, null];

    this.sampler = null;
    this.uniform_buf = null;
    this.bind_group = null;
    this.pipeline = null;
    
		this.dots = null;    

		this.noise = null;          // { textures, views, ... }
		this.bind_groups = null;    // 2D: [2][kNoiseTexCount]
		this.frame_index = 0;  

		this.exposure_buf = null;
		
		this.autoexp_pipeline = null;
		this.autoexp_bind_groups = [null, null]; // one per old_i (ping)

		this.text_overlay = null;
    this.pending_text_burn = false;
    this.pending_text_burn_center_x = 0;
    this.pending_text_burn_center_y = 0;
    this.pending_text_burn_intensity = 1.0;
    
    this.warp_map = new Array();
    for (let i = 0; i < kMaxActiveWarps; i++) {
    	this.warp_map.push(null);
    }
  }
	
	resize(iw, ih) {
		if (!this.pipeline) {
		  // Not initialized yet; we'll build pipelines/bindgroups in init().
		  return;
		}
		
	  iw |= 0;
	  ih |= 0;
	  if (iw <= 0 || ih <= 0) {
	    throw new Error(`GPUWarp.resize invalid size: ${iw}x${ih}`);
	  }
	
	  // No-op if unchanged
	  if (this.W === iw && this.H === ih && this.index_tex[0] && this.index_tex[1]) {
	    return;
	  }
	
	  // 1) Destroy old index textures (warp textures stay as-is)
	  for (let k = 0; k < 2; k++) {
	    if (this.index_tex[k]) {
	      try { this.index_tex[k].destroy(); } catch (_) {}
	      this.index_tex[k] = null;
	      this.index_view[k] = null;
	    }
	  }
	
	  // 2) Update dims + reset ping so "old" is tex0 again
	  this.W = iw;
	  this.H = ih;
	  this.ping = 0;
	
	  // 3) Recreate index ping-pong textures/views
	  const d = this.device;
	  for (let k = 0; k < 2; k++) {
	    this.index_tex[k] = d.createTexture({
	      size: { width: this.W, height: this.H },
	      // TODO: Could experiment with making this "rg" only someday.
	      format: "rgba8unorm",
	      usage:
	        GPUTextureUsage.TEXTURE_BINDING |
	        GPUTextureUsage.RENDER_ATTACHMENT |
	        GPUTextureUsage.COPY_DST |
	        GPUTextureUsage.COPY_SRC,
	    });
	    this.index_view[k] = this.index_tex[k].createView();
	  }
	
	  // 4) Invalidate any cached padded upload buffers sized for previous dims
	  // (You may add these later; safe to clear now if they exist.)
	  //this._padded_index_rgba8 = null;
	  //this._padded_index_rgba8_w = 0;
	  //this._padded_index_rgba8_h = 0;
	
		this.rebuild_autoexp_bind_groups();
	  this.rebuild_bind_groups_all();

	
	  // 6) Fill with fresh noise, like init-time behavior
	  // (Uses upload_index_u8 internally.)
	  // TODO: Remove this.
	  this.fill_index_u8_with_noise();	  
	}
	
  init() {
    const d = this.device;

    // Index ping-pong textures: rgba8unorm, renderable + sampleable.
    for (let k = 0; k < 2; k++) {
      this.index_tex[k] = d.createTexture({
        size: { width: this.W, height: this.H },
        format: "rgba8unorm",
        usage: GPUTextureUsage.TEXTURE_BINDING |
               GPUTextureUsage.RENDER_ATTACHMENT |
               GPUTextureUsage.COPY_DST |
               GPUTextureUsage.COPY_SRC,
      });
      this.index_view[k] = this.index_tex[k].createView();
    }

    // Warp textures: rg16float, sampleable + uploadable.
    for (let i = 0; i < 4; i++) {
      this.warp_tex[i] = d.createTexture({
        //size: { width: this.W, height: this.H },
        // See also: size forced in motion.js.
        size: { width: kWarpMapSize, height: kWarpMapSize },
        format: "rg16float",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      this.warp_view[i] = this.warp_tex[i].createView();
    }

    // Filtering sampler for warp maps (bilinear).
    this.sampler = d.createSampler({
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
      magFilter: "linear",
      minFilter: "linear",
      mipmapFilter: "nearest",
    });

    // Uniforms (16-byte aligned). We'll use 12 floats = 48 bytes, but align to 64.
    this.uniform_buf = d.createBuffer({
      size: 80,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const module = d.createShaderModule({ code: this.shader_code });

    this.pipeline = d.createRenderPipeline({
      layout: "auto",
      vertex: { module, entryPoint: "vs_main" },
      fragment: {
        module,
        entryPoint: "fs_main",
        targets: [{ format: "rgba8unorm" }],
      },
      primitive: { topology: "triangle-list" },
    });



		// 16 bytes (4 floats) to keep it aligned and match ExposureOut
		this.exposure_buf = d.createBuffer({
		  size: 16,
		  usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
		});
		
		const ae_module = d.createShaderModule({ code: kAutoExposureWGSL });
		this.autoexp_pipeline = d.createComputePipeline({
		  layout: "auto",
		  compute: { module: ae_module, entryPoint: "cs_main" },
		});
		
		this.rebuild_autoexp_bind_groups();

		
		// Set up dot renderer
		this.dots = new DotRenderer(d, "rgba8unorm");
		this.dots.init(32768);
		
		// Create noise textures (one-time random fill inside)
		this.noise = create_noise_textures(d); // <-- adjust signature if needed (see note below)

    this.text_overlay = new GpuTextOverlay(d, "rgba8unorm");
    this.text_overlay.init();
    		
		this.rebuild_bind_groups_all();	
	}
	
	rebuild_autoexp_bind_groups() {
	  if (!this.autoexp_pipeline) return;          // not initialized yet
	  if (!this.exposure_buf) return;
	  if (!this.index_view[0] || !this.index_view[1]) return;
	
	  const layout0 = this.autoexp_pipeline.getBindGroupLayout(0);
	
	  for (let old_i = 0; old_i < 2; old_i++) {
	    this.autoexp_bind_groups[old_i] = this.device.createBindGroup({
	      layout: layout0,
	      entries: [
	        { binding: 0, resource: this.index_view[old_i] },
	        { binding: 1, resource: { buffer: this.uniform_buf } },
	        { binding: 2, resource: { buffer: this.exposure_buf } },
	      ],
	    });
	  }
	}
		
	rebuild_bind_groups_all() {
	  const layout0 = this.pipeline.getBindGroupLayout(0);
	
	  const tex_count = this.noise.views.length; // should be kNoiseTexCount
	  this.bind_groups = [new Array(tex_count), new Array(tex_count)];
	
	  for (let old_i = 0; old_i < 2; old_i++) {
	    for (let ni = 0; ni < tex_count; ni++) {
	      this.bind_groups[old_i][ni] = this.device.createBindGroup({
	        layout: layout0,
	        entries: [
	          { binding: 0, resource: this.index_view[old_i] },
	          { binding: 1, resource: this.warp_view[0] },
	          { binding: 2, resource: this.warp_view[1] },
	          { binding: 3, resource: this.warp_view[2] },
	          { binding: 4, resource: this.warp_view[3] },
	          { binding: 5, resource: this.sampler },
	          { binding: 6, resource: { buffer: this.uniform_buf } },
	          { binding: 7, resource: this.noise.views[ni] },
          	{ binding: 8, resource: { buffer: this.exposure_buf } },
	          //{ binding: 9, resource: this.noise.views[0] },
            //{ binding: 10, resource: this.noise.bilinear_wrap_sampler },
	        ],
	      });
	    }
	  }
	}

  // Upload initial index from a Uint8Array (one byte per pixel).
	upload_index_u8(index_u8) {
	  if (!index_u8 || index_u8.length < this.W * this.H) {
	    throw new Error(`upload_index_u8: index_u8 length (${index_u8 ? index_u8.length : "null"}) < W*H (${this.W * this.H})`);
	  }
	
	  // Pack U8 -> RG16-in-RGBA8 (R=hi byte, G=lo byte=0).
	  const packed = pack_u8_to_rg16_in_rgba8(index_u8); // length = W*H*4 bytes
	
	  const unaligned_bpr = this.W * 4;                 // rgba8 = 4 bytes/px
	  const aligned_bpr   = (unaligned_bpr + 255) & ~255;
	
	  // Helper that writes a given packed buffer into a given index texture,
	  // with correct padding if needed.
	  const write_rgba8 = (tex, packed_rgba8) => {
	    if (aligned_bpr === unaligned_bpr) {
	      this.device.queue.writeTexture(
	        { texture: tex },
	        packed_rgba8,
	        { bytesPerRow: unaligned_bpr, rowsPerImage: this.H },
	        { width: this.W, height: this.H }
	      );
	      return;
	    }
	
	    const needed_bytes = aligned_bpr * this.H;
	    if (!this._padded_index_rgba8 || this._padded_index_rgba8.length !== needed_bytes) {
	      this._padded_index_rgba8 = new Uint8Array(needed_bytes);
	    } else {
	      // Clear so padding bytes don't contain old junk (not strictly required, but safer).
	      this._padded_index_rgba8.fill(0);
	    }
	
	    for (let y = 0; y < this.H; y++) {
	      const src_off = y * unaligned_bpr;
	      const dst_off = y * aligned_bpr;
	      this._padded_index_rgba8.set(
	        packed_rgba8.subarray(src_off, src_off + unaligned_bpr),
	        dst_off
	      );
	    }
	
	    this.device.queue.writeTexture(
	      { texture: tex },
	      this._padded_index_rgba8,
	      { bytesPerRow: aligned_bpr, rowsPerImage: this.H },
	      { width: this.W, height: this.H }
	    );
	  };
	
	  // Write into both ping-pong textures so first step has valid data.
	  write_rgba8(this.index_tex[this.ping], packed);
	  write_rgba8(this.index_tex[this.ping ^ 1], packed);
	}
  
  fill_index_u8_with_noise() {
  	let noise = new Uint8Array(this.W * this.H);
  	for (let i = 0; i < this.W * this.H; i++) {
  		noise[i] = (Math.random() * 40) | 0;
  	}
  	this.upload_index_u8(noise);
  }

  // Upload one warp map (Float32Array XYXY...), index 0..3.
  // NOTE: W and H here can be anything.
  upload_warp_map(slot, warp_f32_xy) {
  	if (this.warp_map[slot] != warp_f32_xy) {
  		//console.log(`Uploading warp map to GPU for slot ${slot}, size ${warp_f32_xy.length}`);  //UNDO //xxx
  		this.warp_map[slot] = warp_f32_xy;
  		
	  	const W = kWarpMapSize;
	  	const H = kWarpMapSize;  	
	    const packed_u16 = pack_f32_to_rg16f(warp_f32_xy);
	    this.device.queue.writeTexture(
	      { texture: this.warp_tex[slot] },
	      packed_u16,
	      { bytesPerRow: W * 4, rowsPerImage: H }, // 2 channels * 2 bytes = 4 bytes/px
	      { width: W, height: H }
	    );  		
  	}
  }

  // Update uniform parameters.
  set_params({
    w0 = 1, w1 = 0, w2 = 0, w3 = 0,
    shift_x = 0, shift_y = 0,
    darkening = 0.0,
    warp_width = kWarpMapSize,
    warp_height = kWarpMapSize,
    image_width = this.W,
    image_height = this.H,
  } = {}) {
		let xform = new TransformHelper(image_width, image_height);
  	
  	const image_width_inv = 1.0 / image_width;
  	const image_height_inv = 1.0 / image_height;
  	
  	const noise_offset_x = (Math.random() * (kNoiseTexSize - 1)) | 0;
  	const noise_offset_y = (Math.random() * (kNoiseTexSize - 1)) | 0;
  	
  	// Uniforms:
    const data = new Float32Array([
      w0, w1, w2, w3,
      shift_x, 
      shift_y,
      warp_width, 
      warp_height,
      image_width, 
      image_height,
      image_width_inv, 
      image_height_inv,
      xform.x0x1,
      xform.y0y1,
      xform.inv_x0x1,
      xform.inv_y0y1,
      noise_offset_x,
      noise_offset_y,
      darkening,
      // NOTE: If you don't have a multiple of 4 values here, add padding:
      0, // pad
    ]);
    this.device.queue.writeBuffer(this.uniform_buf, 0, data);
  }

  // Run one warp step: old -> new, then swap.
  // Draws the waveform after the warp.  Should be an interleaved
  //   Float32Array() of the form [x,y,a, x,y,a ...] 
  //   with XY as pixel coordinates.
  step(waveform) {
    const d = this.device;
    const old_i = this.ping;
    const new_i = this.ping ^ 1;

		//console.log(float32_to_float16_bits(0.0).toString(16)); // should be "0"
		//console.log(float32_to_float16_bits(1.0).toString(16)); // should be "3c00"
		//console.log(float32_to_float16_bits(-1.0).toString(16)); // should be "bc00"

    const encoder = d.createCommandEncoder();
    
    // --- Autoexposure compute pass (old_i -> exposure_buf)
		{
		  const cpass = encoder.beginComputePass();
		  cpass.setPipeline(this.autoexp_pipeline);
		  cpass.setBindGroup(0, this.autoexp_bind_groups[old_i]);
		  cpass.dispatchWorkgroups(1);
		  cpass.end();
		}
		
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.index_view[new_i],
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: "load",   // or "clear" if you prefer
        storeOp: "store",
      }],
    });

		const noise_i = get_noise_index_for_frame(this.frame_index++);

    pass.setPipeline(this.pipeline);
		pass.setBindGroup(0, this.bind_groups[old_i][noise_i]);
    pass.draw(3);
    pass.end();


	  // 2) Dots: draw into the warped buffer (new_i)
	  if (waveform && waveform.length) {
	    this.dots.set_uniforms(this.W, this.H, /*circle=*/true);
	    this.dots.upload_points(waveform);
	    this.dots.draw(encoder, this.index_view[new_i]);
	  }

    // 3) Optional one-frame burn into the warped buffer (new_i)
    if (this.pending_text_burn && this.text_overlay) {
      this.text_overlay.draw(
        encoder,
        this.index_view[new_i],
        this.W,
        this.H,
        this.pending_text_burn_center_x,
        this.pending_text_burn_center_y,
        this.pending_text_burn_intensity
      );

      // After the burn frame, stop presenter from showing it and clear the text.
      this.text_overlay.clear_text();
      this.pending_text_burn = false;
    }
    
    d.queue.submit([encoder.finish()]);

    // Swap
    this.ping = new_i;
  }

  // Get current (latest) index texture view for presenting.
  get_current_index_view() {
    return this.index_view[this.ping];
  }

  // If your presenter wants the texture itself:
  get_current_index_texture() {
    return this.index_tex[this.ping];
  }


	/*
	// Intended usage pattern for text overlay stuff:
	
	// Rarely: rebuild/upload bitmap
	gpu_warp.set_overlay_text("HELLO WORLD", 96, {
	  font_family: "Arial",
	  font_weight: "bold",
	  supersample: 2,
	  padding_px: 4,
	});
	
	// Whenever you want it stamped on the next frame:
	gpu_warp.queue_overlay_text(gpu_warp.W * 0.5, gpu_warp.H * 0.5, 0.75);
	
	// Then your normal render/update path:
	gpu_warp.step(waveform);
	*/
  set_overlay_text(text, font_px, {
    font_family = "sans-serif",
    font_weight = "bold",
    supersample = 2,
    padding_px = 4,
    center_x = this.W * 0.5,
    center_y = this.H * 0.5,
    intensity = 1.0,
    duration = 2.0,
    fade_in_power = 0.5,
  } = {}) {
    if (!this.text_overlay) return;

    this.text_overlay.set_text(text, font_px, {
      font_family,
      font_weight,
      supersample,
      padding_px,
    });

		const time_now = performance.now() * 0.001;
		const t0 = time_now;
		const t1 = time_now + duration;
    this.text_overlay.show_overlay(center_x, center_y, intensity, t0, t1, fade_in_power);
  }

  clear_overlay_text() {
    if (!this.text_overlay) return;
    this.text_overlay.clear_text();
    this.pending_text_burn = false;
  }

  hide_overlay_text() {
    if (!this.text_overlay) return;
    this.text_overlay.hide_overlay();
  }

  show_overlay_text(center_x, center_y, intensity = 1.0) {
    if (!this.text_overlay) return;
    this.text_overlay.show_overlay(center_x, center_y, intensity);
  }

  burn_overlay_text(center_x = null, center_y = null, intensity = null) {
    if (!this.text_overlay) return;

    const rect = this.text_overlay.get_presenter_rect();
    if (!rect.enabled) return;

    this.pending_text_burn = true;
    this.pending_text_burn_center_x = (center_x ?? (rect.left_px + rect.width_px * 0.5));
    this.pending_text_burn_center_y = (center_y ?? (rect.top_px  + rect.height_px * 0.5));
    this.pending_text_burn_intensity = (intensity ?? rect.intensity);
  }

  get_overlay_texture_view() {
    return this.text_overlay ? this.text_overlay.get_presenter_texture_view() : null;
  }

  get_overlay_sampler() {
    return this.text_overlay ? this.text_overlay.get_sampler() : null;
  }

  get_overlay_rect() {
    if (!this.text_overlay) {
      return {
        enabled: 0,
        left_px: 0,
        top_px: 0,
        width_px: 0,
        height_px: 0,
        intensity: 0,
      };
    }
    return this.text_overlay.get_presenter_rect();
  }
}