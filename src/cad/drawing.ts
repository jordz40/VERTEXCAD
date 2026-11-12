import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { silhouetteEdges, type SolidEdge } from './mesh';

export type ViewKind = 'front' | 'top' | 'right' | 'iso';

export interface ViewBasis {
  /** unit vector from the model toward the camera */
  eye: THREE.Vector3;
  /** screen right axis in world space */
  right: THREE.Vector3;
  /** screen up axis in world space */
  up: THREE.Vector3;
}

const WORLD_UP = new THREE.Vector3(0, 0, 1);

const EYE_DIRS: Record<ViewKind, THREE.Vector3> = {
  front: new THREE.Vector3(0, -1, 0),
  top: new THREE.Vector3(0, 0, 1),
  right: new THREE.Vector3(1, 0, 0),
  iso: new THREE.Vector3(0.6, -0.7, 0.55).normalize(),
};

export function viewBasis(kind: ViewKind): ViewBasis {
  const eye = EYE_DIRS[kind].clone().normalize();
  const forward = eye.clone().negate();
  const refUp = kind === 'top' ? new THREE.Vector3(0, 1, 0) : WORLD_UP.clone();
  const right = new THREE.Vector3().crossVectors(forward, refUp).normalize();
  const up = new THREE.Vector3().crossVectors(right, forward).normalize();
  return { eye, right, up };
}

export const VIEW_LABEL: Record<ViewKind, string> = {
  front: 'FRONT VIEW',
  top: 'TOP VIEW',
  right: 'RIGHT VIEW',
  iso: 'ISOMETRIC VIEW',
};

export interface ProjectedSeg {
  a: [number, number];
  b: [number, number];
  hidden: boolean;
}

export interface ProjectedView {
  visible: [number, number][][];
  hidden: [number, number][][];
  segs: ProjectedSeg[];
  min: [number, number];
  max: [number, number];
}

const OCCLUSION_EPS = 1e-3;

export function projectView(
  geometry: THREE.BufferGeometry | null,
  edges: SolidEdge[],
  kind: ViewKind,
  opts: { hiddenLines?: boolean } = {},
): ProjectedView {
  const { eye, right, up } = viewBasis(kind);
  const hiddenLines = opts.hiddenLines ?? true;

  let bvh: MeshBVH | null = null;

  if (hiddenLines && geometry) {
    const pos = geometry.getAttribute('position');
    if (pos && pos.count >= 9) {
      const indexed = geometry.clone();
      indexed.deleteAttribute('uv');
      if (!indexed.index) {
        const n = indexed.getAttribute('position').count;
        const arr = new Uint32Array(n);
        for (let i = 0; i < n; i++) arr[i] = i;
        indexed.setIndex(new THREE.BufferAttribute(arr, 1));
      }
      bvh = new MeshBVH(indexed);
    }
  }

  const allEdges: SolidEdge[] = geometry
    ? [...edges, ...silhouetteEdges(geometry, eye)]
    : edges;

  const project = (p: THREE.Vector3): [number, number] => [p.dot(right), p.dot(up)];

  const ray = new THREE.Ray();
  const isHidden = (point: THREE.Vector3): boolean => {
    if (!bvh) return false;
    const origin = point.clone().addScaledVector(eye, OCCLUSION_EPS * 2);
    ray.set(origin, eye);
    const hit = bvh.raycastFirst(ray, THREE.DoubleSide, OCCLUSION_EPS);
    return !!hit;
  };

  const segs: ProjectedSeg[] = [];

  for (const edge of allEdges) {
    const a3 = edge.a;
    const b3 = edge.b;
    const screenLen = Math.hypot(
      project(b3)[0] - project(a3)[0],
      project(b3)[1] - project(a3)[1],
    );
    if (screenLen < 1e-6) continue;

    const worldLen = a3.distanceTo(b3);
    const samples = Math.max(2, Math.min(20, Math.ceil(worldLen / 0.5) + 1));

    const flags: boolean[] = [];
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      const p = new THREE.Vector3().lerpVectors(a3, b3, t);
      flags.push(isHidden(p));
    }

    for (let i = 0; i < samples; i++) {
      const t0 = i / samples;
      const t1 = (i + 1) / samples;
      const pa = project(new THREE.Vector3().lerpVectors(a3, b3, t0));
      const pb = project(new THREE.Vector3().lerpVectors(a3, b3, t1));
      segs.push({ a: pa, b: pb, hidden: flags[i] && flags[i + 1] });
    }
  }

  const visible: [number, number][][] = [];
  const hidden: [number, number][][] = [];

  for (const wantHidden of [false, true]) {
    const list = wantHidden ? hidden : visible;
    let run: [number, number][] = [];
    let prevEnd: [number, number] | null = null;
    for (const seg of segs) {
      if (seg.hidden !== wantHidden) {
        if (run.length >= 2) list.push(run);
        run = [];
        prevEnd = null;
        continue;
      }
      if (!prevEnd || Math.hypot(prevEnd[0] - seg.a[0], prevEnd[1] - seg.a[1]) > 1e-6) {
        if (run.length >= 2) list.push(run);
        run = [seg.a];
      }
      run.push(seg.b);
      prevEnd = seg.b;
    }
    if (run.length >= 2) list.push(run);
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of [...visible.flat(), ...hidden.flat()]) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  if (!Number.isFinite(minX)) {
    minX = 0;
    minY = 0;
    maxX = 1;
    maxY = 1;
  }

  return { visible, hidden, segs, min: [minX, minY], max: [maxX, maxY] };
}

