import './demo-app/styles.css';
import { mountDemoApp } from './demo-app/app';
import { InterfaceModeRuntime } from './framework/runtime';
import { formatSnapshotForAgent, takeSnapshot } from './framework/snapshot';
import { demoSitePack } from './site-packs/demo';
import runtimeGuide from './site-packs/demo/runtime-guide.md?raw';

// Mount the demo merchant app
const root = document.getElementById('root');
if (!root) throw new Error('#root not found');
mountDemoApp(root);

// Mount the floating InterfaceMode assistant (no extra container needed)
const runtime = new InterfaceModeRuntime({
  sitePack: demoSitePack,
  skillsMarkdown: runtimeGuide,
});

// Debug helpers
declare global {
  interface Window {
    __im?: { snapshot: () => string; runtime: InterfaceModeRuntime };
  }
}

window.__im = {
  snapshot: () => formatSnapshotForAgent(takeSnapshot({ overlaySelectors: demoSitePack.overlaySelectors })),
  runtime,
};

console.info('[InterfaceMode] 助手已就绪。调试：window.__im.snapshot()');
