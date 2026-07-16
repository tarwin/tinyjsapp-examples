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

// If the point size is 1.0 or less, this just draws a plain white square for each "dot".
// If the point size is >= 3, an antialiased circle is drawn, circumscribed
//   within a square quad.
// It expects an interleaved float4 array of [x, y, rad, alpha, ...].
// It draws the dots as RGB (1,0,0,alpha), additively.
export const kDotPassWGSL = /* wgsl */`
struct DotUniforms {
  width  : f32,
  height : f32,
  _pad0  : f32,
  _pad1  : f32,
};

// The radial distance over which the dots will fade from opaque to transparent,
// relative to the dot radius.  (Applies to 3x3 or larger dots only.)
// Range: [0..1]
// At 0, a crisp dot of the desired radius is drawn.
// At 1, a blurry dot of double that radius is drawn.
const kRadiusFade = 0.5;//0.25;//0.2;

@group(0) @binding(0) var<uniform> u : DotUniforms;

// Vertex output + fragment input
struct VSOut {
  @builtin(position) pos : vec4f,
  @location(0) a         : f32,
  @location(1) r1        : f32, // inner radius
  @location(2) r2        : f32, // outer radius
  @location(3) center_pc : vec2f, 
};

@vertex
fn vs_main(
  @location(0) corner_unit : vec2f, // (-1,-1),(+1,-1),(-1,+1),(+1,+1)
  @location(1) inst        : vec4f  // (center_x_pc, center_y_pc, size_px, alpha)
) -> VSOut {
  let center_pc = inst.xy;         // pixel-center coords (integer = pixel center)
  let size_px   = max(inst.z, 1.0);
  let a         = inst.w;

  // size_px:  quad size:   half_extent_pc:   circle_r:
  // 1         1x1          0.5               4
  // 2         2x2          1                 4
  // 3         5x5          2.5               3
  // 4         6x6          3                 4
  // 5         7x7          3.5               5

  // A size of 1 means cover exactly one pixel: center_pc +/- 0.5 in pixel-center coords.
  var half_extent_pc = 0.5 * size_px;

  // Compute circle radius of the white part of the dot to send down to fragment shader.
  // - If point size is 1x1: force very large so it fully covers the square.
  // - If radius > 1: circle_radius = radius - 1.
  // - Otherwise (i.e., ~3x3 to ~4x4-ish), also force large so it's fully covered.
  //   (This matches your intent: small dots should not get circularly clipped.)
  var r1 = 4.0;
  var r2 = 5.0;
  if (size_px >= 1.0001) {
		// Find the exact circle radius that would have the exact same square area
		// as the NxN-pixel square dot.
    let square_area = size_px * size_px;
    let ideal_r = pow(square_area / 3.1415927, 0.5);

		r1 = ideal_r * (1.0 - kRadiusFade);
		r2 = ideal_r * (1.0 + kRadiusFade);
		// The antialiasing will be from [rad - kRadiusFadeDistance/2] ... [rad + kRadiusFadeDistance/2],
		// so choose the square size to make sure we cover it.
    half_extent_pc = ceil(r2);
  }
 
  // Quad corners in pixel-center coords.
  let p_pc = center_pc + corner_unit * half_extent_pc;

  // Convert pixel-center coords -> pixel coords used for NDC mapping:
  // pixel center x corresponds to pixel coord x+0.5
  let p_px = p_pc + 0.5;

  let ndc_x = (p_px.x / u.width) * 2.0 - 1.0;
  let ndc_y = 1.0 - (p_px.y / u.height) * 2.0;

  var out: VSOut;
  out.pos = vec4f(ndc_x, ndc_y, 0.0, 1.0);
  out.a = a;
  out.r1 = r1;
  out.r2 = r2;
  out.center_pc = center_pc;
  return out;
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4f {
  // Fragment position in pixel-center coords (integer means pixel center)
  let pc = in.pos.xy - 0.5;

  // Distance from dot center in pixel-center coords.
  // This should be exactly zero in the center of the anti-aliased edge.
  let r = length(pc - in.center_pc);

  // 1 inside circle_r, 0 outside, with a 1-pixel fade band.
  // Fade over [circle_r .. circle_r + 1]
  // smoothstep(edge0, edge1, x) is a clamped, smooth threshold function.
	//   It returns 0 when x <= edge0
	//   It returns 1 when x >= edge1
	//   Between edge0 and edge1, it transitions smoothly from 0→1 with zero slope at both ends (so no sharp corners / banding).
  //let coverage = 1.0 - smoothstep(in.circle_r, in.circle_r + 1.0, d);
  var coverage = 1.0 - (r - in.r1) / (in.r2 - in.r1 + 0.000001);
  coverage = max(0.0, min(1.0, coverage));
  
  return vec4f(max(0.0, min(1.0, in.a)) * coverage, 0.0, 0.0, 1.0);
  //return vec4f(1.0, 0.0, 0.0, 1.0);
}
`;

