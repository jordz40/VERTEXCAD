import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Circle,
  Cylinder,
  Download,
  Eye,
  EyeOff,
  FolderOpen,
  Grid3x3,
  Layers,
  Minus,
  MousePointer2,
  Octagon,
  Pentagon,
  RotateCcw,
  RotateCw,
  Save,
  Spline,
  Square,
  Trash2,
} from 'lucide-react';
import { activeSketchFeature, useStore, type Tool } from '../cad/store';
import { evaluateDoc } from '../cad/model';
import { exportProjectJSON, parseProjectJSON } from '../cad/export';
import type { Doc, Feature, PlaneId, PlaneId as Plane, SketchFeature, SolidFeature } from '../cad/types';
import { round } from '../cad/math';
import ExportDialog from './ExportDialog';
import FeatureDialog from './FeatureDialog';
import ViewportArea from './ViewportArea';

const TOOL_DEFS: { key: Tool; label: string; icon: React.ReactNode }[] = [
  { key: 'select', label: 'Select', icon: <MousePointer2 size={17} /> },
  { key: 'line', label: 'Line', icon: <Minus size={17} /> },
  { key: 'rect', label: 'Rectangle', icon: <Square size={17} /> },
  { key: 'circle', label: 'Circle', icon: <Circle size={17} /> },
  { key: 'arc', label: 'Arc', icon: <Spline size={17} /> },
  { key: 'polyline', label: 'Polyline', icon: <Spline size={17} style={{ transform: 'scaleY(-1)' }} /> },
  { key: 'polygon', label: 'Polygon', icon: <Pentagon size={17} /> },
  { key: 'ellipse', label: 'Ellipse', icon: <Octagon size={17} /> },
];

const PLANES: { key: Plane; label: string }[] = [
  { key: 'XY', label: 'XY' },
  { key: 'XZ', label: 'XZ' },
  { key: 'YZ', label: 'YZ' },
];

type Toast = { msg: string; kind: 'ok' | 'error' } | null;

export default function App() {
  const store = useStore();
  const [exportOpen, setExportOpen] = useState(false);
  const [featureDialog, setFeatureDialog] = useState<'extrude' | 'revolve' | null>(null);
  const [toast, setToast] = useState<Toast>(null);

  const sketch = activeSketchFeature(store);
  const result = useMemo(() => evaluateDoc(store.doc), [store.doc]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2800);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'SELECT');
      if (typing) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        store.undo();
      } else if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
        e.preventDefault();
        store.redo();
      } else if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        exportProjectJSON(store.doc);
        setToast({ msg: 'Project saved', kind: 'ok' });
      } else if (mod && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        setExportOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [store]);

  const openFeature = (which: 'extrude' | 'revolve') => {
    if (!store.doc.features.some((f) => f.type === 'sketch')) {
      setToast({ msg: 'Create a sketch first, then extrude it.', kind: 'error' });
      return;
    }
    if (store.sketchId) store.closeSketch();
    setFeatureDialog(which);
  };

  return (
    <div className="app">
      <div className="titlebar">
        <div className="brand">
          <div className="brand-mark">
            <Box size={14} />
          </div>
          Vertex CAD
        </div>

        <div className="menu-row">
          <button className="menu-btn" onClick={() => store.newDoc()}>
            New
          </button>
          <button className="menu-btn" onClick={() => setExportOpen(true)}>
            Export
          </button>
        </div>

        <input
          className="doc-name"
          value={store.doc.name}
          onChange={(e) => store.setDocName(e.target.value)}
          spellCheck={false}
        />

        <div className="spacer" />

        <button className="ghost" title="Undo (Ctrl+Z)" onClick={store.undo} disabled={!store.past.length}>
          <RotateCcw size={15} />
        </button>
        <button className="ghost" title="Redo (Ctrl+Y)" onClick={store.redo} disabled={!store.future.length}>
          <RotateCw size={15} />
        </button>
        <button
          className="ghost"
          title="Save project (Ctrl+S)"
          onClick={() => {
            exportProjectJSON(store.doc);
            setToast({ msg: 'Project saved', kind: 'ok' });
          }}
        >
          <Save size={15} />
        </button>
        <button
          className="ghost"
          title="Open project"
          onClick={() =>
            openProject(
              (d) => store.loadDoc(d),
              setToast,
            )
          }
        >
          <FolderOpen size={15} />
        </button>
        <button className="primary" onClick={() => setExportOpen(true)}>
          <Download size={14} />
          Export
        </button>
      </div>

      <Ribbon
        sketchOpen={!!sketch}
        activeTool={store.activeTool}
        showGrid={store.showGrid}
        onTool={store.setTool}
        onNewSketch={(plane) => {
          store.newSketch(plane);
          setToast({ msg: `Sketch started on ${plane} plane`, kind: 'ok' });
        }}
        onCloseSketch={store.closeSketch}
        onExtrude={() => openFeature('extrude')}
        onRevolve={() => openFeature('revolve')}
        onToggleGrid={store.toggleGrid}
      />

      <div className="body">
        <Sidebar />
        <ViewportArea />
      </div>

      <StatusBar result={result} />

      {exportOpen && (
        <ExportDialog
          onClose={() => setExportOpen(false)}
          onExported={() => setToast({ msg: 'Export complete', kind: 'ok' })}
        />
      )}

      {featureDialog && (
        <FeatureDialog
          mode={featureDialog}
          doc={store.doc}
          sketchId={store.sketchId}
          onClose={() => setFeatureDialog(null)}
          onSubmit={(f: SolidFeature) => {
            store.addFeature(f);
            setToast({ msg: `${f.type === 'extrude' ? 'Extrusion' : 'Revolution'} created`, kind: 'ok' });
          }}
        />
      )}

      {toast && <div className={`toast ${toast.kind}`}>{toast.msg}</div>}
    </div>
  );
}

