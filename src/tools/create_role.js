import { assertBotHasPermissions, assertRolePosition, compact, hex, parseColor, parsePermissions } from './_helpers.js';

export default {
  kind: 'write',
  definition: {
    name: 'create_role',
    description:
      'Cria um cargo. Se "permissions" for omitido, o cargo nasce SEM permissões próprias (só herda de @everyone) — ' +
      'ideal para cargos decorativos/separadores. "position" é opcional e precisa ficar abaixo do cargo mais alto do bot; ' +
      'para ordenar vários cargos de uma vez, prefira criar todos e depois usar reorder.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Nome do cargo (máx. 100 caracteres).' },
        color: { type: 'string', description: 'Cor em hexadecimal, ex.: "#5865F2". Omitir = sem cor.' },
        hoist: { type: 'boolean', description: 'Exibir separadamente na lista de membros.' },
        mentionable: { type: 'boolean', description: 'Permitir que qualquer um mencione o cargo.' },
        permissions: {
          type: 'array',
          items: { type: 'string' },
          description: 'Nomes de permissão do discord.js, ex.: ["ManageMessages", "KickMembers"].',
        },
        position: { type: 'integer', description: 'Posição na hierarquia (1 = logo acima de @everyone).' },
      },
      required: ['name'],
      additionalProperties: false,
    },
  },

  async execute(input, { guild, reason }) {
    const permissions = parsePermissions(input.permissions) ?? 0n;
    await assertBotHasPermissions(guild, permissions, 'criar cargo');
    await assertRolePosition(guild, input.position);
    const color = parseColor(input.color);

    const role = await guild.roles.create(
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
      created: 'role',
      id: role.id,
      name: role.name,
      position: role.position,
      color: hex(role.colors?.primaryColor ?? role.color),
    };
  },
};
