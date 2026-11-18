export interface CastCandidate {
  assignmentId: string;
  character: string;
  talentName: string;
}

function normalizeCharacter(value: string) {
  return value.trim().normalize('NFKC').replace(/[يى]/g, 'ی').replace(/ك/g, 'ک').toLocaleLowerCase();
}

export function castForScheduledScenes(sceneCharacters: string[][], candidates: CastCandidate[]) {
  const characters = new Set(sceneCharacters.flat().map(normalizeCharacter).filter(Boolean));
  return candidates.filter((candidate) => characters.has(normalizeCharacter(candidate.character)));
}
