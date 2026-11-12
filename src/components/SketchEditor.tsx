import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PlaneId, SketchEntity, Vec2 } from '../cad/types';
import { activeSketchFeature, useStore, type Tool } from '../cad/store';
import { buildProfiles } from '../cad/profile';
import { arcPoints, circlePoints, entityPolyline, entityMidpoint } from '../cad/geom';
import { dist, round, uid } from '../cad/math';

interface Camera {
  x: number;
  y: number;
  zoom: number;
}

const GRID_BASE = 10;
const SNAP_PX = 9;

function gridStep(zoom: number): number {
  let step = GRID_BASE;
  while (step * zoom < 9) step *= 5;
  while (step * zoom > 120) step /= 5;
  return step;
}

interface Hit {
  point: Vec2;
  label: string;
}

function collectSnapPoints(entities: SketchEntity[]): Hit[] {
  const hits: Hit[] = [];
  for (const e of entities) {
    if (e.type === 'line') {
      hits.push({ point: e.a, label: 'endpoint' });
      hits.push({ point: e.b, label: 'endpoint' });
      hits.push({ point: entityMidpoint(e), label: 'midpoint' });
    } else if (e.type === 'circle') {
      hits.push({ point: e.c, label: 'center' });
      hits.push({ point: { x: e.c.x + e.r, y: e.c.y }, label: 'quadrant' });
      hits.push({ point: { x: e.c.x - e.r, y: e.c.y }, label: 'quadrant' });
      hits.push({ point: { x: e.c.x, y: e.c.y + e.r }, label: 'quadrant' });
      hits.push({ point: { x: e.c.x, y: e.c.y - e.r }, label: 'quadrant' });
    } else if (e.type === 'arc') {
      hits.push({ point: e.c, label: 'center' });
      hits.push({ point: { x: e.c.x + e.r * Math.cos(e.a0), y: e.c.y + e.r * Math.sin(e.a0) }, label: 'endpoint' });
      hits.push({ point: { x: e.c.x + e.r * Math.cos(e.a1), y: e.c.y + e.r * Math.sin(e.a1) }, label: 'endpoint' });
      hits.push({ point: entityMidpoint(e), label: 'midpoint' });
    } else if (e.type === 'polyline') {
      for (const p of e.pts) hits.push({ point: p, label: 'endpoint' });
    }
  }
  return hits;
}

export interface SketchEditorProps {
  onExtrude: () => void;
}

