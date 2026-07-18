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

/*
 * [amp modifications] 2026-07-16
 * This file was MODIFIED for the amp example app (tinyjsapp-examples), which
 * embeds Geiss HDR as one of amp's visualizer engines inside a WKWebView.
 * All changes are marked with "[amp]" comments. Summary:
 *   - external-audio mode (window.GeissAmpConfig): amp feeds an existing
 *     WebAudio source node instead of the mic/mp3/tab source-select flow
 *   - HDR forced off (WKWebView's rgba16float canvas fails silently, per the
 *     author's own Safari notes; WKWebView's UA has no "Safari" token so the
 *     original detection would wrongly try the HDR path)
 *   - HTTPS-requirement check skipped (page is loaded from disk by tinyjs)
 *   - top-level awaits removed (bundled as a classic script; the warning
 *     overlays they gated are not present in amp's DOM)
 *   - background worker created via a factory (amp inlines the worker source
 *     as a Blob; the tinyjs build packs everything into one HTML file, so a
 *     relative worker URL would not resolve)
 *   - keyboard/pointer/drag-drop handlers made inert while the engine is
 *     inactive or where they collide with amp's own transport keys
 */

import { AudioInput } from "./audio_input.js";
import { Engine, GENERAL_TRANSITION_SPEED } from "./engine.js";
import { WebGPUPresenter } from "./webgpu_present.js";
import { g_version } from "./version.js";
import { GenerateRandomPalette, SamplePalette, HdrToSdr, AddPalette, SetOverridePalette, PrintOverridePalette, ClearOverridePalette, OverridePaletteRel, OverridePaletteAbs, AdjustOverridePalette, GetOverridePalette, PrintSavedPalettes } from "./palette.js"
import { ShowError, HideError } from "./error.js"
import { SimpleBeatDetector } from "./beat_detect.js";

const startMicBtn = document.getElementById("start_mic");
const startTabBtn = document.getElementById("start_tab");
const startDemoBtn = document.getElementById("start_demo");
const startRemoteMp3Btn = document.getElementById("start_remote_mp3");
const startLocalMp3Btn = document.getElementById("start_local_mp3");
const local_file_input = document.getElementById("local_file_input");
const statusEl = document.getElementById("status");
const startMsg = document.getElementById("start_message");
const canvas = document.getElementById("c");
const dbg = document.getElementById("dbg");
const audio_source_select_screen = document.getElementById("audio_source_select_screen");
const hud = document.getElementById("hud");
const dctx = dbg.getContext("2d");
const license_line   = document.getElementById("license_line");
const license_prefix = document.getElementById("license_prefix");
const license_link   = document.getElementById("license_link");
const license_suffix = document.getElementById("license_suffix");

// TODO: Rename DemoSong to SongWithMetadata.
class DemoSong {
  constructor(filename, artist = "", songname = "", source = "", license = null, path = "", file = null) {
    this.filename = filename;
    this.path = path;
    this.songname = songname;
    this.artist = artist;
    this.source = source;
    this.license = license;
    this.file = file;
    this.has_metadata = (songname.length > 0 || artist.length > 0 || source.length > 0 || license.length > 0);
  }
	GetToast() {
		let license_prefix = "";
		let license_text = "";
		let license_link = "";
		let license_suffix = "";
		let song_name = "";
		let embed_string = ""; // For text embed in the image.
		if (this.has_metadata) {
			// Demo song.
			if (this.source.length > 0) {
				license_prefix += this.source + `, `;
			}
			if (this.license != null) {
				license_prefix += "license type: ";
				license_text = this.license.text;
				license_link = this.license.link;
				license_suffix = "";
			}
			song_name = `${g_white_text}Playing '${this.songname}' by ${this.artist}${g_end_color}`;
			embed_string = `${this.artist} - ${this.songname}`;
		} else {
			// Local mp3.
			if (this.path.length == 0) {
				// No path information.
				song_name = g_white_text + this.filename + g_end_color;
			} else {
				// Show filename AND path.
				song_name = `${g_grey_text}${this.path}/${g_end_color}\n${g_white_text}${this.filename}${g_end_color}`;					
			}
			embed_string = this.filename.replace(/\.[^/.]+$/, "");  // Remove extension.			
		}
		return { license_prefix, license_text, license_link, license_suffix, song_name, embed_string };
	}  
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]]; // swap
  }
}

const kFromFMA = "Song from the Free Music Archive";
const kLicenseCcBy   = { text : "CC BY", link : "https://creativecommons.org/licenses/by/4.0/" };
const kLicenseCcBySa = { text : "CC BY-SA", link : "https://creativecommons.org/licenses/by-sa/4.0/" };

const kDemoSongs = [
	// (filename, artist, song title, source, license text)
	// Avoid these licenses:
	//   CC-BY-NC
	//   CC-BY-ND
	//   CC-BY-NC-ND
	// CC-BY:
  new DemoSong("mp3/1000 Handz - Sharpens Steel.mp3", "1000 Handz", "Sharpens Steel", kFromFMA, kLicenseCcBy),
  new DemoSong("mp3/Grumplefunk - Prelude.mp3", "Grumplefunk", "Prelude", kFromFMA, kLicenseCcBy),
  new DemoSong("mp3/Kevin MacLeod - Erik Satie Gymnopedie No 1.mp3", "Kevin MacLeod", "Erik Satie Gymnopedie No 1", kFromFMA, kLicenseCcBy),
  new DemoSong("mp3/Kevin MacLeod - Mourning Song.mp3", "Kevin MacLeod", "Mourning Song", kFromFMA, kLicenseCcBy),
  new DemoSong("mp3/John Harrison with the Wichita State University Chamber Players - Spring Mvt 3 Allegro pastorale.mp3", "John Harrison with the Wichita State University Chamber Players", "Spring Mvt 3 Allegro pastorale", kFromFMA, kLicenseCcBy),
  new DemoSong("mp3/Ketsa - Goes Red.mp3", "Ketsa", "Goes Red", kFromFMA, kLicenseCcBy),
  new DemoSong("mp3/Andrey Petrov - I won't hear the wind's tale.mp3", "Andrey Petrov", "I won't hear the wind's tale", kFromFMA, kLicenseCcBy),
  new DemoSong("mp3/Tea K Pea - mewmew.mp3", "Tea K Pea", "mewmew", kFromFMA, kLicenseCcBy),
  // CC-BY-SA:
  new DemoSong("mp3/Lovira - Birthday present.mp3", "Lovira", "Birthday present", kFromFMA, kLicenseCcBySa),
  new DemoSong("mp3/Lovira - Re.mp3", "Lovira", "Re", kFromFMA, kLicenseCcBySa),
  new DemoSong("mp3/Birds for Scale - Smarties.mp3", "Birds for Scale", "Smarties", kFromFMA, kLicenseCcBySa),
  new DemoSong("mp3/Small Colin - Mono Crash.mp3", "Small Colin", "Mono Crash", kFromFMA, kLicenseCcBySa),
  // Unlicensed:
  new DemoSong("mp3/Nunuther - Weirment Eubie.mp3", "Nunuther", "Weirment Eubie"),
  new DemoSong("mp3/Nunuther - Thrive.mp3", "Nunuther", "Thrive"),
];

let g_mp3s = kDemoSongs;
shuffle(g_mp3s);

let g_song_order = [];	// Contains indices into g_mp3s[].
let g_song_index = 0;   // Where we currently are in g_song_order[].

const kSeekSeconds = 5.0;
const kVolChange = 1.1;
const kStartVol = 0.5;
const kMaxVol = 1.0;
const kMinVol = 0.001;
let g_volume = kStartVol;
let g_playing_mp3s = false;
let g_playing_demo_mp3s = false;
let g_ok_to_start = true;		// Used to delay full startup until first local mp3 has been chosen.
let g_audio_source_selected = false;

let g_embed_string = "";
// [amp] external mode: the host announces track changes via setTrackTitle;
// auto-paint defaults ON there (their mp3 mode shows a HUD toast instead, but
// amp has no toast on track change). SHIFT+T still toggles it off.
let g_auto_embed_song_titles = window.GeissAmpConfig ? true : false;
let g_external_track_title = "";   // [amp] current track, fed by the host

let g_show_song_name = false;
let g_show_song_time = false;
let g_show_song_name_end_time = -1;
let g_show_song_time_end_time = -1;

const PALETTE_HOLD_TIME_MIN = GENERAL_TRANSITION_SPEED * 17;   // seconds
const PALETTE_HOLD_TIME_MAX = GENERAL_TRANSITION_SPEED * 32;   // seconds
const PALETTE_BLEND_TIME_MIN = GENERAL_TRANSITION_SPEED * 4;   // seconds
const PALETTE_BLEND_TIME_MAX = GENERAL_TRANSITION_SPEED * 8;   // seconds

const TARGET_FPS = 120.0;

let g_motion_scale = 1.0;
const kMinMotionScale = Math.pow(2.0, -10);
const kMaxMotionScale = Math.pow(2.0, 4);

let g_renders_per_second = TARGET_FPS;
let g_user_transition_speed = 1.0;		// Always leave this at 1.0.

let g_raf_hz = 0.0;
let g_last_raf_time = -1;
let g_raf_calls = 0;
const g_raf_dt_buffer = new Float32Array(120).fill(1.0 / TARGET_FPS);
let g_raf_dt_buffer_pos = 0;

let g_dbg = false;  // Debugging keys; toggled on/off via F8.
let g_dbg_viz = 0;

let g_experiment = false;

const g_start_time = performance.now() * 0.001; 
let g_time = g_start_time;
let g_prev_time = g_start_time - 1.0 / 90.0;
let g_palette_time = g_start_time;
let g_motion_time = g_start_time;
let g_wave_time = g_start_time;
let g_shift_time = g_start_time;

// Technically, g_show_toasts controls whether or not toasts
// can be LAUNCHED -- not whether or not they display.
let g_show_toasts = true;
let g_toasts = [];		// each item has .message, .id, .end_time

let g_frame = 0;
const g_render_dt_buffer = new Float32Array(120).fill(1.0 / TARGET_FPS);
let g_render_dt_buffer_pos = 0;
let g_average_render_time_seconds = 1.0 / TARGET_FPS;

let g_show_help = false;
let g_frozen = false;

let g_wave_scale = 1.0;
let g_wave_smoothing = 2;  // Tune this to balance the impact of treble hits on the index map.
let g_xy_oscilloscope_gap = 96;  //TODO: Remove
let g_wave_point_size = -1;  // (0..1], or <= 0 for auto. 

let g_oversample = 1.0;//1.0;
const kMaxTextureDim = 8192;		// TODO: Query this.
const kMaxOversample = 4.0;			// Fragment shader doesn't support > 4x4 samples @ present time.
const kMinOversample = 0.25;

// Palettes have two fields: .palette and .name.
let g_palette1 = GenerateRandomPalette();
let g_palette2 = null;
let g_palette_edit_backup = null;
let g_current_blended_palette = null;
let g_palette_locked = false;
let g_palette_fade_t0 = g_palette_time + 10;
let g_palette_fade_t1 = g_palette_time + 20;

let g_motion_locked = false;
let g_randomize_motion = false;

let g_wave_locked = false;
let g_randomize_wave = false;
let g_toggle_grid_dots = false;
let g_toggle_fading_dots = false;
let g_toggle_random_beat_dots = false;
let g_toggle_radial_beat_dots = false;

let g_brightness = 1.0;
let g_darkening = 0.0;

// Range: [0..1].
// Lower value -> better alignment, but fewer aligned wave samples. (wider wave!)
//             -> CAREFUL: our AnalyserNode sends is a rolling window of
//                  the most recent ~2048 samples, in ~128-sample quanta;
//                  if we give too much room for alignment, it'll just
//                  snap exactly to the previous waveform, and visually
//                  it'll look like the same wave again for 2,3,4 frames.
//                  So don't blindly lower this without watching for that!
// Good test song for jumping bass waves:  "03 - IDB (With Sayr).mp3"
let g_align_frac = 0.6;//0.55;
// bass songs:  max align_frac where bass waves align:
//   03 - IDB (with sayr) - 0.6
//   deadmau5 - random album title - 10 - not exactly       - 0.6
//   bonobo - 0.6 ideal, 0.7 soso
//   anokha - 0.65
//   downlink - 0.75
//   expand the room - 0.8
//   tosca - 0.85


//xxx
/*
	CTRL+R = toggle red
	CTRL+G = toggle green
	CTRL+B = toggle blue
	CTRL+V = toggle preview on/off
	CTRL+Z = revert
*/
let g_palette_edit_preview = true;
let g_palette_edit_r = true;
let g_palette_edit_g = true;
let g_palette_edit_b = true;
let g_palette_edit_index = 1;
//let g_palette_edit_shadows    = true;
//let g_palette_edit_midtones   = true;
//let g_palette_edit_highlights = true;

