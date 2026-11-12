export interface Vec2 {
  x: number;
  y: number;
}

export type PlaneId = 'XY' | 'XZ' | 'YZ';

export interface EntityBase {
  id: string;
  construction?: boolean;
}

export interface LineEntity extends EntityBase {
  type: 'line';
  a: Vec2;
  b: Vec2;
}

export interface CircleEntity extends EntityBase {
  type: 'circle';
  c: Vec2;
  r: number;
}

export interface ArcEntity extends EntityBase {
  type: 'arc';
  c: Vec2;
  r: number;
  a0: number;
  a1: number;
}

export interface PolylineEntity extends EntityBase {
  type: 'polyline';
  pts: Vec2[];
  closed: boolean;
}

export type SketchEntity = LineEntity | CircleEntity | ArcEntity | PolylineEntity;
export type EntityType = SketchEntity['type'];

export interface SketchFeature {
  type: 'sketch';
  id: string;
  name: string;
  plane: PlaneId;
  offset: number;
  entities: SketchEntity[];
  visible: boolean;
  suppressed: boolean;
}

export type BoolOp = 'add' | 'cut' | 'intersect';

export interface ExtrudeFeature {
  type: 'extrude';
  id: string;
  name: string;
  sketchId: string;
  distance: number;
  direction: 'one' | 'symmetric';
  operation: BoolOp;
  suppressed: boolean;
}

export interface RevolveFeature {
  type: 'revolve';
  id: string;
  name: string;
  sketchId: string;
  axisOrigin: Vec2;
  axisDir: Vec2;
  angle: number;
  segments: number;
  operation: BoolOp;
  suppressed: boolean;
}

export type Feature = SketchFeature | ExtrudeFeature | RevolveFeature;
export type SolidFeature = ExtrudeFeature | RevolveFeature;

export interface Doc {
  name: string;
  features: Feature[];
  seq: number;
}

export interface Profile {
  outer: Vec2[];
  holes: Vec2[][];
}

export interface Pt {
  x: number;
  y: number;
  z: number;
}

export interface Edge {
  a: Pt;
  b: Pt;
}
