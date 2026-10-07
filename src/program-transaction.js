import { prepareProgram, CompatibilityError } from './compatibility.js';
import { programToJson, jsonToProgram } from './blocks-json.js';

// Validate both representations before touching the visible workspace. If the
// editor rejects a load partway through, restore its exact previous snapshot.
export function installProgram(program, editor) {
  const candidate = prepareProgram(program);
  const json = programToJson(candidate);
  const expected = prepareProgram(jsonToProgram(json).program);
  const semantic = value => {
    if (Array.isArray(value)) return value.map(semantic);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.keys(value).filter(k => k !== 'id').sort().map(k =>
      [k, ['vars', 'lists'].includes(k) && Array.isArray(value[k]) ? [...value[k]].sort() : semantic(value[k])]));
  };
  if (editor) {
    const before = editor.read();
    try {
      editor.write(json);
      const actual = prepareProgram(jsonToProgram(editor.read()).program);
      if (JSON.stringify(semantic(actual)) !== JSON.stringify(semantic(expected)))
        throw new CompatibilityError(['The block editor changed program data while loading; the previous project has been restored.']);
    }
    catch (error) { editor.write(before); throw error; }
  }
  return candidate;
}