const g_level_bands = [
  { f0:   30, f1:   200, name: "bass" },	// bass
  { f0:  200, f1:  2200, name: "mid"  },	// mid
  { f0: 2200, f1: 12000, name: "high" },	// high
  { f0:   30, f1: 12000, name: "vol"  },	// all
];
const BANDS = g_level_bands.length;
const BASS_BAND = 0;
const MID_BAND  = 1;
const HIGH_BAND = 2;
const VOL_BAND  = 3;
const g_band_colors = [
	"rgba(240,64,0,1)",
	"rgba(0,220,0,1)",
	"rgba(24,170,255,1)",
	"rgba(255,255,255,1)"
];

const VOL_SPEED_HALF_LIVES = [ 30.0, 3.0, 2.0, 1.0 ];
const VOL_SPEED_COUNT = VOL_SPEED_HALF_LIVES.length;
const VOL_FOR_BEAT_DET = 2;  //TWEAK

const kBiasDampedVolTowardHighValues = 0.0;//1.0;  // 0+  //TWEAK
const g_min_level = 0.00001;
let g_vol_imm = new Float32Array(BANDS).fill(g_min_level * 20);
let g_vol_rel_damped = new Array(VOL_SPEED_COUNT);		// index by [vol_speed][XXX_BAND]
for (let i = 0; i < VOL_SPEED_COUNT; i++) {
	g_vol_rel_damped[i] = new Float32Array(BANDS).fill(g_min_level * 20);
}
let g_time_since_beat = 9999.9;

const g_beat_detector = new SimpleBeatDetector({
  fastIdx: 3,   // 0.25s in your VOL_SPEED_HALF_LIVES
  slowIdx: 1,   // 1.0s in your VOL_SPEED_HALF_LIVES (better if you have ~4s)
  minIntervalSec: 0.20,
  kMul: 2.0,
  tAdd: 0.08,
});

const g_frame_dt_buffer = new Float32Array(180).fill(1.0 / TARGET_FPS);
let g_frame_dt_buffer_pos = 0;

const g_white_text = `<span style="color:#FFF;">`;
const g_grey_text = `<span style="color:#BBB;">`;  // see also: g_grey_text in index.html
const g_green_text = `<span style="color:#4F4;">`;
const g_link_color = `<span style="color:#C8F;">`;  // see also: g_link_color in index.html
const g_end_color = `</span>`;

const g_is_localhost =
  location.hostname === "localhost" ||
  location.hostname === "127.0.0.1" ||
  location.hostname === "::1";
  
function lerp(a, b, t) {
	return a * (1.0 - t) + b * t;
}

function smoothstep(u) {
  return u * u * (3 - 2 * u);
}

(function require_https_or_localhost() {
  if (window.GeissAmpConfig) return;  // [amp] page is loaded from disk (file/custom scheme), not a web server
  const host = location.hostname;
  const is_localhost =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "[::1]" ||
    /^127(?:\.\d{1,3}){3}$/.test(host);

  if (!isSecureContext && !is_localhost) {
    const https_url = "https://" + location.host + location.pathname + location.search + location.hash;

    document.body.style.background = "black";
    document.body.style.color = "white";
    document.body.style.font = "20px/1.4 sans-serif";
    document.body.style.padding = "24px";

    document.body.innerHTML = `
      <div style="max-width: 900px;">
        <div style="margin-bottom: 12px;">
          For webGPU to work properly, this site must be loaded over <b>HTTPS</b> (secure context).
        </div>
        <div style="margin-bottom: 12px;">
          Current URL:<br><code>${location.href}</code>
        </div>
        <div style="margin-top: 18px;">
          Please use this link instead:<br>
          <a href="${https_url}" style="color: #6cf; word-break: break-all;">${https_url}</a>
        </div>
      </div>
    `;

    throw new Error("HTTPS required: " + https_url);
  }
})();

/*
function isSafari() {
  const ua = navigator.userAgent;

  const hasSafari = /Safari/i.test(ua);
  const hasChromeLike = /Chrome|Chromium|CriOS/i.test(ua);
  const hasFirefoxiOS = /FxiOS/i.test(ua);
  const hasEdgeiOS = /EdgiOS/i.test(ua);
  const hasOpera = /OPR|OPiOS/i.test(ua);

  return hasSafari && !hasChromeLike && !hasFirefoxiOS && !hasEdgeiOS && !hasOpera;
}*/

// Browser checks:
const ua = navigator.userAgent;
console.log(`Browser: ${ua}`);

const g_is_chrome_or_similar = /Chrome|Chromium|CriOS/i.test(ua);
const g_is_firefox = /Firefox\/\d+/i.test(ua) || /FxiOS\/\d+/i.test(ua);
const g_is_safari = /Safari/i.test(ua) && !g_is_chrome_or_similar;

//if (!g_is_chrome_or_similar && !g_is_firefox && !g_is_safari) {
	// FOR ALL BROWSERS:
	//   *** In Mac OS settings, you must enable 
	//       "System Audio Recording Only" 
	//       for the browser of your choice. ***
	// CHROME:
	//   AUDIO: Works great.
	//   HDR:   Works great.
	// FIREFOX:
	//   AUDIO:
	//     Mic works; audio-from-tab still doesn't work.
	//   HDR:
	//     At startup, immediately reports that HDR is not supported (even if you have an HDR display).
	//     Rendering-wise, works fine in SDR.
	//   -> Allowed, but SDR is forced (HDR not working yet), and user is warned.
	// SAFARI: 
	//   SETUP:
	//     1. Settings -> Advanceed -> Show Develop Menu
	//     2. Develop Develop -> Feature Flags, search for WebGPU,
	//          and enable it.
	//   AUDIO:
	//     When capturing a tab, it has some kind of permission failure in startTab().  
	//   HDR:
	//     (!) Broken.  Safari browser fails silently at when you request "rgba16float"
	//     in WebGPUPresenter (this.context.configure()), and the canvas remains black.
	//     (If we instead force 'preferred_format', which is bgra8unorm, it works -- 
	//     but of course, then it's not HDR.)  So, for now, we just set
	//     g_browser_supports_hdr to false when you're running Safari, and issue
	//     the disclaimer screen at startup.
	//   MISC:
	//     1. clicking the license links is broken.  (works in chrome, firefox)
	//     2. (ok) framerate is limited to 60 hz unless you turn off a default feature
	//          flag.  When this happens, a toast warns the user, and tells them how to fix it.
	//     3. (!) warp map float16 uploads are very slow, adding to jank.  see console warnings.
	//     4. the burn-in of embedded song titles (into the index buffer) is broken;
	//          haven't bothered figuring out why yet.  The title shows in the present
	//          shader for ~1 second, but it doesn't burn in at the end (~warp shader).
	//   CONCLUSION:
	//     -> DISABLED.  (could also allow w/SDR forced on, w/warning, but... too many issues)
//	ShowError(`This browser is not yet supported.\n\nPlease try with Google Chrome instead.\n\n${navigator.userAgent}`);
//}

const g_page_url_params = new URLSearchParams(window.location.search);
//const foo = g_page_url_params.get("foo");   // null if missing
const g_force_hdr = g_page_url_params.get("force_hdr") != undefined;

// HDR doesn't work properly on Safari browser yet; it quietly fails
// with a black screen.  However, if we add 'colorSpace: "display-p3"',
// it works -- but we only get SDR, and no warning that it's not HDR.
// And p3 renders differently on chrome (a little more saturated).
// [amp] WKWebView: the WKWebView UA has no "Safari" token so g_is_safari
// misses it. Historically its rgba16float canvas failed silently (see the
// author's Safari notes above), but macOS 26.5 WebKit renders it fine — so in
// amp mode this starts false and the host flips it on at start() time IF its
// own runtime probe (configure rgba16float + toneMapping extended, render,
// read back non-black) passed. `let` (was const): amp assigns it later.
let g_browser_supports_hdr = window.GeissAmpConfig ? false
    : ((!g_is_safari && !g_is_firefox) || g_force_hdr);

// Reports if the display *IS* an HDR display.
// Note that if you have an HDR display but it's set to SDR mode,
//   this will still return true.
let g_display_is_hdr = ((matchMedia("(dynamic-range: high)").matches) ? true : false);

// User setting:
let g_disable_hdr = !(g_display_is_hdr && g_browser_supports_hdr);


function HdrWarning() {
	let text = "";
	if (!g_display_is_hdr) {
		text += 
`Code 1: HDR display not detected.
`;
	}
	if (!g_browser_supports_hdr) {
		text += 
`Code 2: This browser does not [properly] support HDR rendering.
`;
	}
	
	text += `
Please expect degraded visual quality.

For best results, use an HDR display with 1000+
nits of brightness, and Chrome browser.`;
	
	Toast(text, 910323, (g_frame == 0) ? 15.0 : 9.0);
}

function resizeCanvasToWindow() {
	const cw = window.innerWidth;
	const ch = window.innerHeight;

  //const dpr = window.devicePixelRatio || 1;
  //const cw = ww;//Math.max(1, Math.floor(ww / dpr));
  //const ch = wh;//Math.max(1, Math.floor(wh / dpr));
	console.log(`Resizing window to ${cw}x${ch}`);

  canvas.width = cw;
  canvas.height = ch;
	dbg.width = cw;
	dbg.height = ch;
	
  const iw = Math.max(1, Math.floor(cw * g_oversample)) | 0;
  const ih = Math.max(1, Math.floor(ch * g_oversample)) | 0;
  
  // cw, ch: client size
  // iw, ih: index buffer size (might be 2x smaller, 3x smaller, etc)
  return { cw, ch, iw, ih };
}

function DrawCircle(x, y, r, color, alpha = 1) {
  dctx.globalAlpha = alpha;
  dctx.fillStyle = color;
  dctx.beginPath();
  dctx.arc(x, y, r, 0, Math.PI * 2);
  dctx.fill();
  dctx.globalAlpha = 1;
}

function UpdateDampedVolumes(frame_number, dt) {
	const fps = 1.0 / dt;
	for (let v = 0; v < VOL_SPEED_COUNT; v++) {
		const half_life = VOL_SPEED_HALF_LIVES[v];  // in seconds
		const init_frame_count = (half_life * 2) * fps;
		for (let b = 0; b < BANDS; b++) {
			let update_str = 1.0;
			if (frame_number < init_frame_count) {
				// Do the equivalent of averaging for the first 200 frames.
				update_str = 1.0 / Math.max(1, frame_number + 1);
			} else {
				// Choose update rate that gives exactly the desired decay half-life,
				// at 'fps' frames per second.
				//update_str = 1.0 - Math.pow(2.0, -1.0 / (fps * half_life));
				update_str = 1.0 - Math.pow(2.0, -dt / half_life);
			}

			// If the volume went up, respond more aggressively --
			// this way, the averages tracked bias a little more toward the louder parts.
			if (g_vol_imm[b] > g_vol_rel_damped[v][b]) {
				update_str = Math.pow(update_str, 1.0 / (1 + kBiasDampedVolTowardHighValues));
			} else {
				update_str = Math.pow(update_str, 1 + kBiasDampedVolTowardHighValues);
			}

			g_vol_rel_damped[v][b] = 
					(      update_str) * g_vol_imm[b] + 
					(1.0 - update_str) * g_vol_rel_damped[v][b];
		}
	}
}


function Toast(message, id = 0, duration = 1.5) {
	if (g_show_toasts) {
		if (id != 0) {
			// Erase any existing toasts with the same ID.
			let new_toasts = [];
			for (let i = 0; i < g_toasts.length; i++) {
				if (g_toasts[i].id != id) {
					new_toasts.push(g_toasts[i]);
				}
			}	
			g_toasts = new_toasts;	
		}
		
		// Note: We pull this directly (instead of using g_time) so that
		// any toasts fired before the animation begins have the correct
		// time -- for example, if the user uses a file picker before the
		// animation really starts, and it results in a toast.
		let time_now = performance.now() * 0.001;
		
		let end_time = time_now + duration;
		g_toasts.push({message, id, end_time})
	}
}

const LocalStorageHelper = {
  get(key, fallback) {
    const v = localStorage.getItem(key);
    return v === null ? fallback : JSON.parse(v);
  },
  set(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  },
};

function get_device_type() {
  const ua = navigator.userAgent || "";
  const touch_points = navigator.maxTouchPoints || 0;
  const width = Math.min(window.screen.width, window.screen.height); // CSS px-ish portrait baseline

  const is_ipad =
    /iPad/.test(ua) ||
    (navigator.platform === "MacIntel" && touch_points > 1); // iPadOS desktop-mode quirk

  const is_android = /Android/.test(ua);
  const is_mobile_ua = /Mobi|iPhone|iPod|Windows Phone/.test(ua);

  if (is_ipad) return "tablet";

  if (is_android) {
    // Android phones usually include "Mobile"; tablets often don't.
    if (/Mobile/.test(ua)) return "phone";
    return "tablet";
  }

  if (is_mobile_ua) return "phone";

  // Fallback: touch + size heuristic
  if (touch_points > 0) {
    if (width < 600) return "phone";
    if (width < 900) return "tablet";
  }

  return "laptop_or_desktop";
}

