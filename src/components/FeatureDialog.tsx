import { useEffect, useState } from 'react';
import type { BoolOp, Doc, SketchFeature, SolidFeature, Vec2 } from '../cad/types';
import { uid } from '../cad/math';
import { buildProfiles } from '../cad/profile';

interface Props {
  mode: 'extrude' | 'revolve';
  doc: Doc;
  sketchId: string | null;
  onClose: () => void;
  onSubmit: (f: SolidFeature) => void;
}

const OPS: { key: BoolOp; label: string; hint: string }[] = [
  { key: 'add', label: 'Join', hint: 'Merge with existing body' },
  { key: 'cut', label: 'Cut', hint: 'Subtract from existing body' },
  { key: 'intersect', label: 'Intersect', hint: 'Keep common volume' },
];

export default function FeatureDialog({ mode, doc, sketchId, onClose, onSubmit }: Props) {
  const sketches = doc.features.filter((f): f is SketchFeature => f.type === 'sketch');
  const [target, setTarget] = useState<string>(sketchId ?? sketches[sketches.length - 1]?.id ?? '');
  const [distance, setDistance] = useState(20);
  const [angle, setAngle] = useState(360);
  const [symmetric, setSymmetric] = useState(false);
  const [operation, setOperation] = useState<BoolOp>('add');
  const [axisA, setAxisA] = useState<Vec2>({ x: 0, y: 0 });
  const [axisB, setAxisB] = useState<Vec2>({ x: 0, y: 1 });
  const [segments, setSegments] = useState(64);

  const sketch = sketches.find((s) => s.id === target);
  const profiles = sketch ? buildProfiles(sketch.entities) : [];
  const hasSolid = doc.features.some((f) => f.type !== 'sketch' && !f.suppressed);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const valid = profiles.length > 0;

  const submit = () => {
    if (!valid || !sketch) return;
    if (mode === 'extrude') {
      onSubmit({
        type: 'extrude',
        id: uid('ex'),
        name: '',
        sketchId: sketch.id,
        distance,
        direction: symmetric ? 'symmetric' : 'one',
        operation: hasSolid ? operation : 'add',
        suppressed: false,
      });
    } else {
      onSubmit({
        type: 'revolve',
        id: uid('rv'),
        name: '',
        sketchId: sketch.id,
        axisOrigin: axisA,
        axisDir: { x: axisB.x - axisA.x, y: axisB.y - axisA.y },
        angle,
        segments,
        operation: hasSolid ? operation : 'add',
        suppressed: false,
      });
    }
    onClose();
  };

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          {mode === 'extrude' ? 'Extrude' : 'Revolve'}
          <button className="ghost" onClick={onClose} style={{ padding: '2px 8px' }}>
            ✕
          </button>
        </div>
        <div className="dialog-body">
          <div className="field-group">
            <label>Profile sketch</label>
            <select value={target} onChange={(e) => setTarget(e.target.value)}>
              {sketches.length === 0 && <option value="">No sketches</option>}
              {sketches.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.plane})
                </option>
              ))}
            </select>
          </div>

          {!valid && (
            <div className="warn-box">
              {sketch
                ? 'This sketch has no closed profile. Draw a closed shape (rectangle, circle, or connected lines) before extruding.'
                : 'Select a sketch to use as profile.'}
            </div>
          )}

          {valid && (
            <div className="info-box">
              {profiles.length} closed profile{profiles.length > 1 ? 's' : ''} detected
              {profiles.some((p) => p.holes.length) ? ' (with inner holes)' : ''}.
            </div>
          )}

          {mode === 'extrude' ? (
            <>
              <div className="field-group">
                <label>Distance (mm)</label>
                <input
                  type="number"
                  value={distance}
                  autoFocus
                  onChange={(e) => setDistance(parseFloat(e.target.value) || 0)}
                  onKeyDown={(e) => e.key === 'Enter' && submit()}
                />
              </div>
              <div className="field-group">
                <label>Direction</label>
                <div className="seg">
                  <button className={!symmetric ? 'active' : ''} onClick={() => setSymmetric(false)}>
                    One side
                  </button>
                  <button className={symmetric ? 'active' : ''} onClick={() => setSymmetric(true)}>
                    Symmetric
                  </button>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="field-group">
                <label>Angle (deg)</label>
                <input
                  type="number"
                  value={angle}
                  onChange={(e) => setAngle(parseFloat(e.target.value) || 0)}
                  onKeyDown={(e) => e.key === 'Enter' && submit()}
                />
              </div>
              <div className="field-group">
                <label>Axis start (x, y)</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    type="number"
                    value={axisA.x}
                    onChange={(e) => setAxisA({ ...axisA, x: parseFloat(e.target.value) || 0 })}
                  />
                  <input
                    type="number"
                    value={axisA.y}
                    onChange={(e) => setAxisA({ ...axisA, y: parseFloat(e.target.value) || 0 })}
                  />
                </div>
              </div>
              <div className="field-group">
                <label>Axis end (x, y)</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    type="number"
                    value={axisB.x}
                    onChange={(e) => setAxisB({ ...axisB, x: parseFloat(e.target.value) || 0 })}
                  />
                  <input
                    type="number"
                    value={axisB.y}
                    onChange={(e) => setAxisB({ ...axisB, y: parseFloat(e.target.value) || 0 })}
                  />
                </div>
              </div>
              <div className="field-group">
                <label>Segments</label>
                <input
                  type="number"
                  value={segments}
                  onChange={(e) => setSegments(Math.max(6, Math.min(256, parseInt(e.target.value) || 64)))}
                />
              </div>
            </>
          )}

          {hasSolid && (
            <div className="field-group">
              <label>Boolean operation</label>
              <div className="seg">
                {OPS.map((op) => (
                  <button
                    key={op.key}
                    className={operation === op.key ? 'active' : ''}
                    onClick={() => setOperation(op.key)}
                    title={op.hint}
                  >
                    {op.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="dialog-foot">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={submit} disabled={!valid}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
