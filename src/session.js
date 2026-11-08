import Anthropic from '@anthropic-ai/sdk';
import { ComponentType, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { AgentError, ServerAgent } from './agent.js';
import { config } from './config.js';
import { logger } from './logger.js';
import {
  BUTTON_IDS,
  COLORS,
  planButtons,
  planEmbeds,
  progressEmbed,
  progressLine,
  statusEmbed,
  summaryEmbed,
} from './ui/embeds.js';

const activeSessions = new Set(); // um fluxo por servidor por vez
const REQUIRED_BOT_PERMISSIONS = ['ManageRoles', 'ManageChannels'];
const RECOMMENDED_BOT_PERMISSIONS = ['ManageGuild', 'ViewChannel', 'SendMessages', 'EmbedLinks', 'ManageMessages'];

export function isAuthorized(interaction) {
  return (
    interaction.user.id === interaction.guild.ownerId ||
    interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) === true
  );
}

/**
 * Edita a mensagem de progresso com throttle. Usa a edição normal de mensagem (token do bot),
 * que não expira como o token da interação (15 min); se falhar, tenta pela interação.
 */
class ProgressReporter {
  constructor({ message, interaction, scope }) {
    this.message = message;
    this.interaction = interaction;
    this.scope = scope;
    this.lines = [];
    this.timer = null;
    this.latest = null;
    this.lastSent = 0;
    this.chain = Promise.resolve();
  }

  push(event, render) {
    this.lines.push(progressLine(event));
    if (this.lines.length > 15) this.lines.splice(0, this.lines.length - 15);
    this.latest = render;
    this.#schedule();
  }

  #schedule(force = false) {
    if (this.timer) return;
    const wait = force ? 0 : Math.max(0, 2000 - (Date.now() - this.lastSent));
    this.timer = setTimeout(() => {
      this.timer = null;
      this.lastSent = Date.now();
      const payload = this.latest?.(this.lines);
      if (payload) this.chain = this.chain.then(() => this.edit(payload));
    }, wait);
  }

  async flush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.chain;
  }

  async edit(payload) {
    try {
      await this.message.edit(payload);
      return true;
    } catch (err) {
      try {
        await this.interaction.editReply(payload);
        return true;
      } catch {
        logger.warn(this.scope, 'Não foi possível atualizar a mensagem de progresso', { error: err.message });
        return false;
      }
    }
  }
}

function describeError(err) {
  if (err instanceof AgentError) return err.message;
  if (err instanceof Anthropic.AuthenticationError) return 'A chave da API da Anthropic é inválida (ANTHROPIC_API_KEY).';
  if (err instanceof Anthropic.PermissionDeniedError) return 'A chave da API da Anthropic não tem acesso a este modelo.';
  if (err instanceof Anthropic.RateLimitError) return 'Limite de uso da API da Anthropic atingido. Tente de novo em alguns minutos.';
  if (err instanceof Anthropic.BadRequestError) return `Requisição recusada pela API da Anthropic: ${err.message}`;
  if (err instanceof Anthropic.APIConnectionError) return 'Não foi possível conectar à API da Anthropic.';
  if (err instanceof Anthropic.APIError) return `Erro da API da Anthropic (HTTP ${err.status}): ${err.message}`;
  return `Erro inesperado: ${err?.message ?? err}`;
}