export default function SketchEditor({ onExtrude }: SketchEditorProps) {
  const feature = useStore(activeSketchFeature);
  const tool = useStore((s) => s.activeTool);
  const setTool = useStore((s) => s.setTool);
  const addEntity = useStore((s) => s.addSketchEntity);
  const showGrid = useStore((s) => s.showGrid);
  const setSnap = useStore((s) => s.setSnap);

  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, zoom: 4 });
  const [cursor, setCursor] = useState<Vec2>({ x: 0, y: 0 });
  const [pending, setPending] = useState<Vec2[]>([]);
  const [hoverSnap, setHoverSnap] = useState<Hit | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; cam: Camera } | null>(null);
  const [dims, setDims] = useState({ w: 800, h: 600 });

  const entities = useMemo(() => feature?.entities ?? [], [feature]);
  const snapPoints = useMemo(() => collectSnapPoints(entities), [entities]);
  const profiles = useMemo(() => (feature ? buildProfiles(entities) : []), [feature, entities]);

  const size = useRef({ w: 800, h: 600 });
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const apply = () => {
      const r = el.getBoundingClientRect();
      size.current = { w: r.width, h: r.height };
      setDims((prev) =>
        Math.abs(prev.w - r.width) < 1 && Math.abs(prev.h - r.height) < 1
          ? prev
          : { w: r.width, h: r.height },
      );
    };
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    apply();
    return () => ro.disconnect();
  }, []);

  const toScreen = useCallback(
    (p: Vec2): [number, number] => {
      const { w, h } = size.current;
      return [w / 2 + (p.x - camera.x) * camera.zoom, h / 2 - (p.y - camera.y) * camera.zoom];
    },
    [camera],
  );

  useEffect(() => {
    if (!feature) return;
    const { w, h } = size.current;
    if (!w || !h) return;
    const pts: Vec2[] = [];
    for (const e of feature.entities) {
      pts.push(...entityPolyline(e).pts);
      if (e.type === 'circle') {
        pts.push(
          { x: e.c.x - e.r, y: e.c.y - e.r },
          { x: e.c.x + e.r, y: e.c.y + e.r },
        );
      }
    }
    if (!pts.length) {
      setCamera({ x: 0, y: 0, zoom: 4 });
      return;
    }
    const minX = Math.min(...pts.map((p) => p.x));
    const maxX = Math.max(...pts.map((p) => p.x));
    const minY = Math.min(...pts.map((p) => p.y));
    const maxY = Math.max(...pts.map((p) => p.y));
    const spanX = Math.max(maxX - minX, 1);
    const spanY = Math.max(maxY - minY, 1);
    const zoom = Math.min((w * 0.7) / spanX, (h * 0.7) / spanY);
    setCamera({
      x: (minX + maxX) / 2,
      y: (minY + maxY) / 2,
      zoom: Math.min(60, Math.max(0.08, zoom)),
    });
  }, [feature?.id]);

  const toWorld = useCallback(
    (sx: number, sy: number): Vec2 => {
      const { w, h } = size.current;
      return {
        x: camera.x + (sx - w / 2) / camera.zoom,
        y: camera.y - (sy - h / 2) / camera.zoom,
      };
    },
    [camera],
  );

  const snapCursor = useCallback(
    (world: Vec2): { point: Vec2; label: string | null } => {
      const px = camera.zoom;
      let best: Hit | null = null;
      let bestDist = SNAP_PX / px;
      for (const hit of snapPoints) {
        const d = dist(hit.point, world);
        if (d < bestDist) {
          bestDist = d;
          best = hit;
        }
      }
      if (best) return { point: best.point, label: best.label };

      const step = gridStep(camera.zoom);
      const gx = Math.round(world.x / step) * step;
      const gy = Math.round(world.y / step) * step;
      const gp: Vec2 = { x: gx, y: gy };
      if (dist(gp, world) * px < SNAP_PX) {
        return { point: gp, label: 'grid' };
      }
      return { point: { x: round(world.x, 3), y: round(world.y, 3) }, label: null };
    },
    [snapPoints, camera.zoom],
  );

  const finishPolyline = useCallback(
    (pts: Vec2[], closed: boolean) => {
      if (pts.length < 2) return;
      addEntity({ id: uid('e'), type: 'polyline', pts, closed });
    },
    [addEntity],
  );

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    if (dragRef.current) {
      const dx = (sx - dragRef.current.startX) / dragRef.current.cam.zoom;
      const dy = (sy - dragRef.current.startY) / dragRef.current.cam.zoom;
      setCamera({
        ...dragRef.current.cam,
        x: dragRef.current.cam.x - dx,
        y: dragRef.current.cam.y + dy,
      });
      return;
    }
    if (e.buttons === 4 || (e.buttons === 1 && e.shiftKey)) {
      dragRef.current = { startX: sx, startY: sy, cam: camera };
      return;
    }
    const world = toWorld(sx, sy);
    if (tool === 'select') {
      setCursor({ x: round(world.x, 3), y: round(world.y, 3) });
      setSnap({ point: null, label: null });
      return;
    }
    const snapped = snapCursor(world);
    setCursor(snapped.point);
    setHoverSnap(snapped.label ? { point: snapped.point, label: snapped.label } : null);
    setSnap({ point: snapped.point, label: snapped.label });
  };

  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
      e.preventDefault();
      const rect = e.currentTarget.getBoundingClientRect();
      dragRef.current = {
        startX: e.clientX - rect.left,
        startY: e.clientY - rect.top,
        cam: camera,
      };
      return;
    }
    if (e.button !== 0) return;

    if (tool === 'select') {
      const target = (e.target as Element).closest('[data-entity]');
      const id = target?.getAttribute('data-entity') ?? null;
      setSelected(id);
      if (id) useStore.getState().setSelection({ kind: 'entity', id });
      return;
    }

    if (e.detail >= 2) {
      // double click: finish polyline chain
      if ((tool === 'line' || tool === 'polyline') && pending.length > 1) {
        finishPolyline(pending, false);
        setPending([]);
        return;
      }
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const world = toWorld(e.clientX - rect.left, e.clientY - rect.top);
    const p = snapCursor(world).point;
    commitPoint(p);
  };

  const commitPoint = (p: Vec2) => {
    switch (tool) {
      case 'line':
      case 'polyline': {
        if (pending.length === 0) {
          setPending([p]);
          return;
        }
        const last = pending[pending.length - 1];
        if (dist(last, p) < 1e-6) return;
        addEntity({ id: uid('e'), type: 'line', a: last, b: p });
        if (tool === 'line') {
          setPending([p]);
        } else {
          setPending([...pending, p]);
        }
        return;
      }
      case 'rect': {
        if (pending.length === 0) {
          setPending([p]);
          return;
        }
        const a = pending[0];
        if (Math.abs(a.x - p.x) < 1e-6 || Math.abs(a.y - p.y) < 1e-6) {
          setPending([]);
          return;
        }
        addEntity({
          id: uid('e'),
          type: 'polyline',
          pts: [
            { x: a.x, y: a.y },
            { x: p.x, y: a.y },
            { x: p.x, y: p.y },
            { x: a.x, y: p.y },
          ],
          closed: true,
        });
        setPending([]);
        return;
      }
      case 'circle': {
        if (pending.length === 0) {
          setPending([p]);
          return;
        }
        const c = pending[0];
        const r = dist(c, p);
        if (r < 1e-6) {
          setPending([]);
          return;
        }
        addEntity({ id: uid('e'), type: 'circle', c, r });
        setPending([]);
        return;
      }
      case 'arc': {
        if (pending.length < 2) {
          setPending([...pending, p]);
          return;
        }
        const [a, b] = pending;
        const c = circumcenter(a, b, p);
        if (!c) {
          setPending([]);
          return;
        }
        const r = dist(c, a);
        const a0 = Math.atan2(a.y - c.y, a.x - c.x);
        const a1 = Math.atan2(b.y - c.y, b.x - c.x);
        addEntity({ id: uid('e'), type: 'arc', c, r, a0, a1 });
        setPending([]);
        return;
      }
      case 'ellipse': {
        if (pending.length < 2) {
          setPending([...pending, p]);
          return;
        }
        const [center, edge] = pending;
        const rx = Math.abs(edge.x - center.x);
        const ry = Math.abs(edge.y - center.y);
        if (rx < 1e-6 || ry < 1e-6) {
          setPending([]);
          return;
        }
        const pts: Vec2[] = [];
        const n = 96;
        for (let i = 0; i < n; i++) {
          const t = (i / n) * Math.PI * 2;
          pts.push({ x: center.x + rx * Math.cos(t), y: center.y + ry * Math.sin(t) });
        }
        addEntity({ id: uid('e'), type: 'polyline', pts, closed: true });
        setPending([]);
        return;
      }
      case 'polygon': {
        if (pending.length === 0) {
          setPending([p]);
          return;
        }
        const c = pending[0];
        const r = dist(c, p);
        if (r < 1e-6) {
          setPending([]);
          return;
        }
        const sides = 6;
        const pts: Vec2[] = [];
        for (let i = 0; i < sides; i++) {
          const t = (i / sides) * Math.PI * 2 + Math.PI / 2;
          pts.push({ x: c.x + r * Math.cos(t), y: c.y + r * Math.sin(t) });
        }
        addEntity({ id: uid('e'), type: 'polyline', pts, closed: true });
        setPending([]);
        return;
      }
      case 'select':
        break;
    }
  };

  const handleWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const before = toWorld(sx, sy);
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    const zoom = Math.min(200, Math.max(0.05, camera.zoom * factor));
    const after = {
      x: camera.x + (sx - size.current.w / 2) / zoom,
      y: camera.y - (sy - size.current.h / 2) / zoom,
    };
    setCamera({
      zoom,
      x: camera.x + (before.x - after.x),
      y: camera.y + (before.y - after.y),
    });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT')) return;
      if (e.key === 'Escape') {
        setPending([]);
        setTool('select');
      }
      if (e.key === 'Enter' && (tool === 'line' || tool === 'polyline') && pending.length > 1) {
        finishPolyline(pending, false);
        setPending([]);
      }
      if (e.key === 'Delete' && selected) {
        useStore.getState().removeSketchEntity(selected);
        setSelected(null);
      }
      const map: Record<string, Tool> = {
        l: 'line',
        r: 'rect',
        c: 'circle',
        a: 'arc',
        p: 'polygon',
        e: 'ellipse',
        v: 'select',
      };
      if (map[e.key.toLowerCase()] && !e.ctrlKey && !e.metaKey) setTool(map[e.key.toLowerCase()]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tool, pending, selected, finishPolyline, setTool]);

  useEffect(() => {
    setPending([]);
    setSelected(null);
  }, [tool]);

  const gridLines = useMemo(() => {
    if (!showGrid) return { minor: [], major: [] };
    const { w, h } = size.current;
    if (!w || !h) return { minor: [], major: [] };
    const step = gridStep(camera.zoom);
    const minor: [number, number, number, number][] = [];
    const major: [number, number, number, number][] = [];
    const left = toWorld(0, 0);
    const rightP = toWorld(w, h);
    const startX = Math.floor(left.x / step) * step;
    const endX = Math.ceil(rightP.x / step) * step;
    const startY = Math.floor(rightP.y / step) * step;
    const endY = Math.ceil(left.y / step) * step;

    for (let x = startX; x <= endX; x += step) {
      const [sx] = toScreen({ x, y: 0 });
      const isMajor = Math.abs(x / (step * 5) - Math.round(x / (step * 5))) < 1e-6;
      (isMajor ? major : minor).push([sx, 0, sx, h]);
    }
    for (let y = startY; y <= endY; y += step) {
      const [, sy] = toScreen({ x: 0, y });
      const isMajor = Math.abs(y / (step * 5) - Math.round(y / (step * 5))) < 1e-6;
      (isMajor ? major : minor).push([0, sy, w, sy]);
    }
    return { minor, major };
  }, [camera, showGrid, toScreen, toWorld, dims]);

  if (!feature) return null;

  const planeHint = planeLabel(feature.plane);
  const previewPts = (() => {
    if (!pending.length) return null;
    if (tool === 'circle') {
      return circlePoints(pending[0], dist(pending[0], cursor)).map(toScreen);
    }
    if (tool === 'rect') {
      const a = pending[0];
      return [a, { x: cursor.x, y: a.y }, cursor, { x: a.x, y: cursor.y }, a].map(toScreen);
    }
    if (tool === 'line' || tool === 'polyline') {
      return [pending[pending.length - 1], cursor].map(toScreen);
    }
    if (tool === 'polygon') {
      const c = pending[0];
      const r = dist(c, cursor);
      const out: [number, number][] = [];
      for (let i = 0; i <= 6; i++) {
        const t = ((i % 6) / 6) * Math.PI * 2 + Math.PI / 2;
        out.push(toScreen({ x: c.x + r * Math.cos(t), y: c.y + r * Math.sin(t) }));
      }
      return out;
    }
    if (tool === 'arc' && pending.length === 1) {
      return [pending[0], cursor].map(toScreen);
    }
    return null;
  })();

  return (
    <svg
      ref={svgRef}
      className="sketch-overlay"
      onPointerMove={handlePointerMove}
      onPointerDown={handlePointerDown}
      onPointerUp={() => (dragRef.current = null)}
      onPointerLeave={() => {
        dragRef.current = null;
        setHoverSnap(null);
      }}
      onWheel={handleWheel}
      onContextMenu={(e) => {
        e.preventDefault();
        setPending([]);
      }}
      onDoubleClick={() => {
        if ((tool === 'line' || tool === 'polyline') && pending.length > 1) {
          finishPolyline(pending, false);
          setPending([]);
        }
      }}
    >
      <defs>
        <pattern id="none" />
      </defs>

      <rect width="100%" height="100%" fill="var(--bg-0)" />

      <g stroke="var(--grid-minor)" strokeWidth={1}>
        {gridLines.minor.map(([x1, y1, x2, y2], i) => (
          <line key={`mi${i}`} x1={x1} y1={y1} x2={x2} y2={y2} />
        ))}
      </g>
      <g stroke="var(--grid-major)" strokeWidth={1}>
        {gridLines.major.map(([x1, y1, x2, y2], i) => (
          <line key={`ma${i}`} x1={x1} y1={y1} x2={x2} y2={y2} />
        ))}
      </g>

      <AxisLine camera={camera} size={size} toScreen={toScreen} axis="x" dims={dims} />
      <AxisLine camera={camera} size={size} toScreen={toScreen} axis="y" dims={dims} />

      <g>
        {entities.map((e) => (
          <EntityPath
            key={e.id}
            entity={e}
            toScreen={toScreen}
            selected={selected === e.id}
            dim={false}
          />
        ))}
      </g>

      {previewPts && previewPts.length > 1 && (
        <polyline
          points={previewPts.map((p) => p.join(',')).join(' ')}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={1.5}
          strokeDasharray="5 4"
          opacity={0.85}
        />
      )}

      {pending.map((p, i) => {
        const [x, y] = toScreen(p);
        return <circle key={i} cx={x} cy={y} r={3} fill="var(--accent)" />;
      })}

      {hoverSnap && (
        <>
          {(() => {
            const [x, y] = toScreen(hoverSnap.point);
            const glyph = hoverSnap.label === 'endpoint' ? '#e8b04b' : hoverSnap.label === 'midpoint' ? '#4ec98a' : hoverSnap.label === 'center' ? '#f07cd0' : '#4f9cf9';
            return (
              <g pointerEvents="none">
                <rect x={x - 4} y={y - 4} width={8} height={8} fill="none" stroke={glyph} strokeWidth={1.6} transform={hoverSnap.label === 'endpoint' ? `rotate(45 ${x} ${y})` : undefined} />
                <text x={x + 10} y={y - 8} fill={glyph} fontSize={10} fontFamily="ui-monospace, monospace">
                  {hoverSnap.label}
                </text>
              </g>
            );
          })()}
        </>
      )}

      <g pointerEvents="none">
        <text x={12} y={20} fill="var(--text-faint)" fontSize={11} fontFamily="ui-monospace, monospace">
          {planeHint} · ZOOM {(camera.zoom * 25.4 / 96).toFixed(2)}x
        </text>
      </g>
    </svg>
  );
}

