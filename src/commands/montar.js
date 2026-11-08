import { InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { runSession } from '../session.js';

export default {
  data: new SlashCommandBuilder()
    .setName('montar')
    .setDescription('Descreva o servidor que você quer e o Claude monta tudo (com plano para confirmar).')
    .addStringOption((opt) =>
      opt
        .setName('descricao')
        .setDescription('Ex.: servidor de comunidade de Valorant com staff, regras, cargos de rank e salas de voz')
        .setRequired(true)
        .setMaxLength(4000),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    await runSession(interaction, 'montar', interaction.options.getString('descricao', true));
  },
};
