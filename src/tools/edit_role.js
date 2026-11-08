import {
  ToolError,
  assertBotHasPermissions,
  assertManageableRole,
  assertRolePosition,
  compact,
  hex,
  parseColor,
  parsePermissions,
  resolveRole,
} from './_helpers.js';

export default {
  kind: 'write',
  definition: {
    name: 'edit_role',
    description:
      'Edita um cargo existente (nome, cor, hoist, mentionable, permissões, posição). Só altera os campos enviados. ' +
      '"permissions" SUBSTITUI a lista inteira de permissões do cargo. Para @everyone, apenas "permissions" pode ser alterado.',
    input_schema: {
      type: 'object',
      properties: {
        role: { type: 'string', description: 'ID, menção ou nome exato do cargo (ou "@everyone").' },
        name: { type: 'string' },
        color: { type: 'string', description: 'Hexadecimal, ex.: "#ED4245". Use "#000000" para remover a cor.' },
        hoist: { type: 'boolean' },
        mentionable: { type: 'boolean' },
        permissions: { type: 'array', items: { type: 'string' } },
        position: { type: 'integer' },
      },
      required: ['role'],
      additionalProperties: false,
    },
  },

  async execute(input, { guild, reason }) {
    const role = await resolveRole(guild, input.role);
    const isEveryone = role.id === guild.id;
    await assertManageableRole(guild, role, { allowEveryone: isEveryone });

    if (isEveryone && ['name', 'color', 'hoist', 'mentionable', 'position'].some((k) => input[k] !== undefined)) {
      throw new ToolError('No @everyone só é possível alterar "permissions".');
    }
    const permissions = parsePermissions(input.permissions);
    await assertBotHasPermissions(guild, permissions, 'editar cargo');
    await assertRolePosition(guild, input.position);
    const color = parseColor(input.color);

    const updated = await role.edit(
      compact({
        name: input.name,
        colors: color !== undefined ? { primaryColor: color } : undefined,
        hoist: input.hoist,
        mentionable: input.mentionable,
        permissions,
        position: input.position,
        reason,
      }),
    );
    return {
      edited: 'role',
      id: updated.id,
      name: updated.name,
      position: updated.position,
      color: hex(updated.colors?.primaryColor ?? updated.color),
    };
  },
};
