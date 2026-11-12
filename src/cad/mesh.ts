import * as THREE from 'three';
import earcut from 'earcut';
import type { PlaneId, Profile, Vec2 } from './types';
import { signedArea } from './math';

export interface PlaneBasis {
  origin: THREE.Vector3;
  u: THREE.Vector3;
  v: THREE.Vector3;
  n: THREE.Vector3;
}

export function planeBasis(plane: PlaneId, offset: number): PlaneBasis {
  switch (plane) {
    case 'XY':
      return {
        origin: new THREE.Vector3(0, 0, offset),
        u: new THREE.Vector3(1, 0, 0),
        v: new THREE.Vector3(0, 1, 0),
        n: new THREE.Vector3(0, 0, 1),
      };
    case 'XZ':
      return {
        origin: new THREE.Vector3(0, offset, 0),
        u: new THREE.Vector3(1, 0, 0),
        v: new THREE.Vector3(0, 0, -1),
        n: new THREE.Vector3(0, 1, 0),
      };
    case 'YZ':
      return {
        origin: new THREE.Vector3(offset, 0, 0),
        u: new THREE.Vector3(0, 0, -1),
        v: new THREE.Vector3(0, 1, 0),
        n: new THREE.Vector3(1, 0, 0),
      };
  }
}

export function mapPoint(b: PlaneBasis, p: Vec2, t = 0): THREE.Vector3 {
  return new THREE.Vector3()
    .copy(b.origin)
    .addScaledVector(b.u, p.x)
    .addScaledVector(b.v, p.y)
    .addScaledVector(b.n, t);
}

interface Tri2D {
  points: Vec2[];
  tris: [number, number, number][];
}

function triangulateProfiles(profiles: Profile[]): Tri2D[] {
  return profiles.map((prof) => {
    const outer = signedArea(prof.outer) < 0 ? [...prof.outer].reverse() : [...prof.outer];
    const holes = prof.holes.map((h) => (signedArea(h) > 0 ? [...h].reverse() : [...h]));

    const points: Vec2[] = [...outer];
    const holeIndices: number[] = [];
    for (const h of holes) {
      holeIndices.push(points.length);
      points.push(...h);
    }
    const flat: number[] = [];
    for (const p of points) flat.push(p.x, p.y);
    const idx = earcut(flat, holeIndices.length ? holeIndices : undefined, 2);
    const tris: [number, number, number][] = [];
    for (let i = 0; i < idx.length; i += 3) {
      tris.push([idx[i], idx[i + 1], idx[i + 2]]);
    }
    return { points, tris };
  });
}

function loopOrientation(loop: Vec2[]): Vec2[] {
  return signedArea(loop) < 0 ? [...loop].reverse() : [...loop];
}

function holeOrientation(loop: Vec2[]): Vec2[] {
  return signedArea(loop) > 0 ? [...loop].reverse() : [...loop];
}

class TriSoup {
  positions: number[] = [];

  tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) {
    this.positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  }

  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3) {
    this.tri(a, b, c);
    this.tri(a, c, d);
  }

  toGeometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    const count = this.positions.length / 3;
    const uv = new Float32Array(count * 2);
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.computeVertexNormals();
    return g;
  }
}

