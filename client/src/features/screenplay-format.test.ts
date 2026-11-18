import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalizeFountain, parseFountain, serializeFountain, type ScriptBlock } from './screenplay-format';

test('Fountain round-trip preserves scene, action, character, parenthetical, dialogue, and transition elements', () => {
  const blocks: ScriptBlock[] = [
    { id: '1', type: 'scene-heading', content: 'INT. ROOM - NIGHT' },
    { id: '2', type: 'action', content: 'A lamp flickers.' },
    { id: '3', type: 'character', content: 'NIMA' },
    { id: '4', type: 'parenthetical', content: '(quietly)' },
    { id: '5', type: 'dialogue', content: 'We should leave.' },
    { id: '6', type: 'transition', content: 'CUT TO:' },
  ];
  const parsed = parseFountain(serializeFountain(blocks));
  assert.deepEqual(parsed.map(({ type, content }) => ({ type, content })), blocks.map(({ type, content }) => ({ type, content })));
});

test('parser reads legacy scene headings and infers dialogue after a character cue', () => {
  const parsed = parseFountain('داخلی. اتاق — شب\n\nنیما به پنجره نگاه می‌کند.\n\nNIMA\n\nباید برویم.');
  assert.deepEqual(parsed.map((block) => block.type), ['scene-heading', 'action', 'character', 'dialogue']);
  assert.equal(parsed[3].content, 'باید برویم.');
});

test('parser honors forced action and transition markers', () => {
  const parsed = parseFountain('!CUT TO a quiet street.\n\n>FADE OUT.');
  assert.deepEqual(parsed.map((block) => ({ type: block.type, content: block.content })), [
    { type: 'action', content: 'CUT TO a quiet street.' },
    { type: 'transition', content: 'FADE OUT.' },
  ]);
});

test('parser reads a conventional Fountain dialogue block with an inline parenthetical', () => {
  const parsed = parseFountain('INT. STUDIO - NIGHT\n\nMAYA\n(whispering)\nWe need to go.\n\n>FADE OUT.');
  assert.deepEqual(parsed.map(({ type, content }) => ({ type, content })), [
    { type: 'scene-heading', content: 'INT. STUDIO - NIGHT' },
    { type: 'character', content: 'MAYA' },
    { type: 'parenthetical', content: '(whispering)' },
    { type: 'dialogue', content: 'We need to go.' },
    { type: 'transition', content: 'FADE OUT.' },
  ]);
});

test('parser skips title-page metadata and keeps older plain screenplay text canonically unchanged', () => {
  const olderBody = 'داخلی. اتاق — شب\n\nنیما در را باز می‌کند.';
  const imported = parseFountain('\uFEFFTitle: The Room\nCredit: Written by\nAuthor: Film Team\n\n' + olderBody);
  assert.deepEqual(imported.map(({ type, content }) => ({ type, content })), [
    { type: 'scene-heading', content: 'داخلی. اتاق — شب' },
    { type: 'action', content: 'نیما در را باز می‌کند.' },
  ]);
  assert.equal(canonicalizeFountain(olderBody), canonicalizeFountain(serializeFountain(imported)));
});
