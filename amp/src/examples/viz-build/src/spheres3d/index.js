// amp:uses three
//
// A three.js visualizer, built from a project.
//
// The `// amp:uses three` line above is the whole mechanism: amp sees it, pastes
// its own copy of three in front of this file, and `THREE` is a global by the
// time any of this runs. So three is NEVER imported and never bundled — it is a
// devDependency of this project for @types/three and nothing else, and the
// built file is a few KB rather than 1.1 MB.
//
// amp ships the WEBGPU build, so WebGPURenderer covers both backends: WebGPU
// where the machine has one, WebGL2 where it has not. There is no WebGLRenderer.
//
// @ts-check
/// <reference path="../../types/amp-viz.d.ts" />

import { makeEnvironment } from './environment.js';
import { createSwarm } from './swarm.js';

const SKINS = [
  { name: 'blush',  accent: 0xff4060, bounce: 0xff6a80, room: 0xeeeeee },
  { name: 'gold',   accent: 0xffcc00, bounce: 0xffb038, room: 0xf0eee8 },
  { name: 'cobalt', accent: 0x2060ff, bounce: 0x5090ff, room: 0xe8ecf2 },
];

amp.register({
  name: 'Spheres',
  backends: ['webgpu', 'webgl2'],
  presets: SKINS.map((s) => s.name),

  // create() may be async, and here it must be: the renderer negotiates a
  // device before it can draw.
  async create({ canvas, backend, width, height }) {
    const renderer = new THREE.WebGPURenderer({
      canvas,
      antialias: true,
      forceWebGL: backend !== 'webgpu',    // honour what amp picked
    });
    await renderer.init();
    renderer.setSize(width, height, false);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;

    let aspect = width / height;
    const scene = new THREE.Scene();
    // a long lens: 17.5° from 30 back flattens the perspective and makes the
    // spheres read as enormous
    const camera = new THREE.PerspectiveCamera(17.5, aspect, 0.1, 200);
    camera.position.set(0, 0, 30);
    camera.lookAt(0, 0, 0);

    let skin = 0;
    scene.environment = makeEnvironment(SKINS[skin].bounce, SKINS[skin].room);
    scene.background = new THREE.Color(SKINS[skin].room);
    const key = new THREE.DirectionalLight(0xffffff, 1.2);
    key.position.set(4, 8, 6);
    scene.add(key);

    const N = 18;
    const swarm = createSwarm(N);
    const mat = new THREE.MeshPhysicalMaterial({ metalness: 0.5, roughness: 0.24 });
    const mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 48, 32), mat, N);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(mesh);

    const colour = new THREE.Color();
    const white = new THREE.Color(0xffffff);
    function paint() {
      for (let i = 0; i < N; i++) {
        if (i % 5 < 2) colour.set(SKINS[skin].accent).lerp(white, 0.3 + (i % 3) * 0.13);
        else if (i % 9 === 4) colour.set(0x8e8e8e);
        else colour.set(0xf7f7f7);
        mesh.setColorAt(i, colour);
      }
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    paint();

    const m4 = new THREE.Matrix4();
    const scl = new THREE.Vector3();

    function reskin(n) {
      skin = (skin + n + SKINS.length) % SKINS.length;
      scene.environment = makeEnvironment(SKINS[skin].bounce, SKINS[skin].room);
      scene.background = new THREE.Color(SKINS[skin].room);
      paint();
      return SKINS[skin].name;
    }

    return {
      backend: backend === 'webgpu' ? 'webgpu · three' : 'webgl2 · three',

      frame({ audio, t, dt }) {
        swarm.step(Math.min(0.05, dt || 1 / 60), audio, aspect);
        for (let i = 0; i < N; i++) {
          const p = swarm.positions[i], r = swarm.radii[i];
          scl.set(r, r, r);
          m4.makeTranslation(p[0], p[1], p[2]);
          m4.scale(scl);
          mesh.setMatrixAt(i, m4);
        }
        mesh.instanceMatrix.needsUpdate = true;
        camera.position.x = Math.sin(t * 0.07) * 1.2;
        camera.position.y = Math.cos(t * 0.05) * 0.8;
        camera.lookAt(0, 0, 0);
        renderer.render(scene, camera);
      },

      resize(w, h) {
        renderer.setSize(w, h, false);
        aspect = w / h;
        camera.aspect = aspect;
        camera.updateProjectionMatrix();
      },

      randomize() { return reskin(1); },
      preset(n) { reskin(n); },
    };
  },
});
