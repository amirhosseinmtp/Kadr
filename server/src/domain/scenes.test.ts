import assert from 'node:assert/strict';
import test from 'node:test';
import { extractFountainSceneHeadings, parseSceneHeading } from './scenes.js';

test('classifies standard Fountain headings without confusing screenplay order and schedule order', () => {
  assert.deepEqual(parseSceneHeading('INT. EDITING ROOM — NIGHT'), { environment: 'interior', timeOfDay: 'night' });
  assert.deepEqual(parseSceneHeading('EXT. ROOFTOP - DAWN'), { environment: 'exterior', timeOfDay: 'dawn' });
  assert.deepEqual(parseSceneHeading('INT./EXT. CAR — DAY'), { environment: 'mixed', timeOfDay: 'day' });
});

test('classifies Persian scene headings and time of day', () => {
  assert.deepEqual(parseSceneHeading('داخلی. آشپزخانه — شب'), { environment: 'interior', timeOfDay: 'night' });
  assert.deepEqual(parseSceneHeading('خارجی/داخلی. حیاط — غروب'), { environment: 'mixed', timeOfDay: 'dusk' });
});

test('extracts scene headings in screenplay order and skips action/dialogue', () => {
  const screenplay = `FADE IN:\n\nEXT. TRAIN PLATFORM — DAWN\nThe station is nearly empty.\n\nINT. CAFE - DAY\n\nMARA\nWe have to go.`;
  assert.deepEqual(extractFountainSceneHeadings(screenplay), ['EXT. TRAIN PLATFORM — DAWN', 'INT. CAFE - DAY']);
});

test('does not mistake words beginning with INT or EXT for scene headings', () => {
  assert.deepEqual(extractFountainSceneHeadings('International waters\nExterior color\nInterior monologue'), []);
});