export class DotRenderer {
  constructor(device, target_format = "rgba8unorm") {
    this.device = device;
    this.target_format = target_format;

    this.pipeline = null;
    this.bind_group = null;

    this.uniform_buf = null;
    this.corner_buf = null;
    this.instance_buf = null;

    this.max_points = 0;
    this.point_count = 0;

    // Cached typed view for filling instance data (x,y,size,alpha)
    this.instance_f32 = null;
  }

  init(max_points = 8192) {
    const d = this.device;
    this.max_points = max_points | 0;

    // width, height, pad, pad
    this.uniform_buf = d.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Corner buffer: 4 vertices for triangle strip quad.
    const corners = new Float32Array([
      -1, -1,
      +1, -1,
      -1, +1,
      +1, +1,
    ]);
    this.corner_buf = d.createBuffer({
      size: corners.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Float32Array(this.corner_buf.getMappedRange()).set(corners);
    this.corner_buf.unmap();

    // Instance buffer: vec4f per point (center_x, center_y, size_px, alpha)
    // NOTE: center_x/center_y are in pixel-center coords (integer = pixel center)
    this.instance_buf = d.createBuffer({
      size: (16 * this.max_points) >>> 0,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.instance_f32 = new Float32Array(this.max_points * 4);

    const module = d.createShaderModule({ code: kDotPassWGSL });

    this.pipeline = d.createRenderPipeline({
      layout: "auto",
      vertex: {
        module,
        entryPoint: "vs_main",
        buffers: [
          {
            arrayStride: 8,
            stepMode: "vertex",
            attributes: [{ shaderLocation: 0, offset: 0, format: "float32x2" }],
          },
          {
            arrayStride: 16,
            stepMode: "instance",
            attributes: [{ shaderLocation: 1, offset: 0, format: "float32x4" }],
          },
        ],
      },
      fragment: {
        module,
        entryPoint: "fs_main",
        targets: [{
          format: this.target_format,
          blend: {
            color: { operation: "add", srcFactor: "one", dstFactor: "one" },
            alpha: { operation: "add", srcFactor: "one", dstFactor: "one" },
          },
          // Only accumulate into RED (as requested).
          writeMask: GPUColorWrite.RED,
        }],
      },
      primitive: { topology: "triangle-strip" },
    });

    this.bind_group = d.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.uniform_buf } }],
    });
  }

  // width/height are the target texture dimensions.
  set_uniforms(width, height) {
    const data = new Float32Array([
      width,
      height,
      0.0,
      0.0,
    ]);
    this.device.queue.writeBuffer(this.uniform_buf, 0, data);
  }

  // points_f32 is [x_pc, y_pc, size_px, alpha, ...]
  // x_pc/y_pc are pixel-center coords (integer = pixel center).
  upload_points(points_f32) {
    const n_floats = points_f32.length | 0;
    const n_pts = (n_floats / 4) | 0;
    if (n_pts > this.max_points) {
    	console.log(`WARNING: DotRenderer max_points is ${this.max_points} but ${n_pts} points were attemped to be drawn.  Not all points will be drawn.`);
    }
    const used = Math.min(n_pts, this.max_points);

    this.instance_f32.set(points_f32.subarray(0, used * 4), 0);

    this.device.queue.writeBuffer(
      this.instance_buf,
      0,
      this.instance_f32,
      0,
      used * 4
    );

    this.point_count = used;
    return used;
  }

  draw(encoder, target_view) {
    if (!this.point_count) return;

    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: target_view,
        loadOp: "load",
        storeOp: "store",
      }],
    });

    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bind_group);

    pass.setVertexBuffer(0, this.corner_buf);
    pass.setVertexBuffer(1, this.instance_buf);

    pass.draw(4, this.point_count, 0, 0);
    pass.end();
  }
}