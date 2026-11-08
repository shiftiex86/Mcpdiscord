import { PermissionsBitField } from 'discord.js';
import { OVERWRITES_SCHEMA, ToolError, buildOverwrites, resolveChannel, resolveRole, serializeOverwrites } from './_helpers.js';

/** bigint allow/deny -> objeto { Flag: true|false } usado por permissionOverwrites.create/edit. */
function toFlags(allow, deny) {
  const flags = {};
  for (const name of new PermissionsBitField(allow).toArray()) flags[name] = true;
  for (const name of new PermissionsBitField(deny).toArray()) flags[name] = false;
  return flags;
}

export default {
  kind: 'write',
  definition: {
    name: 'set_permission_overwrites',
    description:
      'Define permissões por cargo/membro em um canal ou categoria. mode "merge" (padrão): o overwrite de cada alvo ' +
      'informado passa a ser exatamente o allow/deny enviado, e os demais alvos ficam intactos. mode "replace": ' +
      'substitui TODOS os overwrites pelo que foi enviado. "remove" (só em merge) apaga o overwrite dos alvos listados. ' +
      'Alterar uma categoria não altera canais já existentes; use edit_category com sync_children para propagar.',
    input_schema: {
      type: 'object',
      properties: {
        channel: { type: 'string', description: 'ID ou nome do canal ou categoria.' },
        mode: { type: 'string', enum: ['merge', 'replace'] },
        overwrites: OVERWRITES_SCHEMA,
        remove: {
          type: 'array',
          items: { type: 'string' },
          description: 'Alvos (nome/ID de cargo, "@everyone" ou ID de membro) cujo overwrite será removido.',
        },
      },
      required: ['channel', 'overwrites'],
      additionalProperties: false,
    },
  },

  async execute(input, { guild, reason }) {
    const channel = await resolveChannel(guild, input.channel);
    const resolved = await buildOverwrites(guild, input.overwrites);
    const mode = input.mode ?? 'merge';

    if (mode === 'replace') {
      if (input.remove?.length) throw new ToolError('"remove" só pode ser usado com mode "merge".');
      await channel.permissionOverwrites.set(resolved, reason);
    } else {
      for (const ow of resolved) {
        await channel.permissionOverwrites.create(ow.id, toFlags(ow.allow, ow.deny), { type: ow.type, reason });
      }
      for (const target of input.remove ?? []) {
        const id = channel.permissionOverwrites.cache.has(String(target))
          ? String(target)
          : (await resolveRole(guild, target)).id;
        await channel.permissionOverwrites.delete(id, reason);
      }
    }
    return {
      updated: 'overwrites',
      id: channel.id,
      channel: channel.name,
      mode,
      overwrites: serializeOverwrites(channel),
    };
  },
};
