import { CHARACTERS, GRADES } from '../config.js';

export const gradeToServer = (id) => GRADES.find((g) => g.id === id)?.label ?? '게스트';
export const gradeFromServer = (label) => GRADES.find((g) => g.label === label)?.id ?? 'guest';

export const characterToServer = (id) => {
  const i = CHARACTERS.findIndex((c) => c.id === id);
  return (i < 0 ? 0 : i) + 1;
};
export const characterFromServer = (characterId) => CHARACTERS[(Number(characterId) || 1) - 1]?.id ?? CHARACTERS[0].id;
