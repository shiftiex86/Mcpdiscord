import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { truncate } from '../text.js';

export const COLORS = {
  info: 0x5865f2,
  working: 0xfee75c,
  success: 0x57f287,
  warning: 0xf0b232,
  danger: 0xed4245,
  neutral: 0x4f545c,
};

export const BUTTON_IDS = { confirm: 'plan:confirm', cancel: 'plan:cancel' };


/** Quebra linhas em blocos de até `max` caracteres (limite de valor de campo do embed). */
function chunkLines(lines, max = 1024) {
  const chunks = [];
  let current = '';
  for (const raw of lines) {
    const line = truncate(raw, max);
    if (current && current.length + line.length + 1 > max) {
      chunks.push(current);
      current = '';
    }
    current = current ? `${current}\n${line}` : line;
  }
  if (current) chunks.push(current);
  return chunks;
}

export function statusEmbed(title, description, color = COLORS.working) {
  return new EmbedBuilder().setColor(color).setTitle(title).setDescription(truncate(description || '​', 4096));
}

/**
 * Embeds do plano. Respeita os limites do Discord (25 campos por embed, 6000 caracteres no total
 * por mensagem) dividindo em mais de um embed e cortando o excesso.
 */
export function planEmbeds(plan, { mode, requestedBy }) {
  const fields = [];
  if (plan.style) {
    const lines = [
      `**Idioma:** ${plan.style.language}`,
      `**Símbolos:** ${plan.style.symbols}`,
      ...(plan.style.examples?.length ? [`**Exemplos:** ${plan.style.examples.map((e) => `\`${e}\``).join('  ')}`] : []),
    ];
    chunkLines(lines).forEach((value, idx) => fields.push({ name: idx ? '🎨 Estilo (cont.)' : '🎨 Estilo', value }));
  }
  for (const section of plan.sections) {
    const chunks = chunkLines(section.items.map((i) => `• ${i}`));
    chunks.forEach((value, idx) => fields.push({ name: truncate(idx ? `${section.title} (cont.)` : section.title, 256), value }));
  }
  if (plan.destructive_actions.length) {
    const lines = plan.destructive_actions.map(
      (a) => `• **${a.type === 'role' ? 'Cargo' : a.type === 'category' ? 'Categoria' : 'Canal'}** ${a.name}${a.reason ? ` — ${a.reason}` : ''}`,
    );
    chunkLines(lines).forEach((value, idx) => fields.push({ name: idx ? '⚠️ Exclusões (cont.)' : '⚠️ Será EXCLUÍDO', value }));
  }
  if (plan.warnings?.length) {
    chunkLines(plan.warnings.map((w) => `• ${w}`)).forEach((value, idx) => fields.push({ name: idx ? 'Avisos (cont.)' : '📝 Avisos', value }));
  }

  const head = new EmbedBuilder()
    .setColor(plan.destructive_actions.length ? COLORS.warning : COLORS.info)
    .setTitle(truncate(`🗺️ ${plan.title}`, 256))
    .setDescription(truncate(`${plan.summary}\n\n*Nada foi alterado ainda. Revise e confirme abaixo.*`, 4096))
    .setFooter({ text: `/${mode} • pedido por ${requestedBy}` });

  const embeds = [head];
  let total = (head.data.title?.length ?? 0) + (head.data.description?.length ?? 0) + 60;
  let current = head;
  let omitted = 0;
  for (const field of fields) {
    const size = field.name.length + field.value.length;
    if (total + size > 5800) {
      omitted += 1;
      continue;
    }
    if ((current.data.fields?.length ?? 0) >= 25) {
      if (embeds.length >= 10) {
        omitted += 1;
        continue;
      }
      current = new EmbedBuilder().setColor(head.data.color);
      embeds.push(current);
    }
    current.addFields(field);
    total += size;
  }
  if (omitted) {
    head.setDescription(truncate(`${head.data.description}\n\n_(${omitted} seção(ões) não couberam na mensagem, mas fazem parte do plano.)_`, 4096));
  }
  return embeds;
}

export function planButtons(hasDestructive) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(BUTTON_IDS.confirm)
      .setLabel(hasDestructive ? 'Confirmar (inclui exclusões)' : 'Confirmar')
      .setEmoji('✅')
      .setStyle(hasDestructive ? ButtonStyle.Danger : ButtonStyle.Success),
    new ButtonBuilder().setCustomId(BUTTON_IDS.cancel).setLabel('Cancelar').setEmoji('✖️').setStyle(ButtonStyle.Secondary),
  );
}

const TOOL_LABELS = {
  create_role: 'Cargo criado',
  edit_role: 'Cargo editado',
  delete_role: 'Cargo excluído',
  create_category: 'Categoria criada',
  edit_category: 'Categoria editada',
  create_channel: 'Canal criado',
  edit_channel: 'Canal editado',
  delete_channel: 'Excluído',
  set_permission_overwrites: 'Permissões',
  reorder: 'Reordenado',
  send_message: 'Mensagem enviada',
  edit_guild_settings: 'Configurações',
};

/** Linha curta de log para a mensagem de progresso. */
export function progressLine(event) {
  const label = TOOL_LABELS[event.tool] ?? event.tool;
  const target =
    event.output?.name ??
    event.output?.channel ??
    event.input?.name ??
    event.input?.role ??
    event.input?.channel ??
    event.input?.category ??
    '';
  if (event.ok) return truncate(`✅ ${label}${target ? `: ${target}` : ''}`, 180);
  return truncate(`❌ ${label}${target ? ` (${target})` : ''}: ${event.error}`, 300);
}

export function progressEmbed(lines, stats, { iteration, maxIterations }) {
  const body = lines.length ? lines.join('\n') : 'Aguardando o Claude…';
  return new EmbedBuilder()
    .setColor(COLORS.working)
    .setTitle('⚙️ Executando o plano…')
    .setDescription(truncate(body, 4096))
    .setFooter({
      text: `Ações: ${stats.actions} • Erros: ${stats.errors} • Iteração ${iteration}/${maxIterations}`,
    });
}

export function summaryEmbed(text, stats, { limitReached, usage }) {
  const color = limitReached ? COLORS.warning : stats.errors ? COLORS.warning : COLORS.success;
  const title = limitReached ? '⚠️ Execução interrompida (limite de iterações)' : '🎉 Servidor atualizado!';
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(truncate(text || 'Execução concluída.', 4096))
    .addFields({
      name: 'Estatísticas',
      value:
        `Criados: **${stats.created}** • Editados: **${stats.edited}** • Excluídos: **${stats.deleted}** • ` +
        `Mensagens: **${stats.messages}** • Erros: **${stats.errors}**`,
    })
    .setFooter({ text: `Tokens — entrada: ${usage.input} (cache: ${usage.cacheRead}) • saída: ${usage.output}` });
}
