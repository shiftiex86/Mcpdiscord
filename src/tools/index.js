import getServerStructure from './get_server_structure.js';
import createRole from './create_role.js';
import editRole from './edit_role.js';
import deleteRole from './delete_role.js';
import createCategory from './create_category.js';
import editCategory from './edit_category.js';
import createChannel from './create_channel.js';
import editChannel from './edit_channel.js';
import deleteChannel from './delete_channel.js';
import setPermissionOverwrites from './set_permission_overwrites.js';
import reorder from './reorder.js';
import sendMessage from './send_message.js';
import editGuildSettings from './edit_guild_settings.js';
import submitPlan from './submit_plan.js';

// Ordem fixa: a lista de tools faz parte do prefixo de cache do prompt.
const TOOLS = [
  getServerStructure,
  createRole,
  editRole,
  deleteRole,
  createCategory,
  editCategory,
  createChannel,
  editChannel,
  deleteChannel,
  setPermissionOverwrites,
  reorder,
  sendMessage,
  editGuildSettings,
  submitPlan,
];

export const toolsByName = new Map(TOOLS.map((t) => [t.definition.name, t]));

/**
 * Definições enviadas ao Claude. As requisições são em streaming, então cada tool usa
 * eager_input_streaming — e por isso validamos cada input contra o schema antes de executar.
 */
export const TOOL_DEFINITIONS = TOOLS.map((t) => ({ ...t.definition, eager_input_streaming: true }));

/** Validador mínimo de JSON Schema (o subconjunto usado nas tools). Retorna lista de erros. */
export function validateInput(schema, value, path = 'input') {
  const errors = [];
  const typeOf = (v) => (Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v);

  switch (schema.type) {
    case 'object': {
      if (typeOf(value) !== 'object') return [`${path} deve ser um objeto`];
      for (const key of schema.required ?? []) {
        if (value[key] === undefined) errors.push(`${path}.${key} é obrigatório`);
      }
      for (const [key, v] of Object.entries(value)) {
        const sub = schema.properties?.[key];
        if (!sub) {
          if (schema.additionalProperties === false) errors.push(`${path}.${key} não é um campo permitido`);
          continue;
        }
        errors.push(...validateInput(sub, v, `${path}.${key}`));
      }
      break;
    }
    case 'array':
      if (!Array.isArray(value)) return [`${path} deve ser uma lista`];
      if (schema.items) value.forEach((v, i) => errors.push(...validateInput(schema.items, v, `${path}[${i}]`)));
      break;
    case 'string':
      if (typeof value !== 'string') return [`${path} deve ser texto`];
      if (schema.enum && !schema.enum.includes(value)) errors.push(`${path} deve ser um de: ${schema.enum.join(', ')}`);
      break;
    case 'integer':
      if (!Number.isInteger(value)) errors.push(`${path} deve ser um número inteiro`);
      break;
    case 'number':
      if (typeof value !== 'number' || Number.isNaN(value)) errors.push(`${path} deve ser um número`);
      break;
    case 'boolean':
      if (typeof value !== 'boolean') errors.push(`${path} deve ser true/false`);
      break;
    default:
      break;
  }
  return errors;
}
