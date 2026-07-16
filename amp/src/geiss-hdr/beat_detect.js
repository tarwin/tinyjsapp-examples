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

// SimpleBeatDetector.js
// Assumes band indices: 0=bass, 1=mids, 2=highs, 3=all (adjust if needed)

function alphaFromHalfLife(halfLifeSec, dt) {
  return 1.0 - Math.pow(2.0, -dt / Math.max(1e-9, halfLifeSec));
}

export class SimpleBeatDetector {
  constructor({
    fastIdx = 3,          // your half-life ladder index (e.g. 0.25s)
    slowIdx = 1,          // your half-life ladder index (e.g. 1.0s; better is 2–8s if you have it)
    scoreHalfLifeSec = 4, // smoothing for adaptive threshold (seconds)

    minIntervalSec = 0.30, // refractory; max ~320 BPM  (max bpm = 60 / minIntervalSec) 
    //maxIntervalSec = 1.50, // optional ignore super-slow beats (~40 BPM)

    // threshold: score > scoreAvg * k + t
    kMul = 2.4,		// 2.0 (eager) ... 2.8 (conservative)
    tAdd = 0.11,  // 0.08 (eager) ... 0.15 (conservative)

    // combine bass + all for robustness
    wBass = 0.7,
    wAll  = 0.3,
  } = {}) {
    this.fastIdx = fastIdx;
    this.slowIdx = slowIdx;

    this.scoreHalfLifeSec = scoreHalfLifeSec;

    this.minIntervalSec = minIntervalSec;
    //this.maxIntervalSec = maxIntervalSec;

    this.kMul = kMul;
    this.tAdd = tAdd;

    this.wBass = wBass;
    this.wAll  = wAll;

    // Peak-pick state (3-sample)
    this.sPrev2 = 0;
    this.sPrev1 = 0;
    this.sCur   = 0;

    // Adaptive baseline for score
    this.scoreAvg = 0;

    // Timing
    this.lastBeatTimeSec = -1e9;
  }

  _bandScore(E, F, S) {
    // Level-invariant surprise + rising edge, normalized by slow baseline.
    const eps = 1e-9;
    const denom = S + eps;

    const surprise = (E / denom) - 1.0;    // loud vs slow
    const rise     = (E - F) / denom;      // spike vs fast (normalized)

    return Math.max(0, surprise) + Math.max(0, rise);
  }

  update(frame_number, fps, 
         vol_imm_bass, vol_rel_damped_bass,
         vol_imm_all,  vol_rel_damped_all) {
    // returns: { beat, score, threshold, beatTimeSec? }
    const dt = 1.0 / Math.max(1e-6, fps);
    const nowSec = frame_number * dt;

    // Pull baselines
    const E_b = vol_imm_bass;
    const F_b = vol_rel_damped_bass;
    const S_b = vol_rel_damped_bass;

    const E_a = vol_imm_all;
    const F_a = vol_rel_damped_all;
    const S_a = vol_rel_damped_all;

    const scoreBass = this._bandScore(E_b, F_b, S_b);
    const scoreAll  = this._bandScore(E_a, F_a, S_a);
    const score = this.wBass * scoreBass + this.wAll * scoreAll;

    // Adaptive score baseline for thresholding
    const a = alphaFromHalfLife(this.scoreHalfLifeSec, dt);
    this.scoreAvg = (1 - a) * this.scoreAvg + a * score;
    const scoreAvgSafe = Math.max(this.scoreAvg, 1e-4);

    const threshold = scoreAvgSafe * this.kMul + this.tAdd;

    // Peak pick: detect local max at (n-1)
    this.sPrev2 = this.sPrev1;
    this.sPrev1 = this.sCur;
    this.sCur   = score;

    const sPeak = this.sPrev1;
    const isLocalMax = (this.sPrev1 > this.sPrev2) && (this.sPrev1 >= this.sCur);

    let beat = false;
    let beatTimeSec = undefined;

    if (isLocalMax && sPeak > threshold) {
      const tPeak = nowSec - dt; // peak corresponds to previous frame
      const since = tPeak - this.lastBeatTimeSec;

      if (since >= this.minIntervalSec) {// && since <= this.maxIntervalSec) {
        beat = true;
        beatTimeSec = tPeak;
        this.lastBeatTimeSec = tPeak;
      }
    }

    return { beat, score, threshold, beatTimeSec };
  }
}