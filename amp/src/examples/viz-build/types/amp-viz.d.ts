// amp-viz.d.ts — the type of a visualizer plugin.
//
// A plugin is one file that runs in a worker with no DOM, no bridge and no
// network (see src/docs/20-visualizers.md). This file describes the two things
// it talks to: the `amp` global it registers itself with, and the audio it is
// handed every frame.
//
// Point your editor at it and you get completion for the whole surface:
//
//   // @ts-check
//   /// <reference path="../../types/amp-viz.d.ts" />
//
// or list it in a tsconfig/jsconfig "types". There is no runtime here — it is
// declarations only, and nothing imports it.

declare namespace AmpViz {
  /** Which renderer a plugin can be given. amp picks the first one this
   *  machine actually has, from the list in viz.json. */
  type Backend = 'webgpu' | 'webgl2' | '2d';

  /** The audio snapshot, rebuilt every frame from amp's own analysis. All the
   *  0..1 values are already smoothed for drawing with. */
  interface Audio {
    /** 256 frequency bins, 0..255. Bin i is roughly i × 47 Hz. */
    readonly fft: Uint8Array;
    /** 1024 waveform samples, 0..255, where 128 is silence. */
    readonly wave: Uint8Array;

    /** Seconds since this plugin started. */
    readonly t: number;
    /** Seconds since the last frame. Clamp it: a backgrounded window can
     *  hand you a big one. */
    readonly dt: number;

    /** Band energy, 0..1. */
    readonly bass: number;
    readonly mid: number;
    readonly treb: number;
    /** Overall level and recent peak, 0..1. */
    readonly level: number;
    readonly peak: number;
    /** K-weighted loudness, 0..1 — closer to how loud it SOUNDS than level is. */
    readonly loudness: number;
    /** The transient: something just happened. 0..1, decays fast. */
    readonly punch: number;

    /** True on the ONE frame a beat lands. */
    readonly beat: boolean;
    /** Band-limited beats, same one-frame rule. */
    readonly kick: boolean;
    readonly snare: boolean;
    readonly hat: boolean;
    /** Counts up, one per beat. */
    readonly beatIndex: number;
    /** 0..1 toward the NEXT beat — for anticipating rather than reacting. */
    readonly beatPhase: number;
    /** Seconds since the last beat. 9 means "no idea". */
    readonly since: number;
    /** Detected tempo, and how much to believe it (0..1). */
    readonly bpm: number;
    readonly confidence: number;

    readonly playing: boolean;
    /** Position and length of the track, in seconds. 0 for a live stream. */
    readonly elapsed: number;
    readonly duration: number;
  }

  interface CreateArgs {
    /** Yours to draw on. Already sized, already at the right device pixel
     *  ratio — do not resize it yourself. */
    canvas: OffscreenCanvas;
    /** The backend amp actually picked, which may not be your first choice. */
    backend: Backend;
    /** True if the window is on an HDR display AND your viz.json asked for it. */
    hdr: boolean;
    width: number;
    height: number;
    dpr: number;
    /** The string this plugin saved last time, or null. See amp.save(). */
    state: string | null;
    /** The first audio snapshot, if you want to size something off it. */
    audio: Audio;
  }

  interface FrameArgs {
    audio: Audio;
    t: number;
    dt: number;
    width: number;
    height: number;
  }

  interface TrackInfo {
    title?: string;
    artist?: string;
    album?: string;
    /** Seconds; 0 for a live stream. */
    duration?: number;
  }

  interface TransportEvent {
    type: 'play' | 'pause' | 'ended' | 'seek';
    elapsed?: number;
  }

  interface InputEvent {
    type: 'keydown' | 'keyup';
    /** KeyboardEvent.key, and ONLY the keys viz.json's "input" asked for. */
    key: string;
    repeat: boolean;
  }

  /** What create() returns. Only frame() is required. */
  interface Instance {
    /** One frame. amp calls this at 60 fps; do not run your own loop. */
    frame(args: FrameArgs): void;
    /** The canvas is ALREADY the new size when this is called. */
    resize?(width: number, height: number): void;
    /** 🎲. Return a name and amp shows it. */
    randomize?(): string | void;
    /** ‹ and ›: n is +1 or -1. amp also calls this with an index. */
    preset?(n: number): void;
    /** A different track started. Fires on a real change, not once a second. */
    track?(info: TrackInfo): void;
    transport?(ev: TransportEvent): void;
    /** Only fires for the keys viz.json declared in "input". */
    input?(ev: InputEvent): void;
    /** The viz window was hidden or shown. amp stops calling frame() when
     *  hidden regardless; this is for pausing anything else you run. */
    active?(on: boolean): void;
    /** Overrides the backend name amp shows in the corner. */
    backend?: string;
  }

  interface Definition {
    name: string;
    /** Best first. amp picks the first one this machine has. */
    backends?: Backend[];
    /** A non-empty list makes amp show the ‹ › buttons. */
    presets?: string[];
    create(args: CreateArgs): Instance | Promise<Instance>;
  }

  interface Amp {
    /** Call this once, at the top level of your file. */
    register(def: Definition): void;
    /** Goes to the viz lab's log pane. There is no console in here. */
    log(...args: unknown[]): void;
    /** Flash a line over the visualizer. */
    osd(text: string): void;
    /** Replace the preset list amp shows. */
    presets(list: string[]): void;
    /** ONE string, 64 KB, yours alone. Handed back to create() as `state`.
     *  Writes are debounced. */
    save(value: unknown): void;
    /** The same string, if you would rather ask than take it from create(). */
    load(): Promise<string | null>;
    /** The backend you got. */
    readonly backend: Backend;
    readonly hdr: boolean;
    readonly width: number;
    readonly height: number;
    readonly dpr: number;
    now(): number;
  }
}

declare const amp: AmpViz.Amp;

/** amp injects its own copy of three when your source says `// amp:uses three`,
 *  as a global — you never import it, which is why `three` is only ever a
 *  devDependency in a plugin project. This is the WEBGPU build, so it is
 *  `three/webgpu` these types come from: WebGPURenderer, node materials and
 *  THREE.TSL, and NO WebGLRenderer. */
declare const THREE: typeof import('three/webgpu') & {
  TSL: typeof import('three/tsl');
};

/** `// amp:uses p5` */
declare const p5: any;
/** `// amp:uses q5` */
declare const Q5: any;
