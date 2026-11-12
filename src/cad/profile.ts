import type { Profile, SketchEntity, Vec2 } from './types';
import { entityPolyline, isClosedEntity } from './geom';
import { dedupe, dist, pointInPolygon, signedArea } from './math';

const JOIN_TOL = 1e-3;

interface Seg {
  pts: Vec2[];
  used: boolean;
}

interface NodeRef {
  seg: number;
  end: 0 | 1;
}

function key(p: Vec2): string {
  return `${Math.round(p.x / JOIN_TOL)}:${Math.round(p.y / JOIN_TOL)}`;
}

function buildLoops(segments: Seg[]): Vec2[][] {
  const nodes = new Map<string, NodeRef[]>();
  const addNode = (p: Vec2, ref: NodeRef) => {
    const k = key(p);
    const arr = nodes.get(k);
    if (arr) arr.push(ref);
    else nodes.set(k, [ref]);
  };

  segments.forEach((s, i) => {
    addNode(s.pts[0], { seg: i, end: 0 });
    addNode(s.pts[s.pts.length - 1], { seg: i, end: 1 });
  });

  const loops: Vec2[][] = [];

  const takePath = (start: NodeRef): Vec2[] | null => {
    const path: Vec2[] = [];
    let current = start;
    const startKey = key(segments[start.seg].pts[start.end === 0 ? 0 : segments[start.seg].pts.length - 1]);

    for (let guard = 0; guard < segments.length + 2; guard++) {
      const seg = segments[current.seg];
      if (seg.used) break;
      seg.used = true;

      const ordered = current.end === 0 ? seg.pts : [...seg.pts].reverse();
      if (path.length === 0) path.push(...ordered);
      else path.push(...ordered.slice(1));

      const last = ordered[ordered.length - 1];
      const endKey = key(last);
      if (endKey === startKey && path.length > 2) {
        return path;
      }

      const candidates = (nodes.get(endKey) ?? []).filter((r) => !segments[r.seg].used);
      if (candidates.length === 0) return null;

      let next: NodeRef;
      if (candidates.length === 1) {
        next = candidates[0];
      } else {
        const prev = ordered[ordered.length - 2] ?? last;
        const inDir = { x: last.x - prev.x, y: last.y - prev.y };
        const inAngle = Math.atan2(inDir.y, inDir.x);
        let best = Infinity;
        next = candidates[0];
        for (const cand of candidates) {
          const cseg = segments[cand.seg];
          const other = cand.end === 0 ? cseg.pts[cseg.pts.length - 1] : cseg.pts[0];
          const outAngle = Math.atan2(other.y - last.y, other.x - last.x);
          let diff = outAngle - inAngle;
          while (diff <= -Math.PI) diff += Math.PI * 2;
          while (diff > Math.PI) diff -= Math.PI * 2;
          const score = Math.abs(diff);
          if (score < best) {
            best = score;
            next = cand;
          }
        }
      }
      current = next;
    }
    return null;
  };

  segments.forEach((s, i) => {
    if (s.used) return;
    const loop = takePath({ seg: i, end: 0 });
    if (loop) {
      const cleaned = dedupe(loop);
      if (cleaned.length >= 3 && Math.abs(signedArea(cleaned)) > 1e-6) loops.push(cleaned);
    }
  });

  return loops;
}

export function buildProfiles(entities: SketchEntity[]): Profile[] {
  const loops: Vec2[][] = [];
  const open: Seg[] = [];

  for (const e of entities) {
    if (e.construction) continue;
    const { pts, closed } = entityPolyline(e);
    if (pts.length < 2) continue;
    if (closed || isClosedEntity(e)) {
      const cleaned = dedupe(pts);
      if (cleaned.length >= 3 && Math.abs(signedArea(cleaned)) > 1e-6) loops.push(cleaned);
    } else {
      open.push({ pts, used: false });
    }
  }

  loops.push(...buildLoops(open));

  const n = loops.length;
  const depth = new Array<number>(n).fill(0);
  const parent = new Array<number>(n).fill(-1);

  for (let i = 0; i < n; i++) {
    const probe = loops[i][0];
    let bestArea = Infinity;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      if (!pointInPolygon(probe, loops[j])) continue;
      const area = Math.abs(signedArea(loops[j]));
      if (area < bestArea) {
        bestArea = area;
        parent[i] = j;
      }
    }
  }

  for (let i = 0; i < n; i++) {
    let d = 0;
    let p = parent[i];
    let guard = 0;
    while (p !== -1 && guard++ < n) {
      d++;
      p = parent[p];
    }
    depth[i] = d;
  }

  const profiles: Profile[] = [];
  for (let i = 0; i < n; i++) {
    if (depth[i] % 2 !== 0) continue;
    const holes: Vec2[][] = [];
    for (let j = 0; j < n; j++) {
      if (parent[j] === i && depth[j] === depth[i] + 1) holes.push(loops[j]);
    }
    profiles.push({ outer: loops[i], holes });
  }

  return profiles;
}

export function profilesBBox(profiles: Profile[]): { min: Vec2; max: Vec2 } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of profiles) {
    for (const q of p.outer) {
      if (q.x < minX) minX = q.x;
      if (q.y < minY) minY = q.y;
      if (q.x > maxX) maxX = q.x;
      if (q.y > maxY) maxY = q.y;
    }
  }
  if (!Number.isFinite(minX)) return { min: { x: 0, y: 0 }, max: { x: 0, y: 0 } };
  return { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } };
}

export function loopPerimeter(pts: Vec2[]): number {
  let total = 0;
  for (let i = 0; i < pts.length; i++) {
    total += dist(pts[i], pts[(i + 1) % pts.length]);
  }
  return total;
}
