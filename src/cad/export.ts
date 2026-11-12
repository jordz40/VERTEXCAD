import * as THREE from 'three';
import Drawing from 'dxf-writer';
import type { Doc, SketchEntity, Vec2 } from './types';
import type { SolidEdge } from './mesh';
import { arcPoints, entityPolyline } from './geom';
import { deg, signedArea } from './math';
import { buildProfiles } from './profile';
import { evaluateDoc } from './model';

export function download(filename: string, content: BlobPart, mime = 'application/octet-stream') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportSketchDXF(doc: Doc, sketchId: string, fileName: string) {
  const sketch = doc.features.find((f) => f.id === sketchId);
  if (!sketch || sketch.type !== 'sketch') return;

  const d = new Drawing();
  d.setUnits('Millimeters');
  d.addLayer('OUTLINE', Drawing.ACI.WHITE, 'CONTINUOUS');
  d.addLayer('CONSTRUCTION', Drawing.ACI.BLUE, 'DASHED');
  d.addLayer('DIMENSIONS', Drawing.ACI.GREEN, 'CONTINUOUS');

  const drawEntity = (e: SketchEntity, layer: string) => {
    d.setActiveLayer(layer);
    if (e.type === 'circle') {
      d.drawCircle(e.c.x, e.c.y, Math.abs(e.r));
      return;
    }
    if (e.type === 'arc') {
      let sweep = e.a1 - e.a0;
      if (sweep <= 0) sweep += Math.PI * 2;
      d.drawArc(e.c.x, e.c.y, Math.abs(e.r), deg(e.a0), deg(e.a0 + sweep));
      return;
    }
    const { pts, closed } = entityPolyline(e);
    d.drawPolyline(
      pts.map((p) => [p.x, p.y] as [number, number]),
      closed,
    );
  };

  for (const e of sketch.entities) {
    drawEntity(e, e.construction ? 'CONSTRUCTION' : 'OUTLINE');
  }

  const profiles = buildProfiles(sketch.entities);
  d.setActiveLayer('DIMENSIONS');
  for (const p of profiles) {
    const bx = p.outer;
    const minX = Math.min(...bx.map((q) => q.x));
    const maxX = Math.max(...bx.map((q) => q.x));
    const minY = Math.min(...bx.map((q) => q.y));
    const maxY = Math.max(...bx.map((q) => q.y));
    d.drawText((minX + maxX) / 2, maxY + 6, 3, 0, `W ${(maxX - minX).toFixed(1)} x H ${(maxY - minY).toFixed(1)}`);
  }

  const name = fileName.replace(/\.[^.]+$/, '');
  download(`${name}_${sketch.name}.dxf`, d.toDxfString(), 'application/dxf');
}

function projectEdgesForView(edges: SolidEdge[], view: string): [number, number][][] {
  const map = (v: THREE.Vector3): [number, number] => {
    switch (view) {
      case 'front':
        return [v.x, v.y];
      case 'top':
        return [v.x, -v.z];
      case 'right':
        return [v.z, v.y];
      default:
        return [v.x, v.y];
    }
  };
  return edges.map((e) => [map(e.a), map(e.b)]);
}

export function exportDrawingDXF(doc: Doc, view: string, fileName: string) {
  const result = evaluateDoc(doc);
  if (!result.geometry) return;
  const d = new Drawing();
  d.setUnits('Millimeters');
  d.addLayer('0', Drawing.ACI.WHITE, 'CONTINUOUS');
  d.setActiveLayer('0');
  const segs = projectEdgesForView(result.edges, view);
  for (const [a, b] of segs) {
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-5) continue;
    d.drawLine(a[0], a[1], b[0], b[1]);
  }
  const name = fileName.replace(/\.[^.]+$/, '');
  download(`${name}_${view}.dxf`, d.toDxfString(), 'application/dxf');
}

