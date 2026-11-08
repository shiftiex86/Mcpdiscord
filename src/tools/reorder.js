import { ToolError, assertManageableRole, assertRolePosition, compact, resolveChannel, resolveRole } from './_helpers.js';

export default {
  kind: 'write',
  definition: {
    name: 'reorder',
    description:
      'Reordena cargos e/ou canais/categorias em lote. Cargos: posição maior = mais alto na hierarquia ' +
      '(1 = logo acima de @everyone; todos precisam ficar abaixo do cargo mais alto do bot). ' +
      'Canais: posição relativa dentro da categoria (0 = topo); categorias: posição entre categorias. ' +
      'Dica: envie a ordem completa desejada de uma vez.',
    input_schema: {
      type: 'object',
      properties: {
        roles: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              role: { type: 'string', description: 'ID ou nome do cargo.' },
              position: { type: 'integer' },
            },
            required: ['role', 'position'],
            additionalProperties: false,
          },
        },
        channels: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              channel: { type: 'string', description: 'ID ou nome do canal ou categoria.' },
              position: { type: 'integer' },
              category: { type: 'string', description: 'Opcional: mover para esta categoria (ID/nome) ou "none".' },
              sync_permissions: { type: 'boolean', description: 'Sincronizar permissões ao mover de categoria.' },
            },
            required: ['channel', 'position'],
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    },
  },

  async execute(input, { guild }) {
    if (!input.roles?.length && !input.channels?.length) {
      throw new ToolError('Informe "roles" e/ou "channels".');
    }
    const result = { reordered: true };

    if (input.roles?.length) {
      const positions = [];
      for (const item of input.roles) {
        const role = await resolveRole(guild, item.role);
        await assertManageableRole(guild, role);
        await assertRolePosition(guild, item.position);
        positions.push({ role: role.id, position: item.position });
      }
      await guild.roles.setPositions(positions);
      await guild.roles.fetch();
      result.roles = [...guild.roles.cache.values()]
        .sort((a, b) => b.position - a.position)
        .map((r) => `${r.position}: ${r.id === guild.id ? '@everyone' : r.name}`);
    }

    if (input.channels?.length) {
      const positions = [];
      for (const item of input.channels) {
        const channel = await resolveChannel(guild, item.channel);
        let parent;
        if (item.category !== undefined) {
          parent = item.category.toLowerCase() === 'none' ? null : (await resolveChannel(guild, item.category, { category: true })).id;
        }
        positions.push(compact({ channel: channel.id, position: item.position, parent, lockPermissions: item.sync_permissions }));
      }
      await guild.channels.setPositions(positions);
      result.channels = positions.map((p) => ({ id: p.channel, name: guild.channels.cache.get(p.channel)?.name, position: p.position }));
    }
    return result;
  },
};
