// Transactional Blockly installation shared by every storage provider.
import { validateSave } from './save-format.js';
import { registerWorkspaceNames } from './workspace.js';
const stable = v => JSON.stringify(sort(v));
function sort(v) {
  if (Array.isArray(v)) return v.map(sort);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map(k => [k, sort(v[k])]));
  return v;
}
// Stage in a disposable workspace before replacing the visible editor. Both
// the original snapshot and staged canonical snapshot keep layout and loose blocks.
export function prepareSavedWorkspace(data, B) {
  validateSave(data);
  registerWorkspaceNames(data.workspace);
  const scratch = new B.Workspace();
  let canonical;
  B.Events.disable();
  try {
    B.serialization.workspaces.load(data.workspace, scratch);
    canonical = B.serialization.workspaces.save(scratch);
  } finally { scratch.dispose(); B.Events.enable(); }
  if (stable(canonical) !== stable(data.workspace)) throw new Error('The editor could not preserve this workspace exactly. Your current work is unchanged.');
  return canonical;
}
export function installSavedWorkspace(data, B, ws) {
  const canonical = prepareSavedWorkspace(data, B);
  const before = B.serialization.workspaces.save(ws);
  B.Events.disable();
  try {
    B.serialization.workspaces.load(canonical, ws);
    const actual = B.serialization.workspaces.save(ws);
    if (stable(actual) !== stable(canonical)) throw new Error('The editor changed save data while loading.');
    return actual;
  } catch (err) {
    B.serialization.workspaces.load(before, ws);
    throw err;
  } finally { B.Events.enable(); }
}

