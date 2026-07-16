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

// TODO: Speed up warp map uploading; the f32->f16 conversion is
// (probabily) super slow right now.
// Might need to keep this a multiple of 256, so that the warp buffers on the GPU
// have a row stride that is a multiple of 256. 
//UNDO - revert to 1024.
export const kWarpMapSize = 512;//1024;//512; //1024;


export const kNoiseTexSize = 256;
export const kNoiseTexCount = 4;

export const kMaxActiveWarps = 4;