export interface SheetLayout {
  views: { kind: ViewKind; projected: ProjectedView; x: number; y: number; scale: number }[];
  scale: number;
}

const SHEET_MARGIN = 10;
const VIEW_GAP = 14;

const SLOTS: Record<ViewKind, { col: number; row: number }> = {
  front: { col: 0, row: 1 },
  top: { col: 0, row: 0 },
  right: { col: 1, row: 1 },
  iso: { col: 1, row: 0 },
};

const PREFERRED_SCALES = [50, 20, 10, 5, 2, 1, 0.5, 0.2, 0.1];

export function layoutSheet(
  sheet: { width: number; height: number },
  parts: { kind: ViewKind; projected: ProjectedView }[],
  titleBlockHeight = 34,
): SheetLayout {
  const usableW = sheet.width - SHEET_MARGIN * 2;
  const usableH = sheet.height - SHEET_MARGIN * 2 - titleBlockHeight;
  const cols = 2;
  const rows = 2;
  const colWidth = (usableW - VIEW_GAP * (cols - 1)) / cols;
  const rowHeight = (usableH - VIEW_GAP * (rows - 1)) / rows;

  let fitScale = Infinity;
  for (const p of parts) {
    const w = Math.max(p.projected.max[0] - p.projected.min[0], 1);
    const h = Math.max(p.projected.max[1] - p.projected.min[1], 1);
    const s = Math.min((colWidth * 0.94) / w, (rowHeight * 0.94) / h);
    if (s < fitScale) fitScale = s;
  }
  if (!Number.isFinite(fitScale) || fitScale <= 0) fitScale = 1;

  const scale = PREFERRED_SCALES.find((s) => s <= fitScale) ?? 0.1;

  const views = parts.map((p) => {
    const cell = SLOTS[p.kind];
    const cellX = SHEET_MARGIN + cell.col * (colWidth + VIEW_GAP);
    const cellY = SHEET_MARGIN + cell.row * (rowHeight + VIEW_GAP);
    const w = (p.projected.max[0] - p.projected.min[0]) * scale;
    const h = (p.projected.max[1] - p.projected.min[1]) * scale;
    const x = cellX + (colWidth - w) / 2 - p.projected.min[0] * scale;
    const y = cellY + (rowHeight - h) / 2 + p.projected.max[1] * scale;
    return { kind: p.kind, projected: p.projected, x, y, scale };
  });

  return { views, scale };
}
