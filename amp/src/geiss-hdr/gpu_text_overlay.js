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

// gpu_text_overlay.js
// Rarely-updated text rasterizer + cheap GPU stamp pass.
// Renders single-line text into an offscreen canvas, uploads it to an rgba8unorm
// texture, then draws a minimally-fit quad into the destination with additive
// blending into the R channel only.

// gpu_text_overlay.js

export const kGpuTextOverlayWGSL = /* wgsl */ `
struct TextUniforms {
  left_px   : f32,
  top_px    : f32,
  width_px  : f32,
  height_px : f32,

  dst_w     : f32,
  dst_h     : f32,
  intensity : f32,
  _pad0     : f32,
};

@group(0) @binding(0) var text_tex  : texture_2d<f32>;
@group(0) @binding(1) var text_samp : sampler;
@group(0) @binding(2) var<uniform> u : TextUniforms;

struct VSOut {
  @builtin(position) pos : vec4f,
  @location(0) uv        : vec2f,
};

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> VSOut {
  var corner = array<vec2f, 6>(
    vec2f(0.0, 0.0),
    vec2f(1.0, 0.0),
    vec2f(0.0, 1.0),
    vec2f(0.0, 1.0),
    vec2f(1.0, 0.0),
    vec2f(1.0, 1.0)
  );

  let c = corner[vid];

  let px = u.left_px + c.x * u.width_px;
  let py = u.top_px  + c.y * u.height_px;

  let ndc_x = (px / u.dst_w) * 2.0 - 1.0;
  let ndc_y = 1.0 - (py / u.dst_h) * 2.0;

  var out : VSOut;
  out.pos = vec4f(ndc_x, ndc_y, 0.0, 1.0);
  out.uv = c;
  return out;
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4f {
  let a = textureSampleLevel(text_tex, text_samp, in.uv, 0.0).a;
  return vec4f(a * u.intensity, 0.0, 0.0, 0.0);
}
`;

export class GpuTextOverlay {
  constructor(device, target_format = "rgba8unorm") {
    this.device = device;
    this.target_format = target_format;

    this.pipeline = null;
    this.uniform_buf = null;
    this.sampler = null;

    this.canvas = null;
    this.ctx = null;

    this.text_tex = null;
    this.text_view = null;
    this.bind_group = null;

    this.dummy_tex = null;
    this.dummy_view = null;

    this.text_px_w = 0;
    this.text_px_h = 0;

    this.tex_w = 0;
    this.tex_h = 0;

    this.supersample = 2;
    this.has_text = false;

    // Presenter-visible placement/state
    this.overlay_enabled = false;
    this.overlay_center_x = 0;
    this.overlay_center_y = 0;
    this.overlay_intensity = 1.0;
    this.t0 = -2.0;
    this.t1 = -1.0;
    this.fade_in_power = 1.0;
  }

