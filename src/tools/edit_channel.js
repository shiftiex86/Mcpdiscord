import { ChannelType } from 'discord.js';
import {
  OVERWRITES_SCHEMA,
  ToolError,
  buildOverwrites,
  channelTypeLabel,
  compact,
  resolveChannel,
} from './_helpers.js';

export default {
  kind: 'write',
  definition: {
    name: 'edit_channel',
    description:
      'Edita um canal (não categoria): nome, categoria, tópico, slowmode, nsfw, posição, limite de usuários, ' +
      'overwrites. "permission_overwrites" SUBSTITUI todos os overwrites do canal. ' +
      'Use sync_permissions=true para sincronizar com a categoria. category="none" remove da categoria.',
    input_schema: {
      type: 'object',
      properties: {
        channel: { type: 'string', description: 'ID, menção ou nome do canal.' },
        name: { type: 'string' },
        category: { type: 'string', description: 'ID/nome da nova categoria, ou "none".' },
        topic: { type: 'string' },
        slowmode: { type: 'integer' },
        nsfw: { type: 'boolean' },
        position: { type: 'integer' },
        user_limit: { type: 'integer' },
        bitrate: { type: 'integer' },
        sync_permissions: { type: 'boolean' },
        permission_overwrites: OVERWRITES_SCHEMA,
      },
      required: ['channel'],
      additionalProperties: false,
    },
  },

  async execute(input, { guild, reason }) {
    const channel = await resolveChannel(guild, input.channel, { category: false });
    if (input.sync_permissions && input.permission_overwrites) {
      throw new ToolError('Use sync_permissions OU permission_overwrites, não os dois.');
    }
    let parent;
    if (input.category !== undefined) {
      parent = input.category.toLowerCase() === 'none' ? null : (await resolveChannel(guild, input.category, { category: true })).id;
    }
    const isVoice = channel.type === ChannelType.GuildVoice || channel.type === ChannelType.GuildStageVoice;
    if ((input.user_limit !== undefined || input.bitrate !== undefined) && !isVoice) {
      throw new ToolError('user_limit/bitrate só se aplicam a canais de voz ou palco.');
    }

    const edited = await channel.edit(
      compact({
        name: input.name,
        parent,
        topic: input.topic,
        rateLimitPerUser: input.slowmode,
        nsfw: input.nsfw,
        position: input.position,
        userLimit: input.user_limit,
        bitrate: input.bitrate,
        lockPermissions: input.sync_permissions,
        permissionOverwrites: await buildOverwrites(guild, input.permission_overwrites),
        reason,
      }),
    );
    return {
      edited: 'channel',
      id: edited.id,
      name: edited.name,
      type: channelTypeLabel(edited.type),
      category: edited.parent?.name ?? null,
    };
  },
};
