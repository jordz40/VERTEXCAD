import * as THREE from 'three';
import { ADDITION, Brush, Evaluator, INTERSECTION, SUBTRACTION } from 'three-bvh-csg';
import type { Doc, SolidFeature, SketchFeature } from './types';
import { buildExtrudeGeometry, buildRevolveGeometry, extractEdges, type SolidEdge } from './mesh';
import { buildProfiles } from './profile';

export interface SolidResult {
  geometry: THREE.BufferGeometry | null;
  edges: SolidEdge[];
  error: string | null;
  warnings: string[];
}

const WELD_TOL = 1e-4;

function weldGeometry(source: THREE.BufferGeometry): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  const pos = source.getAttribute('position');
  const map = new Map<string, number>();
  const verts: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const key = `${Math.round(x / WELD_TOL)}:${Math.round(y / WELD_TOL)}:${Math.round(z / WELD_TOL)}`;
    let id = map.get(key);
    if (id === undefined) {
      id = verts.length / 3;
      verts.push(x, y, z);
      map.set(key, id);
    }
    indices.push(id);
  }

  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function makeBrush(geometry: THREE.BufferGeometry): Brush {
  const g = weldGeometry(geometry);
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  const brush = new Brush(g, new THREE.MeshStandardMaterial());
  brush.updateMatrixWorld();
  return brush;
}

const evaluator = new Evaluator();
evaluator.attributes = ['position', 'normal'];
evaluator.useGroups = false;
(evaluator as unknown as { useCDTClipping: boolean }).useCDTClipping = true;

function applyBoolean(
  base: THREE.BufferGeometry,
  tool: THREE.BufferGeometry,
  op: 'add' | 'cut' | 'intersect',
): THREE.BufferGeometry | null {
  const a = makeBrush(base);
  const b = makeBrush(tool);
  const opCode = op === 'add' ? ADDITION : op === 'cut' ? SUBTRACTION : INTERSECTION;
  try {
    const result = evaluator.evaluate(a, b, opCode) as Brush;
    const raw = result.geometry;
    const out = raw.index ? raw.toNonIndexed() : raw.clone();
    out.deleteAttribute('uv');
    out.computeVertexNormals();
    return out;
  } catch (err) {
    console.error('CSG failed', err);
    return null;
  }
}

export function sketchOf(doc: Doc, id: string): SketchFeature | undefined {
  const f = doc.features.find((x) => x.id === id);
  return f && f.type === 'sketch' ? f : undefined;
}

export function featureToolGeometry(
  doc: Doc,
  feature: SolidFeature,
  margin = 0,
): THREE.BufferGeometry | null {
  const sketch = sketchOf(doc, feature.sketchId);
  if (!sketch) return null;
  const profiles = buildProfiles(sketch.entities);
  if (!profiles.length) return null;

  if (feature.type === 'extrude') {
    return buildExtrudeGeometry(
      profiles,
      sketch.plane,
      sketch.offset,
      feature.distance,
      feature.direction === 'symmetric',
      margin,
    );
  }
  return buildRevolveGeometry(
    profiles,
    sketch.plane,
    sketch.offset,
    feature.axisOrigin,
    feature.axisDir,
    feature.angle,
    feature.segments,
    margin,
  );
}

function bodyMargin(geometry: THREE.BufferGeometry | null): number {
  if (!geometry) return 1;
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox;
  if (!bb) return 1;
  const diag = bb.getSize(new THREE.Vector3()).length();
  return Math.max(0.5, Math.min(diag * 0.02, 50));
}

export function evaluateDoc(doc: Doc): SolidResult {
  let current: THREE.BufferGeometry | null = null;
  const warnings: string[] = [];
  let error: string | null = null;

  for (const feature of doc.features) {
    if (feature.type === 'sketch') continue;
    if (feature.suppressed) continue;

    const margin = feature.operation === 'cut' ? bodyMargin(current) : 0;
    const tool = featureToolGeometry(doc, feature, margin);
    if (!tool) {
      warnings.push(`${feature.name}: no closed profile found in source sketch`);
      continue;
    }

    if (!current) {
      if (feature.operation === 'cut') {
        warnings.push(`${feature.name}: cut with no existing body, skipping`);
        continue;
      }
      current = tool;
      continue;
    }

    const next = applyBoolean(current, tool, feature.operation);
    if (!next) {
      error = `Boolean operation failed on ${feature.name}`;
      warnings.push(error);
      continue;
    }
    current = next;
  }

  return {
    geometry: current,
    edges: current ? extractEdges(current) : [],
    error,
    warnings,
  };
}

export function solidFeatureCount(doc: Doc): number {
  return doc.features.filter((f) => f.type !== 'sketch' && !f.suppressed).length;
}
