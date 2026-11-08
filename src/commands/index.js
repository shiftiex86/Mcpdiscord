import montar from './montar.js';
import editar from './editar.js';

export const commands = new Map([montar, editar].map((c) => [c.data.name, c]));
