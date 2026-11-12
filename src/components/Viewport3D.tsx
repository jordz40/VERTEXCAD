import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { useStore } from '../cad/store';
import { evaluateDoc } from '../cad/model';
import { planeBasis } from '../cad/mesh';
import { entityPolyline } from '../cad/geom';
import type { SketchFeature } from '../cad/types';
import type { ViewKind } from '../cad/drawing';

export type CameraView = ViewKind | 'home';

interface Props {
  view: CameraView;
  onStats: (s: { tris: number; volume: number; size: [number, number, number] | null }) => void;
}

function sketchToLines(sketch: SketchFeature): THREE.Group {
  const group = new THREE.Group();
  const basis = planeBasis(sketch.plane, sketch.offset);
  for (const e of sketch.entities) {
    const { pts, closed } = entityPolyline(e);
    const pts3 = pts.map((p) =>
      new THREE.Vector3()
        .copy(basis.origin)
        .addScaledVector(basis.u, p.x)
        .addScaledVector(basis.v, p.y),
    );
    if (closed && pts3.length > 2) pts3.push(pts3[0].clone());
    const geo = new THREE.BufferGeometry().setFromPoints(pts3);
    const mat = new THREE.LineBasicMaterial({
      color: e.construction ? 0x9a7bf0 : 0x4f9cf9,
      transparent: true,
      opacity: 0.85,
    });
    group.add(new THREE.Line(geo, mat));
  }
  return group;
}

