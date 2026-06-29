/**
 * InterfaceMode — Library entry point for embedding in any website.
 *
 * Usage (UMD):
 *   <script src="/path/to/im.umd.js"></script>
 *   <script>
 *     new InterfaceMode.InterfaceModeRuntime({ sitePack: window.mySitePack });
 *   </script>
 *
 * Usage (ESM):
 *   import { InterfaceModeRuntime } from './im.es.js';
 *   new InterfaceModeRuntime({ sitePack });
 */

export { InterfaceModeRuntime } from './runtime';
export { loadSettings, saveSettings, defaultSettings, isConfigured, PROVIDERS } from './settings';
export type {
  SitePack,
  Playbook,
  PlaybookStep,
  ToolCommand,
  ToolResult,
  BlockedActionRule,
  FindSpec,
  AgentMessage,
  PageSnapshot,
  SnapshotElement,
  InterfaceModeConfig,
} from './types';