// [amp] awaits removed: the warning overlays are not present in amp's DOM
// (waitForWarningDismiss resolves immediately when the element is missing),
// and top-level await can't survive bundling to a classic script.
waitForWarningDismiss("hdr_warn_overlay", 0);
waitForWarningDismiss("safari_warn_overlay", 1);
waitForWarningDismiss("phone_warn_overlay", 2);
function waitForWarningDismiss(element_name, id) {
  const ov = document.getElementById(element_name);
  if (!ov) {
  	return Promise.resolve(); // already dismissed / not present
	}

  if (id == 0) {
	  // Skip HDR warning entirely if HDR is supported, or if ?force_hdr=1 was in the URL.
	  if ((g_display_is_hdr && g_browser_supports_hdr) || g_force_hdr) {
	    return Promise.resolve();    // don't block startup
	  }
	}
	
	if (id == 1) {
	  // Skip Safari warning overlay entirely if not on Safari.
	  if (!g_is_safari) {
	    return Promise.resolve();    // don't block startup
	  }
	}
	
	if (id == 2) {
		const device_type = get_device_type();  // "phone", "tablet", or "laptop_or_desktop"
		if (device_type != "phone") {
	    return Promise.resolve();    // don't block startup
		}		
	}

	// Show it.
  ov.style.display = "flex";
  
  return new Promise((resolve) => {
    const dismiss = () => {
    	if (!ov || ov.style.display === "none") return;
      ov.remove(); // gone forever
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", dismiss, true);
      resolve();
    };

    const onKey = (e) => {
      // Ignore modifier-only keys; otherwise dismiss on first real key.
      if (e.key === "Shift" || e.key === "Control" || e.key === "Alt" || e.key === "Meta") return;
      dismiss();
    };

    window.addEventListener("keydown", onKey, true);
    ov.addEventListener("pointerdown", dismiss, true);
  });
}

let { cw, ch, iw, ih } = resizeCanvasToWindow();
//let W = iw, H = ih;
window.addEventListener("resize", () => {
  // cw, ch: client size
  // iw, ih: index buffer size (might be 2x smaller, 3x smaller, etc)
  ({ cw, ch, iw, ih } = resizeCanvasToWindow());
  //W = iw; H = ih;

  if (g_engine) g_engine.resize(cw, ch, iw, ih);
  if (g_presenter) g_presenter.resize(cw, ch, iw, ih, g_oversample);
});

let g_touch_active = false;
let g_touch_start_x = 0;
let g_touch_start_y = 0;
let g_touch_start_time = 0;

const kTapMaxDist = 20;
const kSwipeMinDist = 40;

// mousemove:
window.addEventListener("pointermove", function(e) {
	if (window.GeissAmpConfig && !window.GeissAmpConfig.active) return;  // [amp] engine hidden
	if (e.pointerType !== "touch" && g_frame > 0) {
		// In the order we want the toasts to appear (top to bottom), if all active:
		if (g_frozen) {
  		Toast("Animation is frozen; press SHIFT+F to resume", 3424123, 3.0);	  		
  	}
		if (g_playing_mp3s && g_audio.isPaused()) {
			Toast("Playback is paused; press C to resume", 7538623, 1.0);
		}
		if (!g_show_help) {
			Toast("Press H for help", 624362, 1.0);
		}
	}
});

window.addEventListener("pointerdown", (e) => {
	if (window.GeissAmpConfig && !window.GeissAmpConfig.active) return;  // [amp] engine hidden
	//if (e.pointerType !== "touch") return;
  if (!e.isPrimary) return; // ignore second finger

	// Ignore touches on the HUD.
  //if (e.target.closest("#hud a, #hud button, #hud input, #hud select, #hud textarea")) {
  //  return;
  //}
  if (e.target.closest("#hud")) return;
  
  g_touch_active = true;
  g_touch_start_x = e.clientX;
  g_touch_start_y = e.clientY;
  g_touch_start_time = performance.now();
});

window.addEventListener("pointerup", (e) => {
  //if (e.pointerType !== "touch") return;
  if (!g_touch_active) return;

  g_touch_active = false;

  const end_x = e.clientX;
  const end_y = e.clientY;
  const dx = end_x - g_touch_start_x;
  const dy = end_y - g_touch_start_y;
  const dist2 = dx * dx + dy * dy;

  if (dist2 <= kTapMaxDist * kTapMaxDist) {
	  if (e.pointerType === "mouse" || e.pointerType === undefined) {
  		on_mouse_click(end_x, end_y);
  	} else {
  		on_touch_tap(end_x, end_y);
  	}
    return;
  }

  if (Math.abs(dx) < kSwipeMinDist && Math.abs(dy) < kSwipeMinDist) {
    return; // too much movement for tap, too little for swipe
  }

	if (e.pointerType === "touch") {
	  if (Math.abs(dx) > Math.abs(dy)) {
	    if (dx > 0) on_swipe_right();
	    else        on_swipe_left();
	  } else {
	    if (dy > 0) on_swipe_down();
	    else        on_swipe_up();
	  }
	}
});

window.addEventListener("pointercancel", (e) => {
  if (e.pointerType !== "touch") return;
  g_touch_active = false;
});

function on_mouse_click(x, y) {
	//if (g_playing_mp3s) {
	//	let now_playing = g_audio.togglePause();
	//	if (now_playing) {
	//		Toast("Playback resumed", 7538623, 2.0);
	//	} else {
	//		Toast("Playback paused; click mouse to resume", 7538623, 9999999.0);
	//	}
	//}
}

function on_touch_tap(x, y) {
  Randomize();
}

function on_swipe_left()  { console.log("swipe left"); }
function on_swipe_right() { console.log("swipe right"); }
function on_swipe_up()    { console.log("swipe up"); }
function on_swipe_down()  { console.log("swipe down"); }


async function toggleFullscreen() {
	g_oversample = 1.0;
  if (!document.fullscreenElement) {
    await document.documentElement.requestFullscreen();
  } else {
    await document.exitFullscreen();
  }
}

function OnNewOversample(old_oversample, new_oversample) {
	({ cw, ch, iw, ih } = resizeCanvasToWindow());
	g_engine.resize(cw, ch, iw, ih);
	g_presenter.resize(cw, ch, iw, ih, new_oversample);
	let verb = (new_oversample > old_oversample) ? "increased" : "decreased";
	Toast(`Resolution ${verb} to ${iw} x ${ih} (${new_oversample.toFixed(2)}x)`, 914323);
}

function ResetAdjustableParameters() {
	let changed = false;

	if (Math.abs(g_darkening - 0.0) > 0.0001) {
		g_darkening = 0.0;
		Toast(`Darkening reset to ${g_darkening.toFixed(1)}x`, 5831722);
		changed = true;
	}
	
	if (Math.abs(g_user_transition_speed - 1.0) > 0.0001) {
		g_user_transition_speed = 1.0;
		Toast(`Transition speed reset to ${g_user_transition_speed.toFixed(5)}x`, 643261);
		changed = true;
	}
		
	if (Math.abs(g_motion_scale - 1.0) > 0.0001) {
		g_motion_scale = 1.0;
		Toast(`Motion speed reset to ${g_motion_scale.toFixed(3)}x`, 532432);
		changed = true;
	}
		
	if (Math.abs(g_darkening - 0.0) > 0.0001) {
		g_darkening = 0.0;
		Toast(`Darkening reset to ${g_darkening.toFixed(1)}x`, 5831722);
		changed = true;
	}
		
	if (Math.abs(g_brightness - 1.0) > 0.0001) {
		g_brightness = 1.0;
		Toast(`Brightness reset to ${g_brightness.toFixed(2)}x`, 451342);
		changed = true;
	}
		
	if (Math.abs(g_wave_scale - 1.0) > 0.0001) {
		g_wave_scale = 1.0;	  	
		Toast(`Wave scale reset to ${g_wave_scale.toFixed(3)}`, 468206);
		changed = true;
	}
	
	if (Math.abs(g_oversample - 1.0) > 0.0001) {
		let old_oversample = g_oversample;
		g_oversample = 1.0;
		OnNewOversample(old_oversample, g_oversample);
		changed = true;
	}
	
	if (!changed) {
		Toast(`(Nothing more to reset)`, 8752346);		
	}
}

// Number should be in [0..9]
let g_numbers_typed = -1;
function OnNumberKey(number) {
	if (g_dbg) {
		if (g_numbers_typed == -1) {
			g_numbers_typed = number;		
		} else {
			const mode = g_numbers_typed * 10 + number;
			g_numbers_typed = -1;
			g_engine.SetMotionModeDebug(mode, g_motion_time);
			Toast(`Set motion mode to ${mode}`, 318093);
		}
	} else {
		if (number == 0) {
			ResetAdjustableParameters();
		} else if (number == 1) {
			g_toggle_radial_beat_dots = true;			
		} else if (number == 2) {
			g_toggle_random_beat_dots = true;			
		} else if (number == 3) {
			g_toggle_grid_dots = true;
		} else if (number == 4) {
			g_toggle_fading_dots = true;
		}
	}
}

function SetPaletteBlendTimes() {
	let hold_time = PALETTE_HOLD_TIME_MIN +
			(PALETTE_HOLD_TIME_MAX - PALETTE_HOLD_TIME_MIN) * Math.random();
	let blend_time = PALETTE_BLEND_TIME_MIN +
			(PALETTE_BLEND_TIME_MAX - PALETTE_BLEND_TIME_MIN) * Math.random();
	g_palette_fade_t0 = g_palette_time + hold_time;
	g_palette_fade_t1 = g_palette_fade_t0 + blend_time;
}

function Randomize() {
	if (g_palette_locked && g_wave_locked && g_motion_locked) {
		Toast(`Can\'t randomize anything; press L to unlock first`, 235153);
	}
	RandomizePalette();
	RandomizeMotion();
	RandomizeWave();
}

function RandomizePalette() {
	if (g_palette_locked) {
		return;
	}

	g_palette_time = Math.random() * 10000;

	ClearOverridePalette();
	g_palette1 = GenerateRandomPalette();
	g_palette2 = null;
	SetPaletteBlendTimes();
}

function GetCurrentPaletteBlend() {
	const t = Math.max(0, Math.min(1,
			(g_palette_time    - g_palette_fade_t0) / 
	    (g_palette_fade_t1 - g_palette_fade_t0) ));
	return smoothstep(t);
}

function GetCurrentPaletteDesc() {
	const t = GetCurrentPaletteBlend();
	if (t > 0.0001 && g_palette2) {
		const percent = (t * 100 + 0.5) | 0;
		return `Blend of ${g_palette1.name} (${100-percent}%) and ${g_palette2.name} (${percent}%)`;
	}	else {
		return g_palette1.name;
	}
}

function RandomizeMotion() {
	if (g_motion_locked) {
		return;
	}
	g_motion_time = Math.random() * 10000;
	g_randomize_motion = true;	
}

function RandomizeWave() {
	if (g_wave_locked) {
		return;
	}
	g_wave_time = Math.random() * 10000;
	g_randomize_wave = true;
}

// Call: install_auto_hide_cursor(canvas_or_div, 1000);
function install_auto_hide_cursor(client_el, hide_delay_ms = 1000) {
  let hide_timer = 0;
  let is_inside = false;

  function clear_hide_timer() {
    if (hide_timer) {
      clearTimeout(hide_timer);
      hide_timer = 0;
    }
  }

  function show_cursor() {
    // Use "" to fall back to CSS, or "auto"/"default" if you prefer.
    client_el.style.cursor = "";
  }

  function hide_cursor() {
    if (is_inside) client_el.style.cursor = "none";
  }

  function bump() {
    if (!is_inside) return;
    show_cursor();
    clear_hide_timer();
    hide_timer = setTimeout(hide_cursor, hide_delay_ms);
  }

  function on_enter() {
    is_inside = true;
    bump();
  }

  function on_leave() {
    is_inside = false;
    clear_hide_timer();
    show_cursor();
  }

  // Mouse/pointer movement shows cursor and restarts timer.
  // pointermove covers mouse, pen, touch (touch won’t show a cursor anyway).
  client_el.addEventListener("pointerenter", on_enter);
  client_el.addEventListener("pointerleave", on_leave);
  client_el.addEventListener("pointermove", bump);

  // Other interactions should also reveal it.
  client_el.addEventListener("pointerdown", bump);
  client_el.addEventListener("wheel", bump, { passive: true });

  // If you want keyboard activity to reveal cursor while inside:
  // (Only works if the window gets key events; you could also attach to client_el if it’s focusable.)
  //window.addEventListener("keydown", () => { if (is_inside) bump(); });

  // Return an uninstall function to cleanly remove everything if needed.
  return function uninstall() {
    clear_hide_timer();
    show_cursor();
    client_el.removeEventListener("pointerenter", on_enter);
    client_el.removeEventListener("pointerleave", on_leave);
    client_el.removeEventListener("pointermove", bump);
    client_el.removeEventListener("pointerdown", bump);
    client_el.removeEventListener("wheel", bump);
    // Note: can't remove the anonymous keydown listener above; if you care, name it and remove it too.
  };
}

