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

import { ShowError, HideError } from "./error.js"
import { GPUWarp, kWarpWGSL } from "./gpu_warp.js";
import { PaletteOverlayPass } from "./draw_palette.js";
//import { kWarpWGSL } from "./warp_pass.wgsl"; // export const kWarpWGSL = `...`;

/* 
THE PLAN:
	- Warp maps are generated and stored at 1024x1024, and are float16 RG
	    and store NORMALIZED relative offsets.  This supports bilinear really well.
	    They won't have to be regenerated on resize anymore.
	- Index buffer is double-buffered, size of the window, and is of format rgba8unorm.
			R stores 0.255, and G stores the 8 LSBs.  GA unused.  This is universally supported
			for both texture sampling (nearest neighbor) and as a render target.
	    In the warp shader, we'll read the 4 warp offsets, weight them, and add them;
	      then do manually do bilinear.  So fetch 2x2 lookups on the old index buffer (.rg),
	      reconstruct the 16-bit value on each, and then do bilinear between them.  Then
	      write the result top 8 bits in R, and bottom 8 bits in G.
	    For the present shader, we can just read R and ignore G.
*/

//console.log("LOADED webgpu_present.js", new Date().toISOString());

//----------------------------------- WGSL:

const shaderWGSL = /* wgsl */`
struct Uniforms {
  //rgb_scale : vec4f,
  //rgb_power : vec4f,
  oversample : vec4f,		// .x = oversample, .y = 1.0/overesample
  	
	title_left_px   : f32,
	title_top_px    : f32,
	title_width_px  : f32,
	title_height_px : f32,
	
	present_w       : f32,
	present_h       : f32,
	title_intensity : f32,
	_pad_title3     : f32,  
};

@group(0) @binding(0) var indexTex : texture_2d<f32>;
@group(0) @binding(1) var<uniform> u : Uniforms;
@group(0) @binding(2) var paletteTex : texture_2d<f32>;
//@group(0) @binding(3) var paletteSamp : sampler;
@group(0) @binding(3) var title_tex  : texture_2d<f32>;
@group(0) @binding(4) var title_samp : sampler;

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> @builtin(position) vec4f {
  // Fullscreen triangle
  var pos = array<vec2f, 3>(
    vec2f(-1.0, -1.0),
    vec2f(-1.0,  3.0),
    vec2f( 3.0, -1.0)
  );
  let p = pos[vid];
  return vec4f(p, 0.0, 1.0);
}

// Returns [0..1]
fn overlay_title(frag_px: vec2f) -> f32 {
  if (u.title_intensity <= 0.0) {
    return 0.0;
  }

  let left   = u.title_left_px * u.oversample.y;
  let top    = u.title_top_px * u.oversample.y;
  let right  = left + u.title_width_px * u.oversample.y;
  let bottom = top  + u.title_height_px * u.oversample.y;

  if (frag_px.x < left || frag_px.x >= right || frag_px.y < top || frag_px.y >= bottom) {
    return 0.0;
  }

  let uv = vec2f(
    (frag_px.x - left) * (1.0 / max(u.title_width_px  * u.oversample.y,  1.0)),
    (frag_px.y - top ) * (1.0 / max(u.title_height_px * u.oversample.y, 1.0))
  );

  let a = textureSampleLevel(title_tex, title_samp, uv, 0.0).a * u.title_intensity;

  // White overlay; swap in tinting later if desired.
  //let title_rgb = vec3f(1.0, 1.0, 1.0);
  //return vec4f(base_color.rgb * (1.0 - a) + title_rgb * a, base_color.a);
  return a;
}

fn decode_u16_from_rg(c: vec4f) -> u32 {
  // Round to nearest byte.
  let hi: u32 = u32(clamp(floor(c.r * 255.0 + 0.5), 0.0, 255.0));
  let lo: u32 = u32(clamp(floor(c.g * 255.0 + 0.5), 0.0, 255.0));
  return (hi << 8) | lo;
}

@fragment
fn fs_main(@builtin(position) p: vec4f) -> @location(0) vec4f {
  // p.xy is in pixel coordinates of the render target
  let x: i32 = i32(p.x);
  let y: i32 = i32(p.y);

	//xxx - TODO: match scale in main.js here
	let sx: i32 = i32(f32(x) * u.oversample.x);
	let sy: i32 = i32(f32(y) * u.oversample.x);	// [sic] - scale is just one value.

	// Load packed RG from rgba8unorm. Each channel is 0..1.
	// 16-bit index = R * 256 + G
	// Red channel has the 8 MSBs.
	// Green channel has the 8 LSBs.
//xxx; // TODO: TAKE EXTRA SAMPLES WHEN OVERSAMPLE > 1.



	//var rg = textureLoad(indexTex, vec2i(sx, sy), 0).rg;		// [0..1]
	//let v = floor(rg.r * 255);
	//let t = rg.g;


	// Oversampling-friendly version:
	var sum = u32(0);
	let ss = i32(max(1.0, round(u.oversample.x)));
	for (var y = 0; y < ss; y++) {
		for (var x = 0; x < ss; x++) {	
			sum += decode_u16_from_rg(textureLoad(indexTex, vec2i(sx + x, sy + y), 0));		// [0..65535]
		}
	}			

	var avg = u32(f32(sum) * (1.0 / f32(ss * ss)));		// [0..65535]

	// Add in title overlay.
	avg = min(65535, avg + u32(overlay_title(p.xy) * 65535));

  
  let hi: u32 = (avg >> 8) & 255u;
  let lo: u32 =  avg       & 255u;

	let v = hi;		// [0..255]
	let t = f32(lo) * (1.0 / 256);  // [0..1] 
	
	
	let max_palette_x_coord = i32(textureDimensions(paletteTex).x) - 1;
	
	// Perform manual linear interpolation between 2 entries in the palette.
	let uv1 = vec2i(i32(v) + 0, 0);
	let uv2 = vec2i(min(max_palette_x_coord, i32(v) + 1), 0);
	let col1 = textureLoad(paletteTex, uv1, 0);	// [0..1]
	let col2 = textureLoad(paletteTex, uv2, 0);

  var col = col1 * (1.0 - t) + t * col2;
	
	// Square it, to make up for palette packed with kPower == 0.5:
	// TODO: pull this power from constants.
	// SEE ALSO: Same formula repeated in draw_palette.js.
  col = col * col;
  // TODO: Pull this scale from constants.
  col *= 3;  // kHeadroom

	// To bypass the palette:
	//col = col * 0.00001 + 0.9999 * f32(textureLoad(indexTex, vec2i(sx, sy), 0).r);
	
	return col;  // rg.rrrr;//FIXME_WAVEFORM
}
`;

