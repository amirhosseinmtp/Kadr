import type { SceneEnvironment, SceneTimeOfDay } from '../../../shared/types.js';

export interface ParsedSceneHeading {
  environment: SceneEnvironment;
  timeOfDay: SceneTimeOfDay;
}

const sceneHeadingPrefix = /^[\s]*(?:INT\s*\.?\s*(?:\/|\\)\s*EXT\s*\.?|EXT\s*\.?\s*(?:\/|\\)\s*INT\s*\.?|I\s*\/\s*E\s*\.?|INT\s*\.?|EXT\s*\.?|داخلی\s*(?:\/|\\)\s*خارجی|خارجی\s*(?:\/|\\)\s*داخلی|داخلی|خارجی)(?=\s|\.|\/|$)/iu;

export function parseSceneHeading(heading: string): ParsedSceneHeading {
  const source = heading.trim();
  const upper = source.toLocaleUpperCase('en-US');
  let environment: SceneEnvironment = 'unspecified';
  if (/^(?:INT\s*\.?\s*(?:\/|\\)\s*EXT|EXT\s*\.?\s*(?:\/|\\)\s*INT|I\s*\/\s*E)|^(?:داخلی|خارجی)\s*(?:\/|\\)\s*(?:داخلی|خارجی)/iu.test(source)) environment = 'mixed';
  else if (/^INT\s*\.?|^داخلی/iu.test(source)) environment = 'interior';
  else if (/^EXT\s*\.?|^خارجی/iu.test(source)) environment = 'exterior';

  let timeOfDay: SceneTimeOfDay = 'unspecified';
  if (/\b(DAWN|SUNRISE)\b|سحر|سپیده/iu.test(upper)) timeOfDay = 'dawn';
  else if (/\b(DUSK|TWILIGHT|SUNSET)\b|غروب/iu.test(upper)) timeOfDay = 'dusk';
  else if (/\b(NIGHT|EVENING|LATER THAT NIGHT)\b|شب/iu.test(upper)) timeOfDay = 'night';
  else if (/\b(DAY|MORNING|AFTERNOON|CONTINUOUS)\b|روز|صبح|ظهر/iu.test(upper)) timeOfDay = 'day';
  return { environment, timeOfDay };
}

export function extractFountainSceneHeadings(script: string): string[] {
  return script.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0 && sceneHeadingPrefix.test(line));
}