install_auto_hide_cursor(canvas, 250);

let g_audio = null;
let g_engine = null;
let g_presenter = null;

function is_audio_file(file) {
  if (!file) return false;

  const name = file.name || "";
  const type = file.type || "";

  if (type.startsWith("audio/")) return true;

  return /\.(mp3|wav|m4a|aac|ogg|flac|opus|wma)$/i.test(name);
}

function file_from_file_entry(file_entry) {
  return new Promise((resolve, reject) => {
    file_entry.file(resolve, reject);
  });
}

function read_all_directory_entries(dir_entry) {
  return new Promise((resolve, reject) => {
    const reader = dir_entry.createReader();
    const all_entries = [];

    function read_batch() {
      reader.readEntries((entries) => {
        if (!entries || entries.length === 0) {
          resolve(all_entries);
          return;
        }
        all_entries.push(...entries);
        read_batch(); // must keep going until empty batch
      }, reject);
    }

    read_batch();
  });
}

async function walk_dropped_entry(entry, out_files) {
  if (!entry) return;

  if (entry.isFile) {
    try {
      const file = await file_from_file_entry(entry);
			if (is_audio_file(file)) {
        //out_files.push(file);
			  out_files.push({
			    file: file,
			    path: entry.fullPath || file.name
			  });
			}
    } catch (err) {
      console.warn("Failed to read dropped file entry:", err);
    }
    return;
  }

  if (entry.isDirectory) {
    try {
      const children = await read_all_directory_entries(entry);
      for (const child of children) {
        await walk_dropped_entry(child, out_files);
      }
    } catch (err) {
      console.warn("Failed to read dropped directory entry:", err);
    }
  }
}

async function collect_dropped_audio_files(data_transfer) {
  const out_files = [];

  // Preferred path: recurse via entries so folders work.
  if (data_transfer.items && data_transfer.items.length > 0) {
    const entries = [];

    for (const item of data_transfer.items) {
      if (item.kind !== "file") continue;

      const entry =
        (typeof item.getAsEntry === "function" && item.getAsEntry()) ||
        (typeof item.webkitGetAsEntry === "function" && item.webkitGetAsEntry()) ||
        null;

      if (entry) {
        entries.push(entry);
      } else {
        // Fallback: plain file
        const file = item.getAsFile?.();
        if (file && is_audio_file(file)) {
          //out_files.push(file);
					out_files.push({
					  file: file,
					  path: entry.fullPath || file.name
					});
        }
      }
    }

    for (const entry of entries) {
      await walk_dropped_entry(entry, out_files);
    }

    return out_files;
  }

  // Fallback path: plain files only, no directory recursion.
  if (data_transfer.files && data_transfer.files.length > 0) {
    for (const file of data_transfer.files) {
      if (is_audio_file(file)) {
        //out_files.push(file);
				out_files.push({
				  file: file,
				  path: ""
				});
      }
    }
  }

  return out_files;
}

function OnLoadNewSongList() {
	g_song_order = new Uint32Array(g_mp3s.length);
	for (let i = 0; i < g_mp3s.length; i++) g_song_order[i] = i;
	shuffle(g_song_order);
	
	g_song_index = 0;
}

async function PrevTrack() {
	if (g_audio.getCurrentSongTimeInSeconds() < 0.5) {
		// Go to previous track.
		const N = g_song_order.length;
		if (N == 0) {
			return;
		}
		g_song_index = (g_song_index + N - 1) % N;
		const i = g_song_order[g_song_index];
		const filename = g_mp3s[i].filename;
		
		if (g_mp3s[i].file) {
			// Local file		
			const loop = false;
		  const result = await g_audio.loadLocalFile(g_mp3s[i].file, g_volume, loop);
		  if (!result.success) {
		    alert(`Could not load audio file: ${filename}, error: ${result.error}`);
		    return;
		  }		
		} else {
			// Demo track (URL)
			g_audio.loadNewSong(filename);
		}

		OnNewTrack();
	} else {
		// Go to start of current track.
		g_audio.rewindCurrentSong();
	}
}

async function NextTrack() {
	// Go to next track.
	const N = g_song_order.length;
	if (N == 0) {
		return;
	}
	g_song_index = (g_song_index + 1) % N;
	const i = g_song_order[g_song_index];
	const filename = g_mp3s[i].filename;
	
	if (g_mp3s[i].file) {
		// Local file		
		const loop = false;
	  const result = await g_audio.loadLocalFile(g_mp3s[i].file, g_volume, loop);
	  if (!result.success) {
	    alert(`Could not load audio file: ${filename}, error: ${result.error}`);
	    return;
	  }		
	} else {
		// Demo track (URL)
		g_audio.loadNewSong(filename);
	}
	
	OnNewTrack();
  
  if (g_audio.songHasEnded()) {
  	g_audio.play();
  }
}

async function OnLoadLocalFiles(files) {		
	files.sort((a, b) => a.file.name.localeCompare(b.file.name));

	// Remember the filenames.
	g_mp3s = [];
	for (let i = 0; i < files.length; i++) {
		let filename = files[i].file.name;
		let path = files[i].path;
		if (path.startsWith("/")) {
		  path = path.slice(1);
		}
		if (path.includes("/")) {
			path = path.slice(0, path.lastIndexOf("/"));
		}	
		if (path == filename) {
			path = "";
		}
		g_mp3s.push(new DemoSong(filename, "", "", "", "", path, files[i].file));	
	}
	
	if (g_mp3s.length > 1) {
		Toast(`Found ${g_mp3s.length} audio files.`, 4328947, 3.0);	
	}
	
	OnLoadNewSongList();

	// In case they drag-and-dropped before selecting the audio source,
	// this initializes g_audio:
	const first_time = !g_audio_source_selected;
	if (first_time) {
		OnSelectAudioSource();
	}

  // For now: load the first one.
	const i = g_song_order[g_song_index];
	const loop = false;
  const result = await g_audio.loadLocalFile(g_mp3s[i].file, g_volume, loop);	//KIV: removed 'await'
  if (!result.success) {
    alert(`Could not load audio file: ${g_mp3s[i].file.name}, error: ${result.error}`);
  } else {
  	g_ok_to_start = true;
		OnNewTrack();
  }
  
	if (first_time) {
	  OnAudioSourceSelected();
	}
}

// Enable file picker:
local_file_input.addEventListener("change", async () => {
	const files = Array.from(local_file_input.files);			

  const file = files && files[0];
  if (!file) return;

	g_playing_mp3s = true;
	g_playing_demo_mp3s = false;

	let out_files = [];
	for (const file of local_file_input.files) {
	  //console.log(file.name);
	  out_files.push({
	    file: file,
	    path: file.name
	  });
	}			
	
	await OnLoadLocalFiles(out_files);		

  // Clear it so selecting the same file later still triggers change.
  local_file_input.value = "";
  
  if (!g_audio_source_selected) {
		OnAudioSourceSelected();  
	}
});

// Non-async pseudo-sleep function:
// Not a true thread sleep, but should burn less CPU
//   than a tight loop would -- and doesn't require "async".
// On MacBook with Chrome:
//   The sleep duration is super accurate, but is in quanta
//   of exactly 0.1 ms.  And it usually has to "loop" about
//   ~5000 times to achieve each 1.0 ms of "sleep".
function spin_wait_ms(ms) {
  const end = performance.now() + ms;
  let loops = 0;
  while (performance.now() < end) {
    if (typeof Atomics.pause === "function") {
      Atomics.pause();
      loops++;
    }
  }
  return loops;
}

// Enable drag-and-drop:
// [amp] disabled in external-audio mode: amp's playlist owns file drops,
// and a drop here would start playback disconnected from amp's player.
if (!window.GeissAmpConfig)
window.addEventListener("dragover", (e) => {
  e.preventDefault();
  canvas.classList.add("drag_active");
  audio_source_select_screen.classList.add("drag_active");
});

if (!window.GeissAmpConfig)  // [amp] see dragover note
window.addEventListener("dragleave", (e) => {
  canvas.classList.remove("drag_active");
  audio_source_select_screen.classList.remove("drag_active");
});

if (!window.GeissAmpConfig)  // [amp] see dragover note
window.addEventListener("drop", async (e) => {
  e.preventDefault();
  canvas.classList.remove("drag_active");
  audio_source_select_screen.classList.remove("drag_active");
  
  // Optional: only accept drops whose target is the canvas
  //if (e.target !== canvas) {
  //  console.log("drop ignored; target was", e.target);
  //  return;
  //}
  			
  //console.log("WINDOW drop fired");

  const audio_files = await collect_dropped_audio_files(e.dataTransfer);

  //console.log("collected audio files:", audio_files.length);
  //for (const file of audio_files) {
  //  console.log("audio file:", file.name, file.type, file.size);
  //}

  if (audio_files.length === 0) {
    console.log("No audio files found in dropped items.");
    return;
  }

	g_playing_mp3s = true;
	g_playing_demo_mp3s = false;

	await OnLoadLocalFiles(audio_files);		
			
  //console.log("loadLocalFile returned", ok);		  
  if (!g_audio_source_selected) {
		OnAudioSourceSelected();  
	}
});

function OnSelectAudioSource() {
	if (!g_audio_source_selected) {
		g_audio_source_selected = true;
		audio_source_select_screen.remove();
	  g_audio = new AudioInput({ fftSize: 2048 });
	}
}

// audio_source:
// 0 = mic
// 1 = tab
// 2 = demo mp3s (from geisswerks.com)
// 3 = remote mp3 (URL)
// 4 = local mp3
async function Start(audio_source) {
	OnSelectAudioSource();

  let result = { success : false, error : "" };
	if (audio_source == 0) {  
		result = await g_audio.startMic();
	} else if (audio_source == 1) {
	  result = await g_audio.startTab();
	} else if (audio_source == 2) {
		// Play demo mp3s.
	  g_playing_mp3s = true;
	  g_playing_demo_mp3s = true;

		OnLoadNewSongList();	  
		
		let i = g_song_order[g_song_index];
		let filename = g_mp3s[i].filename;
			  
		const loop = false;
	  result = await g_audio.startMP3(filename, g_volume, loop);
 		OnNewTrack();
	} else if (audio_source == 3) {
		alert("Path not currently supported.");
		// Play mp3s from URLs.  But this often has CORS restrictions problems.
		/*		
		g_mp3s = xxx;
		
	  //g_playing_arb_mp3s = true;
	  let url = prompt("Enter MP3 URL:", "./demo.mp3");
	  if (url == null || url.trim() === "") {
	    url = "./demo.mp3";
	  }
		const loop = true;
	  success = await g_audio.startMP3(url, g_volume);
	  */
	} else if (audio_source == 4) {
		// Play local MP3 files, either via O key or drag-and-drop.		
		g_playing_mp3s = true;
		
		// Wait for the user to drag-and-drop or hit the key.
		g_ok_to_start = false;

	  result.success = true;
	}

	if (!result.success) {
		ShowError(`Oops!  Something went wrong.  Please refresh to select another audio source.\n\nError: ${result.error}`);
	}

	OnAudioSourceSelected();
}

function SecondsToText(seconds) {
	seconds = seconds | 0;
	
	let minutes = Math.floor(seconds / 60);
	seconds -= minutes * 60;
	if (minutes < 60) {
		return `${minutes}:${String(seconds).padStart(2, "0")}`;
	}
	
	let hours = Math.floor(minutes / 60);
	minutes -= hours * 60;
	return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;	
}

function GetSongInfo() {
	if (g_song_index < 0 || g_song_index >= g_song_order.length) {
		return;
	}
	const i = g_song_order[g_song_index];
	// This text will come back colorized.
	return g_mp3s[i].GetToast();
}

function GetSongTime() {
	let t = g_audio.getCurrentSongTimeInSeconds();
	let len = g_audio.getCurrentSongLengthInSeconds();
	return `${g_grey_text}${SecondsToText(t)} / ${SecondsToText(len)}${g_end_color}`;
}

function OnSeek() {
	if (!g_show_toasts) {
		return;
	}
	if (!g_show_song_time || g_show_song_time_end_time >= 0) {
		g_show_song_time = true;
		let time_now = performance.now() * 0.001;
		g_show_song_time_end_time = time_now + 3.0;
	}
}

function OnNewTrack() {
	if (g_playing_mp3s && g_auto_embed_song_titles) {
		g_embed_string = GetSongInfo().embed_string;
	}
	
	if (!g_show_toasts) {
		return;
	}
	if (!g_show_song_name || g_show_song_name_end_time >= 0) {
		g_show_song_name = true;
		const time_now = performance.now() * 0.001;
		const duration = g_playing_demo_mp3s ? 8.0 : 3.0;
		g_show_song_name_end_time = time_now + duration;
	}
}