export class WebGPUPresenter {
  // cw, ch: client size
  // iw, ih: index buffer size (might be 2x smaller, 3x smaller, etc)
  constructor(canvas, cw, ch, iw, ih, oversample) {
  	//console.log("WebGPUPresent constructor: ", cw, ch, iw, ih, scale);
    this.canvas = canvas;
    this.cw = cw;
    this.ch = ch;
    this.iw = iw;
    this.ih = ih;
    this.oversample = oversample;

    this.device = null;
    this.context = null;
    this.format = null;

    this.indexTex = null;
    this.paletteTex = null;

    this.pipeline = null;
    this.bindGroup = null;
    
    this.gpu_warp = null;
    this.palette_overlay = null;
  }
	
	BuildBindGroup(index_tex_view) {
	  // Recreate the index texture at the new size
	  this.indexTex?.destroy?.();
	  this.indexTex = this.device.createTexture({
	    size: { width: this.iw, height: this.ih },
	    format: "rgba8unorm",
	    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
	  });
	
	  // Rebuild bind group because it references the old texture view
	  this.bindGroup = this.device.createBindGroup({
	    layout: this.pipeline.getBindGroupLayout(0),
	    entries: [
	      { binding: 0, resource: index_tex_view },
	      { binding: 1, resource: { buffer: this.uniform_buf } },
	      { binding: 2, resource: this.paletteTex.createView() },
	      //{ binding: 3, resource: this.paletteSampler },
	      { binding: 3, resource: this.gpu_warp.get_overlay_texture_view() },
	      { binding: 4, resource: this.gpu_warp.get_overlay_sampler() },
	    ],
	  });
	}	
		