/** Fluxo completo de /montar e /editar: plano → confirmação → execução → resumo. */
export async function runSession(interaction, mode, request) {
  const { guild, user } = interaction;
  const scope = `session:${guild.id}`;

  if (!isAuthorized(interaction)) {
    await interaction.reply({
      content: '🔒 Apenas o dono do servidor ou membros com **Administrador** podem usar este comando.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const me = await guild.members.fetchMe();
  const isAdmin = me.permissions.has(PermissionFlagsBits.Administrator);
  const missing = isAdmin ? [] : REQUIRED_BOT_PERMISSIONS.filter((p) => !me.permissions.has(PermissionFlagsBits[p]));
  if (missing.length) {
    await interaction.reply({
      content:
        `⚠️ O bot precisa das permissões **${missing.join(', ')}** para funcionar ` +
        '(recomendado: **Administrador**). Ajuste o cargo do bot e tente de novo.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (activeSessions.has(guild.id)) {
    await interaction.reply({
      content: '⏳ Já existe uma montagem/edição em andamento neste servidor. Aguarde ela terminar.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  activeSessions.add(guild.id);
  logger.info(scope, `/${mode} iniciado por ${user.tag}`, { request });

  let reporter = null;
  try {
    await interaction.deferReply();
    const recommendedMissing = isAdmin ? [] : RECOMMENDED_BOT_PERMISSIONS.filter((p) => !me.permissions.has(PermissionFlagsBits[p]));
    await interaction.editReply({
      embeds: [
        statusEmbed(
          '🧠 Analisando o servidor e montando o plano…',
          `**Pedido:** ${request}\n\nIsso pode levar alguns instantes.` +
            (recommendedMissing.length ? `\n\n⚠️ O bot não tem: ${recommendedMissing.join(', ')}.` : ''),
        ),
      ],
    });

    const agent = new ServerAgent({
      guild,
      user,
      mode,
      request,
      invokingChannelId: interaction.channelId,
      onAction: (event) =>
        reporter?.push(event, (lines) => ({
          embeds: [progressEmbed(lines, event.stats, { iteration: event.iteration, maxIterations: config.maxExecIterations })],
          components: [],
        })),
    });

    // ---- 1. Plano -----------------------------------------------------------
    const planning = await agent.runPlanning();
    if (!planning.plan) {
      await interaction.editReply({ embeds: [statusEmbed('💬 Resposta do Claude', planning.text, COLORS.info)] });
      return;
    }

    const plan = planning.plan;
    const reply = await interaction.editReply({
      embeds: planEmbeds(plan, { mode, requestedBy: user.tag }),
      components: [planButtons(plan.destructive_actions.length > 0)],
    });

    // ---- 2. Confirmação -----------------------------------------------------
    let click;
    try {
      click = await reply.awaitMessageComponent({
        componentType: ComponentType.Button,
        time: config.confirmTimeoutMs,
        filter: (i) => {
          if (i.user.id === user.id) return true;
          i.reply({ content: 'Só quem usou o comando pode confirmar ou cancelar este plano.', flags: MessageFlags.Ephemeral }).catch(() => {});
          return false;
        },
      });
    } catch {
      await interaction.editReply({
        embeds: [...planEmbeds(plan, { mode, requestedBy: user.tag }).slice(0, 1), statusEmbed('⌛ Plano expirado', 'Nada foi alterado. Use o comando de novo se quiser.', COLORS.neutral)],
        components: [],
      });
      logger.info(scope, 'Plano expirou sem confirmação');
      return;
    }

    if (click.customId === BUTTON_IDS.cancel) {
      await click.update({
        embeds: [statusEmbed('✖️ Plano cancelado', 'Nada foi alterado no servidor.', COLORS.neutral)],
        components: [],
      });
      logger.info(scope, 'Plano cancelado pelo usuário');
      return;
    }

    // ---- 3. Execução --------------------------------------------------------
    await click.update({
      embeds: [progressEmbed([], agent.stats, { iteration: 0, maxIterations: config.maxExecIterations })],
      components: [],
    });
    logger.info(scope, `Plano confirmado por ${click.user.tag}`);
    reporter = new ProgressReporter({ message: reply, interaction, scope });

    let result;
    try {
      result = await agent.runExecution();
    } catch (err) {
      await reporter.flush();
      logger.error(scope, 'Execução falhou', { error: err.message });
      await reporter.edit({
        embeds: [
          statusEmbed(
            '❌ A execução parou no meio',
            `${describeError(err)}\n\nAções concluídas até aqui: **${agent.stats.actions}** ` +
              `(erros: ${agent.stats.errors}). Use \`/editar\` para continuar ou corrigir.`,
            COLORS.danger,
          ),
        ],
        components: [],
      });
      return;
    }

    // ---- 4. Resumo ----------------------------------------------------------
    await reporter.flush();
    await reporter.edit({
      embeds: [summaryEmbed(result.text, agent.stats, { limitReached: result.limitReached, usage: agent.usage })],
      components: [],
    });
  } catch (err) {
    logger.error(scope, 'Falha no fluxo', { error: err.message, stack: err.stack });
    const payload = { embeds: [statusEmbed('❌ Algo deu errado', describeError(err), COLORS.danger)], components: [] };
    await (interaction.deferred || interaction.replied ? interaction.editReply(payload) : interaction.reply(payload)).catch(() => {});
  } finally {
    activeSessions.delete(guild.id);
  }
}
