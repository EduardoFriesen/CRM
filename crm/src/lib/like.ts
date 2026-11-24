// User text inside ILIKE: % and _ are literal, \ is the escape character.
export const escapeLike = (s: string): string => s.replace(/[\\%_]/g, (c) => `\\${c}`);
