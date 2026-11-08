import { EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { ToolError, getBotMember, parseColor, resolveChannel } from './_helpers.js';

const EMBED_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Máx. 256 caracteres.' },
    description: { type: 'string', description: 'Markdown do Discord. Máx. 4096 caracteres.' },
    color: { type: 'string', description: 'Hexadecimal, ex.: "#5865F2".' },
    url: { type: 'string' },
    fields: {
      type: 'array',
      description: 'Máx. 25 campos.',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Máx. 256 caracteres.' },
          value: { type: 'string', description: 'Máx. 1024 caracteres.' },
          inline: { type: 'boolean' },
        },
        required: ['name', 'value'],
        additionalProperties: false,
      },
    },
    author: { type: 'string', description: 'Texto do autor no topo do embed.' },
    footer: { type: 'string' },
    thumbnail_url: { type: 'string' },
    image_url: { type: 'string' },
    timestamp: { type: 'boolean', description: 'Mostrar data/hora atual no rodapé.' },
  },
  additionalProperties: false,
};

function buildEmbed(data, i) {
  const embed = new EmbedBuilder();
  try {
    if (data.title) embed.setTitle(data.title);
    if (data.description) embed.setDescription(data.description);
    const color = parseColor(data.color);
    if (color !== undefined) embed.setColor(color);
    if (data.url) embed.setURL(data.url);
    if (data.fields?.length) embed.addFields(data.fields.map((f) => ({ name: f.name, value: f.value, inline: !!f.inline })));
    if (data.author) embed.setAuthor({ name: data.author });
    if (data.footer) embed.setFooter({ text: data.footer });
    if (data.thumbnail_url) embed.setThumbnail(data.thumbnail_url);
    if (data.image_url) embed.setImage(data.image_url);
    if (data.timestamp) embed.setTimestamp();
  } catch (err) {
    throw new ToolError(`Embed ${i} inválido: ${err.message}`);
  }
  return embed;
}

export default {
  kind: 'write',
  definition: {
    name: 'send_message',
    description:
      'Envia uma mensagem (texto e/ou até 10 embeds) em um canal de texto/anúncios — use para regras, boas-vindas, ' +
      'guia de cargos, FAQ etc. Menções de cargos/canais: <@&ID> e <#ID>. Pode fixar a mensagem com pin=true.',
    input_schema: {
      type: 'object',
      properties: {
        channel: { type: 'string', description: 'ID, menção ou nome do canal.' },
        content: { type: 'string', description: 'Texto fora do embed. Máx. 2000 caracteres.' },
        embeds: { type: 'array', items: EMBED_SCHEMA, description: 'Até 10 embeds.' },
        pin: { type: 'boolean' },
      },
      required: ['channel'],
      additionalProperties: false,
    },
  },

  async execute(input, { guild }) {
    if (!input.content && !input.embeds?.length) throw new ToolError('Informe "content" e/ou "embeds".');
    if (input.content && input.content.length > 2000) throw new ToolError('"content" passa de 2000 caracteres.');
    if (input.embeds && input.embeds.length > 10) throw new ToolError('Máximo de 10 embeds por mensagem.');

    const channel = await resolveChannel(guild, input.channel, { category: false });
    if (!channel.isTextBased()) throw new ToolError(`"${channel.name}" não aceita mensagens de texto.`);

    const message = await channel.send({
      content: input.content || undefined,
      embeds: input.embeds?.map(buildEmbed),
      allowedMentions: { parse: [] }, // não notifica ninguém ao montar o servidor
    });

    let pinned = false;
    if (input.pin) {
      const me = await getBotMember(guild);
      if (channel.permissionsFor(me).has(PermissionFlagsBits.ManageMessages)) {
        await message.pin();
        pinned = true;
      }
    }
    return { sent: 'message', channel: channel.name, channel_id: channel.id, message_id: message.id, pinned };
  },
};
