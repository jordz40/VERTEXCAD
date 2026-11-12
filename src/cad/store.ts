import { create } from 'zustand';
import type {
  Doc,
  Feature,
  PlaneId,
  SketchEntity,
  SketchFeature,
  SolidFeature,
  Vec2,
} from './types';
import { uid } from './math';
import { buildProfiles } from './profile';

export type Tool =
  | 'select'
  | 'line'
  | 'rect'
  | 'circle'
  | 'arc'
  | 'polyline'
  | 'ellipse'
  | 'polygon';

export interface Selection {
  kind: 'feature' | 'entity' | 'none';
  id: string | null;
}

export interface SnapState {
  point: Vec2 | null;
  label: string | null;
}

interface HistoryEntry {
  doc: Doc;
  label: string;
}

export interface AppState {
  doc: Doc;
  past: HistoryEntry[];
  future: HistoryEntry[];
  lastAction: string;

  selection: Selection;
  activeTool: Tool;
  sketchId: string | null;
  snap: SnapState;
  showGrid: boolean;
  showDimensions: boolean;
  flyout: string | null;

  newSketch: (plane: PlaneId) => void;
  editSketch: (id: string) => void;
  closeSketch: () => void;
  addSketchEntity: (e: SketchEntity) => void;
  removeSketchEntity: (id: string) => void;
  updateSketchEntity: (id: string, patch: Partial<SketchEntity>) => void;

  addFeature: (f: SolidFeature) => void;
  updateFeature: (id: string, patch: Partial<Feature>) => void;
  removeFeature: (id: string) => void;
  toggleSuppressed: (id: string) => void;
  renameFeature: (id: string, name: string) => void;

  setSelection: (s: Selection) => void;
  setTool: (t: Tool) => void;
  setSnap: (s: SnapState) => void;
  setFlyout: (id: string | null) => void;
  toggleGrid: () => void;
  toggleDimensions: () => void;
  setDocName: (n: string) => void;
  loadDoc: (d: Doc) => void;
  newDoc: () => void;
  undo: () => void;
  redo: () => void;
}

const emptyDoc = (): Doc => ({ name: 'Part1', features: [], seq: 0 });

function cloneDoc(d: Doc): Doc {
  return JSON.parse(JSON.stringify(d)) as Doc;
}

const HISTORY_LIMIT = 60;