  // cw, ch: client size
  // iw, ih: index buffer size (might be 2x smaller, 3x smaller, etc)
  resize(cw, ch, iw, ih, oversample) {
  	//console.log("WebGPUPresent::RESIZE: ", cw, ch, iw, ih, scale);
    this.cw = cw;
    this.ch = ch;
    this.iw = iw;
    this.ih = ih;
    this.oversample = oversample;
		//console.log(`over/undersample = ${oversample}, ${undersample}`);  //xxx

		if (this.device != null) {
			this.configure_canvas(this.use_hdr);

			this.gpu_warp.resize(iw, ih);
			
			this.BuildBindGroup(this.gpu_warp.get_current_index_view());
		}
  }

	// TODO: We can get rid of this now.
	updateGlobals() {					
		//console.log(`${this.gpu_warp}`);  null!
		let data = new Float32Array([
				// *** Be sure to update this in 2 places -- see below also.
	  		this.oversample, 1.0 / this.oversample, 0.0, 0.0,
	  		0, 0, 0, 0,
	  		this.cw, this.ch, 0, 0
	  		]); // pad to 16 bytes
		if (this.gpu_warp) {
			const r = this.gpu_warp.get_overlay_rect();
			if (r.intensity > 0) {
			  data = new Float32Array([
					// *** Be sure to update this in 2 places -- see above also.
		  		this.oversample, 1.0 / this.oversample, 0.0, 0.0,
		  		r.left_px, r.top_px, r.width_px, r.height_px,
		  		this.cw, this.ch, r.intensity, 0.0
		  		]); // pad to 16 bytes
	  	}
		}
	  this.device.queue.writeBuffer(this.uniform_buf, 0, data);
	}
	
	configure_canvas(attempt_hdr) {
		const preferred_format = navigator.gpu.getPreferredCanvasFormat();
		if (attempt_hdr) {
			try {
		    // HDR:    
		    this.format = "rgba16float";
		    this.context.configure({
		      device: this.device,
		      format: this.format,
		      alphaMode: "opaque",
		      // Allow output values > 1 on HDR displays (falls back effectively to SDR otherwise)
		      toneMapping: { mode: "extended" },
		      // Optional: nicer gamut on wide-gamut displays
		      // Note: On Chrome, this works, and we get HDR.
		      // On Safari, this fixes the "black screen" problem (if we try to do HDR),
		      // but... it still just shows as SDR, with no warning.
		      // NOTE: On Chrome, P3 color shows as a little richer.
		      //colorSpace: "display-p3",
		    });
		    return true;  //HDR
			} catch (e) {
				console.log(`ERROR: rgba16float texture format not supported -> falling back to ${preferred_format}.`);
			}		
		}
		
		// LDR:
		this.use_hdr = false;
	  this.format = preferred_format;
	  this.context.configure({
	    device: this.device,
	    format: this.format,
	    alphaMode: "opaque",
	  });
	  return false;  //SDR
	}

