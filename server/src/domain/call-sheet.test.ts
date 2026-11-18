import assert from 'node:assert/strict';
import test from 'node:test';
import { castForScheduledScenes } from './call-sheet.js';

test('includes only cast assignments for characters appearing on the scheduled day', () => {
  const cast = castForScheduledScenes(
    [['مینا', 'علي'], ['مینا']],
    [
      { assignmentId: 'mina', character: ' مینا ', talentName: 'Mina' },
      { assignmentId: 'ali', character: 'علی', talentName: 'Ali' },
      { assignmentId: 'nima', character: 'نیما', talentName: 'Nima' },
    ],
  );

  assert.deepEqual(cast.map((candidate) => candidate.assignmentId), ['mina', 'ali']);
});

test('does not include uncredited or empty character assignments', () => {
  const cast = castForScheduledScenes(
    [['SARA'], ['']],
    [
      { assignmentId: 'sara', character: 'Sara', talentName: 'Sara' },
      { assignmentId: 'other', character: 'Other', talentName: 'Other' },
      { assignmentId: 'empty', character: ' ', talentName: 'Unknown' },
    ],
  );

  assert.deepEqual(cast.map((candidate) => candidate.assignmentId), ['sara']);
});
