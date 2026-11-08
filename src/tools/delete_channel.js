import { ChannelType } from 'discord.js';
import { ToolError, channelTypeLabel, resolveChannel } from './_helpers.js';

export default {
  kind: 'destructive',
  definition: {
    name: 'delete_channel',
    description:
      'Exclui um canal ou categoria. AÇÃO DESTRUTIVA: só funciona se o ID estiver em "destructive_actions" do plano ' +
      'aprovado. Excluir uma categoria NÃO exclui os canais dentro dela (eles ficam sem categoria) — liste-os também ' +
      'se quiser removê-los. Use o ID.',
    input_schema: {
      type: 'object',
      properties: {
        channel: { type: 'string', description: 'ID do canal ou categoria a excluir.' },
      },
      required: ['channel'],
      additionalProperties: false,
    },
  },

  async execute(input, { guild, reason, approvedDeletions, invokingChannelId }) {
    const channel = await resolveChannel(guild, input.channel);
    if (!approvedDeletions.has(channel.id)) {
      throw new ToolError(
        `Exclusão de "${channel.name}" (${channel.id}) NÃO foi aprovada no plano. ` +
          'Exclusões só podem ser feitas em itens listados em destructive_actions do plano confirmado.',
      );
    }
    if (channel.id === invokingChannelId) {
      throw new ToolError(
        'Este é o canal onde o comando foi usado (o bot reporta o progresso nele), então o bot não o exclui. ' +
          'Siga com o resto e avise no resumo final que o usuário pode excluí-lo manualmente.',
      );
    }
    const { id, name } = channel;
    const kind = channel.type === ChannelType.GuildCategory ? 'category' : 'channel';
    const type = channelTypeLabel(channel.type);
    await channel.delete(reason);
    return { deleted: kind, id, name, type };
  },
};
