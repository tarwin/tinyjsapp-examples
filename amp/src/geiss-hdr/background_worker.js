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

import { buildWarpMap } from "./motion.js";

// worker.js (module worker)
self.onmessage = (e) => {
  if (e.data.type === "start") {
    const { payload } = e.data;

    // Do heavy work here
    const result = do_heavy_thing(payload);

    self.postMessage({ type: "done", result });
  }
};

function do_heavy_thing(payload) {
	return { mode : payload.mode,
		       warp_map : buildWarpMap(payload.mode), 
		       i : payload.i,
		       t0 : payload.t0, 
		       t1 : payload.t1, 
		       t2 : payload.t2, 
		       t3 : payload.t3 };
}
