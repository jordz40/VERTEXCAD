import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../cad/store';
import { evaluateDoc } from '../cad/model';
import { layoutSheet, projectView } from '../cad/drawing';
import { SHEET_SIZES, type SheetSize } from '../cad/pdf';
import type { ViewKind } from '../cad/drawing';

interface Props {
  sheet: SheetSize;
  views: ViewKind[];
  hiddenLines: boolean;
}

export default function DrawingPreview({ sheet, views, hiddenLines }: Props) {
  const doc = useStore((s) => s.doc);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState({ w: 1200, h: 800 });

  const result = useMemo(() => evaluateDoc(doc), [doc]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const apply = () => {
      const r = el.getBoundingClientRect();
      setBox((prev) =>
        Math.abs(prev.w - r.width) < 2 && Math.abs(prev.h - r.height) < 2
          ? prev
          : { w: r.width, h: r.height },
      );
    };
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    apply();
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const size = SHEET_SIZES[sheet];
    const DPR = Math.min(window.devicePixelRatio || 1, 2);
    const pxPerMm = Math.max(
      0.6,
      Math.min((box.w - 44) / size.width, (box.h - 70) / size.height),
    );

    canvas.width = Math.round(size.width * pxPerMm * DPR);
    canvas.height = Math.round(size.height * pxPerMm * DPR);
    canvas.style.width = `${Math.round(size.width * pxPerMm)}px`;
    canvas.style.height = `${Math.round(size.height * pxPerMm)}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size.width * pxPerMm, size.height * pxPerMm);

    const m = (v: number) => v * pxPerMm;

    ctx.strokeStyle = '#111';
    ctx.lineWidth = 1.4;
    ctx.strokeRect(m(6), m(6), m(size.width - 12), m(size.height - 12));

    const parts = views
      .map((kind) => ({
        kind,
        projected: projectView(result.geometry, result.edges, kind, {
          hiddenLines: hiddenLines && kind !== 'iso',
        }),
      }))
      .filter((p) => p.projected.segs.length > 0);

    if (!parts.length) {
      ctx.fillStyle = '#999';
      ctx.font = `${m(4)}px "Segoe UI", sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('No solid body to draw', m(size.width / 2), m(size.height / 2));
      return;
    }

    const layout = layoutSheet(size, parts, 34);

    for (const view of layout.views) {
      const s = view.scale;
      const toX = (x: number) => m(view.x + x * s);
      const toY = (y: number) => m(view.y - y * s);

      ctx.strokeStyle = '#111';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      for (const run of view.projected.visible) {
        for (let i = 1; i < run.length; i++) {
          ctx.moveTo(toX(run[i - 1][0]), toY(run[i - 1][1]));
          ctx.lineTo(toX(run[i][0]), toY(run[i][1]));
        }
      }
      ctx.stroke();

      if (hiddenLines && view.kind !== 'iso') {
        ctx.strokeStyle = '#8c8c8c';
        ctx.lineWidth = 1;
        ctx.setLineDash([m(2.2), m(1.4)]);
        ctx.beginPath();
        for (const run of view.projected.hidden) {
          for (let i = 1; i < run.length; i++) {
            ctx.moveTo(toX(run[i - 1][0]), toY(run[i - 1][1]));
            ctx.lineTo(toX(run[i][0]), toY(run[i][1]));
          }
        }
        ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.fillStyle = '#333';
      ctx.font = `bold ${m(3.2)}px "Segoe UI", sans-serif`;
      ctx.textAlign = 'left';
      ctx.fillText(
        labelFor(view.kind),
        toX(view.projected.min[0]),
        toY(view.projected.min[1]) + m(6),
      );
    }

    drawTitleBlockCanvas(ctx, m, doc.name, layout.scale, size, parts.length);
  }, [doc, result, sheet, views, hiddenLines, box]);

  return (
    <div className="drawing-shell" ref={wrapRef}>
      <canvas ref={canvasRef} className="sheet-canvas" />
    </div>
  );
}

function labelFor(k: ViewKind): string {
  return k === 'front' ? 'FRONT VIEW' : k === 'top' ? 'TOP VIEW' : k === 'right' ? 'RIGHT VIEW' : 'ISOMETRIC VIEW';
}

function drawTitleBlockCanvas(
  ctx: CanvasRenderingContext2D,
  m: (v: number) => number,
  name: string,
  scale: number,
  sheet: { width: number; height: number },
  viewCount: number,
) {
  const w = Math.min(150, sheet.width * 0.5);
  const h = 34;
  const x = sheet.width - 6 - w;
  const y = sheet.height - 6 - h;

  ctx.strokeStyle = '#111';
  ctx.lineWidth = 1.4;
  ctx.strokeRect(m(x), m(y), m(w), m(h));

  const rowH = h / 3;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(m(x), m(y + rowH));
  ctx.lineTo(m(x + w), m(y + rowH));
  ctx.moveTo(m(x), m(y + rowH * 2));
  ctx.lineTo(m(x + w), m(y + rowH * 2));
  ctx.moveTo(m(x + w * 0.6), m(y));
  ctx.lineTo(m(x + w * 0.6), m(y + h));
  ctx.stroke();

  const cell = (cx: number, cy: number, label: string, value: string, big = false) => {
    ctx.fillStyle = '#8a8a8a';
    ctx.font = `${m(2.2)}px "Segoe UI", sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillText(label, m(cx), m(cy));
    ctx.fillStyle = '#111';
    ctx.font = `bold ${m(big ? 5.2 : 3.6)}px "Segoe UI", sans-serif`;
    ctx.fillText(value, m(cx), m(cy + 5));
  };

  cell(x + 4, y + 6, 'TITLE', name.toUpperCase(), true);
  cell(x + 4, y + rowH + 6, 'DRAWING NUMBER', 'VC-001');
  cell(x + 4, y + rowH * 2 + 6, 'MATERIAL', 'N/A');
  cell(x + w * 0.6 + 4, y + 6, 'SCALE', `${scale}:1`);
  cell(x + w * 0.6 + 4, y + rowH + 6, 'DATE', new Date().toISOString().slice(0, 10));
  cell(x + w * 0.6 + 4, y + rowH * 2 + 6, 'SHEET', `1 of 1 (${viewCount} views)`);
}
