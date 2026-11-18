export type ElementType = 'scene-heading' | 'action' | 'character' | 'parenthetical' | 'dialogue' | 'transition';
export interface ScriptBlock { id: string; type: ElementType; content: string }

export const elementTypes: ElementType[] = ['scene-heading', 'action', 'character', 'parenthetical', 'dialogue', 'transition'];

const scenePrefix = /^(?:INT\s*\.?|EXT\s*\.?|I\s*\/\s*E\s*\.?|داخلی|خارجی)(?:\s|\/|\.|$)/iu;
const transitionPrefix = /^(?:FADE IN|FADE OUT|FADE TO|CUT TO|DISSOLVE TO|SMASH CUT|پایان)/iu;
const characterCue = /^[\p{Lu}\d\s.'’_-]+$/u;

function identify(line: string, next = '', inDialogue = false): ElementType {
  if (line.startsWith('@')) return 'character';
  if (line.startsWith('>')) return 'transition';
  if (line.startsWith('!')) return 'action';
  const possibleScene = line.startsWith('.') ? line.slice(1).trimStart() : line;
  if (scenePrefix.test(possibleScene)) return 'scene-heading';
  if (transitionPrefix.test(line)) return 'transition';
  if (/^\(.+\)$/.test(line)) return 'parenthetical';
  const uppercase = line.length < 52 && /[A-Z]/.test(line) && line === line.toLocaleUpperCase('en-US') && characterCue.test(line);
  if (uppercase && next.length > 0 && (next !== next.toLocaleUpperCase('en-US') || /[^\x00-\x7f]/.test(next))) return 'character';
  return inDialogue ? 'dialogue' : 'action';
}

function cleanForcedPrefix(content: string, type: ElementType): string {
  const lines = content.split('\n');
  if (type === 'character' && lines[0].startsWith('@')) lines[0] = lines[0].slice(1).trimStart();
  if (type === 'scene-heading' && lines[0].startsWith('.')) lines[0] = lines[0].slice(1).trimStart();
  if (type === 'action' && lines[0].startsWith('!')) lines[0] = lines[0].slice(1).trimStart();
  if (type === 'transition' && lines[0].startsWith('>')) lines[0] = lines[0].slice(1).trim().replace(/^<|<$/g, '').trim();
  return lines.join('\n').trim();
}

export function parseFountain(source: string): ScriptBlock[] {
  const paragraphs = source.replace(/\r\n?/g, '\n').split(/\n\s*\n+/).map((item) => item.trim()).filter(Boolean);
  let inDialogue = false;
  const blocks: ScriptBlock[] = [];
  const add = (type: ElementType, content: string) => {
    const cleaned = cleanForcedPrefix(content, type);
    if (cleaned) blocks.push({ id: `${Date.now()}-${blocks.length}-${Math.random().toString(16).slice(2)}`, type, content: cleaned });
  };
  paragraphs.forEach((content, index) => {
    const lines = content.split('\n').map((line) => line.trim()).filter(Boolean);
    const firstLine = lines[0];
    const nextLine = lines[1] ?? paragraphs[index + 1]?.split('\n')[0].trim() ?? '';
    const type = identify(firstLine, nextLine, inDialogue);
    if (type === 'character' && lines.length > 1) {
      add('character', lines[0]);
      let dialogue: string[] = [];
      const flushDialogue = () => { if (dialogue.length) { add('dialogue', dialogue.join('\n')); dialogue = []; } };
      for (const line of lines.slice(1)) {
        if (/^\(.+\)$/.test(line)) { flushDialogue(); add('parenthetical', line); }
        else dialogue.push(line);
      }
      flushDialogue();
      inDialogue = true;
      return;
    }
    add(type, content);
    if (type === 'character') inDialogue = true;
    else if (type === 'dialogue' || type === 'action' || type === 'scene-heading' || type === 'transition') inDialogue = false;
  });
  return blocks;
}

export function serializeFountain(blocks: ScriptBlock[]): string {
  return blocks.map((block) => {
    const content = block.content.trim();
    if (!content) return '';
    if (block.type === 'character') return `@${content}`;
    if (block.type === 'transition') return `>${content}`;
    if (block.type === 'action') return `!${content}`;
    return content;
  }).filter(Boolean).join('\n\n');
}
