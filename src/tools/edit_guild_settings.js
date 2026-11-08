import {
  NOTIFICATION_LEVELS,
  ToolError,
  VERIFICATION_LEVELS,
  compact,
  labelOf,
  resolveChannel,
} from './_helpers.js';

export default {
  kind: 'write',
  definition: {
    name: 'edit_guild_settings',
    description:
      'Altera configurações do servidor: nome, canal de sistema (mensagens automáticas de entrada/boost), ' +
      'nível de verificação e notificações padrão. Use system_channel="none" para desativar o canal de sistema.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Nome do servidor (2–100 caracteres).' },
        system_channel: { type: 'string', description: 'ID/nome de um canal de texto, ou "none".' },
        verification_level: { type: 'string', enum: Object.keys(VERIFICATION_LEVELS) },
        default_notifications: { type: 'string', enum: Object.keys(NOTIFICATION_LEVELS) },
      },
      additionalProperties: false,
    },
  },

  async execute(input, { guild, reason }) {
    if (Object.keys(input).length === 0) throw new ToolError('Nenhuma configuração informada.');
    let systemChannel;
    if (input.system_channel !== undefined) {
      systemChannel =
        input.system_channel.toLowerCase() === 'none'
          ? null
          : (await resolveChannel(guild, input.system_channel, { category: false })).id;
    }
    const edited = await guild.edit(
      compact({
        name: input.name,
        systemChannel,
        verificationLevel: input.verification_level ? VERIFICATION_LEVELS[input.verification_level] : undefined,
        defaultMessageNotifications: input.default_notifications ? NOTIFICATION_LEVELS[input.default_notifications] : undefined,
        reason,
      }),
    );
    return {
      edited: 'guild',
      name: edited.name,
      system_channel: edited.systemChannel?.name ?? null,
      verification_level: labelOf(VERIFICATION_LEVELS, edited.verificationLevel),
      default_notifications: labelOf(NOTIFICATION_LEVELS, edited.defaultMessageNotifications),
    };
  },
};
