import { jsonToProgram } from './blocks-json.js';
import { emptyProgram } from './blocks.js';
import { prepareProgram } from './compatibility.js';
import { installSavedWorkspace, prepareSavedWorkspace } from './workspace-transaction.js';

// Raw editor storage and executable validation have different boundaries.
// A workspace may be valid/editable while intentionally unfinished or disabled.
export function createWorkspaceSession({ state, getWorkspace, getBlockly, persist, status,
  guard = () => {}, beforeRestore = () => {}, afterRestore = () => {} }) {
  const editor = () => {
    const ws = getWorkspace();
    if (!ws) throw new Error('The block editor is unavailable.');
    return ws;
  };
  function remember(snapshot) {
    state.ws = snapshot;
    // Raw editing never invokes the executable converter. Discard any cached
    // AST so no later action can accidentally run the previous workspace.
    state.program = emptyProgram();
    status({ workspace: snapshot });
    persist();
  }
  function sync() {
    guard();
    remember(getBlockly().serialization.workspaces.save(editor()));
  }
  return {
    sync,
    capture() {
      return { version: 1, workspace: getBlockly().serialization.workspaces.save(editor()), start: { ...state.start } };
    },
    validateCandidate(data) { return prepareSavedWorkspace(data, getBlockly()); },
    restore(data) {
      // Staging validates storage shape and editor fidelity, not executability.
      // installSavedWorkspace rolls back a partial visible-editor failure.
      const snapshot = installSavedWorkspace(data, getBlockly(), editor());
      beforeRestore();
      state.sounds = {};
      Object.assign(state.start, data.start);
      remember(snapshot);
      afterRestore();
    },
    executable() {
      sync();
      const result = jsonToProgram(state.ws);
      result.program.sounds = state.sounds;
      const candidate = prepareProgram(result.program);
      state.program = candidate;
      return candidate;
    }
  };
}