async function OnAudioSourceSelected() {
	dbg.style.display = "none";   // or "none"/""


  // Presenter (WebGPU)
  g_presenter = new WebGPUPresenter(canvas, cw, ch, iw, ih, g_oversample);
  const try_hdr = g_display_is_hdr && g_browser_supports_hdr;
  await g_presenter.init(try_hdr);
  

  // Engine
  g_engine = new Engine(g_presenter, cw, ch, iw, ih, g_time);

	if (!navigator.gpu) {
	  ShowError(
`ERROR: WebGPU not supported in this browser.
(navigator.gpu is undefined)

Consider trying Google Chrome.

Otherwise, look up if your browser (and version number) support WebGPU.
In some cases, it might still be behind a browser feature flag
or setting that you need to turn on.  Then be sure to restart your browser.`
		);
	}

	
  statusEl.textContent = g_ok_to_start ? "running" : `Drag-and-drop your music files here to play them.\n\nOr press CTRL+L to browse for them.\n\nSupported types: mp3, m4a, ogg, wav`;
  statusEl.style.fontSize = "16px";
  statusEl.style.color = "white";
  let lastT = null;

	//g_wave_scale = LocalStorageHelper.get(
	//		g_audio_from_tab ? "geiss.wave_scale.tab" : "geiss.wave_scale.mic", 
	//		g_wave_scale);
	
	const help_screen_1 = 
`${g_white_text}Keyboard commands:${g_end_color}
  ${g_green_text}H         toggle help screen
  SPACE     randomize visuals
  L         lock/unlock visuals
  F         toggle fullscreen${g_end_color}`;

	// This chunk is only shown if g_playing_mp3s is true.
	const help_screen_2 = `

${g_white_text}Playback control:${g_end_color}${g_grey_text}
  <EM>In addition to your computer\'s
  built-in media control keys for
  volume, pause, next, etc:</EM>
  Z B       prev/next song
  C         play/pause song
  ← →       seek within song
  ↑ ↓       adjust volume${g_end_color}`;

	const help_screen_3 = `

${g_white_text}Advanced:${g_end_color}${g_grey_text}
  CTRL + L  browse for songs
  CTRL + H  toggle HDR/SDR
  [ ]       adjust transition speed
  - +       adjust motion speed
  e E       adjust brightness
  d D       adjust darkening
  j J       adjust wave size
  q Q       adjust resolution
  0         reset all adjustable parameters
  1..4      toggle various visual effects
  CTRL+T    hide/show text pop-ups
  SHIFT+F   [un]freeze visuals${g_end_color}`;

	const help_screen_4 = `${g_grey_text}
  I         show song info/time
  T         paint song title
               (+SHIFT = toggle auto)${g_end_color}`;
	// Note: the last bit of the help screen, which shows
	// lock/unlock keys and statuses, is drawn dynamically.

	

  // P key: set random color tone
	window.addEventListener("keydown", (e) => {
		// [amp] ignore keys while the engine is switched away (amp's own
		// visualizer window handles transport keys itself)
		if (window.GeissAmpConfig && !window.GeissAmpConfig.active) return;
		// Key names are documented here:
		// https://developer.mozilla.org/en-US/docs/Web/API/UI_Events/Keyboard_event_key_values

	  if ((e.key == "F1" || e.key === "h" || e.key == "H")  && !e.ctrlKey) {
	  	g_show_help = !g_show_help;
	  }
	  if (e.key === "Escape") {
	  	if (g_frozen) {
		  	g_frozen = false;
	  		Toast("Animation resumed", 3424123, 3.0);	  		
	  	} else if (!g_palette_edit_preview) {
	  		g_palette_edit_preview = true;
	  	} else if (g_show_help) {
	  		g_show_help = false;
	  	} else if (document.fullscreenElement) {
	      toggleFullscreen();
	    }
	  }
	  if (e.key === "ArrowLeft" && !e.ctrlKey && !e.shiftKey) {
	  	if (g_playing_mp3s) {
		  	if (g_is_localhost && g_playing_demo_mp3s) {
		  		Toast("Sorry - seeking doesn't work when page is served from localhost.", 512433);
		  	} else {
		  		g_audio.seekRelative(-kSeekSeconds);
		  		OnSeek();
		  	}
			}
	  }
	  if (e.key === "ArrowRight" && !e.ctrlKey && !e.shiftKey) {
	  	if (g_playing_mp3s) {
		  	if (g_is_localhost && g_playing_demo_mp3s) {
		  		Toast("Sorry - seeking doesn't work when page is served from localhost.", 512433);
		  	} else {
		  		g_audio.seekRelative(kSeekSeconds);
		  		OnSeek();
		  	}
			}
	  }
	  if ((e.key === "z" || e.key === "Z") && !e.ctrlKey) {
	  	if (g_playing_mp3s) {
	  		PrevTrack();
			}
	  }
	  if ((e.key === "b" || e.key === "B") && !e.ctrlKey) {
	  	if (g_playing_mp3s) {
	  		NextTrack();
			}
	  }
	  if (e.key === "ArrowUp") {
	  	if (g_playing_mp3s) {
		  	g_volume = Math.max(kMinVol, Math.min(kMaxVol, g_volume * kVolChange));
	  		g_audio.setVolume(g_volume);
	  		Toast(`Volume set to ${g_volume.toFixed(3)}`, 713432); 
	  	}
	  }
	  if (e.key === "ArrowDown") {
	  	if (g_playing_mp3s) {
		  	g_volume = Math.max(kMinVol, Math.min(kMaxVol, g_volume / kVolChange));
	  		g_audio.setVolume(g_volume);
	  		Toast(`Volume set to ${g_volume.toFixed(3)}`, 713432); 
	  	}
	  }
	  // Note: Avoid using Ctrl+F, as it pops up a dialog on Firefox.
	  if ((e.key === "f" || e.key === "F") && !e.ctrlKey && e.shiftKey) {
	  	g_frozen = !g_frozen;
  		Toast(g_frozen ? "Image frozen for study" : "Animation resumed", 3424123, 3.0);
	  }
	  // [amp] F is handled by amp's visualizer window (native macOS
	  // fullscreen via tiny.win.fullscreen); the DOM fullscreen API this
	  // branch uses isn't available in the WKWebView host.
	  if ((e.key === "f" || e.key === "F") && !e.ctrlKey && !e.shiftKey && !window.GeissAmpConfig) {
	  	if (!document.fullscreenElement) {
	  		Toast("Press F or ESC to exit fullscreen mode", 6431534, 3.0);
	  	}
	  	toggleFullscreen();
	  }
	  //if ((e.key === "g" || e.key === "G") && !e.ctrlKey) {
	  //  g_toggle_grid_dots = true;
	  //}
	  //if (e.key === "g" && !e.ctrlKey) {
	  //	g_xy_oscilloscope_gap = Math.max(8, (g_xy_oscilloscope_gap * 7 / 8) | 0);
	  //	Toast(`xy_oscilloscope_gap ${g_xy_oscilloscope_gap}`, 724664);
	  //}
	  //if (e.key === "G" && !e.ctrlKey) {
	  //	g_xy_oscilloscope_gap = Math.min(512, (g_xy_oscilloscope_gap * 9 / 8) | 0);
	  //	Toast(`xy_oscilloscope_gap ${g_xy_oscilloscope_gap}`, 724664);
	  //}
	  if (e.key === "e" && !e.ctrlKey) {
	  	g_brightness *= Math.pow(2.0, -0.1);
			Toast(`Brightness adjusted to ${g_brightness.toFixed(2)}x`, 451342);
	  }
	  if (e.key === "E" && !e.ctrlKey) {
	  	g_brightness *= Math.pow(2.0, 0.1);
			Toast(`Brightness adjusted to ${g_brightness.toFixed(2)}x`, 451342);
	  }
	  if ((e.key === "d" | e.key === "D") && !e.ctrlKey) {
	  	g_darkening += (e.key === "d") ? -0.1 : 0.1;
	  	g_darkening = Math.max(-1.0, Math.min(1.0, g_darkening));
			Toast(`Darkening adjusted to ${g_darkening.toFixed(1)}x`, 5831722);
	  }
	  if ((e.key === "[") && !e.ctrlKey) {
			g_user_transition_speed *= Math.pow(2.0, -0.5);
			g_user_transition_speed = Math.max(g_user_transition_speed, Math.pow(2.0, -17));
			if (g_user_transition_speed < 1.0) {
				Toast(`Transition speed adjusted to ${g_user_transition_speed.toFixed(5)}x`, 643261);
			} else {
				Toast(`Transition speed adjusted to ${g_user_transition_speed.toFixed(1)}x`, 643261);				
			}
	  }
	  if ((e.key === "]") && !e.ctrlKey) {
			g_user_transition_speed *= Math.pow(2.0, 0.5);
			g_user_transition_speed = Math.min(g_user_transition_speed, 16.0);
			if (g_user_transition_speed < 1.0) {
				Toast(`Transition speed adjusted to ${g_user_transition_speed.toFixed(5)}x`, 643261);
			} else {
				Toast(`Transition speed adjusted to ${g_user_transition_speed.toFixed(1)}x`, 643261);				
			}
	  }
	  if ((e.key === "-" || e.key === "_") && !e.ctrlKey) {
			g_motion_scale *= Math.pow(2.0, -0.25);
			g_motion_scale = Math.max(kMinMotionScale, Math.min(kMaxMotionScale, g_motion_scale));
			Toast(`Motion speed adjusted to ${g_motion_scale.toFixed(3)}x`, 532432);
	  }
	  if ((e.key === "+" || e.key === "=") && !e.ctrlKey) {
			g_motion_scale *= Math.pow(2.0, 0.25);
			g_motion_scale = Math.max(kMinMotionScale, Math.min(kMaxMotionScale, g_motion_scale));
			Toast(`Motion speed adjusted to ${g_motion_scale.toFixed(3)}x`, 532432);
	  }
	  if (e.key === "s" && !e.ctrlKey) {
	  	g_wave_smoothing = Math.max(0, g_wave_smoothing - 1);
			Toast(`Wave smoothing adjusted to ${g_wave_smoothing}`, 682343);
	  }
	  if (e.key === "S" && !e.ctrlKey) {
	  	g_wave_smoothing = Math.min(32, g_wave_smoothing + 1);
			Toast(`Wave smoothing adjusted to ${g_wave_smoothing}`, 682343);
	  }
	  if ((e.key === "h" || e.key === "H") && e.ctrlKey) {
	  	if (!g_display_is_hdr || !g_browser_supports_hdr) {
				HdrWarning();
	  	} else {
		  	g_disable_hdr = !g_disable_hdr;
				Toast(g_disable_hdr ? "HDR disabled" : "HDR enabled", 348296);
			}
	  }
	  if (e.key === "j" && !e.ctrlKey) {
			g_wave_scale *= Math.pow(2.0, -1.0 / 3);	  	
			Toast(`Wave scale set to ${g_wave_scale.toFixed(3)}`, 468206);
			//if (g_audio_from_tab) {
			//	LocalStorageHelper.set("geiss.wave_scale.tab", g_wave_scale);
			//} else {
			//	LocalStorageHelper.set("geiss.wave_scale.mic", g_wave_scale);				
			//}
	  }
	  if (e.key === "J" && !e.ctrlKey) {
			g_wave_scale *= Math.pow(2.0, 1.0 / 3);	  	
			Toast(`Wave scale set to ${g_wave_scale.toFixed(3)}`, 468206);
			//if (g_audio_from_tab) {
			//	LocalStorageHelper.set("geiss.wave_scale.tab", g_wave_scale);
			//} else {
			//	LocalStorageHelper.set("geiss.wave_scale.mic", g_wave_scale);				
			//}
	  }
    if (e.key === "p" && !e.ctrlKey) {
	  	if (g_palette_locked) {
	  		Toast(`Can\'t randomize palette; press SHIFT+P to unlock first`, 135165);
	  	}
	  	RandomizePalette();
	  }
	  if (e.key === "P" && !e.ctrlKey) {
	  	g_palette_locked = !g_palette_locked;
			Toast(g_palette_locked ? "Palette locked" : "Palette unlocked", 583243);
	  }
	  if (e.key === "q" && !e.ctrlKey) {
	  	// Decrease resolution (increase scale)
	  	if (g_oversample > kMinOversample) {
		  	const old_oversample = g_oversample;
		  	if (g_oversample > 1.99) {
		  		g_oversample -= 1.0;
		  	} else {
		  		let scale = 1.0 / g_oversample;
		  		scale += 0.5;
		  		g_oversample = Math.max(kMinOversample, 1.0 / scale);
		  	}
		  			  	
		  	if (g_oversample != old_oversample) {
		  		OnNewOversample(old_oversample, g_oversample);
				}
			}
	  }
	  if (e.key === "Q" && !e.ctrlKey) {
	  	// Increase resolution (decrease scale)
	  	const max_oversample = Math.min(kMaxOversample, Math.floor(kMaxTextureDim / cw));
	  	if (g_oversample < max_oversample) {
		  	const old_oversample = g_oversample;
		  	if (g_oversample > 0.99) {
		  		g_oversample += 1.0;
		  	} else {
		  		let scale = 1.0 / g_oversample;
		  		scale -= 0.5;
		  		g_oversample = Math.min(max_oversample, 1.0 / scale);
		  	}
		  			  	
		  	if (g_oversample != old_oversample) {
		  		OnNewOversample(old_oversample, g_oversample);
				}
			}
	  }
	  if ((e.key === "L" || e.key === "l") && !e.ctrlKey) {
	  	if (g_palette_locked && g_wave_locked && g_motion_locked) {
	  		g_palette_locked = false;
	  		g_wave_locked = false;
	  		g_motion_locked = false;
	  		Toast(`Everything unlocked`, 179375);
	  	} else {
	  		g_palette_locked = true;
	  		g_wave_locked = true;
	  		g_motion_locked = true;
	  		Toast(`Everything locked`, 179375);
	  	}
		}
	  // [amp] space is reserved for play/pause across every amp window;
	  // amp maps randomize onto ←/→ and the bar buttons instead.
	  if (e.key === " " && !e.ctrlKey && !window.GeissAmpConfig) {
	  	Randomize();
	  }
	  if (e.key === "m" && !e.ctrlKey) {
	  	if (g_motion_locked) {
	  		Toast(`Can\'t randomize motion; press SHIFT+M to unlock first`, 862734);
	  	}
	  	RandomizeMotion();
	  }
	  if (e.key === "M" && !e.ctrlKey) {
	  	g_motion_locked = !g_motion_locked;
			Toast(g_motion_locked ? "Motion locked" : "Motion unlocked", 149323);
	  }
	  if (e.key === "w" && !e.ctrlKey) {
	  	if (g_wave_locked) {
	  		Toast(`Can\'t randomize waveform; press SHIFT+W to unlock first`, 432512);
	  	}
	  	RandomizeWave();
	  }
	  if (e.key === "W" && !e.ctrlKey) {
	  	g_wave_locked = !g_wave_locked;
			Toast(g_wave_locked ? "Waveform locked" : "Waveform unlocked", 682738);
	  }
	  if (e.key === "t" || e.key === "T") {
	  	if (e.shiftKey) {
		  	g_auto_embed_song_titles = !g_auto_embed_song_titles;
				Toast(g_auto_embed_song_titles ? "Song titles auto-paint enabled" : "Song titles auto-paint disabled", 3824576);	  		
	  	} else if (e.ctrlKey) {
		  	if (g_show_toasts) {
					Toast("Further text pop-ups will be hidden", 532653);
		  		g_show_toasts = false;
		  	} else {
		  		g_show_toasts = true;	  		
					Toast("Text pop-ups re-enabled", 532653);
		  	}
	  	} else {
				if (g_playing_mp3s) {
					g_embed_string = GetSongInfo().embed_string;
				} else if (g_external_track_title) {   // [amp] T paints the host-announced track
					g_embed_string = g_external_track_title;
				}
	  	}
	  }
	  if (e.key === "0" && !e.ctrlKey) {
	  	OnNumberKey(0);
	  }
	  if (e.key === "1" && !e.ctrlKey) {
	  	OnNumberKey(1);
	  }
	  if (e.key === "2" && !e.ctrlKey) {
	  	OnNumberKey(2);
	  }
	  if (e.key === "3" && !e.ctrlKey) {
	  	OnNumberKey(3);
	  }
	  if (e.key === "4" && !e.ctrlKey) {
	  	OnNumberKey(4);
	  }
	  if (e.key === "5" && !e.ctrlKey) {
	  	OnNumberKey(5);
	  }
	  if (e.key === "6" && !e.ctrlKey) {
	  	OnNumberKey(6);
	  }
	  if (e.key === "7" && !e.ctrlKey) {
	  	OnNumberKey(7);
	  }
	  if (e.key === "8" && !e.ctrlKey) {
	  	OnNumberKey(8);
	  }
	  if (e.key === "9" && !e.ctrlKey) {
	  	OnNumberKey(9);
	  }
	  if ((e.key === "e" || e.key == "E") && e.ctrlKey) {
	  	g_experiment = !g_experiment;
	  	Toast(`Experiment is now ${g_experiment}`, 8413461);
	  }
	  
	  // Debug keys:
	  if (e.key === "F8" && !e.ctrlKey) {
	  	g_dbg = !g_dbg;
	  	if (!g_dbg) {
	  		if (ClearOverridePalette()) {
	  			g_palette_locked = false;
	  		}
	  	}
	  	Toast(g_dbg ? "Debugging keys enabled" : "Debugging keys disabled", 696332);	  	
	  }
	  if (g_dbg) {
	  	console.log(`Key pressed: \"${e.key}\"`);
		  //console.log({
		  //  key: e.key,
		  //  code: e.code,
		  //  ctrlKey: e.ctrlKey,
		  //  metaKey: e.metaKey,
		  //  altKey: e.altKey,
		  //  shiftKey: e.shiftKey,
		  //  repeat: e.repeat,
		  //  target: e.target?.tagName,
		  //});

		  if (e.key == "y" && !e.ctrlKey) {
		  	g_align_frac = Math.max(0.2, g_align_frac - 0.05);
		  	Toast(`align_frac is now ${g_align_frac.toFixed(2)}`, 8472612);
		  }
		  if (e.key == "Y" && !e.ctrlKey) {
		  	g_align_frac = Math.min(1.0, g_align_frac + 0.05);
		  	Toast(`align_frac is now ${g_align_frac.toFixed(2)}`, 8472612);
		  }
			if ((e.key === "z" || e.key === "Z") && e.ctrlKey) {
				if (g_palette_locked && g_palette_edit_backup != null) {
			  	SetOverridePalette(g_palette_edit_backup.palette);
			  	g_palette1 = g_palette_edit_backup;
			  	g_palette2 = null;
					Toast(`Reverted palette changes`, 5892474);
				}
			}
		  if (e.key === "v" && !e.ctrlKey) {
		  	g_wave_point_size = Math.min(1.0, Math.max(0.05, g_wave_point_size - 0.05));
				Toast(`Wave point size adjusted to ${g_wave_point_size.toFixed(2)}`, 1423643);
		  }
		  if (e.key === "V" && !e.ctrlKey) {
		  	g_wave_point_size = Math.min(1.0, Math.max(0.05, g_wave_point_size + 0.05));
				Toast(`Wave point size adjusted to ${g_wave_point_size.toFixed(2)}`, 1423643);
		  }
		  if ((e.key === "v" || e.key === "V") && e.ctrlKey) {
		  	g_palette_edit_preview = !g_palette_edit_preview;
		  }
	  	if (e.key === "1" && e.ctrlKey) {
	  		g_palette_edit_index = 1;
	  	}
	  	if (e.key === "2" && e.ctrlKey) {
	  		g_palette_edit_index = 2;
	  	}
	  	if (e.key === "3" && e.ctrlKey) {
	  		g_palette_edit_index = 3;
	  	}
	  	if (e.key === "4" && e.ctrlKey) {
	  		g_palette_edit_index = 4;
	  	}
	  	if (e.key === "5" && e.ctrlKey) {
	  		g_palette_edit_index = 5;
	  	}
	  	if (e.key === "6" && e.ctrlKey) {
	  		g_palette_edit_index = 6;
	  	}
	  	if (e.key === "7" && e.ctrlKey) {
	  		g_palette_edit_index = 7;
	  	}
	  	if (e.key === "8" && e.ctrlKey) {
	  		g_palette_edit_index = 8;
	  	}
	  	if (e.key === "9" && e.ctrlKey) {
	  		g_palette_edit_index = 9;
	  	}
	  	if ((e.key === "r" || e.key === "R") && e.ctrlKey) {
	  		g_palette_edit_r = !g_palette_edit_r;
	  		Toast(`Palette editing r/g/b -> ${g_palette_edit_r ? "1" : "0"}/${g_palette_edit_g ? "1" : "0"}/${g_palette_edit_b ? "1" : "0"}`, 2068634);
	  	}
	  	if ((e.key === "g" || e.key === "G") && e.ctrlKey) {
	  		g_palette_edit_g = !g_palette_edit_g;
	  		Toast(`Palette editing r/g/b -> ${g_palette_edit_r ? "1" : "0"}/${g_palette_edit_g ? "1" : "0"}/${g_palette_edit_b ? "1" : "0"}`, 2068634);
	  	}
	  	if ((e.key === "b" || e.key === "B") && e.ctrlKey) {
	  		g_palette_edit_b = !g_palette_edit_b;
	  		Toast(`Palette editing r/g/b -> ${g_palette_edit_r ? "1" : "0"}/${g_palette_edit_g ? "1" : "0"}/${g_palette_edit_b ? "1" : "0"}`, 2068634);
	  	}
	  		  	
		  if ((e.key === "d" || e.key === "D") && e.ctrlKey) {
		  	// Show/hide the debug viz.
		  	g_dbg_viz = (g_dbg_viz + 1) % 3;
		  	dbg.style.display = (g_dbg_viz > 0) ? "block" : "none";   // or "none"/""
		  }
		  // Palette editing keys:
		  if ((e.key === "c" || e.key === "C") && e.ctrlKey) {
		  	let i = AddPalette(g_current_blended_palette);
				OverridePaletteAbs(i);
				
		  	PrintSavedPalettes();

				// Set it as the current override palette,
				// so they can adjust brightness if desired.
		  	g_palette_locked = true;
		  	g_palette1 = GetOverridePalette();
		  	g_palette2 = null;
		  	SetPaletteBlendTimes();
				Toast(`Added new palette: ${g_palette1.name}`, 453232);
		  }
			if (e.key === "x" && !e.ctrlKey) {
		  	PrintSavedPalettes();
		  }
			if (e.key === "i" && e.ctrlKey) {
				// Set previous override palette.
		  	g_palette_locked = true;
				OverridePaletteRel(-1);
		  	g_palette1 = GetOverridePalette();
		  	g_palette2 = null;
		  	g_palette_edit_backup = g_palette1;
		  	SetPaletteBlendTimes();
				Toast(`Forcing ${g_palette1.name}`, 290941);
			}
			if (e.key === "o" && e.ctrlKey) {
				// Set next override palette.
		  	g_palette_locked = true;
				OverridePaletteRel(1);
		  	g_palette1 = GetOverridePalette();
		  	g_palette2 = null;
		  	g_palette_edit_backup = g_palette1;
		  	SetPaletteBlendTimes();
				Toast(`Forcing ${g_palette1.name}`, 290941);
				return;
			}
			if (e.key === "," && !e.ctrlKey) {
				// Darken the current override palette.
				AdjustOverridePalette(1.0 / 1.05, g_palette_edit_r, g_palette_edit_g, g_palette_edit_b, 
				                      g_palette_edit_index);
				let new_palette = GetOverridePalette();
				if (new_palette != null) {
			  	g_palette1 = new_palette;
			  	g_palette2 = null;
			  	SetPaletteBlendTimes();
			  	PrintOverridePalette();
			  }
			}
			if (e.key === "." && !e.ctrlKey) {
				// Brighten the current override palette.
				AdjustOverridePalette(1.05, g_palette_edit_r, g_palette_edit_g, g_palette_edit_b, 
				                      g_palette_edit_index);
				let new_palette = GetOverridePalette();
				if (new_palette != null) {
			  	g_palette1 = new_palette;
			  	g_palette2 = null;
			  	SetPaletteBlendTimes();
			  	PrintOverridePalette();
			  }
			}			
		}
	  if ((e.key === "c" || e.key === "C") && !e.ctrlKey) {
			if (g_playing_mp3s) {
		  	let now_playing = g_audio.togglePause();
		  	let toast = now_playing ? "Playback resumed" : "Playback paused";
		  	Toast(toast, 7538623, now_playing ? 2.0 : 3.0);
		  }
	  }
		if ((e.key === "l" || e.key === "L") && e.ctrlKey && !window.GeissAmpConfig) {  // [amp] amp's playlist owns file loading
	    e.preventDefault();
    	local_file_input.click();
	  }
		if ((e.key === "i" || e.key === "I") && !e.ctrlKey) {
			// Just show the song name and time toast.
			if (g_show_song_name && g_show_song_time) {
				g_show_song_name = false;
			} else if (g_show_song_name && !g_show_song_time) {
				g_show_song_time = true;
			} else if (!g_show_song_name && g_show_song_time) {
				g_show_song_time = false;
			} else {
				g_show_song_name = true;
			} 
			g_show_song_name_end_time = -1;
			g_show_song_time_end_time = -1;
		}
	});
	
	function render() {		
		// Update time.
		g_prev_time = g_time;
		g_time = performance.now() * 0.001;
		
		const render_start_time = g_time;
		
		if (g_frame == 0) {
			// First frame will be slow due to init stuff; spoof frame time.
			g_prev_time = g_time - 1.0 / 60;
		}
    let dt = 
    		Math.min(0.2, Math.max(0.001, g_time - g_prev_time));
    const freeze_anim_clocks = g_playing_mp3s && (g_audio.isPaused() || g_frozen);
		if (!g_palette_locked && !freeze_anim_clocks) {
			g_palette_time += dt * g_user_transition_speed;
		}
		if (!g_motion_locked && !freeze_anim_clocks) {
			g_motion_time += dt * g_user_transition_speed;
		}
		if (!g_wave_locked && !freeze_anim_clocks) {
			g_wave_time += dt * g_user_transition_speed;
		}
		// For the shift effect, allow it to slow down, but not speed up.
		g_shift_time += dt * Math.min(g_user_transition_speed, 1.0);
    
    // Update fps from a circular buffer of 'dt' values.
    {
	    g_frame_dt_buffer[g_frame_dt_buffer_pos] = dt;
	    g_frame_dt_buffer_pos = (g_frame_dt_buffer_pos + 1) % g_frame_dt_buffer.length;
			let dt_sum = 0.0;
			for (let i = 0; i < g_frame_dt_buffer.length; i++) {
				dt_sum += g_frame_dt_buffer[i];
			}
			let renders_per_second = 1.0 / (dt_sum / g_frame_dt_buffer.length);    
			g_renders_per_second = g_renders_per_second * 0.95 + 0.05 * renders_per_second;
		}

		if (g_time > g_show_song_name_end_time && g_show_song_name_end_time >= 0) {
			g_show_song_name = false;
			g_show_song_name_end_time = -1;
		}
		if (g_time > g_show_song_time_end_time && g_show_song_time_end_time >= 0) {
			g_show_song_time = false;
			g_show_song_time_end_time = -1;
		}
				
		if (g_frame == 0) {
			// Initial palette:
			g_palette1 = GenerateRandomPalette();
			g_palette2 = null;
			SetPaletteBlendTimes();

			//if (!g_display_is_hdr) {
			//	HdrWarning();
			//}		
			Toast("Press H for help", 624362, 5.0);
		}

		//if (g_frame == 300) {
		//	if (g_is_safari && g_renders_per_second > 50.0 && g_renders_per_second < 70.0) {
		//		Toast("Warning: Framerate in Safari seems to be stuck at 60 hz.\nTo Fix, disable the 'Prefer Page Rendering Updates near 60fps'\nfeature flag, which is set by default, and then restart your browser.", 5412352, 12.0);
		//	}
		//}



		// Animated blend between the 2 palettes.
		{
			let t = GetCurrentPaletteBlend();

			if (t > 0.0 && g_palette2 == null) {
				g_palette2 = GenerateRandomPalette();
			}
	
			if (t >= 1.0) {
				// Start blending to a new color palette.			
				g_palette1 = g_palette2;
				g_palette2 = null;
		  	SetPaletteBlendTimes();
				t = 0;
			}

			// If we're editing a palette and the preview is off,
			// revert to the backup snapshot of the palette.
			let palette1 = g_palette1;
			let palette2 = g_palette2;
			if (!g_palette_edit_preview) {
				t = 0;
				palette1 = g_palette_edit_backup;
				palette2 = null;
			}
			
			// Sample and maybe blend the root palette(s).
			if (t < 0.00001) {
				// Use palette1 only.
				for (let i = 0; i < 256; i++) {
					let s = i * (1.0 / 255.0);
					let color = SamplePalette(palette1.palette, s);
					g_engine.paletteRGBA[i * 4 + 0] = color.r;
					g_engine.paletteRGBA[i * 4 + 1] = color.g;
					g_engine.paletteRGBA[i * 4 + 2] = color.b;
					g_engine.paletteRGBA[i * 4 + 3] = 1.0;
				}
			} else {
				// Blend between two palettes.
				for (let i = 0; i < 256; i++) {
					let s = i * (1.0 / 255.0);
					let color1 = SamplePalette(palette1.palette, s);
					let color2 = SamplePalette(palette2.palette, s);
					let r = (color1.r * (1 - t) + color2.r * t);
					let g = (color1.g * (1 - t) + color2.g * t);
					let b = (color1.b * (1 - t) + color2.b * t);
					g_engine.paletteRGBA[i * 4 + 0] = r;
					g_engine.paletteRGBA[i * 4 + 1] = g;
					g_engine.paletteRGBA[i * 4 + 2] = b;
					g_engine.paletteRGBA[i * 4 + 3] = 1.0;
				}
			}

			// Scale by g_brightness, clamp, and measure max value.
			// Don't let palette colors exceed this amount.
			// We limit this to ~3 because even if HDR displays support
			//   more than 3x brightness over SDR, we don't want to use
			//   that much -- it would hurt your eyes.
			const enforced_max_value = 3.0;
			let max_value = 0.0;
			for (let i = 0; i < 256; i++) {
				let r = g_engine.paletteRGBA[i * 4 + 0] * g_brightness;
				let g = g_engine.paletteRGBA[i * 4 + 1] * g_brightness;
				let b = g_engine.paletteRGBA[i * 4 + 2] * g_brightness;
				r = Math.min(r, enforced_max_value);
				g = Math.min(g, enforced_max_value);
				b = Math.min(b, enforced_max_value);
				g_engine.paletteRGBA[i * 4 + 0] = r;
				g_engine.paletteRGBA[i * 4 + 1] = g;
				g_engine.paletteRGBA[i * 4 + 2] = b;
				g_engine.paletteRGBA[i * 4 + 3] = 1.0;
				max_value = Math.max(Math.max(r, g), Math.max(b, max_value));
			}				

			// Remap to SDR if needed.						
			const remap_to_sdr = (!g_display_is_hdr || !g_browser_supports_hdr || g_disable_hdr);
			if (remap_to_sdr) {
				// Squeeze the palette down to SDR.
				for (let i = 0; i < 256; i++) {
					let t = i * (1.0 / 255);
					let r = g_engine.paletteRGBA[i * 4 + 0];
					let g = g_engine.paletteRGBA[i * 4 + 1];
					let b = g_engine.paletteRGBA[i * 4 + 2];
					let col = HdrToSdr(t, r, g, b, max_value, g_experiment);
					g_engine.paletteRGBA[i * 4 + 0] = col[0];
					g_engine.paletteRGBA[i * 4 + 1] = col[1];
					g_engine.paletteRGBA[i * 4 + 2] = col[2];
				}
			}
						
			//g_presenter.uploadPaletteFP16(g_engine.paletteRGBA);
			g_presenter.uploadPaletteRGBA8UNorm(g_engine.paletteRGBA);

			g_current_blended_palette = g_engine.paletteRGBA;
		}

  	if (g_playing_mp3s && g_audio.songHasEnded()) {
  		NextTrack();
		}

		if (g_audio.isPrevSongRequested()) {
			PrevTrack();
		}
		if (g_audio.isNextSongRequested()) {
			NextTrack();
		}

    //const a = audio.getFrame(); // waveform-only
		const audio_frame = g_audio.getFrame({
			waveScale : g_wave_scale,
		  wantWave: true,
		  wantSpec: true,
		  bandsHz: g_level_bands
		});
				
		for (let b = 0; b < BANDS; b++) {			
			// Update immediate absolute levels.
			// (Note that the underlying spectrum was already adjusted to be perceptually uniform.)
			g_vol_imm[b] = Math.max(g_min_level, audio_frame.bandEnergy[b]);
		}

		// Updates g_vol_rel_damped[][] from g_vol_imm[].
		UpdateDampedVolumes(g_frame, dt);

		g_time_since_beat += dt;
 	  const r = g_beat_detector.update(g_frame, g_renders_per_second, 
         g_vol_imm[BASS_BAND], g_vol_rel_damped[VOL_FOR_BEAT_DET][BASS_BAND],
         g_vol_imm[VOL_BAND],  g_vol_rel_damped[VOL_FOR_BEAT_DET][VOL_BAND]);
    let beat = false;
 	  if (g_frame > 50 && r.beat) {
		  g_time_since_beat = 0.0;
		  beat = true;
		}



		if (g_dbg_viz > 0) {
			let x00 = 4;
			let y00 = 4;

			// Draw debug viz layer.
			dctx.clearRect(0, 0, dbg.width, dbg.height);

			if (g_dbg_viz >= 2) {
				// Draw the spectrum.
				for (let b = 0; b < 3; b++) {
				  dctx.beginPath();
					dctx.globalAlpha = 1;
					dctx.strokeStyle = g_band_colors[b];
			  	const f0 = g_level_bands[3].f0;
			  	const f1 = g_level_bands[3].f1;
			  	const log_f0 = Math.log(f0) / Math.log(10);
			  	const log_f1 = Math.log(f1) / Math.log(10);
			  	const spectrum_width = 400;
			  	const nyquist = 22500.0;  // TODO: Don't hardcode/assume this.
				  for (let x = 0; x < spectrum_width; x++) {
				  	let t = x * (1.0 / (spectrum_width - 1));		// [0..1]
				  	let f = Math.pow(10, log_f0 + (log_f1 - log_f0) * t);
				  	if (f >= g_level_bands[b].f0 && f <= g_level_bands[b].f1) {
					  	let i = Math.max(0, Math.min(audio_frame.spectrum.length - 1, (f * (1.0 / nyquist) * audio_frame.spectrum.length) | 0));				  			  	
					    dctx.moveTo(x, dbg.height - 4 - 1 - audio_frame.spectrum[i] * (15 / g_vol_rel_damped[0][VOL_BAND]));
					    dctx.lineTo(x, dbg.height - 4);
				  	}
				  }
				  dctx.stroke();			
				  dctx.globalAlpha = 1;
				}
			}

//g_vol_imm[BANDS]
//g_vol_rel_damped[VOL_SPEED_COUNT][_BAND]

			const bkg_box_opacity = 0.92;
			
			if (g_dbg_viz >= 2) {
				// Draw circles for immediate band levels.
				const circle_spacing = (Math.max(dbg.width, dbg.height) / 26) | 0;
				const scale = 0.1 * circle_spacing;
				for (let b = 0; b < BANDS; b++) {
					const yc = circle_spacing * (2 + b * 2);
					const y0 = yc - circle_spacing;
					const y1 = yc + circle_spacing;
	
					// Draw transparent background.					
					let bkg_color = 0;//(beat_b == b) ? 40 : 0;
					dctx.fillStyle = `rgba(${bkg_color}, ${bkg_color}, ${bkg_color}, ${bkg_box_opacity})`;
					dctx.fillRect(0, y0, circle_spacing * (VOL_SPEED_COUNT * 2 + 1), y1 - y0);	
					y00 = Math.max(y1, y00) + 4;
					dctx.globalAlpha = 1;
	
					for (let v = 0; v < VOL_SPEED_COUNT; v++) {
						//const vol = g_vol_rel_damped[v][b] * 100;// / g_vol_rel_damped[0][b];
						const vol = g_vol_imm[b] / g_vol_rel_damped[v][b];
	
						const r = vol * scale;
						
						// Draw the immediate relative level circle on the left.
						//DrawCircle(circle_spacing, yc, circle_spacing, "black", 0.5);
						const xc = circle_spacing * 2 * (v + 1);
						DrawCircle(xc, yc, r, g_band_colors[b], 1);
					}
	
					// Draw text.				  
				  dctx.font = "14px sans-serif";
					dctx.fillStyle = "white";
					dctx.textAlign = "left";     // left | center | right
					dctx.textBaseline = "top";   // top | middle | alphabetic | bottom
					dctx.fillText(g_level_bands[b].name, 4, y0 + 4);
				}
			}
			
		  dctx.font = "18px sans-serif";
			dctx.fillStyle = "white";
			dctx.textAlign = "left";     // left | center | right
			dctx.textBaseline = "top";   // top | middle | alphabetic | bottom
			
			if (g_time_since_beat < 0.05) {
				dctx.fillText("BEAT!", 4, 4);
			}

			// Show modes & weights.		
			let lines = g_engine.GetMotionDebugInfo(g_motion_time);
			lines.push(GetCurrentPaletteDesc());
			dctx.font = "14px Menlo";
			dctx.fillStyle = "white";
			dctx.textAlign = "left";     // left | center | right
			dctx.textBaseline = "top";   // top | middle | alphabetic | bottom
			for (let i = 0; i < lines.length; i++) {
				let text = lines[i];
				const m = dctx.measureText(text);
				const w = m.width;
				const h = 20;//(m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) || 16;
				const pad = 2;

				dctx.fillStyle = `rgba(0,0,0,${bkg_box_opacity})`;
				dctx.fillRect(x00, y00, w + pad * 2, h + pad * 2);
				dctx.fillStyle = "white";
				dctx.fillText(text, x00 + pad, y00 + pad);
				y00 += h + pad * 2;
			}
	
			/*
			// Draw the palette colors.   --> skip here; can only do SDR rendering here.
			const swatch_size = 24;
			const swatch_margin = 2;
			for (let i = 0; i < 8; i++) {
				let s = i * (1.0 / 7.0);
				let color = SamplePalette(g_palette1.palette, s);
				let x = swatch_size * i + swatch_margin * (i + 1);
				dctx.fillStyle = `rgba(${color.r * 255}, ${color.g * 255}, ${color.b * 255}, 1.0)`;
				dctx.fillRect(x, y00, swatch_size, swatch_size);	
			}			
			*/
		}		

    
    
    
    g_engine.update(dt, audio_frame);
    g_engine.render(
    		g_time, g_motion_time, g_wave_time, g_shift_time, g_frame, 
    		g_randomize_motion, g_randomize_wave, g_renders_per_second, g_wave_smoothing, g_wave_point_size, 
    		g_xy_oscilloscope_gap, beat, g_motion_scale, g_frozen, g_experiment, g_embed_string, g_darkening, g_align_frac, 
    		g_toggle_grid_dots, g_toggle_fading_dots, g_toggle_random_beat_dots, g_toggle_radial_beat_dots,    		
    		"this_is_the_last_param");
    g_randomize_motion = false;
    g_randomize_wave = false;
    g_toggle_grid_dots = false;
    g_toggle_fading_dots = false;
    g_toggle_random_beat_dots = false;
    g_toggle_radial_beat_dots = false;
    g_embed_string = "";

    //g_presenter.uploadIndex(g_engine.front);
    let palette_swatch_count = 0;
    if (g_dbg) {
    	palette_swatch_count = g_palette1.palette.length / 4;
    }
    g_presenter.draw(palette_swatch_count);

		let hud_text = "";

		// Note: The song info has to go first (above help screen)
		// because there is are special, hyperlinkable "license" UI
		// elements that live above it.
		let x = GetSongInfo();
		if (g_show_song_name && g_playing_demo_mp3s && x.license_text != "") {
			license_prefix.textContent = x.license_prefix;
			license_link.textContent = x.license_text;
			license_link.href = x.license_link;
			license_suffix.textContent = x.license_suffix;
		  license_line.style.display = "";		   // Show the license line.
		} else {
			license_prefix.textContent = "";
			license_link.textContent = "";
			license_link.href = "";
			license_suffix.textContent = "";
		  license_line.style.display = "none";		// Hide the whole line.
		}
    
		// Draw song info.
		if (g_playing_mp3s && (g_show_song_name || g_show_song_time)) {
			if (hud_text.length > 0) {
				hud_text += `\n`;
			}
						
			if (g_show_song_name) {
				if (g_show_song_time) {
					hud_text += x.song_name + `\n` + GetSongTime();
				} else {
					hud_text += x.song_name;
				}
			} else if (g_show_song_time) {
				hud_text += GetSongTime();
			}
		}

		if (!g_palette_edit_preview) {
    	hud_text += `*** Showing original palette.  Hit CTRL+V or ESC to go back. ***`;
		}
    
    if (g_show_help) {
			if (hud_text.length > 0) {
				hud_text += `\n\n`;
			}
    	hud_text += help_screen_1;
    	if (g_playing_mp3s) {
	    	hud_text += help_screen_2;
	    }
    	hud_text += help_screen_3;
    	if (g_playing_mp3s) {
	    	hud_text += help_screen_4;
	    }

			const locked = `${g_white_text}Locked${g_end_color}`;
		 	const unlocked = `${g_grey_text}Unlocked${g_end_color}`;

			hud_text += `
  ${g_grey_text}
  ${g_white_text}            random:   [un]lock:${g_end_color}
  ${g_white_text}all 3:   ${g_end_color}   SPACE     L
  ${g_white_text}motion:  ${g_end_color}   m         M      ${g_motion_locked ? locked : unlocked}
  ${g_white_text}palette: ${g_end_color}   p         P      ${g_palette_locked ? locked : unlocked}
  ${g_white_text}waveform:${g_end_color}   w         W      ${g_wave_locked ? locked : unlocked}${g_end_color}`;

	    hud_text += `\n\n${g_white_text}Info:${g_end_color}\n`;
	    hud_text += g_grey_text;
	    hud_text += `  Version:     Geiss HDR v${g_version}\n`;
	    hud_text += `  Window res:  ${cw}x${ch} (${(g_display_is_hdr && g_browser_supports_hdr && !g_disable_hdr) ? "HDR" : "SDR"})\n`;
	    let scale_text = "";
			if (g_oversample >= 1.001) {
				scale_text = ` (${(g_oversample).toFixed(0)}x)`;
	    }
	    if (g_oversample <= 0.999) {
	    	scale_text = ` (${(g_oversample).toFixed(2)}x)`;
	    }
	    hud_text += `  Buffer res:  ${iw}x${ih}${scale_text}\n`;
	    hud_text += `  Repaint hz:  ${g_raf_hz.toFixed(1)}\n`;
	    hud_text += `  Render hz:   ${g_renders_per_second.toFixed(1)}  (Target: ${TARGET_FPS|0})\n`;
	    const idle_percent = 100 - Math.min(100, Math.round(g_renders_per_second * g_average_render_time_seconds * 100) | 0);
	    hud_text += `  Idle time:   ${idle_percent}%${g_end_color}`;
    }
		
		// Draw toast(s)
		let new_toasts = [];
		for (let i = 0; i < g_toasts.length; i++) {
			if (g_time < g_toasts[i].end_time) {
				if (hud_text.length > 0) hud_text += '\n\n';
	    	hud_text += g_toasts[i].message;
	    	new_toasts.push(g_toasts[i]);
			}
		}
		g_toasts = new_toasts;

		// Hide the HUD if the status box is empty.
		const empty = hud_text.trim().length === 0;
		hud.style.display = empty ? "none" : "block";		

		statusEl.textContent = hud_text;

		// This allows the embedded <spans> to work.
		statusEl.innerHTML = hud_text;
  
	  statusEl.style.fontSize = "12px";

		g_frame++;
	
		//spin_wait_ms(4);//UNDO
			
	  // Keep track of how slow/fast our raw rendering is.
		const render_end_time = performance.now() * 0.001;
		const render_dt = render_end_time - render_start_time;
    g_render_dt_buffer[g_render_dt_buffer_pos] = render_dt;
    g_render_dt_buffer_pos = (g_render_dt_buffer_pos + 1) % g_render_dt_buffer.length;
  				
    let dt_sum = 0.0;
    let sample_count = 0;
    for (let i = 0; i < Math.min(g_render_dt_buffer.length, g_frame); i++) {
			dt_sum += g_render_dt_buffer[i];
			sample_count++;
    }
    g_average_render_time_seconds = (dt_sum / sample_count);   
    //console.log(g_average_render_time_seconds);		// 0.0005 ms!!!
 	}	// end of render()

  function frame(t) {

		if (!g_ok_to_start) {
			// Wait until user loads a local mp3 before we try to start the graphics/audio.
			requestAnimationFrame(frame);
			return;
		}

		// [amp] engine switched away: keep the rAF loop alive but do no work,
		// so switching back is instant and costs nothing while hidden.
		if (window.GeissAmpConfig && !window.GeissAmpConfig.active) {
			g_last_raf_time = -1;   // don't count hidden time against the fps stats
			requestAnimationFrame(frame);
			return;
		}

    // Track the FPS of the raw RAF calls.    
		// For chrome this is usually 120 hz; others 60 hz.
    {
    	const time_now = t * 0.001;		// ~now in seconds

			if (g_last_raf_time < 0) {
			  g_last_raf_time = time_now;			
			} else {
		    const raf_dt = time_now - g_last_raf_time;
			  g_last_raf_time = time_now;
	
		    if (raf_dt < 0.1) {                // Ignore any long pause e.g. from switching windows
					g_raf_calls++;
			    g_raf_dt_buffer[g_raf_dt_buffer_pos] = raf_dt;
			    g_raf_dt_buffer_pos = (g_raf_dt_buffer_pos + 1) % g_raf_dt_buffer.length;
			  }
		  				
		    let dt_sum = 0.0;
		    let sample_count = 0;
		    for (let i = 0; i < Math.min(g_raf_dt_buffer.length, g_raf_calls); i++) {
					dt_sum += g_raf_dt_buffer[i];
					sample_count++;
		    }
		    g_raf_hz = 1.0 / (dt_sum / sample_count);   
		    //console.log(g_raf_hz);
		  }
		}

		const first_render_start_time = performance.now() * 0.001;

		render();

		const render_time_elapsed = performance.now() * 0.001 - first_render_start_time;

		// Increase internal render rate for low RAF hz
		// --------------------------------------------
		// Our animation is tuned ot look best at 120 hz, and if the GPU
		//   is fast (which it usually is), we can achieve 120 hz animation
		//   even if the paint rate is low (30, 50, 60 hz) -- 
		//   by rendering multiple times per frame.
		// If we're being called at a low rate like 30 or 50 or 60 hz, 
		//   but we could easily internally render at double that
		//   120 hz, then pause until the appropriate time has passed,
		//   has passed, and then render again.
		//console.log(g_frame, g_raf_hz, 1.0 / g_average_render_time_seconds);	//UNDO
		const max_render_hz = 1.0 / g_average_render_time_seconds;
		// [amp] noSubframes: as the rack's background this spin-wait catch-up
		// fights the page's own frame work for the main thread and drags rAF
		// down further — one render per frame there, the author's 120 Hz
		// chase stays on for the standalone viz window.
		if (g_frame > 50 &&
				!(window.GeissAmpConfig && window.GeissAmpConfig.noSubframes) &&
				g_raf_hz != 0.0 &&
				g_raf_hz < TARGET_FPS * 0.65 &&
				max_render_hz > g_raf_hz * 2.5) {
			
			const renders_per_frame = Math.min(10, Math.round(TARGET_FPS / g_raf_hz - 0.25));
			if (renders_per_frame > 1) {
				// Try to render N times per RAF call, but evenly spaced in time.
				const ideal_time_between_renders = 1.0 / (g_raf_hz * renders_per_frame);
				for (let i = 1; i < renders_per_frame; i++) {
					const ideal_render_start_time = 
							first_render_start_time + i * ideal_time_between_renders;
					const sleep_time = ideal_render_start_time - performance.now() * 0.001;
					if (sleep_time > 0) {
						//console.log(`subframe ${i+1}/${renders_per_frame}: sleeping for ${(sleep_time * 1000).toFixed(1)} ms`);
						spin_wait_ms(sleep_time * 1000);
					}
					render();				
				}
			}
		}
		
		//let t1 = performance.now();
		//let loops = spin_wait_ms(1.0);
		//let t2 = performance.now();
		//console.log(`looped ${loops} times to get a ${t2 - t1} ms delay`);

    requestAnimationFrame(frame);
  }
  
  requestAnimationFrame(frame);
}

