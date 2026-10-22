'use client';

import { useEffect, useRef, useState } from 'react';
import { formatBytes, modelExtension } from '@/lib/cad/models';
import { mediaSrc, mediaSrcSet } from '@/lib/media-url';

type Status = 'idle' | 'loading' | 'ready' | 'error';
type Controls = { reset: () => void; setSpin: (on: boolean) => void; snapshot: () => Promise<Blob | null> };

/** Small files without a still picture load as soon as they're on screen; the rest wait for a tap. */
const AUTO_LOAD_BYTES = 4 * 1024 * 1024;

type Props = {
  src: string; name: string; size?: number;
  /** A still picture of the model, shown until the 3D view is opened. */
  poster?: string;
  /** Given a picture of the current view (admin: saved as the still); `byHand` when 📷 was pressed. */
  onSnapshot?: (image: Blob, byHand: boolean) => Promise<void>;
  /** Take that picture by itself once the model has loaded (there's no still for this model yet). */
  wantsSnapshot?: boolean;
  /** Load straight away (e.g. just after the model was saved, so its still gets taken). */
  autoStart?: boolean;
};

/**
 * An interactive 3D view of a model file (STL, 3MF, OBJ, GLB or PLY): drag to
 * turn it, scroll or pinch to zoom. Until it's opened it shows the model's
 * still picture, so the file (and three.js) only download when someone wants
 * the 3D view. Rendering pauses while the viewer is off screen.
 */
