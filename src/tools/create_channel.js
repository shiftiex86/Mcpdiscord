import { ChannelType } from 'discord.js';
import {
  CHANNEL_TYPE_ENUM,
  OVERWRITES_SCHEMA,
  ToolError,
  buildOverwrites,
  channelTypeLabel,
  compact,
  parseChannelType,
  resolveChannel,
} from './_helpers.js';

export default {
  kind: 'write',
  definition: {
    name: 'create_channel',
    description:
      'Cria um canal de texto, voz, anúncios, fórum ou palco. Anúncios e palco exigem que o servidor tenha ' +
      'o recurso Comunidade ativado (community_enabled em get_server_structure). Sem "permission_overwrites", ' +
      'o canal fica sincronizado com a categoria. Nomes de canais de texto são normalizados pelo Discord ' +
      '(minúsculas, espaços viram hífens).',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Nome do canal (máx. 100 caracteres).' },
        type: { type: 'string', enum: CHANNEL_TYPE_ENUM },
        category: { type: 'string', description: 'ID ou nome da categoria. Omitir = sem categoria.' },
        topic: { type: 'string', description: 'Tópico/descrição (texto, anúncios, fórum). Máx. 1024 caracteres.' },
        slowmode: { type: 'integer', description: 'Modo lento em segundos (0–21600).' },
        nsfw: { type: 'boolean' },
        position: { type: 'integer', description: 'Posição dentro da categoria.' },
        user_limit: { type: 'integer', description: 'Limite de usuários (voz; 0 = ilimitado, máx. 99).' },
        bitrate: { type: 'integer', description: 'Bitrate em bps para voz/palco (ex.: 64000).' },
        forum_tags: {
          type: 'array',
          description: 'Somente fórum: tags disponíveis (máx. 20).',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              emoji: { type: 'string', description: 'Emoji unicode opcional.' },
              moderated: { type: 'boolean' },
            },
            required: ['name'],
            additionalProperties: false,
          },
        },
        permission_overwrites: OVERWRITES_SCHEMA,
      },
      required: ['name', 'type'],
      additionalProperties: false,
    },
  },

  async execute(input, { guild, reason }) {
    const type = parseChannelType(input.type);
    if ((type === ChannelType.GuildAnnouncement || type === ChannelType.GuildStageVoice) && !guild.features.includes('COMMUNITY')) {
      throw new ToolError(
        `Canais do tipo "${input.type}" exigem o recurso Comunidade, que não está ativado neste servidor. ` +
          'Use "text" (ou "voice") e restrinja o envio com overwrites, ou peça ao dono para ativar a Comunidade.',
      );
    }
    if (input.forum_tags && type !== ChannelType.GuildForum) {
      throw new ToolError('"forum_tags" só pode ser usado com type "forum".');
    }
    const parent = input.category ? await resolveChannel(guild, input.category, { category: true }) : undefined;

    const channel = await guild.channels.create(
      compact({
        name: input.name,
        type,
        parent: parent?.id,
        topic: input.topic,
        rateLimitPerUser: input.slowmode,
        nsfw: input.nsfw,
        position: input.position,
        userLimit: input.user_limit,
        bitrate: input.bitrate,
        availableTags: input.forum_tags?.map((t) => compact({ name: t.name, emoji: t.emoji ? { name: t.emoji } : undefined, moderated: t.moderated })),
        // Sem overwrites próprios, copia os da categoria para nascer sincronizado.
        permissionOverwrites:
          (await buildOverwrites(guild, input.permission_overwrites)) ?? parent?.permissionOverwrites.cache,
        reason,
      }),
    );
    return {
      created: 'channel',
      id: channel.id,
      name: channel.name,
      type: channelTypeLabel(channel.type),
      category: parent?.name ?? null,
    };
  },
};
