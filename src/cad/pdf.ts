import { jsPDF } from 'jspdf';
import type * as THREE from 'three';
import type { Doc } from './types';
import { evaluateDoc } from './model';
import { layoutSheet, projectView, type ViewKind, type ProjectedView } from './drawing';
import type { SolidEdge } from './mesh';

export type SheetSize = 'A4' | 'A3' | 'A2';

export const SHEET_SIZES: Record<SheetSize, { width: number; height: number }> = {
  A4: { width: 297, height: 210 },
  A3: { width: 420, height: 297 },
  A2: { width: 594, height: 420 },
};

export interface PdfOptions {
  sheet: SheetSize;
  views: ViewKind[];
  hiddenLines: boolean;
}

const TITLE_BLOCK_H = 34;
const BORDER = 6;

function labelText(kind: ViewKind): string {
  switch (kind) {
    case 'front':
      return 'FRONT VIEW';
    case 'top':
      return 'TOP VIEW';
    case 'right':
      return 'RIGHT VIEW';
    case 'iso':
      return 'ISOMETRIC VIEW';
  }
}

function projectForExport(
  geometry: THREE.BufferGeometry | null,
  edges: SolidEdge[],
  kind: ViewKind,
  hiddenLines: boolean,
): ProjectedView {
  return projectView(geometry, edges, kind, { hiddenLines });
}

function drawTitleBlock(
  pdf: jsPDF,
  doc: Doc,
  sheet: { width: number; height: number },
  scale: number,
  viewCount: number,
) {
  const blockW = Math.min(150, sheet.width * 0.5);
  const blockH = TITLE_BLOCK_H;
  const x = sheet.width - BORDER - blockW;
  const y = sheet.height - BORDER - blockH;

  pdf.setLineWidth(0.5);
  pdf.setDrawColor(0, 0, 0);
  pdf.rect(x, y, blockW, blockH);

  const rowH = blockH / 3;
  pdf.setLineWidth(0.3);
  pdf.line(x, y + rowH, x + blockW, y + rowH);
  pdf.line(x, y + rowH * 2, x + blockW, y + rowH * 2);
  pdf.line(x + blockW * 0.6, y, x + blockW * 0.6, y + blockH);

  const text = (tx: number, ty: number, label: string, value: string, size = 7) => {
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(Math.max(4, size - 2));
    pdf.setTextColor(110, 110, 110);
    pdf.text(label, tx, ty);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(size);
    pdf.setTextColor(20, 20, 20);
    pdf.text(value, tx, ty + 4.5);
  };

  text(x + 4, y + 6, 'TITLE', doc.name.toUpperCase(), 10);
  text(x + 4, y + rowH + 6, 'DRAWING NUMBER', 'VC-001', 8);
  text(x + 4, y + rowH * 2 + 6, 'MATERIAL', 'N/A', 8);

  text(x + blockW * 0.6 + 4, y + 6, 'SCALE', `${scale}:1`, 8);
  text(x + blockW * 0.6 + 4, y + rowH + 6, 'DATE', new Date().toISOString().slice(0, 10), 8);
  text(x + blockW * 0.6 + 4, y + rowH * 2 + 6, 'SHEET', `1 of 1 (${viewCount} views)`, 8);

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(6);
  pdf.setTextColor(150, 150, 150);
  pdf.text('Designed in Vertex CAD', sheet.width - BORDER - 2, BORDER + 4, { align: 'right' });
}

export function buildSheet(doc: Doc, opts: PdfOptions) {
  const result = evaluateDoc(doc);
  const sheet = SHEET_SIZES[opts.sheet];
  const parts: { kind: ViewKind; projected: ProjectedView }[] = [];

  for (const kind of opts.views) {
    const projected = projectForExport(result.geometry, result.edges, kind, opts.hiddenLines);
    if (projected.segs.length) parts.push({ kind, projected });
  }

  const layout = layoutSheet(sheet, parts, TITLE_BLOCK_H);
  const pdf = new jsPDF({
    orientation: sheet.width > sheet.height ? 'landscape' : 'portrait',
    unit: 'mm',
    format: [sheet.width, sheet.height],
  });

  pdf.setLineWidth(0.5);
  pdf.setDrawColor(0, 0, 0);
  pdf.rect(BORDER, BORDER, sheet.width - BORDER * 2, sheet.height - BORDER * 2);

  for (const view of layout.views) {
    const s = view.scale;
    const toX = (x: number) => view.x + x * s;
    const toY = (y: number) => view.y - y * s;

    pdf.setLineWidth(0.35);
    pdf.setDrawColor(0, 0, 0);
    for (const run of view.projected.visible) {
      for (let i = 1; i < run.length; i++) {
        const a = run[i - 1];
        const b = run[i];
        pdf.line(toX(a[0]), toY(a[1]), toX(b[0]), toY(b[1]));
      }
    }

    if (opts.hiddenLines) {
      pdf.setDrawColor(140, 140, 140);
      pdf.setLineDashPattern([1.2, 0.8], 0);
      for (const run of view.projected.hidden) {
        for (let i = 1; i < run.length; i++) {
          const a = run[i - 1];
          const b = run[i];
          pdf.line(toX(a[0]), toY(a[1]), toX(b[0]), toY(b[1]));
        }
      }
      pdf.setLineDashPattern([], 0);
    }

    pdf.setDrawColor(0, 0, 0);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(7);
    pdf.setTextColor(30, 30, 30);
    pdf.text(labelText(view.kind), toX(view.projected.min[0]), toY(view.projected.min[1]) + 7);
  }

  drawTitleBlock(pdf, doc, sheet, layout.scale, parts.length);

  return { pdf, layout, warnings: result.warnings };
}

export function exportDrawingPDF(doc: Doc, opts: PdfOptions) {
  const { pdf } = buildSheet(doc, opts);
  pdf.save(`${doc.name}_drawing.pdf`);
}