export const useStore = create<AppState>((set, get) => {
  const pushHistory = (label: string) => {
    const { doc, past } = get();
    const next = [...past, { doc: cloneDoc(doc), label }];
    if (next.length > HISTORY_LIMIT) next.shift();
    return next;
  };

  const uniqueName = (doc: Doc, base: string): string => {
    const taken = new Set(doc.features.map((f) => f.name));
    let n = 1;
    while (taken.has(`${base}${n}`)) n++;
    return `${base}${n}`;
  };

  const withFeatures = (features: Feature[], label?: string) => {
    const snap = label ? { past: pushHistory(label), future: [] } : {};
    return { ...snap, doc: { ...get().doc, features } };
  };

  return {
    doc: emptyDoc(),
    past: [],
    future: [],
    lastAction: 'Ready',
    selection: { kind: 'none', id: null },
    activeTool: 'select',
    sketchId: null,
    snap: { point: null, label: null },
    showGrid: true,
    showDimensions: true,
    flyout: null,

    newSketch: (plane) => {
      const s = get();
      const sketch: SketchFeature = {
        type: 'sketch',
        id: uid('sk'),
        name: uniqueName(s.doc, 'Sketch'),
        plane,
        offset: 0,
        entities: [],
        visible: true,
        suppressed: false,
      };
      set({
        past: pushHistory('New sketch'),
        future: [],
        doc: { ...s.doc, features: [...s.doc.features, sketch] },
        sketchId: sketch.id,
        activeTool: 'line',
        selection: { kind: 'feature', id: sketch.id },
        lastAction: `Created ${sketch.name} on ${plane} plane`,
      });
    },

    editSketch: (id) => {
      const f = get().doc.features.find((x) => x.id === id);
      if (!f || f.type !== 'sketch') return;
      set({
        sketchId: id,
        activeTool: 'select',
        selection: { kind: 'feature', id },
        lastAction: `Editing ${f.name}`,
      });
    },

    closeSketch: () => {
      const s = get();
      const id = s.sketchId;
      if (!id) return;
      const target = s.doc.features.find((f) => f.id === id);
      const isEmpty = target?.type === 'sketch' && target.entities.length === 0;
      if (isEmpty) {
        set({
          past: pushHistory('Discard empty sketch'),
          future: [],
          doc: { ...s.doc, features: s.doc.features.filter((f) => f.id !== id) },
          sketchId: null,
          activeTool: 'select',
          lastAction: 'Empty sketch discarded',
        });
        return;
      }
      set({ sketchId: null, activeTool: 'select', lastAction: 'Sketch closed' });
    },

    addSketchEntity: (e) => {
      const s = get();
      if (!s.sketchId) return;
      const entity: SketchEntity = { ...e, id: e.id || uid('e') };
      set(
        withFeatures(
          s.doc.features.map((f) =>
            f.id === s.sketchId && f.type === 'sketch'
              ? { ...f, entities: [...f.entities, entity] }
              : f,
          ),
        ),
      );
      set({ lastAction: `Added ${entity.type}` });
    },

    removeSketchEntity: (id) => {
      const s = get();
      if (!s.sketchId) return;
      set(
        withFeatures(
          s.doc.features.map((f) =>
            f.id === s.sketchId && f.type === 'sketch'
              ? { ...f, entities: f.entities.filter((e) => e.id !== id) }
              : f,
          ),
          'Delete entity',
        ),
      );
      set({ lastAction: 'Deleted entity' });
    },

    updateSketchEntity: (id, patch) => {
      const s = get();
      if (!s.sketchId) return;
      set(
        withFeatures(
          s.doc.features.map((f) =>
            f.id === s.sketchId && f.type === 'sketch'
              ? {
                  ...f,
                  entities: f.entities.map((e) =>
                    e.id === id ? ({ ...e, ...patch } as SketchEntity) : e,
                  ),
                }
              : f,
          ),
        ),
      );
    },

    addFeature: (f) => {
      const s = get();
      const named: SolidFeature = {
        ...f,
        name: uniqueName(s.doc, f.type === 'extrude' ? 'Extrusion' : 'Revolution'),
      };
      set({
        past: pushHistory(`Add ${named.name}`),
        future: [],
        doc: { ...s.doc, features: [...s.doc.features, named], seq: s.doc.seq + 1 },
        selection: { kind: 'feature', id: named.id },
        lastAction: `Created ${named.name}`,
      });
    },

    updateFeature: (id, patch) => {
      const s = get();
      set({
        past: pushHistory('Edit feature'),
        future: [],
        doc: {
          ...s.doc,
          features: s.doc.features.map((f) => (f.id === id ? ({ ...f, ...patch } as Feature) : f)),
        },
        lastAction: 'Feature updated',
      });
    },

    removeFeature: (id) => {
      const s = get();
      const target = s.doc.features.find((f) => f.id === id);
      const dependents = s.doc.features.filter((f) => f.type !== 'sketch' && f.sketchId === id);
      const features = s.doc.features.filter(
        (f) => f.id !== id && !(f.type !== 'sketch' && f.sketchId === id),
      );
      set({
        past: pushHistory(`Delete ${target?.name ?? 'feature'}`),
        future: [],
        doc: { ...s.doc, features },
        selection: { kind: 'none', id: null },
        sketchId: s.sketchId === id ? null : s.sketchId,
        lastAction: dependents.length
          ? `Deleted ${target?.name} and ${dependents.length} dependent feature(s)`
          : `Deleted ${target?.name ?? 'feature'}`,
      });
    },

    toggleSuppressed: (id) => {
      const s = get();
      set({
        past: pushHistory('Toggle suppress'),
        future: [],
        doc: {
          ...s.doc,
          features: s.doc.features.map((f) =>
            f.id === id ? ({ ...f, suppressed: !f.suppressed } as Feature) : f,
          ),
        },
      });
    },

    renameFeature: (id, name) => {
      const s = get();
      set({
        doc: { ...s.doc, features: s.doc.features.map((f) => (f.id === id ? { ...f, name } : f)) },
      });
    },

    setSelection: (selection) => set({ selection }),
    setTool: (activeTool) => set({ activeTool }),
    setSnap: (snap) => set({ snap }),
    setFlyout: (flyout) => set({ flyout }),
    toggleGrid: () => set((s) => ({ showGrid: !s.showGrid })),
    toggleDimensions: () => set((s) => ({ showDimensions: !s.showDimensions })),
    setDocName: (name) => set((s) => ({ doc: { ...s.doc, name } })),

    loadDoc: (d) =>
      set({
        doc: d,
        past: [],
        future: [],
        sketchId: null,
        selection: { kind: 'none', id: null },
        lastAction: `Opened ${d.name}`,
      }),

    newDoc: () =>
      set({
        doc: emptyDoc(),
        past: [],
        future: [],
        sketchId: null,
        selection: { kind: 'none', id: null },
        activeTool: 'select',
        lastAction: 'New document',
      }),

    undo: () =>
      set((s) => {
        if (!s.past.length) return s;
        const entry = s.past[s.past.length - 1];
        return {
          past: s.past.slice(0, -1),
          future: [...s.future, { doc: cloneDoc(s.doc), label: entry.label }],
          doc: entry.doc,
          sketchId: null,
          lastAction: `Undo: ${entry.label}`,
        };
      }),

    redo: () =>
      set((s) => {
        if (!s.future.length) return s;
        const entry = s.future[s.future.length - 1];
        return {
          future: s.future.slice(0, -1),
          past: [...s.past, { doc: cloneDoc(s.doc), label: entry.label }],
          doc: entry.doc,
          sketchId: null,
          lastAction: `Redo: ${entry.label}`,
        };
      }),
  };
});

export function activeSketchFeature(state: AppState): SketchFeature | null {
  if (!state.sketchId) return null;
  const f = state.doc.features.find((x) => x.id === state.sketchId);
  return f && f.type === 'sketch' ? f : null;
}

export function sketchProfiles(state: AppState) {
  const f = activeSketchFeature(state);
  return f ? buildProfiles(f.entities) : [];
}