  async init(attempt_hdr) {		
		if (!this.cw || !this.ch) {
			throw new Error(`Presenter index size invalid: cw=${this.cw} ch=${this.ch}`);
		}
    if (!navigator.gpu) {
      throw new Error("WebGPU not supported in this browser.");
    }
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error("No WebGPU adapter found.");
    this.device = await adapter.requestDevice();

    this.context = this.canvas.getContext("webgpu");
		
		
		



		this.use_hdr = this.configure_canvas(attempt_hdr);

		this.uniform_buf = this.device.createBuffer({
		  size: 128, // uniform alignment; each vec4f needs 16 bytes
		  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		});
		this.updateGlobals();

    // Palette texture (256x1 RGBA)
    this.paletteTex = this.device.createTexture({
      size: { width: 256, height: 1 },
      format: "rgba8unorm", //"rgba16float", //,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });

		this.paletteSampler = this.device.createSampler({
		  addressModeU: "clamp-to-edge",
		  addressModeV: "clamp-to-edge",
      addressModeW: "clamp-to-edge",
		  magFilter: "linear",
		  minFilter: "linear",
		  mipmapFilter: "nearest", // no mips anyway for 256x1 unless you add them
		});

    const module = this.device.createShaderModule({ code: shaderWGSL });

    this.pipeline = this.device.createRenderPipeline({
      layout: "auto",
      vertex: { module, entryPoint: "vs_main" },
      fragment: {
        module,
        entryPoint: "fs_main",
        targets: [{ format: this.format }],
      },
      primitive: { topology: "triangle-list" },
    });

		// After this.pipeline is created:
		this.gpu_warp = new GPUWarp(this.device, this.iw, this.ih, kWarpWGSL);
		this.gpu_warp.init();
		
		// Upload initial index (your existing byte buffer)
		this.gpu_warp.fill_index_u8_with_noise();
		
		this.palette_overlay = new PaletteOverlayPass(this.device, this.format, this.paletteTex);
		
		// Build presenter bind group using GPUWarp's *current* texture view
		this.BuildBindGroup(this.gpu_warp.get_current_index_view());
  }

	SetWarpMap(slot, warp_map) {
		this.gpu_warp.upload_warp_map(slot, warp_map);
	}

	uploadPaletteRGBA8UNorm(palette_rgba_f32) {
	  // palette_rgba_f32: Float32Array (or Array-like) length 256*4
	  // Assumes this.paletteTex was created with format: "rgba8unorm"
	  // Expected float range: [0..8]

		// Leave headroom for HDR values > 1.
		// We'll map [0 .. kHeadroom] to [0..255].
		const kHeadroom = 3.0;

	  // Pack values in a cheap gamma-space so we can get
	  // roughly as much detail in the highlights as we can
	  // in the shadows.
		const kPower = 0.5;
	
	  const kWidth = 256;
	  const kHeight = 1;
	  const kChannels = 4;
	  const kTexelCount = kWidth * kChannels;   // 1024

	  const packed_u8 = new Uint8Array(kTexelCount);
	
	  for (let i = 0; i < kTexelCount; i++) {
	    let v = Math.max(0.0, Math.min(1.0, palette_rgba_f32[i] * (1.0 / kHeadroom)));
			v = Math.pow(v, kPower);
			v *= 255;

      // Round to nearest integer for slightly better quantization.
      packed_u8[i] = (v + 0.5) | 0;
	  }
	
	  this.device.queue.writeTexture(
	    { texture: this.paletteTex },
	    packed_u8,
	    { bytesPerRow: kWidth * 4, rowsPerImage: 1 }, // 4 channels * 1 byte = 4 bytes/texel
	    { width: kWidth, height: kHeight }
	  );
	}
	
	warpAndDrawWaveform(w0, w1, w2, w3, shift_x, shift_y, waveform, darkening) {
		this.updateGlobals();

		// Set warp weights (per-frame you can tweak these)
		this.gpu_warp.set_params({ w0: w0, w1: w1, w2: w2, w3: w3, warp_scale: 1,
			                         shift_x: shift_x, shift_y: shift_y, 
			                         darkening : darkening});

		// 1) advance the simulation one step on GPU
		this.gpu_warp.step(waveform);

		// 2) rebuild presenter bind group so binding(0) points at the NEW current index texture
		this.BuildBindGroup(this.gpu_warp.get_current_index_view());
	}
			
  draw(palette_swatch_count = 0) {		
    const encoder = this.device.createCommandEncoder();
    const view = this.context.getCurrentTexture().createView();

    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view,
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: "clear",
        storeOp: "store",
      }],
    });

    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.draw(3);

		if (palette_swatch_count > 0) {
			this.palette_overlay.update_ui_uniforms(this.cw, this.ch, palette_swatch_count, palette_swatch_count * 32, 32, 8, 8);
		  this.palette_overlay.draw(pass);
		}

    pass.end();

    this.device.queue.submit([encoder.finish()]);
  }
}
