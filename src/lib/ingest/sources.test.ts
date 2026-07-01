import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseSourceRows, resolveSources, gatherTaggedFiles } from './sources';

let failures = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log('ok   -', name);
  } catch (e) {
    failures += 1;
    console.error('FAIL -', name, '\n     ', (e as Error).message);
  }
}

check('parse: null → empty', () => {
  assert.deepEqual(parseSourceRows(null), []);
});

check('parse: invalid JSON → empty', () => {
  assert.deepEqual(parseSourceRows('{not json'), []);
});

check('parse: non-array → empty', () => {
  assert.deepEqual(parseSourceRows('{"path":"/a"}'), []);
});

check('parse: trims path and tag', () => {
  assert.deepEqual(parseSourceRows('[{"path":"  /a  ","tag":"  work  "}]'), [
    { path: '/a', tag: 'work' },
  ]);
});

check('parse: empty tag → default', () => {
  assert.deepEqual(parseSourceRows('[{"path":"/a","tag":"   "}]'), [
    { path: '/a', tag: 'default' },
  ]);
});

check('parse: drops empty-path rows', () => {
  assert.deepEqual(parseSourceRows('[{"path":"","tag":"x"},{"path":"/a","tag":"y"}]'), [
    { path: '/a', tag: 'y' },
  ]);
});

check('parse: dedups by path, first tag wins', () => {
  assert.deepEqual(
    parseSourceRows('[{"path":"/a","tag":"first"},{"path":"/a","tag":"second"}]'),
    [{ path: '/a', tag: 'first' }],
  );
});

check('resolve: empty → fallback tagged default', () => {
  assert.deepEqual(resolveSources(null, '/home/u/.claude/projects'), [
    { path: '/home/u/.claude/projects', tag: 'default' },
  ]);
});

check('resolve: passes through non-empty rows', () => {
  assert.deepEqual(resolveSources('[{"path":"/a","tag":"work"}]', '/fallback'), [
    { path: '/a', tag: 'work' },
  ]);
});

check('parse: caps tag at 60 chars', () => {
  const long = 'x'.repeat(100);
  const out = parseSourceRows(`[{"path":"/a","tag":"${long}"}]`);
  assert.equal(out[0].tag.length, 60);
});

check('gather: tags files per source, dedups repeats, first source wins', () => {
  // Nonexistent paths make realpathSync throw → dedup falls back to the raw
  // string, which is what this case exercises.
  const out = gatherTaggedFiles(
    [
      { path: '/one', tag: 'work' },
      { path: '/two', tag: 'home' },
    ],
    (p) => (p === '/one' ? ['/one/a.jsonl', '/shared.jsonl'] : ['/two/b.jsonl', '/shared.jsonl']),
  );
  assert.deepEqual(out, [
    { file: '/one/a.jsonl', tag: 'work' },
    { file: '/shared.jsonl', tag: 'work' },
    { file: '/two/b.jsonl', tag: 'home' },
  ]);
});

check('gather: dedups symlink aliases of the same physical file', () => {
  const base = mkdtempSync(join(tmpdir(), 'ag-gather-'));
  const realDir = join(base, 'real');
  const linkDir = join(base, 'link');
  mkdirSync(realDir);
  writeFileSync(join(realDir, 's.jsonl'), '{}\n');
  symlinkSync(realDir, linkDir);
  const out = gatherTaggedFiles(
    [
      { path: realDir, tag: 'default' },
      { path: linkDir, tag: 'work' },
    ],
    (p) => [join(p, 's.jsonl')],
  );
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], { file: join(realDir, 's.jsonl'), tag: 'default' });
});

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log('\nall source tests passed');
