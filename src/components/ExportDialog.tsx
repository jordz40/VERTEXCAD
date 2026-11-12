import { useState } from 'react';
import { useStore } from '../cad/store';
import { evaluateDoc } from '../cad/model';
import {
  exportDrawingDXF,
  exportOBJ,
  exportSTL,
  exportSketchDXF,
  download,
} from '../cad/export';
import { exportDrawingPDF, SHEET_SIZES, type SheetSize } from '../cad/pdf';
import type { ViewKind } from '../cad/drawing';
import { activeSketchFeature } from '../cad/store';

interface Props {
  onClose: () => void;
  onExported?: () => void;
}

type Kind = 'stl' | 'obj' | 'dxf-sketch' | 'dxf-drawing' | 'pdf';

export default function ExportDialog({ onClose, onExported }: Props) {
  const doc = useStore((s) => s.doc);
  const sketchId = useStore((s) => s.sketchId);
  const [kind, setKind] = useState<Kind>('stl');
  const [binary, setBinary] = useState(true);
  const [sheet, setSheet] = useState<SheetSize>('A3');
  const [view, setView] = useState<ViewKind>('front');
  const [hidden, setHidden] = useState(true);

  const result = evaluateDoc(doc);
  const hasSolid = !!result.geometry;
  const sketch = activeSketchFeature(useStore.getState());
  const sketchFeatures = doc.features.filter((f) => f.type === 'sketch');

  const run = () => {
    if (kind === 'stl') {
      if (!result.geometry) return;
      exportSTL(result.geometry, doc.name, binary);
    } else if (kind === 'obj') {
      if (!result.geometry) return;
      exportOBJ(result.geometry, doc.name);
    } else if (kind === 'dxf-sketch') {
      const target = sketch?.id ?? sketchFeatures[sketchFeatures.length - 1]?.id;
      if (!target) return;
      exportSketchDXF(doc, target, doc.name);
    } else if (kind === 'dxf-drawing') {
      exportDrawingDXF(doc, view, doc.name);
    } else if (kind === 'pdf') {
      exportDrawingPDF(doc, { sheet, views: ['front', 'top', 'right', 'iso'], hiddenLines: hidden });
    }
    onExported?.();
    onClose();
  };

  const options: { key: Kind; label: string; desc: string; enabled: boolean }[] = [
    { key: 'stl', label: 'STL (3D print)', desc: 'Binary or ASCII mesh — for slicers', enabled: hasSolid },
    { key: 'obj', label: 'OBJ (mesh)', desc: 'Triangle mesh for other 3D tools', enabled: hasSolid },
    { key: 'dxf-sketch', label: 'DXF (sketch)', desc: '2D sketch geometry as DXF', enabled: sketchFeatures.length > 0 },
    { key: 'dxf-drawing', label: 'DXF (view)', desc: 'Projected view edges as DXF', enabled: hasSolid },
    { key: 'pdf', label: 'PDF (drawing sheet)', desc: 'Standard multiview sheet with title block', enabled: hasSolid },
  ];

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" style={{ width: 480 }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          Export
          <button className="ghost" onClick={onClose} style={{ padding: '2px 8px' }}>
            ✕
          </button>
        </div>
        <div className="dialog-body">
          <div className="field-group">
            <label>Format</label>
            <select value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
              {options.map((o) => (
                <option key={o.key} value={o.key} disabled={!o.enabled}>
                  {o.label}
                </option>
              ))}
            </select>
            <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 5 }}>
              {options.find((o) => o.key === kind)?.desc}
            </div>
          </div>

          {(kind === 'stl' || kind === 'obj') && !hasSolid && (
            <div className="warn-box">No solid body yet. Create a sketch and extrude it first.</div>
          )}

          {kind === 'stl' && (
            <label className="checkbox-row">
              <input type="checkbox" checked={binary} onChange={(e) => setBinary(e.target.checked)} />
              Binary STL (smaller, preferred by slicers)
            </label>
          )}

          {kind === 'dxf-drawing' && (
            <div className="field-group">
              <label>Projected view</label>
              <div className="seg">
                {(['front', 'top', 'right', 'iso'] as ViewKind[]).map((v) => (
                  <button key={v} className={view === v ? 'active' : ''} onClick={() => setView(v)}>
                    {v.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
          )}

          {kind === 'pdf' && (
            <>
              <div className="field-group">
                <label>Sheet size</label>
                <div className="seg">
                  {(Object.keys(SHEET_SIZES) as SheetSize[]).map((s) => (
                    <button key={s} className={sheet === s ? 'active' : ''} onClick={() => setSheet(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
              <label className="checkbox-row">
                <input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} />
                Include hidden lines (gray, dashed)
              </label>
              <div className="info-box">
                Sheet contains front, top, right, and isometric views with a title block. Scale is chosen
                automatically to fit the sheet.
              </div>
            </>
          )}

          {kind === 'dxf-sketch' && (
            <div className="info-box">
              Exports the active sketch (or last sketch) with both outline and construction geometry on
              separate layers.
            </div>
          )}
        </div>
        <div className="dialog-foot">
          <button onClick={onClose}>Cancel</button>
          <button
            className="primary"
            onClick={run}
            disabled={!options.find((o) => o.key === kind)?.enabled}
          >
            Export
          </button>
        </div>
      </div>
    </div>
  );
}

export { download };