export function exportSTL(geometry: THREE.BufferGeometry, fileName: string, binary = true) {
  const pos = geometry.getAttribute('position');
  const triCount = pos.count / 3;
  const name = fileName.replace(/\.[^.]+$/, '');

  if (!binary) {
    const lines: string[] = [`solid ${name}`];
    for (let i = 0; i < triCount; i++) {
      const a = new THREE.Vector3().fromBufferAttribute(pos, i * 3);
      const b = new THREE.Vector3().fromBufferAttribute(pos, i * 3 + 1);
      const c = new THREE.Vector3().fromBufferAttribute(pos, i * 3 + 2);
      const n = new THREE.Vector3()
        .subVectors(b, a)
        .cross(new THREE.Vector3().subVectors(c, a))
        .normalize();
      lines.push(`  facet normal ${n.x} ${n.y} ${n.z}`);
      lines.push('    outer loop');
      lines.push(`      vertex ${a.x} ${a.y} ${a.z}`);
      lines.push(`      vertex ${b.x} ${b.y} ${b.z}`);
      lines.push(`      vertex ${c.x} ${c.y} ${c.z}`);
      lines.push('    endloop');
      lines.push('  endfacet');
    }
    lines.push(`endsolid ${name}`);
    download(`${name}.stl`, lines.join('\n'), 'model/stl');
    return;
  }

  const buffer = new ArrayBuffer(84 + triCount * 50);
  const view = new DataView(buffer);
  const header = `Vertex CAD binary STL - ${name}`;
  for (let i = 0; i < Math.min(80, header.length); i++) {
    view.setUint8(i, header.charCodeAt(i));
  }
  view.setUint32(80, triCount, true);
  let offset = 84;
  for (let i = 0; i < triCount; i++) {
    const a = new THREE.Vector3().fromBufferAttribute(pos, i * 3);
    const b = new THREE.Vector3().fromBufferAttribute(pos, i * 3 + 1);
    const c = new THREE.Vector3().fromBufferAttribute(pos, i * 3 + 2);
    const n = new THREE.Vector3()
      .subVectors(b, a)
      .cross(new THREE.Vector3().subVectors(c, a))
      .normalize();
    for (const v of [n, a, b, c]) {
      view.setFloat32(offset, v.x, true);
      view.setFloat32(offset + 4, v.y, true);
      view.setFloat32(offset + 8, v.z, true);
      offset += 12;
    }
    view.setUint16(offset, 0, true);
    offset += 2;
  }
  download(`${name}.stl`, buffer, 'model/stl');
}

export function exportOBJ(geometry: THREE.BufferGeometry, fileName: string) {
  const pos = geometry.getAttribute('position');
  const name = fileName.replace(/\.[^.]+$/, '');
  const lines: string[] = [`# Vertex CAD export`, `o ${name}`];
  for (let i = 0; i < pos.count; i++) {
    lines.push(`v ${pos.getX(i).toFixed(6)} ${pos.getY(i).toFixed(6)} ${pos.getZ(i).toFixed(6)}`);
  }
  for (let i = 0; i < pos.count; i += 3) {
    lines.push(`f ${i + 1} ${i + 2} ${i + 3}`);
  }
  download(`${name}.obj`, lines.join('\n'), 'text/plain');
}

export function exportProjectJSON(doc: Doc) {
  const payload = {
    format: 'vertex-cad',
    version: 1,
    savedAt: new Date().toISOString(),
    doc,
  };
  download(`${doc.name}.vcad.json`, JSON.stringify(payload, null, 2), 'application/json');
}

export function parseProjectJSON(text: string): Doc | null {
  try {
    const parsed = JSON.parse(text);
    if (parsed && parsed.format === 'vertex-cad' && parsed.doc) return parsed.doc as Doc;
    if (parsed && Array.isArray(parsed.features)) return parsed as Doc;
    return null;
  } catch {
    return null;
  }
}

export { arcPoints, signedArea };
export type { Vec2 };