function openProject(load: (d: Doc) => void, setToast: (t: Toast) => void) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    const text = await file.text();
    const doc = parseProjectJSON(text);
    if (!doc) {
      setToast({ msg: 'Not a valid Vertex CAD project file.', kind: 'error' });
      return;
    }
    load(doc);
    setToast({ msg: `Opened ${doc.name}`, kind: 'ok' });
  };
  input.click();
}

function Ribbon({
  sketchOpen,
  activeTool,
  showGrid,
  onTool,
  onNewSketch,
  onCloseSketch,
  onExtrude,
  onRevolve,
  onToggleGrid,
}: {
  sketchOpen: boolean;
  activeTool: Tool;
  showGrid: boolean;
  onTool: (t: Tool) => void;
  onNewSketch: (p: PlaneId) => void;
  onCloseSketch: () => void;
  onExtrude: () => void;
  onRevolve: () => void;
  onToggleGrid: () => void;
}) {
  const [planeFlyout, setPlaneFlyout] = useState(false);
  const [drawFlyout, setDrawFlyout] = useState<{ tool: Tool; x: number } | null>(null);
  const flyoutRef = useRef<HTMLDivElement>(null);
  const drawFlyoutRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!planeFlyout && !drawFlyout) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (planeFlyout && flyoutRef.current && !flyoutRef.current.contains(t)) {
        setPlaneFlyout(false);
      }
      if (drawFlyout && drawFlyoutRef.current && !drawFlyoutRef.current.contains(t)) {
        const inRibbon = (t as HTMLElement).closest?.('.ribbon-tools .tool-btn');
        if (!inRibbon) setDrawFlyout(null);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [planeFlyout, drawFlyout]);

  return (
    <div className="ribbon">
      <div className="ribbon-group" style={{ position: 'relative' }} ref={flyoutRef}>
        <div className="ribbon-tools">
          <button className="tool-btn primary" onClick={() => setPlaneFlyout((v) => !v)}>
            <span className="icon-wrap">
              <Square size={17} />
            </span>
            Sketch
          </button>
          {planeFlyout && (
            <div className="flyout">
              {PLANES.map((p) => (
                <button
                  key={p.key}
                  className="flyout-item"
                  data-plane={p.key}
                  onClick={() => {
                    onNewSketch(p.key);
                    setPlaneFlyout(false);
                  }}
                >
                  <Layers size={13} />
                  Sketch on {p.label} plane
                </button>
              ))}
            </div>
          )}
          {sketchOpen && (
            <button className="tool-btn" onClick={onCloseSketch}>
              <span className="icon-wrap">
                <Save size={17} />
              </span>
              Finish
            </button>
          )}
        </div>
        <div className="ribbon-label">Sketch</div>
      </div>

      <div className="ribbon-group">
        <div className="ribbon-tools">
          <button className="tool-btn" onClick={onExtrude} title="Extrude a profile">
            <span className="icon-wrap">
              <Cylinder size={17} />
            </span>
            Extrude
          </button>
          <button className="tool-btn" onClick={onRevolve} title="Revolve a profile">
            <span className="icon-wrap">
              <RotateCw size={17} />
            </span>
            Revolve
          </button>
        </div>
        <div className="ribbon-label">Create</div>
      </div>

      <div className="ribbon-group">
        <div className="ribbon-tools">
          {TOOL_DEFS.map((t) => (
            <button
              key={t.key}
              className={`tool-btn ${activeTool === t.key && sketchOpen ? 'active' : ''}`}
              onClick={(e) => {
                if (!sketchOpen && t.key !== 'select') {
                  setDrawFlyout({ tool: t.key, x: e.currentTarget.getBoundingClientRect().left });
                  return;
                }
                onTool(t.key);
              }}
              title={sketchOpen ? t.label : `${t.label} — pick a plane to start a sketch`}
            >
              <span className="icon-wrap">{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>
        <div className="ribbon-label">Draw</div>
      </div>

      {drawFlyout && (
        <div
          className="flyout"
          style={{ left: Math.max(8, drawFlyout.x - 10), top: '100%' }}
          ref={drawFlyoutRef}
        >
          <div style={{ padding: '5px 9px 7px', fontSize: 11, color: 'var(--text-faint)' }}>
            Start sketch on plane
          </div>
          {PLANES.map((p) => (
            <button
              key={p.key}
              className="flyout-item"
              data-draw-plane={p.key}
              onClick={() => {
                onNewSketch(p.key);
                onTool(drawFlyout.tool);
                setDrawFlyout(null);
              }}
            >
              <Layers size={13} />
              {p.label} plane
            </button>
          ))}
        </div>
      )}

      <div className="ribbon-group">
        <div className="ribbon-tools">
          <button className={`tool-btn ${showGrid ? 'active' : ''}`} onClick={onToggleGrid}>
            <span className="icon-wrap">
              <Grid3x3 size={17} />
            </span>
            Grid
          </button>
        </div>
        <div className="ribbon-label">View</div>
      </div>
    </div>
  );
}

function Sidebar() {
  const store = useStore();
  const selection = store.selection;
  const selected = store.doc.features.find((f) => f.id === selection.id);
  const editing = store.doc.features.find((f) => f.id === store.sketchId);

  return (
    <div className="sidebar">
      <div className="panel-header">
        <span>Model browser</span>
        <span style={{ fontSize: 10 }}>{store.doc.features.length}</span>
      </div>
      <div className="tree">
        {store.doc.features.length === 0 && (
          <div className="tree-empty">
            No features yet.
            <br />
            Click <b>Sketch</b> to start drawing.
          </div>
        )}
        {store.doc.features.map((f) => (
          <div
            key={f.id}
            className={`tree-item ${selection.id === f.id ? 'selected' : ''} ${f.suppressed ? 'suppressed' : ''}`}
            onClick={() => store.setSelection({ kind: 'feature', id: f.id })}
            onDoubleClick={() => {
              if (f.type === 'sketch') store.editSketch(f.id);
            }}
            title={f.type === 'sketch' ? 'Double-click to edit sketch' : f.name}
          >
            <span className="icon">{iconForFeature(f)}</span>
            <span className="name">{f.name}</span>
            <span className="badge" style={{ opacity: 0.55 }}>
              {f.type === 'sketch' ? (f as SketchFeature).plane : (f as SolidFeature).operation}
            </span>
            <button
              className="eye"
              title={f.suppressed ? 'Unsuppress' : 'Suppress'}
              onClick={(e) => {
                e.stopPropagation();
                store.toggleSuppressed(f.id);
              }}
            >
              {f.suppressed ? <EyeOff size={13} /> : <Eye size={13} />}
            </button>
          </div>
        ))}
      </div>

      <div className="properties">
        {!selected && editing && editing.type === 'sketch' && (
          <>
            <div className="prop-title">
              <Square size={13} /> {editing.name}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--text-dim)', lineHeight: 1.7 }}>
              Plane: <b>{editing.plane}</b>
              <br />
              Entities: <b>{editing.entities.length}</b>
            </div>
            <div className="info-box" style={{ marginTop: 10 }}>
              Draw a closed profile, then use <b>Extrude</b> or <b>Revolve</b> to create a solid.
            </div>
          </>
        )}

        {selected && selected.type === 'sketch' && (
          <>
            <div className="prop-title">
              <Square size={13} /> {selected.name}
            </div>
            <div className="prop-row">
              <label>Plane</label>
              <select
                value={selected.plane}
                onChange={(e) => store.updateFeature(selected.id, { plane: e.target.value as PlaneId })}
              >
                {PLANES.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="prop-row">
              <label>Entities</label>
              <span style={{ fontSize: 12 }}>{selected.entities.length}</span>
            </div>
            <button
              style={{ width: '100%', justifyContent: 'center', marginTop: 4 }}
              onClick={() => store.editSketch(selected.id)}
            >
              Edit sketch
            </button>
          </>
        )}

        {selected && selected.type === 'extrude' && (
          <>
            <div className="prop-title">
              <Cylinder size={13} /> {selected.name}
            </div>
            <div className="prop-row">
              <label>Distance</label>
              <input
                type="number"
                value={selected.distance}
                onChange={(e) => store.updateFeature(selected.id, { distance: parseFloat(e.target.value) || 0 })}
              />
            </div>
            <div className="prop-row">
              <label>Operation</label>
              <div className="chips" style={{ flex: 1 }}>
                {(['add', 'cut', 'intersect'] as const).map((op) => (
                  <button
                    key={op}
                    className={`chip ${selected.operation === op ? 'active' : ''}`}
                    onClick={() => store.updateFeature(selected.id, { operation: op })}
                  >
                    {op}
                  </button>
                ))}
              </div>
            </div>
            <div className="prop-row">
              <label>Profile</label>
              <span style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>
                {store.doc.features.find((f) => f.id === selected.sketchId)?.name ?? 'missing'}
              </span>
            </div>
          </>
        )}

        {selected && selected.type === 'revolve' && (
          <>
            <div className="prop-title">
              <RotateCw size={13} /> {selected.name}
            </div>
            <div className="prop-row">
              <label>Angle</label>
              <input
                type="number"
                value={selected.angle}
                onChange={(e) => store.updateFeature(selected.id, { angle: parseFloat(e.target.value) || 0 })}
              />
            </div>
            <div className="prop-row">
              <label>Segments</label>
              <input
                type="number"
                value={selected.segments}
                onChange={(e) => store.updateFeature(selected.id, { segments: parseInt(e.target.value) || 32 })}
              />
            </div>
          </>
        )}

        {selected && (
          <button
            style={{ width: '100%', justifyContent: 'center', marginTop: 6, color: 'var(--danger)' }}
            onClick={() => store.removeFeature(selected.id)}
          >
            <Trash2 size={13} /> Delete feature
          </button>
        )}

        {!selected && !editing && (
          <div style={{ fontSize: 11.5, color: 'var(--text-faint)', lineHeight: 1.7 }}>
            Select a feature to edit its parameters.
          </div>
        )}
      </div>
    </div>
  );
}

function iconForFeature(f: Feature) {
  if (f.type === 'sketch') return <Square size={13} />;
  if (f.type === 'extrude') return <Cylinder size={13} />;
  return <RotateCw size={13} />;
}

function StatusBar({ result }: { result: ReturnType<typeof evaluateDoc> }) {
  const store = useStore();
  const snap = store.snap;
  const stats = useMemo(() => {
    if (!result.geometry) return null;
    result.geometry.computeBoundingBox();
    const bb = result.geometry.boundingBox!;
    return {
      size: [bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z],
      tris: result.geometry.getAttribute('position').count / 3,
    };
  }, [result]);

  return (
    <div className="statusbar">
      <span className="field">
        <b>Tool</b> {store.activeTool}
      </span>
      {snap.point && (
        <span className="field">
          <b>X</b> {round(snap.point.x, 2)} <b>Y</b> {round(snap.point.y, 2)}
        </span>
      )}
      {snap.label && (
        <span className="field" style={{ color: 'var(--ok)' }}>
          snap:{snap.label}
        </span>
      )}
      {stats && (
        <>
          <span className="field">
            <b>Size</b> {stats.size.map((s) => round(s, 1)).join(' × ')} mm
          </span>
          <span className="field">
            <b>Tris</b> {stats.tris.toLocaleString()}
          </span>
        </>
      )}
      <span className="msg">{store.lastAction}</span>
      {store.sketchId && <span className="badge sketch">SKETCH</span>}
      {!store.sketchId && result.geometry && <span className="badge solid">SOLID</span>}
    </div>
  );
}
