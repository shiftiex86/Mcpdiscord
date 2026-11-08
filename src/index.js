import { Client, Events, GatewayIntentBits, MessageFlags, OAuth2Scopes, PermissionFlagsBits, REST, Routes } from 'discord.js';
import { config } from './config.js';
import { logger } from './logger.js';
import { commands } from './commands/index.js';

// Só o intent Guilds é necessário: o bot trabalha com cargos, canais e interações (slash commands/botões).
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(config.discordToken);
  const body = [...commands.values()].map((c) => c.data.toJSON());
  if (config.devGuildId) {
    await rest.put(Routes.applicationGuildCommands(config.clientId, config.devGuildId), { body });
    logger.info('boot', `Comandos registrados no servidor ${config.devGuildId} (${body.length})`);
  } else {
    await rest.put(Routes.applicationCommands(config.clientId), { body });
    logger.info('boot', `Comandos globais registrados (${body.length}); podem levar alguns minutos para aparecer`);
  }
}

client.once(Events.ClientReady, async (c) => {
  logger.info('boot', `Conectado como ${c.user.tag} em ${c.guilds.cache.size} servidor(es)`);
  const invite = c.generateInvite({
    scopes: [OAuth2Scopes.Bot, OAuth2Scopes.ApplicationsCommands],
    permissions: [PermissionFlagsBits.Administrator],
  });
  logger.info('boot', `Link de convite: ${invite}`);
  try {
    await registerCommands();
  } catch (err) {
    logger.error('boot', 'Falha ao registrar os slash commands', { error: err.message });
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const command = commands.get(interaction.commandName);
  if (!command) return;
  if (!interaction.inCachedGuild()) {
    await interaction.reply({ content: 'Use este comando dentro de um servidor.', flags: MessageFlags.Ephemeral }).catch(() => {});
    return;
  }
  try {
    await command.execute(interaction);
  } catch (err) {
    logger.error('interaction', `Erro em /${interaction.commandName}`, { error: err.message, stack: err.stack });
    const payload = { content: '❌ Ocorreu um erro inesperado.', flags: MessageFlags.Ephemeral };
    await (interaction.deferred || interaction.replied ? interaction.followUp(payload) : interaction.reply(payload)).catch(() => {});
  }
});

client.on(Events.Error, (err) => logger.error('client', err.message));
process.on('unhandledRejection', (err) => logger.error('process', 'unhandledRejection', { error: err?.message ?? String(err) }));

client.login(config.discordToken).catch((err) => {
  logger.error('boot', 'Falha ao conectar ao Discord (confira DISCORD_TOKEN)', { error: err.message });
  process.exit(1);
});
