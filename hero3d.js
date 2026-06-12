// ============================================================
// NEXTGEN — Interactive 3D hero (Three.js)
// A stack of gold ingots with particle dust. Idle rotation,
// mouse parallax, and drag-to-rotate with inertia.
// Degrades silently: if WebGL or the CDN is unavailable, the
// canvas stays empty and the CSS glow/grid backdrop shows.
// ============================================================
import * as THREE from 'three';
import { RoomEnvironment } from './vendor/three/RoomEnvironment.js';
import { RoundedBoxGeometry } from './vendor/three/RoundedBoxGeometry.js';

const canvas = document.getElementById('heroCanvas');
const hero = canvas?.closest('.hero');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function supportsWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch (_) {
    return false;
  }
}

if (canvas && hero && supportsWebGL()) {
  init();
}

function init() {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 60);
  camera.position.set(0, 1.1, 9);

  // Soft studio reflections so the metal reads as gold
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  const key = new THREE.DirectionalLight(0xffe9c4, 1.7);
  key.position.set(4, 7, 5);
  scene.add(key);
  // Warm gold bounce from one side, cool rim from the other for edge contrast
  const rim = new THREE.PointLight(0xd6a644, 10, 30);
  rim.position.set(-5, 1.5, -4);
  scene.add(rim);
  const cool = new THREE.PointLight(0x88b4e8, 16, 28);
  cool.position.set(6, 2.5, -5);
  scene.add(cool);
  scene.add(new THREE.AmbientLight(0x14100a, 1.4));

  // ---- Procedural surface maps (cast-metal imperfections) ----
  function noiseTexture(size = 256, base = 150, spread = 70) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    ctx.fillStyle = `rgb(${base},${base},${base})`;
    ctx.fillRect(0, 0, size, size);
    // speckle
    for (let i = 0; i < 9000; i++) {
      const v = base + (Math.random() - 0.5) * spread;
      ctx.fillStyle = `rgba(${v},${v},${v},${0.25 + Math.random() * 0.4})`;
      ctx.fillRect(Math.random() * size, Math.random() * size, 1 + Math.random() * 2, 1 + Math.random() * 2);
    }
    // faint casting streaks
    for (let i = 0; i < 26; i++) {
      const v = base + (Math.random() - 0.5) * spread * 0.8;
      ctx.strokeStyle = `rgba(${v},${v},${v},0.18)`;
      ctx.lineWidth = 0.6 + Math.random() * 1.6;
      const y = Math.random() * size;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(size * 0.3, y + (Math.random() - 0.5) * 18, size * 0.7, y + (Math.random() - 0.5) * 18, size, y + (Math.random() - 0.5) * 10);
      ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }

  const roughMap = noiseTexture(256, 140, 90);
  const bumpMap = noiseTexture(256, 128, 60);

  const goldMat = new THREE.MeshPhysicalMaterial({
    color: 0xd2a13c,
    metalness: 1.0,
    roughness: 0.42,            // multiplied by the map → varied 0.2–0.45 finish
    roughnessMap: roughMap,
    bumpMap: bumpMap,
    bumpScale: 0.018,
    clearcoat: 0.12,
    clearcoatRoughness: 0.5,
    envMapIntensity: 1.15,
  });

  // ---- Engraved stamp for the bar faces ----
  function stampTexture() {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 256;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, 512, 256);
    ctx.strokeStyle = 'rgba(70,46,10,0.9)';
    ctx.lineWidth = 4;
    ctx.strokeRect(36, 30, 440, 196);
    ctx.fillStyle = 'rgba(70,46,10,0.92)';
    ctx.textAlign = 'center';
    ctx.font = '600 64px Georgia, serif';
    ctx.fillText('NEXTGEN', 256, 110);
    ctx.font = '400 30px Georgia, serif';
    ctx.fillText('999.9  FINE  GOLD', 256, 160);
    ctx.font = '400 24px Georgia, serif';
    ctx.fillText('· HONG KONG ·', 256, 200);
    const tex = new THREE.CanvasTexture(c);
    tex.anisotropy = 4;
    return tex;
  }
  const stampMat = new THREE.MeshStandardMaterial({
    map: stampTexture(),
    transparent: true,
    metalness: 0.9,
    roughness: 0.75,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });

  // ---- Gold ingot: rounded box with a smooth cast taper ----
  function ingotGeometry(w = 2.9, h = 0.62, d = 1.25, taper = 0.8) {
    const geo = new RoundedBoxGeometry(w, h, d, 4, 0.09);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const f = THREE.MathUtils.mapLinear(pos.getY(i), -h / 2, h / 2, 1, taper);
      pos.setX(i, pos.getX(i) * f);
      pos.setZ(i, pos.getZ(i) * f);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    return geo;
  }

  const group = new THREE.Group();
  const geo = ingotGeometry();
  const W = 2.9, H = 0.62, D = 1.25, TAPER = 0.8;

  function makeBar() {
    const bar = new THREE.Mesh(geo, goldMat);
    // engraved stamp resting on the top face
    const stamp = new THREE.Mesh(
      new THREE.PlaneGeometry(W * TAPER * 0.82, D * TAPER * 0.78),
      stampMat
    );
    stamp.rotation.x = -Math.PI / 2;
    stamp.position.y = H / 2 + 0.004;
    bar.add(stamp);
    return bar;
  }

  // Pyramid stack: two bars below, one across the top
  const positions = [
    { p: [0, -0.45, -0.72], r: [0, 0.045, 0] },
    { p: [0, -0.45, 0.72],  r: [0, -0.06, 0] },
    { p: [0, 0.22, 0],      r: [0, Math.PI / 2 + 0.05, 0] },
  ];
  positions.forEach(({ p, r }) => {
    const bar = makeBar();
    bar.position.set(...p);
    bar.rotation.set(...r);
    group.add(bar);
  });

  // Soft contact shadow grounding the stack
  (function addShadow() {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(128, 128, 10, 128, 128, 126);
    g.addColorStop(0, 'rgba(0,0,0,0.62)');
    g.addColorStop(0.55, 'rgba(0,0,0,0.30)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(6.4, 4.4),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = -0.79;
    group.add(shadow);
  })();

  // Halo ring behind the stack
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(2.6, 0.012, 12, 160),
    new THREE.MeshBasicMaterial({ color: 0xd6a644, transparent: true, opacity: 0.22 })
  );
  ring.rotation.x = Math.PI / 2.25;
  ring.position.y = -0.2;
  group.add(ring);

  group.rotation.set(0.12, 0.5, 0);
  let baseY = -2.0;
  group.scale.setScalar(1.18);
  group.position.y = baseY;
  scene.add(group);

  // ---- Gold dust particles ----
  const COUNT = 420;
  const pGeo = new THREE.BufferGeometry();
  const pPos = new Float32Array(COUNT * 3);
  const pSpeed = new Float32Array(COUNT);
  for (let i = 0; i < COUNT; i++) {
    pPos[i * 3]     = (Math.random() - 0.5) * 16;
    pPos[i * 3 + 1] = (Math.random() - 0.5) * 9;
    pPos[i * 3 + 2] = (Math.random() - 0.5) * 8 - 1;
    pSpeed[i] = 0.1 + Math.random() * 0.35;
  }
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  const particles = new THREE.Points(pGeo, new THREE.PointsMaterial({
    color: 0xe8c97a,
    size: 0.035,
    transparent: true,
    opacity: 0.55,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }));
  scene.add(particles);

  // ---- Interaction state ----
  let targetRX = group.rotation.x, targetRY = group.rotation.y;
  let velX = 0, velY = 0;
  let dragging = false;
  let lastX = 0, lastY = 0;
  let parallaxX = 0, parallaxY = 0;
  let interacted = false;

  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    interacted = true;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.classList.add('grabbing');
    canvas.setPointerCapture(e.pointerId);
    hideHint();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    velY = (e.clientX - lastX) * 0.006;
    velX = (e.clientY - lastY) * 0.004;
    targetRY += velY;
    targetRX += velX;
    lastX = e.clientX;
    lastY = e.clientY;
  });
  const endDrag = () => { dragging = false; canvas.classList.remove('grabbing'); };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  window.addEventListener('mousemove', (e) => {
    parallaxX = (e.clientX / window.innerWidth - 0.5) * 2;
    parallaxY = (e.clientY / window.innerHeight - 0.5) * 2;
  }, { passive: true });

  // Drag hint
  const hint = document.getElementById('heroHint');
  if (hint && !reducedMotion) hint.classList.add('show');
  function hideHint() {
    if (hint) { hint.style.opacity = '0'; hint.style.transition = 'opacity 0.5s'; }
  }

  // ---- Render only while visible ----
  let inView = true;
  new IntersectionObserver(([e]) => { inView = e.isIntersecting; }, { threshold: 0 }).observe(hero);

  function resize() {
    const w = hero.clientWidth;
    const h = hero.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // Pull the camera back and shrink the stack on narrow screens
    camera.position.z = w < 720 ? 13.5 : 9;
    group.scale.setScalar(w < 720 ? 0.85 : 1.18);
    baseY = w < 720 ? -2.8 : -2.0;
    group.position.y = baseY;
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener('resize', resize);

  const clock = new THREE.Clock();

  function tick() {
    requestAnimationFrame(tick);
    if (!inView || document.hidden) return;

    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;

    // Idle spin until the user takes over, then inertia
    if (!dragging) {
      if (!reducedMotion) targetRY += (interacted ? 0.04 : 0.14) * dt;
      targetRY += velY;
      targetRX += velX;
      velX *= 0.94;
      velY *= 0.94;
      // Ease pitch back toward a pleasant angle
      targetRX += (0.12 - targetRX) * 0.012;
    }
    group.rotation.y += (targetRY - group.rotation.y) * 0.12;
    group.rotation.x += (targetRX - group.rotation.x) * 0.12;

    // Gentle float
    if (!reducedMotion) group.position.y = baseY + Math.sin(t * 0.8) * 0.07;

    // Camera parallax + slight scroll dolly
    const scroll = Math.min(window.scrollY / window.innerHeight, 1);
    camera.position.x += (parallaxX * 0.55 - camera.position.x) * 0.04;
    camera.position.y += (1.1 + parallaxY * -0.3 + scroll * 1.6 - camera.position.y) * 0.05;
    camera.lookAt(0, -0.4, 0);

    // Drift the dust upward
    if (!reducedMotion) {
      const arr = pGeo.attributes.position.array;
      for (let i = 0; i < COUNT; i++) {
        arr[i * 3 + 1] += pSpeed[i] * dt * 0.55;
        if (arr[i * 3 + 1] > 4.5) arr[i * 3 + 1] = -4.5;
      }
      pGeo.attributes.position.needsUpdate = true;
      ring.rotation.z = t * 0.1;
    }

    renderer.render(scene, camera);
  }
  tick();
}
