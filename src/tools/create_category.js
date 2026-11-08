import { ChannelType } from 'discord.js';
import { OVERWRITES_SCHEMA, buildOverwrites, compact } from './_helpers.js';

export default {
  kind: 'write',
  definition: {
    name: 'create_category',
    description:
      'Cria uma categoria. Overwrites definidos aqui são herdados pelos canais criados dentro dela ' +
      '(a menos que o canal defina os próprios).',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Nome da categoria (máx. 100 caracteres).' },
        position: { type: 'integer', description: 'Posição entre as categorias (0 = topo).' },
        permission_overwrites: OVERWRITES_SCHEMA,
      },
      required: ['name'],
      additionalProperties: false,
    },
  },

  async execute(input, { guild, reason }) {
    const category = await guild.channels.create(
      compact({
        name: input.name,
        type: ChannelType.GuildCategory,
        position: input.position,
        permissionOverwrites: await buildOverwrites(guild, input.permission_overwrites),
        reason,
      }),
    );
    return { created: 'category', id: category.id, name: category.name, position: category.position };
  },
};
