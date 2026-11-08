import { OVERWRITES_SCHEMA, buildOverwrites, compact, resolveChannel } from './_helpers.js';

export default {
  kind: 'write',
  definition: {
    name: 'edit_category',
    description:
      'Edita uma categoria (nome, posição, overwrites). "permission_overwrites" SUBSTITUI todos os overwrites da categoria; ' +
      'para ajustes pontuais use set_permission_overwrites com mode "merge". ' +
      'Use sync_children=true para sincronizar as permissões dos canais filhos com a categoria.',
    input_schema: {
      type: 'object',
      properties: {
        category: { type: 'string', description: 'ID ou nome da categoria.' },
        name: { type: 'string' },
        position: { type: 'integer' },
        permission_overwrites: OVERWRITES_SCHEMA,
        sync_children: { type: 'boolean', description: 'Sincroniza as permissões de todos os canais filhos.' },
      },
      required: ['category'],
      additionalProperties: false,
    },
  },

  async execute(input, { guild, reason }) {
    const category = await resolveChannel(guild, input.category, { category: true });
    const edited = await category.edit(
      compact({
        name: input.name,
        position: input.position,
        permissionOverwrites: await buildOverwrites(guild, input.permission_overwrites),
        reason,
      }),
    );
    const synced = [];
    if (input.sync_children) {
      for (const child of edited.children.cache.values()) {
        await child.lockPermissions();
        synced.push(child.name);
      }
    }
    return {
      edited: 'category',
      id: edited.id,
      name: edited.name,
      position: edited.position,
      ...(synced.length ? { synced_children: synced } : {}),
    };
  },
};
