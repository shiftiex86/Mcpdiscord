import { ChannelType, PermissionFlagsBits } from 'discord.js';
import {
  NOTIFICATION_LEVELS,
  VERIFICATION_LEVELS,
  channelTypeLabel,
  getBotMember,
  hex,
  labelOf,
  serializeOverwrites,
} from './_helpers.js';

const REQUIRED_BOT_PERMISSIONS = ['ManageRoles', 'ManageChannels', 'ManageGuild', 'ViewChannel', 'SendMessages', 'EmbedLinks'];

function serializeChannel(c) {
  return {
    id: c.id,
    name: c.name,
    type: channelTypeLabel(c.type),
    position: c.position,
    ...(c.topic ? { topic: c.topic } : {}),
    ...(c.nsfw ? { nsfw: true } : {}),
    ...(c.rateLimitPerUser ? { slowmode: c.rateLimitPerUser } : {}),
    ...(c.parentId ? { permissions_synced: c.permissionsLocked ?? false } : {}),
    overwrites: serializeOverwrites(c),
  };
}

export default {
  kind: 'read',
  definition: {
    name: 'get_server_structure',
    description:
      'Lê a estrutura atual do servidor: configurações, cargos (do mais alto ao mais baixo, com permissões), ' +
      'categorias com seus canais, canais sem categoria, overwrites de permissão e a posição/permissões do bot. ' +
      'Use sempre antes de planejar e quando precisar conferir IDs.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },

  async execute(_input, { guild }) {
    await guild.fetch();
    await guild.roles.fetch();
    await guild.channels.fetch();
    const me = await getBotMember(guild);

    const roles = [...guild.roles.cache.values()]
      .sort((a, b) => b.position - a.position)
      .map((r) => ({
        id: r.id,
        name: r.id === guild.id ? '@everyone' : r.name,
        position: r.position,
        color: hex(r.colors?.primaryColor ?? r.color),
        hoist: r.hoist,
        mentionable: r.mentionable,
        managed: r.managed,
        permissions: r.permissions.has(PermissionFlagsBits.Administrator) ? ['Administrator'] : r.permissions.toArray(),
        bot_can_manage: r.id !== guild.id && !r.managed && guild.roles.comparePositions(r, me.roles.highest) < 0,
      }));

    const all = [...guild.channels.cache.values()].filter((c) => !c.isThread());
    const byPos = (a, b) => a.rawPosition - b.rawPosition || a.id.localeCompare(b.id);

    const categories = all
      .filter((c) => c.type === ChannelType.GuildCategory)
      .sort(byPos)
      .map((cat) => ({
        id: cat.id,
        name: cat.name,
        position: cat.position,
        overwrites: serializeOverwrites(cat),
        channels: all.filter((c) => c.parentId === cat.id).sort(byPos).map(serializeChannel),
      }));

    const uncategorized = all
      .filter((c) => c.type !== ChannelType.GuildCategory && !c.parentId)
      .sort(byPos)
      .map(serializeChannel);

    const isAdmin = me.permissions.has(PermissionFlagsBits.Administrator);
    return {
      guild: {
        id: guild.id,
        name: guild.name,
        owner_id: guild.ownerId,
        community_enabled: guild.features.includes('COMMUNITY'),
        features: guild.features,
        premium_tier: guild.premiumTier,
        verification_level: labelOf(VERIFICATION_LEVELS, guild.verificationLevel),
        default_notifications: labelOf(NOTIFICATION_LEVELS, guild.defaultMessageNotifications),
        system_channel: guild.systemChannel ? { id: guild.systemChannel.id, name: guild.systemChannel.name } : null,
        rules_channel: guild.rulesChannel ? { id: guild.rulesChannel.id, name: guild.rulesChannel.name } : null,
        member_count: guild.memberCount,
      },
      bot: {
        id: me.id,
        highest_role: { id: me.roles.highest.id, name: me.roles.highest.name, position: me.roles.highest.position },
        is_admin: isAdmin,
        missing_permissions: isAdmin ? [] : REQUIRED_BOT_PERMISSIONS.filter((p) => !me.permissions.has(PermissionFlagsBits[p])),
        note: 'O bot só consegue criar/editar/excluir/reordenar cargos ABAIXO de highest_role.position.',
      },
      roles,
      categories,
      uncategorized_channels: uncategorized,
      totals: { roles: roles.length, categories: categories.length, channels: all.length - categories.length },
    };
  },
};