startMicBtn.addEventListener("click", async () => {
	Start(0);
});

startTabBtn.addEventListener("click", async () => {
	Start(1);
});

startDemoBtn.addEventListener("click", async () => {
	Start(2);
});

if (startRemoteMp3Btn != null) startRemoteMp3Btn.addEventListener("click", async () => {
	Start(3);
});

startLocalMp3Btn.addEventListener("click", async () => {
	Start(4);
});

// [amp] external-audio mode. The host page (amp's visualizer window) defines
// window.GeissAmpConfig before this script loads, then calls .start() when the
// user switches to this engine. Audio comes in as an existing WebAudio source
// node (amp's silent twin of the playing track) instead of any of the
// mic/tab/mp3 flows above. .active gates rendering + input handlers so amp
// can switch engines without tearing this one down.
if (window.GeissAmpConfig) {
	window.GeissAmpConfig.start = async () => {
		// [amp] the host probed HDR canvas support before calling start();
		// honor it here so OnAudioSourceSelected's try_hdr picks it up.
		if (window.GeissAmpConfig.allowHdr) {
			g_browser_supports_hdr = true;
			g_disable_hdr = !(g_display_is_hdr && g_browser_supports_hdr);
		}
		OnSelectAudioSource();
		const { ctx, srcNode } = window.GeissAmpConfig.getAudio();
		g_audio.startExternal(ctx, srcNode);
		g_ok_to_start = true;
		await OnAudioSourceSelected();
		return true;
	};
	window.GeissAmpConfig.randomize = () => Randomize();
	// [amp] track-change hook: the engine decides what to do with it — with
	// auto-paint on (default; SHIFT+T toggles) the title is painted into the
	// image exactly like their own OnNewTrack flow, and T repaints on demand.
	window.GeissAmpConfig.setTrackTitle = (title) => {
		g_external_track_title = String(title || "");
		if (g_auto_embed_song_titles && g_external_track_title) {
			g_embed_string = g_external_track_title;
		}
	};
}