function planeLabel(p: PlaneId): string {
  return p;
}

function AxisLine({
  size,
  toScreen,
  axis,
  dims,
}: {
  camera: Camera;
  size: React.MutableRefObject<{ w: number; h: number }>;
  toScreen: (p: Vec2) => [number, number];
  axis: 'x' | 'y';
  dims: { w: number; h: number };
}) {
  const { w, h } = dims;
  if (!w) return null;
  const origin = toScreen({ x: 0, y: 0 });
  if (axis === 'x') {
    return <line x1={0} y1={origin[1]} x2={w} y2={origin[1]} stroke="#3b4257" strokeWidth={1.4} />;
  }
  return <line x1={origin[0]} y1={0} x2={origin[0]} y2={h} stroke="#3b4257" strokeWidth={1.4} />;
}

function EntityPath({
  entity,
  toScreen,
  selected,
  dim,
}: {
  entity: SketchEntity;
  toScreen: (p: Vec2) => [number, number];
  selected: boolean;
  dim: boolean;
}) {
  const color = entity.construction ? 'var(--construction)' : 'var(--accent)';
  const stroke = selected ? '#9cf09c' : color;
  const width = selected ? 2.4 : 1.7;

  if (entity.type === 'circle') {
    const [cx, cy] = toScreen(entity.c);
    const r = Math.abs(entity.r) * (toScreen({ x: 1, y: 0 })[0] - toScreen({ x: 0, y: 0 })[0]);
    return (
      <g data-entity={entity.id}>
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill={dim ? 'rgba(79,156,249,0.03)' : 'none'}
          stroke={stroke}
          strokeWidth={width}
          strokeDasharray={entity.construction ? '6 4' : undefined}
          style={{ cursor: 'pointer' }}
        />
        <circle cx={cx} cy={cy} r={2.5} fill={stroke} />
      </g>
    );
  }

  if (entity.type === 'arc') {
    const pts = arcPoints(entity).map(toScreen);
    return (
      <polyline
        data-entity={entity.id}
        points={pts.map((p) => p.join(',')).join(' ')}
        fill="none"
        stroke={stroke}
        strokeWidth={width}
        strokeDasharray={entity.construction ? '6 4' : undefined}
        style={{ cursor: 'pointer' }}
      />
    );
  }

  const { pts, closed } = entityPolyline(entity);
  const screen = pts.map(toScreen);
  return (
    <polyline
      data-entity={entity.id}
      points={screen.map((p) => p.join(',')).join(' ')}
      fill={closed ? (dim ? 'rgba(79,156,249,0.04)' : 'none') : 'none'}
      stroke={stroke}
      strokeWidth={width}
      strokeLinejoin="round"
      strokeDasharray={entity.construction ? '6 4' : undefined}
      style={{ cursor: 'pointer' }}
    />
  );
}

function circumcenter(a: Vec2, b: Vec2, c: Vec2): Vec2 | null {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-9) return null;
  const ux =
    ((a.x * a.x + a.y * a.y) * (b.y - c.y) +
      (b.x * b.x + b.y * b.y) * (c.y - a.y) +
      (c.x * c.x + c.y * c.y) * (a.y - b.y)) /
    d;
  const uy =
    ((a.x * a.x + a.y * a.y) * (c.x - b.x) +
      (b.x * b.x + b.y * b.y) * (a.x - c.x) +
      (c.x * c.x + c.y * c.y) * (b.x - a.x)) /
    d;
  return { x: ux, y: uy };
}

export { circlePoints };