  init() {
    const d = this.device;

    const module = d.createShaderModule({ code: kGpuTextOverlayWGSL });

    this.pipeline = d.createRenderPipeline({
      layout: "auto",
      vertex: {
        module,
        entryPoint: "vs_main",
      },
      fragment: {
        module,
        entryPoint: "fs_main",
        targets: [{
          format: this.target_format,
          blend: {
            color: {
              operation: "add",
              srcFactor: "one",
              dstFactor: "one",
            },
            alpha: {
              operation: "add",
              srcFactor: "zero",
              dstFactor: "one",
            },
          },
          writeMask: GPUColorWrite.RED,
        }],
      },
      primitive: {
        topology: "triangle-list",
      },
    });

    this.uniform_buf = d.createBuffer({
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.sampler = d.createSampler({
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
      magFilter: "linear",
      minFilter: "linear",
      mipmapFilter: "nearest",
    });

    this._ensure_canvas();
    this._create_dummy_texture();
  }

  _ensure_canvas() {
    if (this.canvas && this.ctx) return;

    if (typeof OffscreenCanvas !== "undefined") {
      this.canvas = new OffscreenCanvas(1, 1);
    } else {
      this.canvas = document.createElement("canvas");
      this.canvas.width = 1;
      this.canvas.height = 1;
    }

    this.ctx = this.canvas.getContext("2d", { alpha: true });
    if (!this.ctx) {
      throw new Error("GpuTextOverlay: failed to get 2D canvas context");
    }
  }

  _create_dummy_texture() {
    this.dummy_tex = this.device.createTexture({
      size: { width: 1, height: 1 },
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    this.dummy_view = this.dummy_tex.createView();

    const transparent_pixel = new Uint8Array([0, 0, 0, 0]);
    this.device.queue.writeTexture(
      { texture: this.dummy_tex },
      transparent_pixel,
      { bytesPerRow: 4, rowsPerImage: 1 },
      { width: 1, height: 1 }
    );
  }

  _recreate_texture_if_needed(tex_w, tex_h) {
    if (this.text_tex && this.tex_w === tex_w && this.tex_h === tex_h) {
      return;
    }

    if (this.text_tex) {
      try { this.text_tex.destroy(); } catch (_) {}
      this.text_tex = null;
      this.text_view = null;
      this.bind_group = null;
    }

    this.tex_w = tex_w;
    this.tex_h = tex_h;

    this.text_tex = this.device.createTexture({
      size: { width: tex_w, height: tex_h },
      format: "rgba8unorm",
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });

    this.text_view = this.text_tex.createView();
    this._rebuild_bind_group();
  }

  _rebuild_bind_group() {
    if (!this.pipeline || !this.text_view || !this.sampler || !this.uniform_buf) return;

    const layout0 = this.pipeline.getBindGroupLayout(0);
    this.bind_group = this.device.createBindGroup({
      layout: layout0,
      entries: [
        { binding: 0, resource: this.text_view },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: { buffer: this.uniform_buf } },
      ],
    });
  }

  clear_text() {
    this.has_text = false;
    this.text_px_w = 0;
    this.text_px_h = 0;
    this.overlay_enabled = false;
  }

  set_text(text, font_px, {
    font_family = "sans-serif",
    font_weight = "bold",
    supersample = 2,
    padding_px = 4,
    fill_style = "#ffffff",
  } = {}) {
    this._ensure_canvas();

    text = `${text ?? ""}`;
    if (!text.length || !(font_px > 0)) {
      this.clear_text();
      return;
    }

    const ss = Math.max(1, supersample | 0);
    this.supersample = ss;

    const scaled_font_px = font_px * ss;
    const scaled_pad = Math.max(1, Math.ceil(padding_px * ss));

    const ctx = this.ctx;
    ctx.font = `${font_weight} ${scaled_font_px}px ${font_family}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";

    const m = ctx.measureText(text);

    const left    = Math.ceil(m.actualBoundingBoxLeft ?? 0);
    const right   = Math.ceil(m.actualBoundingBoxRight ?? Math.ceil(m.width));
    const ascent  = Math.ceil(m.actualBoundingBoxAscent ?? Math.ceil(scaled_font_px * 0.8));
    const descent = Math.ceil(m.actualBoundingBoxDescent ?? Math.ceil(scaled_font_px * 0.2));

    const glyph_w = Math.max(1, left + right);
    const glyph_h = Math.max(1, ascent + descent);

    const tex_w = Math.max(1, glyph_w + scaled_pad * 2 + 16);
    const tex_h = Math.max(1, glyph_h + scaled_pad * 2);

    this.canvas.width = tex_w;
    this.canvas.height = tex_h;

    ctx.font = `${font_weight} ${scaled_font_px}px ${font_family}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.clearRect(0, 0, tex_w, tex_h);

    const draw_x = scaled_pad + left;
    const draw_y = scaled_pad + ascent;

    ctx.fillStyle = fill_style;
    ctx.fillText(text, draw_x - left, draw_y);

    this._recreate_texture_if_needed(tex_w, tex_h);

    this.device.queue.copyExternalImageToTexture(
      { source: this.canvas },
      { texture: this.text_tex },
      { width: tex_w, height: tex_h }
    );

    this.text_px_w = tex_w / ss;
    this.text_px_h = tex_h / ss;
    this.has_text = true;
  }

  // Presenter-side visibility
  show_overlay(center_x, center_y, intensity, t0, t1, fade_in_power) {
    if (!this.has_text) {
      this.overlay_enabled = false;
      return;
    }
    this.overlay_enabled = true;
    this.overlay_center_x = center_x;
    this.overlay_center_y = center_y;
    this.overlay_intensity = intensity;
    this.t0 = t0;
    this.t1 = t1;
    this.fade_in_power = fade_in_power;
  }

  hide_overlay() {
    this.overlay_enabled = false;
  }

  get_presenter_texture_view() {
    return (this.overlay_enabled && this.has_text && this.text_view) ? this.text_view : this.dummy_view;
  }

  get_sampler() {
    return this.sampler;
  }

	get_intensity() {
		if (this.t0 < 0) {
			return 0.0;
		}
		const time_now = performance.now() * 0.001;
	  let t = Math.max(0.0, Math.min(1.0, (time_now - this.t0) / (this.t1 - this.t0)));
	  t = Math.pow(t, this.fade_in_power);
	  
	  return this.overlay_intensity * t;		
	}

  get_presenter_rect() {
    const width_px = this.has_text ? this.text_px_w : 0;
    const height_px = this.has_text ? this.text_px_h : 0;
    const left_px = this.overlay_center_x - width_px * 0.5;
    const top_px = this.overlay_center_y - height_px * 0.5;

		const intensity = this.get_intensity();

    return {
      enabled: this.overlay_enabled && this.has_text ? 1 : 0,
      left_px,
      top_px,
      width_px,
      height_px,
      intensity,
    };
  }

  draw(encoder, dst_view, dst_w, dst_h, center_x, center_y, intensity = 1.0) {
    if (!this.has_text || !this.pipeline || !this.bind_group) return;

    const left_px = center_x - this.text_px_w * 0.5;
    const top_px  = center_y - this.text_px_h * 0.5;

    const data = new Float32Array([
      left_px,
      top_px,
      this.text_px_w,
      this.text_px_h,
      dst_w,
      dst_h,
      intensity,
      0,
    ]);
    this.device.queue.writeBuffer(this.uniform_buf, 0, data);

    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: dst_view,
        loadOp: "load",
        storeOp: "store",
      }],
    });

    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bind_group);
    pass.draw(6);
    pass.end();
  }
}