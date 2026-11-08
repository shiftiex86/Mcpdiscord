import { InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { runSession } from '../session.js';
import { addStyleOptions, readStyleOptions } from './_styleOptions.js';

export default {
  data: addStyleOptions(
    new SlashCommandBuilder()
      .setName('editar')
      .setDescription('Peça um ajuste no servidor existente e o Claude aplica (com plano para confirmar).')
      .addStringOption((opt) =>
        opt
          .setName('pedido')
          .setDescription('Ex.: crie uma categoria de eventos com um canal de anúncios e uma sala de palco')
          .setRequired(true)
          .setMaxLength(4000),
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .setContexts(InteractionContextType.Guild),
  ),

  async execute(interaction) {
    await runSession(interaction, 'editar', interaction.options.getString('pedido', true), readStyleOptions(interaction));
  },
};