export default function Viewport3D({ view, onStats }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const doc = useStore((s) => s.doc);
  const sketchId = useStore((s) => s.sketchId);
  const showGrid = useStore((s) => s.showGrid);

  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const solidRef = useRef<THREE.Group | null>(null);
  const sketchRef = useRef<THREE.Group | null>(null);
  const gridRef = useRef<THREE.GridHelper | null>(null);
  const lastViewRef = useRef<CameraView | null>(null);

  const result = useMemo(() => evaluateDoc(doc), [doc]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x16181d);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 20000);
    camera.position.set(160, -190, 130);
    camera.up.set(0, 0, 1);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = false;
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.rotateSpeed = 0.85;
    controls.zoomSpeed = 0.9;
    controls.panSpeed = 0.8;
    controls.screenSpacePanning = true;
    controlsRef.current = controls;

    const hemi = new THREE.HemisphereLight(0xffffff, 0x2a2f3a, 1.6);
    hemi.position.set(0, 0, 1);
    scene.add(hemi);

    const key = new THREE.DirectionalLight(0xffffff, 2.1);
    key.position.set(120, -160, 220);
    scene.add(key);

    const fill = new THREE.DirectionalLight(0x9dc4ff, 0.85);
    fill.position.set(-160, 130, 90);
    scene.add(fill);

    const rim = new THREE.DirectionalLight(0xffffff, 0.6);
    rim.position.set(0, 200, -160);
    scene.add(rim);

    const grid = new THREE.GridHelper(600, 60, 0x3a4152, 0x262b36);
    grid.rotation.x = Math.PI / 2;
    scene.add(grid);
    gridRef.current = grid;

    const solidGroup = new THREE.Group();
    scene.add(solidGroup);
    solidRef.current = solidGroup;

    const sketchGroup = new THREE.Group();
    scene.add(sketchGroup);
    sketchRef.current = sketchGroup;

    let raf = 0;
    let disposed = false;
    const loop = () => {
      if (disposed) return;
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    };
    loop();

    const resize = () => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      if (!w || !h) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = '100%';
      renderer.domElement.style.height = '100%';
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement === mount) mount.removeChild(renderer.domElement);
    };
  }, []);

  useEffect(() => {
    const group = solidRef.current;
    if (!group) return;
    while (group.children.length) {
      const child = group.children.pop() as THREE.Mesh | THREE.LineSegments;
      child.geometry?.dispose();
      const mat = child.material as THREE.Material | THREE.Material[];
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose();
    }

    if (result.geometry) {
      const geo = result.geometry;
      geo.computeBoundingBox();
      const material = new THREE.MeshStandardMaterial({
        color: 0xb9c2d4,
        metalness: 0.28,
        roughness: 0.42,
        flatShading: false,
        side: THREE.FrontSide,
      });
      const mesh = new THREE.Mesh(geo, material);
      group.add(mesh);

      const positions: number[] = [];
      for (const e of result.edges) {
        positions.push(e.a.x, e.a.y, e.a.z, e.b.x, e.b.y, e.b.z);
      }
      if (positions.length) {
        const lineGeo = new THREE.BufferGeometry();
        lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        const lineMat = new THREE.LineBasicMaterial({ color: 0x2b3345, transparent: true, opacity: 0.9 });
        group.add(new THREE.LineSegments(lineGeo, lineMat));
      }

      const bb = geo.boundingBox!;
      const size: [number, number, number] = [
        bb.max.x - bb.min.x,
        bb.max.y - bb.min.y,
        bb.max.z - bb.min.z,
      ];
      const pos = geo.getAttribute('position');
      onStats({ tris: pos.count / 3, volume: calculateVolume(geo), size });
    } else {
      onStats({ tris: 0, volume: 0, size: null });
    }
  }, [result, onStats]);

  useEffect(() => {
    const group = sketchRef.current;
    if (!group) return;
    while (group.children.length) {
      const child = group.children.pop() as THREE.Group;
      child.traverse((o) => {
        const any = o as THREE.Mesh;
        any.geometry?.dispose();
        const mat = any.material as THREE.Material | undefined;
        mat?.dispose();
      });
    }
    for (const f of doc.features) {
      if (f.type !== 'sketch') continue;
      if (!f.visible) continue;
      if (f.id === sketchId) continue;
      group.add(sketchToLines(f));
    }
  }, [doc, sketchId]);

  useEffect(() => {
    if (gridRef.current) gridRef.current.visible = showGrid;
  }, [showGrid]);

  useEffect(() => {
    const cam = cameraRef.current;
    const controls = controlsRef.current;
    if (!cam || !controls) return;
    if (lastViewRef.current === view) return;
    lastViewRef.current = view;

    let bb: THREE.Box3 | null = null;
    let radius = 100;
    if (result.geometry) {
      result.geometry.computeBoundingBox();
      bb = result.geometry.boundingBox;
      if (bb) {
        const sphere = bb.getBoundingSphere(new THREE.Sphere());
        radius = Math.max(sphere.radius, 1);
        controls.target.copy(sphere.center);
      }
    } else {
      controls.target.set(0, 0, 0);
    }

    const d = radius * 2.9;
    const c = controls.target;
    switch (view) {
      case 'front':
        cam.position.set(c.x, c.y - d, c.z);
        break;
      case 'top':
        cam.position.set(c.x, c.y, c.z + d);
        break;
      case 'right':
        cam.position.set(c.x + d, c.y, c.z);
        break;
      case 'iso':
      case 'home':
        cam.position.set(c.x + d * 0.6, c.y - d * 0.7, c.z + d * 0.55);
        break;
    }
    cam.up.set(0, 0, 1);
    cam.lookAt(c);
    controls.update();
  }, [view, result]);

  return <div ref={mountRef} style={{ position: 'absolute', inset: 0 }} />;
}

function calculateVolume(geo: THREE.BufferGeometry): number {
  const pos = geo.getAttribute('position');
  let vol = 0;
  for (let i = 0; i < pos.count; i += 3) {
    const ax = pos.getX(i), ay = pos.getY(i), az = pos.getZ(i);
    const bx = pos.getX(i + 1), by = pos.getY(i + 1), bz = pos.getZ(i + 1);
    const cx = pos.getX(i + 2), cy = pos.getY(i + 2), cz = pos.getZ(i + 2);
    vol += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  return Math.abs(vol);
}
