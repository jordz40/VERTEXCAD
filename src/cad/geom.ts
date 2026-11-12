import type { ArcEntity, CircleEntity, PolylineEntity, SketchEntity, Vec2 } from './types';
import { normalizeAngle } from './math';

const CHORD_ERR = 0.02;

function arcSegments(radius: number, sweep: number): number {
  const r = Math.max(Math.abs(radius), 1e-4);
  const safe = Math.min(1, CHORD_ERR / r);
  const step = 2 * Math.acos(1 - safe);
  const n = Math.ceil(Math.abs(sweep) / Math.max(step, 1e-3));
  return Math.max(2, Math.min(256, n));
}

export function circlePoints(c: Vec2, r: number, segments?: number): Vec2[] {
  const n = segments ?? Math.max(16, Math.min(192, arcSegments(r, Math.PI * 2)));
  const pts: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) });
  }
  return pts;
}

export function arcPoints(e: ArcEntity): Vec2[] {
  let sweep = e.a1 - e.a0;
  if (sweep <= 0) sweep += Math.PI * 2;
  const n = Math.max(2, Math.min(256, arcSegments(e.r, sweep)));
  const pts: Vec2[] = [];
  for (let i = 0; i <= n; i++) {
    const a = e.a0 + (sweep * i) / n;
    pts.push({ x: e.c.x + e.r * Math.cos(a), y: e.c.y + e.r * Math.sin(a) });
  }
  return pts;
}

export function entityPolyline(e: SketchEntity): { pts: Vec2[]; closed: boolean } {
  switch (e.type) {
    case 'line':
      return { pts: [e.a, e.b], closed: false };
    case 'circle':
      return { pts: circlePoints(e.c, e.r), closed: true };
    case 'arc':
      return { pts: arcPoints(e), closed: false };
    case 'polyline': {
      const pts = e.closed && e.pts.length > 2 ? [...e.pts, e.pts[0]] : [...e.pts];
      return { pts, closed: e.closed };
    }
  }
}

export function isClosedEntity(e: SketchEntity): boolean {
  if (e.type === 'circle') return true;
  if (e.type === 'polyline') return e.closed && e.pts.length > 2;
  if (e.type === 'arc') return false;
  return false;
}

export function arcFromThreePoints(c: Vec2, a: Vec2, b: Vec2): ArcEntity {
  const a0 = Math.atan2(a.y - c.y, a.x - c.x);
  const a1 = Math.atan2(b.y - c.y, b.x - c.x);
  return { id: '', type: 'arc', c, r: Math.hypot(a.x - c.x, a.y - c.y), a0, a1 };
}

export function circleFromCenterRadius(c: Vec2, r: number): CircleEntity {
  return { id: '', type: 'circle', c, r };
}

export function polylineLength(pts: Vec2[]): number {
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }
  return total;
}

export function polylineEntity(pts: Vec2[], closed: boolean): PolylineEntity {
  return { id: '', type: 'polyline', pts, closed };
}

export function entityLength(e: SketchEntity): number {
  switch (e.type) {
    case 'line':
      return Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y);
    case 'circle':
      return Math.PI * 2 * Math.abs(e.r);
    case 'arc': {
      let sweep = e.a1 - e.a0;
      if (sweep <= 0) sweep += Math.PI * 2;
      return Math.abs(e.r) * sweep;
    }
    case 'polyline':
      return polylineLength(entityPolyline(e).pts);
  }
}

export function entityMidpoint(e: SketchEntity): Vec2 {
  switch (e.type) {
    case 'line':
      return { x: (e.a.x + e.b.x) / 2, y: (e.a.y + e.b.y) / 2 };
    case 'circle':
      return { ...e.c };
    case 'arc': {
      let sweep = e.a1 - e.a0;
      if (sweep <= 0) sweep += Math.PI * 2;
      const a = e.a0 + sweep / 2;
      return { x: e.c.x + e.r * Math.cos(a), y: e.c.y + e.r * Math.sin(a) };
    }
    case 'polyline': {
      const pts = entityPolyline(e).pts;
      const half = polylineLength(pts) / 2;
      let acc = 0;
      for (let i = 1; i < pts.length; i++) {
        const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
        if (acc + d >= half) {
          const t = d === 0 ? 0 : (half - acc) / d;
          return {
            x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t,
            y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t,
          };
        }
        acc += d;
      }
      return pts[pts.length - 1] ?? { x: 0, y: 0 };
    }
  }
}

export function normalizeAngleForArc(e: ArcEntity): ArcEntity {
  return { ...e, a0: normalizeAngle(e.a0), a1: normalizeAngle(e.a1) };
}

export function offsetEntity(e: SketchEntity, d: number): SketchEntity | null {
  if (e.type === 'circle') {
    const r = e.r + d;
    if (r <= 1e-6) return null;
    return { ...e, r };
  }
  if (e.type === 'line' || e.type === 'polyline') {
    const { pts, closed } = entityPolyline(e);
    const out: Vec2[] = pts.map((p, i) => {
      const prev = pts[Math.max(0, i - 1)];
      const next = pts[Math.min(pts.length - 1, i + 1)];
      const t = { x: next.x - prev.x, y: next.y - prev.y };
      const l = Math.hypot(t.x, t.y) || 1;
      return { x: p.x - (t.y / l) * d, y: p.y + (t.x / l) * d };
    });
    if (e.type === 'polyline') return { ...e, pts: out, closed };
    return { ...e, a: out[0], b: out[out.length - 1] };
  }
  return null;
}