export default function ModelViewer({ src, name, size, poster, onSnapshot, wantsSnapshot, autoStart }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const controls = useRef<Controls | null>(null);
  // The latest snapshot wishes, read once the model has loaded.
  const snap = useRef({ onSnapshot, wantsSnapshot });
  snap.current = { onSnapshot, wantsSnapshot };
  const [snapping, setSnapping] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  /** Each load (or retry) bumps this; 0 until the model is asked for. */
  const [attempt, setAttempt] = useState(0);
  const load = () => { setProgress(0); setStatus('loading'); setAttempt((n) => n + 1); };
  const [progress, setProgress] = useState(0);
  const [spin, setSpin] = useState(true);
  const ext = modelExtension(src);

  // Load now when asked to.
  useEffect(() => { if (autoStart && status === 'idle') load(); }, [autoStart, status]);

  // Small models without a still start loading when they scroll into view.
  useEffect(() => {
    if (status !== 'idle' || poster || (size ?? 0) > AUTO_LOAD_BYTES || !box.current) return;
    const seen = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) { seen.disconnect(); load(); } }, { rootMargin: '200px' });
    seen.observe(box.current);
    return () => seen.disconnect();
  }, [status, size, poster]);

  useEffect(() => {
    if (!attempt || !box.current || !ext) return;
    const host = box.current;
    let disposed = false;
    let cleanup = () => {};

    (async () => {
      const THREE = await import('three');
      const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js');
      if (disposed) return;

      const accent = getComputedStyle(host).getPropertyValue('--accent').trim() || '#5e81ac';
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(host.clientWidth, host.clientHeight);
      renderer.domElement.className = 'mv-canvas';
      host.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.6));
      const key = new THREE.DirectionalLight(0xffffff, 2.2);
      key.position.set(1, 1.4, 1.1);
      const fill = new THREE.DirectionalLight(0xffffff, 0.8);
      fill.position.set(-1.2, 0.4, -0.8);
      scene.add(key, fill);

      const camera = new THREE.PerspectiveCamera(40, host.clientWidth / host.clientHeight, 0.01, 1000);
      const orbit = new OrbitControls(camera, renderer.domElement);
      orbit.enableDamping = true;
      orbit.autoRotate = true;
      orbit.autoRotateSpeed = 1.6;
      orbit.addEventListener('start', () => { orbit.autoRotate = false; setSpin(false); });

      const material = () => new THREE.MeshStandardMaterial({ color: new THREE.Color(accent), metalness: 0.15, roughness: 0.55 });
      const onProgress = (e: ProgressEvent) => { if (e.lengthComputable) setProgress(e.loaded / e.total); else if (size) setProgress(Math.min(0.99, e.loaded / size)); };

      // Each format's loader; CAD formats (STL, 3MF, PLY) are Z-up, so they're stood up.
      let object: import('three').Object3D;
      try {
        if (ext === '.stl' || ext === '.ply') {
          const Loader = ext === '.stl' ? (await import('three/examples/jsm/loaders/STLLoader.js')).STLLoader : (await import('three/examples/jsm/loaders/PLYLoader.js')).PLYLoader;
          const geometry = await new Loader().loadAsync(src, onProgress);
          // Many STL exporters write zero normals, so STL's are always worked out again.
          if (ext === '.stl' || !geometry.attributes.normal) geometry.computeVertexNormals();
          const hasColor = !!geometry.attributes.color;
          const mat = material();
          if (hasColor) { mat.vertexColors = true; mat.color.set(0xffffff); }
          object = new THREE.Mesh(geometry, mat);
          object.rotation.x = -Math.PI / 2;
        } else if (ext === '.3mf') {
          const { ThreeMFLoader } = await import('three/examples/jsm/loaders/3MFLoader.js');
          object = await new ThreeMFLoader().loadAsync(src, onProgress);
          object.rotation.x = -Math.PI / 2;
        } else if (ext === '.obj') {
          const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js');
          object = await new OBJLoader().loadAsync(src, onProgress);
          object.traverse((o) => { if (o instanceof THREE.Mesh) o.material = material(); });
        } else {
          const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
          object = (await new GLTFLoader().loadAsync(src, onProgress)).scene;
        }
      } catch {
        if (!disposed) setStatus('error');
        renderer.dispose();
        renderer.domElement.remove();
        return;
      }
      if (disposed) { renderer.dispose(); renderer.domElement.remove(); return; }

      // Centre it, sit it on a grid, and frame it.
      const wrap = new THREE.Group();
      wrap.add(object);
      scene.add(wrap);
      const bounds = new THREE.Box3().setFromObject(wrap);
      const centre = bounds.getCenter(new THREE.Vector3());
      const dims = bounds.getSize(new THREE.Vector3());
      object.position.sub(centre);
      const radius = Math.max(dims.x, dims.y, dims.z) / 2 || 1;
      const grid = new THREE.GridHelper(radius * 4, 16, 0x888888, 0x888888);
      (grid.material as import('three').Material).opacity = 0.25;
      (grid.material as import('three').Material).transparent = true;
      grid.position.y = -dims.y / 2;
      scene.add(grid);
      const distance = radius / Math.sin((camera.fov * Math.PI) / 360) * 1.15;
      const home = new THREE.Vector3(distance * 0.75, distance * 0.55, distance * 0.95);
      camera.near = distance / 100;
      camera.far = distance * 20;
      camera.updateProjectionMatrix();
      orbit.minDistance = radius * 0.3;
      orbit.maxDistance = distance * 5;
      const reset = () => { camera.position.copy(home); orbit.target.set(0, 0, 0); orbit.update(); };
      reset();

      const frame = () => { orbit.update(); renderer.render(scene, camera); };
      const resize = new ResizeObserver(() => {
        const { clientWidth: w, clientHeight: h } = host;
        if (!w || !h) return;
        renderer.setSize(w, h);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      });
      resize.observe(host);
      // Only draw while on screen.
      const onScreen = new IntersectionObserver((entries) => renderer.setAnimationLoop(entries.some((e) => e.isIntersecting) ? frame : null));
      onScreen.observe(host);

      // A picture of what's on screen, drawn at least 1200px wide whatever the screen
      // (the canvas is copied as toBlob is called, so the size goes straight back).
      const snapshot = () => new Promise<Blob | null>((done) => {
        const ratio = renderer.getPixelRatio();
        const sharp = Math.min(4, Math.max(ratio, 1200 / Math.max(1, host.clientWidth)));
        if (sharp !== ratio) renderer.setPixelRatio(sharp);
        renderer.render(scene, camera);
        renderer.domElement.toBlob(done, 'image/webp', 0.85);
        if (sharp !== ratio) { renderer.setPixelRatio(ratio); renderer.render(scene, camera); }
      });
      controls.current = { reset, setSpin: (on) => { orbit.autoRotate = on; }, snapshot };
      setStatus('ready');

      // No still for this model yet: take one from the starting view.
      if (snap.current.wantsSnapshot && snap.current.onSnapshot) {
        const image = await snapshot();
        if (image && !disposed) snap.current.onSnapshot(image, false).catch(() => { /* the 📷 button can try again */ });
      }

      cleanup = () => {
        onScreen.disconnect();
        resize.disconnect();
        renderer.setAnimationLoop(null);
        orbit.dispose();
        scene.traverse((o) => {
          if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
            o.geometry.dispose();
            (Array.isArray(o.material) ? o.material : [o.material]).forEach((m: import('three').Material) => m.dispose());
          }
        });
        renderer.dispose();
        renderer.domElement.remove();
        controls.current = null;
      };
    })();

    return () => { disposed = true; cleanup(); };
  }, [attempt, src, ext, size]);

  const takeSnapshot = async () => {
    if (!controls.current || !onSnapshot) return;
    setSnapping(true);
    try {
      const image = await controls.current.snapshot();
      if (image) await onSnapshot(image, true);
    } finally {
      setSnapping(false);
    }
  };

  const fullscreen = () => {
    const el = box.current?.parentElement;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else el.requestFullscreen?.().catch(() => {});
  };

  return (
    <div className="mv">
      <div ref={box} className="mv-stage" aria-label={`3D view of ${name}`} role="img">
        {poster && status !== 'ready' && (
          <img className="mv-poster" src={mediaSrc(poster, 960)} srcSet={mediaSrcSet(poster, [640, 960, 1280])} sizes="(max-width: 700px) 100vw, 420px" alt={`${name} (still picture)`} loading="lazy" decoding="async" />
        )}
        {status === 'idle' && (poster ? (
          <button type="button" className="mv-start has-poster" onClick={load} aria-label={`Open the 3D view of ${name}`}>
            <span className="mv-play"><span aria-hidden>🧊</span> View in 3D<small>{size ? ` · ${formatBytes(size)}` : ''}</small></span>
          </button>
        ) : (
          <button type="button" className="mv-start" onClick={load}>
            <span aria-hidden>🧊</span>
            <strong>View in 3D</strong>
            <small>{ext?.slice(1).toUpperCase()}{size ? ` · ${formatBytes(size)}` : ''}</small>
          </button>
        ))}
        {status === 'loading' && (
          <div className={`mv-loading${poster ? ' over-poster' : ''}`}>
            <span>Loading model… {progress > 0 ? `${Math.round(progress * 100)}%` : ''}</span>
            <span className="mv-bar"><i style={{ width: `${Math.round(progress * 100)}%` }} /></span>
          </div>
        )}
        {status === 'error' && (
          <div className="mv-loading">
            <span>Couldn’t show this model.</span>
            <button type="button" className="mv-tool" onClick={load}>Try again</button>
          </div>
        )}
      </div>
      {status === 'ready' && (
        <div className="mv-tools">
          <button type="button" className="mv-tool" onClick={() => controls.current?.reset()} title="Reset the view">⟲</button>
          <button type="button" className="mv-tool" aria-pressed={spin} onClick={() => { controls.current?.setSpin(!spin); setSpin(!spin); }} title={spin ? 'Stop spinning' : 'Spin'}>{spin ? '⏸' : '▶'}</button>
          {onSnapshot && <button type="button" className="mv-tool" onClick={takeSnapshot} disabled={snapping} title="Use this view as the still picture">{snapping ? '…' : '📷'}</button>}
          <button type="button" className="mv-tool" onClick={fullscreen} title="Full screen">⛶</button>
        </div>
      )}
      {status === 'ready' && <span className="mv-hint">Drag to turn · scroll or pinch to zoom</span>}
    </div>
  );
}
