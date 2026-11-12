import { useState } from 'react';
import Viewport3D, { type CameraView } from './Viewport3D';
import SketchEditor from './SketchEditor';
import DrawingPreview from './DrawingPreview';
import { useStore } from '../cad/store';
import type { SheetSize } from '../cad/pdf';

type Tab = 'Model' | 'Sketch' | 'Drawing';

export interface ViewStats {
  tris: number;
  volume: number;
  size: [number, number, number] | null;
}

export default function ViewportArea() {
  const sketchId = useStore((s) => s.sketchId);
  const [tab, setTab] = useState<Tab>('Model');
  const [camera, setCamera] = useState<CameraView>('home');
  const [sheet, setSheet] = useState<SheetSize>('A3');
  const [hidden, setHidden] = useState(true);
  const [, setStats] = useState<ViewStats>({ tris: 0, volume: 0, size: null });

  const effective: Tab = sketchId ? 'Sketch' : tab === 'Sketch' ? 'Model' : tab;

  return (
    <div className="viewport">
      <div className="viewport-tabs">
        {(['Model', 'Sketch', 'Drawing'] as Tab[]).map((t) => (
          <button
            key={t}
            className={effective === t ? 'active' : ''}
            onClick={() => {
              if (t === 'Sketch' && !sketchId) return;
              setTab(t);
            }}
            disabled={t === 'Sketch' && !sketchId}
          >
            {t}
          </button>
        ))}
      </div>

      {effective === 'Model' && (
        <>
          <Viewport3D view={camera} onStats={setStats} />
          <div className="view-cube">
            <button onClick={() => setCamera('front')}>FRONT</button>
            <button onClick={() => setCamera('top')}>TOP</button>
            <button onClick={() => setCamera('right')}>RIGHT</button>
            <button onClick={() => setCamera('iso')}>ISO</button>
            <button onClick={() => setCamera('home')} style={{ gridColumn: 'span 2' }}>
              HOME
            </button>
          </div>
        </>
      )}

      {effective === 'Sketch' && <SketchEditor onExtrude={() => setTab('Model')} />}

      {effective === 'Drawing' && (
        <>
          <DrawingPreview sheet={sheet} views={['front', 'top', 'right', 'iso']} hiddenLines={hidden} />
          <div className="view-cube">
            <button onClick={() => setSheet('A4')} className={sheet === 'A4' ? 'active' : ''}>
              A4
            </button>
            <button onClick={() => setSheet('A3')} className={sheet === 'A3' ? 'active' : ''}>
              A3
            </button>
            <button onClick={() => setSheet('A2')} className={sheet === 'A2' ? 'active' : ''}>
              A2
            </button>
            <button onClick={() => setHidden((v) => !v)} style={{ gridColumn: 'span 3' }}>
              {hidden ? 'Hidden lines: ON' : 'Hidden lines: OFF'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
