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

// noise_textures.js
// Creates kNoiseTexCount r8unorm noise textures (kNoiseTexSize x kNoiseTexSize),
// fills them once with random bytes (with row padding as needed),
// and returns textures + views + per-texture bind groups.
//
// Assumes you define these in const.js:
//   export const kNoiseTexSize = 256;
//   export const kNoiseTexCount = 4;

import { kNoiseTexSize, kNoiseTexCount } from "./const.js";

function align_to_256(x) {
  // Smallest multiple of 256 >= x
  return (x + 255) & ~255;
}

// Create 1 noise texture + fill it
function create_one_noise_texture(device, size_px) {
  const texture = device.createTexture({
    size: { width: size_px, height: size_px, depthOrArrayLayers: 1 },
    format: "r8unorm",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });

  const view = texture.createView();

  // Row padding for writeTexture (bytesPerRow must be multiple of 256)
  const bytes_per_pixel = 1; // r8unorm
  const unpadded_bpr = size_px * bytes_per_pixel;
  const padded_bpr = align_to_256(unpadded_bpr);

  const upload_bytes = new Uint8Array(padded_bpr * size_px);

  // Fill with random bytes
  // (crypto.getRandomValues can fill up to 65536 bytes per call in many browsers,
  // so chunk it to be safe.)
  //const kMaxChunk = 65536;
  //for (let i = 0; i < upload_bytes.length; i += kMaxChunk) {
  //  const chunk = upload_bytes.subarray(i, Math.min(upload_bytes.length, i + kMaxChunk));
  //  crypto.getRandomValues(chunk);
  //}
  for (let i = 0; i < padded_bpr * size_px; i++) {
  	// Create gaussian noise:
  	let t = (Math.random() + Math.random() + Math.random()) * (1.0 / 3.0);
  	// Center the distrib. at exactly 128.
  	upload_bytes[i] = (t * 255 + 0.5) | 0;
  }

  // If padded_bpr > unpadded_bpr, we don't care what the padding bytes are;
  // they won't be read by textureLoad because you only address [0..size_px-1].
  device.queue.writeTexture(
    { texture },
    upload_bytes,
    { bytesPerRow: padded_bpr, rowsPerImage: size_px },
    { width: size_px, height: size_px, depthOrArrayLayers: 1 }
  );

  return { texture, view };
}

// Create all noise textures and bind groups.
// You pass in your pipeline's bind group layout and the binding index for the noise texture.
export function create_noise_textures(device, noise_bgl, noise_binding_index) {
  if (kNoiseTexSize <= 0) throw new Error(`kNoiseTexSize invalid: ${kNoiseTexSize}`);
  if (kNoiseTexCount <= 0) throw new Error(`kNoiseTexCount invalid: ${kNoiseTexCount}`);

  const textures = new Array(kNoiseTexCount);
  const views = new Array(kNoiseTexCount);
  const bind_groups = new Array(kNoiseTexCount);

	const bilinear_wrap_sampler = device.createSampler({
	  addressModeU: "repeat",
	  addressModeV: "repeat",
	  magFilter: "linear",
	  minFilter: "linear",
	  mipmapFilter: "linear", // optional; harmless even without mips
	});

  for (let i = 0; i < kNoiseTexCount; i++) {
    const { texture, view } = create_one_noise_texture(device, kNoiseTexSize);
    textures[i] = texture;
    views[i] = view;
  }

  return { textures, views, bilinear_wrap_sampler };
}

// Pick which noise texture to bind each frame.
export function get_noise_index_for_frame(frame_index) {
  // kNoiseTexCount is 4 in your current setup (power of two), so bitmask is fastest.
  // Fallback to % for non-power-of-two.
  const n = kNoiseTexCount | 0;
  if ((n & (n - 1)) === 0) return frame_index & (n - 1);
  return frame_index % n;
}