function signedVolume(pos: number[]): number {
  let vol = 0;
  for (let i = 0; i < pos.length; i += 9) {
    const ax = pos[i], ay = pos[i + 1], az = pos[i + 2];
    const bx = pos[i + 3], by = pos[i + 4], bz = pos[i + 5];
    const cx = pos[i + 6], cy = pos[i + 7], cz = pos[i + 8];
    vol += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  return vol;
}

function flip(pos: number[]): void {
  for (let i = 0; i < pos.length; i += 9) {
    for (let k = 0; k < 3; k++) {
      const t = pos[i + 3 + k];
      pos[i + 3 + k] = pos[i + 6 + k];
      pos[i + 6 + k] = t;
    }
  }
}

function finalize(soup: TriSoup): THREE.BufferGeometry {
  if (signedVolume(soup.positions) < 0) flip(soup.positions);
  return soup.toGeometry();
}

export function buildExtrudeGeometry(
  profiles: Profile[],
  plane: PlaneId,
  offset: number,
  distance: number,
  symmetric: boolean,
  margin = 0,
): THREE.BufferGeometry | null {
  if (!profiles.length || Math.abs(distance) < 1e-9) return null;
  const basis = planeBasis(plane, offset);
  let t0: number;
  let t1: number;
  if (symmetric) {
    t0 = -Math.abs(distance) / 2;
    t1 = Math.abs(distance) / 2;
  } else if (distance >= 0) {
    t0 = 0;
    t1 = distance;
  } else {
    t0 = distance;
    t1 = 0;
  }
  t0 -= margin;
  t1 += margin;

  const soup = new TriSoup();

  for (const prof of profiles) {
    const outer = loopOrientation(prof.outer);
    const holes = prof.holes.map(holeOrientation);
    const rings = [outer, ...holes];

    for (const ring of rings) {
      for (let i = 0; i < ring.length; i++) {
        const p = ring[i];
        const q = ring[(i + 1) % ring.length];
        const bp = mapPoint(basis, p, t0);
        const bq = mapPoint(basis, q, t0);
        const tq = mapPoint(basis, q, t1);
        const tp = mapPoint(basis, p, t1);
        soup.quad(bp, bq, tq, tp);
      }
    }

    const tri = triangulateProfiles([prof])[0];
    for (const [i, j, k] of tri.tris) {
      const a = mapPoint(basis, tri.points[i], t1);
      const b = mapPoint(basis, tri.points[j], t1);
      const c = mapPoint(basis, tri.points[k], t1);
      soup.tri(a, b, c);
      const a2 = mapPoint(basis, tri.points[k], t0);
      const b2 = mapPoint(basis, tri.points[j], t0);
      const c2 = mapPoint(basis, tri.points[i], t0);
      soup.tri(a2, b2, c2);
    }
  }

  return finalize(soup);
}

export function buildRevolveGeometry(
  profiles: Profile[],
  plane: PlaneId,
  offset: number,
  axisOrigin: Vec2,
  axisDir: Vec2,
  angleDeg: number,
  segments: number,
  margin = 0,
): THREE.BufferGeometry | null {
  if (!profiles.length) return null;
  const basis = planeBasis(plane, offset);
  const dLen = Math.hypot(axisDir.x, axisDir.y);
  if (dLen < 1e-9) return null;
  const d: Vec2 = { x: axisDir.x / dLen, y: axisDir.y / dLen };
  const n: Vec2 = { x: d.y, y: -d.x };

  const d3 = new THREE.Vector3().addScaledVector(basis.u, d.x).addScaledVector(basis.v, d.y).normalize();
  const n3 = new THREE.Vector3().addScaledVector(basis.u, n.x).addScaledVector(basis.v, n.y).normalize();
  const N3 = basis.n.clone();
  const o3 = mapPoint(basis, axisOrigin, 0);

  const full = Math.abs(angleDeg) >= 359.999;
  const baseAngle = full ? Math.PI * 2 : (angleDeg * Math.PI) / 180;
  const angle = full ? baseAngle : baseAngle + Math.sign(baseAngle || 1) * (margin > 0 ? 0.02 : 0);
  const steps = Math.max(3, Math.min(256, Math.round(segments)));

  const radialAt = (theta: number): THREE.Vector3 =>
    new THREE.Vector3().addScaledVector(n3, Math.cos(theta)).addScaledVector(N3, -Math.sin(theta));

  const place = (p: Vec2, theta: number, radial: THREE.Vector3): THREE.Vector3 => {
    const along = (p.x - axisOrigin.x) * d.x + (p.y - axisOrigin.y) * d.y;
    const r = (p.x - axisOrigin.x) * n.x + (p.y - axisOrigin.y) * n.y;
    return new THREE.Vector3().copy(o3).addScaledVector(d3, along).addScaledVector(radial, r);
  };

  const soup = new TriSoup();

  for (const prof of profiles) {
    const outer = loopOrientation(prof.outer);
    const holes = prof.holes.map(holeOrientation);

    for (const ring of [outer, ...holes]) {
      for (let i = 0; i < ring.length; i++) {
        const p = ring[i];
        const q = ring[(i + 1) % ring.length];
        for (let s = 0; s < steps; s++) {
          const th0 = (angle * s) / steps;
          const th1 = (angle * (s + 1)) / steps;
          const r0 = radialAt(th0);
          const r1 = radialAt(th1);
          soup.quad(place(p, th0, r0), place(p, th1, r1), place(q, th1, r1), place(q, th0, r0));
        }
      }
    }

    if (!full) {
      const tri = triangulateProfiles([prof])[0];
      const r0 = radialAt(0);
      const rEnd = radialAt(angle);
      for (const [i, j, k] of tri.tris) {
        soup.tri(
          place(tri.points[k], 0, r0),
          place(tri.points[j], 0, r0),
          place(tri.points[i], 0, r0),
        );
        soup.tri(
          place(tri.points[i], angle, rEnd),
          place(tri.points[j], angle, rEnd),
          place(tri.points[k], angle, rEnd),
        );
      }
    }
  }

  return finalize(soup);
}

export interface SolidEdge {
  a: THREE.Vector3;
  b: THREE.Vector3;
}

const WELD = 1e-4;

function quantKey(v: THREE.Vector3): string {
  return `${Math.round(v.x / WELD)}:${Math.round(v.y / WELD)}:${Math.round(v.z / WELD)}`;
}

export interface MeshTopology {
  verts: THREE.Vector3[];
  tris: [number, number, number][];
  normals: THREE.Vector3[];
  edges: { a: number; b: number; tris: number[] }[];
}

const topologyCache = new WeakMap<THREE.BufferGeometry, MeshTopology>();

export function meshTopology(geometry: THREE.BufferGeometry): MeshTopology {
  const cached = topologyCache.get(geometry);
  if (cached) return cached;

  const pos = geometry.getAttribute('position');
  const verts: THREE.Vector3[] = [];
  const index = new Map<string, number>();
  const tris: [number, number, number][] = [];

  if (pos) {
    for (let i = 0; i < pos.count; i += 3) {
      const tri: number[] = [];
      for (let k = 0; k < 3; k++) {
        const v = new THREE.Vector3().fromBufferAttribute(pos, i + k);
        const key = quantKey(v);
        let id = index.get(key);
        if (id === undefined) {
          id = verts.length;
          verts.push(v);
          index.set(key, id);
        }
        tri.push(id);
      }
      if (tri[0] !== tri[1] && tri[1] !== tri[2] && tri[0] !== tri[2]) {
        tris.push([tri[0], tri[1], tri[2]]);
      }
    }
  }

  const normals = tris.map(([a, b, c]) => {
    const ab = new THREE.Vector3().subVectors(verts[b], verts[a]);
    const ac = new THREE.Vector3().subVectors(verts[c], verts[a]);
    return ab.cross(ac).normalize();
  });

  const edgeMap = new Map<string, { a: number; b: number; tris: number[] }>();
  tris.forEach((tri, ti) => {
    for (let k = 0; k < 3; k++) {
      const a = tri[k];
      const b = tri[(k + 1) % 3];
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      const entry = edgeMap.get(key);
      if (entry) entry.tris.push(ti);
      else edgeMap.set(key, { a, b, tris: [ti] });
    }
  });

  const topo: MeshTopology = { verts, tris, normals, edges: [...edgeMap.values()] };
  topologyCache.set(geometry, topo);
  return topo;
}

export function extractEdges(geometry: THREE.BufferGeometry, creaseDeg = 20): SolidEdge[] {
  const topo = meshTopology(geometry);
  const cosLimit = Math.cos((creaseDeg * Math.PI) / 180);
  const out: SolidEdge[] = [];

  for (const { a, b, tris } of topo.edges) {
    if (tris.length === 1) {
      out.push({ a: topo.verts[a], b: topo.verts[b] });
      continue;
    }
    if (tris.length === 2) {
      const d = topo.normals[tris[0]].dot(topo.normals[tris[1]]);
      if (Math.abs(d) < cosLimit) out.push({ a: topo.verts[a], b: topo.verts[b] });
      continue;
    }
    out.push({ a: topo.verts[a], b: topo.verts[b] });
  }
  return out;
}

export function silhouetteEdges(geometry: THREE.BufferGeometry, eye: THREE.Vector3): SolidEdge[] {
  const topo = meshTopology(geometry);
  const out: SolidEdge[] = [];
  const facing = topo.normals.map((n) => n.dot(eye));

  for (const { a, b, tris } of topo.edges) {
    if (tris.length !== 2) continue;
    const f0 = facing[tris[0]];
    const f1 = facing[tris[1]];
    if (f0 * f1 < 0) out.push({ a: topo.verts[a], b: topo.verts[b] });
  }
  return out;
}

export function geometryVolume(geometry: THREE.BufferGeometry): number {
  const pos = geometry.getAttribute('position');
  if (!pos) return 0;
  const arr: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    arr.push(pos.getX(i), pos.getY(i), pos.getZ(i));
  }
  return Math.abs(signedVolume(arr));
}
