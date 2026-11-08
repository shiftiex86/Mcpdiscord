import {
  ChannelType,
  DiscordAPIError,
  GuildDefaultMessageNotifications,
  GuildVerificationLevel,
  OverwriteType,
  PermissionFlagsBits,
  PermissionsBitField,
  resolveColor,
} from 'discord.js';

/** Erro de validação/regra de negócio: volta ao Claude como tool_result com is_error. */
export class ToolError extends Error {}

// ---------------------------------------------------------------------------
// Tipos de canal
// ---------------------------------------------------------------------------

export const CHANNEL_TYPES = {
  text: ChannelType.GuildText,
  voice: ChannelType.GuildVoice,
  announcement: ChannelType.GuildAnnouncement,
  forum: ChannelType.GuildForum,
  stage: ChannelType.GuildStageVoice,
};

const CHANNEL_TYPE_ALIASES = {
  texto: 'text',
  voz: 'voice',
  anuncios: 'announcement',
  'anúncios': 'announcement',
  news: 'announcement',
  'fórum': 'forum',
  palco: 'stage',
};

export const CHANNEL_TYPE_ENUM = Object.keys(CHANNEL_TYPES);

export function parseChannelType(value) {
  const key = CHANNEL_TYPE_ALIASES[String(value).toLowerCase()] ?? String(value).toLowerCase();
  const type = CHANNEL_TYPES[key];
  if (type === undefined) {
    throw new ToolError(`Tipo de canal inválido "${value}". Use um de: ${CHANNEL_TYPE_ENUM.join(', ')}.`);
  }
  return type;
}

export function channelTypeLabel(type) {
  switch (type) {
    case ChannelType.GuildText: return 'text';
    case ChannelType.GuildVoice: return 'voice';
    case ChannelType.GuildAnnouncement: return 'announcement';
    case ChannelType.GuildForum: return 'forum';
    case ChannelType.GuildStageVoice: return 'stage';
    case ChannelType.GuildCategory: return 'category';
    case ChannelType.GuildMedia: return 'media';
    default: return `other(${type})`;
  }
}

// ---------------------------------------------------------------------------
// Permissões
// ---------------------------------------------------------------------------

const normalizePermKey = (s) => String(s).replace(/[\s_-]/g, '').toLowerCase();
const PERMISSION_LOOKUP = new Map(
  Object.keys(PermissionFlagsBits).map((name) => [normalizePermKey(name), name]),
);

export const PERMISSION_NAMES = Object.keys(PermissionFlagsBits);

/** Converte ["ViewChannel", "SEND_MESSAGES", ...] em bigint. Aceita PascalCase e SNAKE_CASE. */
export function parsePermissions(list, field = 'permissions') {
  if (list === undefined || list === null) return undefined;
  if (!Array.isArray(list)) throw new ToolError(`"${field}" deve ser uma lista de nomes de permissão.`);
  let bits = 0n;
  const invalid = [];
  for (const item of list) {
    const name = PERMISSION_LOOKUP.get(normalizePermKey(item));
    if (!name) invalid.push(item);
    else bits |= PermissionFlagsBits[name];
  }
  if (invalid.length) {
    throw new ToolError(
      `Permissões inválidas em "${field}": ${invalid.join(', ')}. Nomes válidos: ${PERMISSION_NAMES.join(', ')}.`,
    );
  }
  return bits;
}

export const permissionNames = (bitfield) => new PermissionsBitField(bitfield).toArray();

// ---------------------------------------------------------------------------
// Cores
// ---------------------------------------------------------------------------

export function parseColor(value) {
  if (value === undefined || value === null || value === '') return undefined;
  try {
    if (typeof value === 'string' && /^[0-9a-f]{6}$/i.test(value)) return resolveColor(`#${value}`);
    return resolveColor(value);
  } catch {
    throw new ToolError(`Cor inválida "${value}". Use hexadecimal como "#5865F2".`);
  }
}

export const hex = (n) => `#${Number(n ?? 0).toString(16).padStart(6, '0').toUpperCase()}`;

// ---------------------------------------------------------------------------
// Resolução de cargos e canais (por ID, menção ou nome)
// ---------------------------------------------------------------------------

function extractId(ref, mentionPattern) {
  const s = String(ref).trim();
  const mention = s.match(mentionPattern);
  if (mention) return mention[1];
  if (/^\d{17,20}$/.test(s)) return s;
  return null;
}

function pickByName(collection, name, kind) {
  let matches = collection.filter((x) => x.name === name);
  if (matches.size === 0) matches = collection.filter((x) => x.name.toLowerCase() === name.toLowerCase());
  if (matches.size === 1) return matches.first();
  if (matches.size > 1) {
    const ids = matches.map((x) => x.id).join(', ');
    throw new ToolError(`Há mais de um ${kind} chamado "${name}" (IDs: ${ids}). Use o ID.`);
  }
  return null;
}

export async function resolveRole(guild, ref) {
  if (ref === undefined || ref === null || ref === '') throw new ToolError('Cargo não informado.');
  const s = String(ref).trim();
  if (s === '@everyone' || s.toLowerCase() === 'everyone') return guild.roles.everyone;
  const id = extractId(s, /^<@&(\d+)>$/);
  if (id) {
    const role = guild.roles.cache.get(id) ?? (await guild.roles.fetch(id).catch(() => null));
    if (role) return role;
  }
  const byName = pickByName(guild.roles.cache, s, 'cargo');
  if (byName) return byName;
  throw new ToolError(`Cargo "${s}" não encontrado. Use get_server_structure para conferir nomes e IDs.`);
}

/**
 * @param {{ category?: boolean }} opts category=true só aceita categorias; false só aceita não-categorias;
 *   undefined aceita ambos.
 */
export async function resolveChannel(guild, ref, opts = {}) {
  if (ref === undefined || ref === null || ref === '') throw new ToolError('Canal/categoria não informado.');
  const s = String(ref).trim();
  const kind = opts.category === true ? 'categoria' : 'canal';
  const pool = guild.channels.cache.filter((c) => {
    if (c.isThread()) return false;
    if (opts.category === true) return c.type === ChannelType.GuildCategory;
    if (opts.category === false) return c.type !== ChannelType.GuildCategory;
    return true;
  });
  const id = extractId(s, /^<#(\d+)>$/);
  let channel = id ? pool.get(id) ?? null : null;
  if (!channel && id) {
    const fetched = await guild.channels.fetch(id).catch(() => null);
    if (fetched && pool.has(fetched.id)) channel = fetched;
    else if (fetched) throw new ToolError(`O ID ${id} não é ${opts.category ? 'uma categoria' : 'um canal'} válido aqui.`);
  }
  if (!channel) channel = pickByName(pool, s.replace(/^#/, ''), kind);
  if (!channel) {
    throw new ToolError(`${opts.category ? 'Categoria' : 'Canal'} "${s}" não encontrado(a). Use get_server_structure para conferir.`);
  }
  return channel;
}

// ---------------------------------------------------------------------------
// Hierarquia e permissões do bot
// ---------------------------------------------------------------------------

export async function getBotMember(guild) {
  return guild.members.me ?? (await guild.members.fetchMe());
}

/** Garante que o bot consegue editar/excluir o cargo (não gerenciado e abaixo do cargo mais alto do bot). */
export async function assertManageableRole(guild, role, { allowEveryone = false } = {}) {
  if (role.id === guild.id && !allowEveryone) {
    throw new ToolError('O cargo @everyone não pode ser alterado desta forma.');
  }
  if (role.managed) {
    throw new ToolError(`O cargo "${role.name}" é gerenciado por uma integração/bot e não pode ser alterado.`);
  }
  const me = await getBotMember(guild);
  if (role.id !== guild.id && guild.roles.comparePositions(role, me.roles.highest) >= 0) {
    throw new ToolError(
      `O cargo "${role.name}" (posição ${role.position}) está igual ou acima do cargo mais alto do bot ` +
        `("${me.roles.highest.name}", posição ${me.roles.highest.position}). ` +
        'Peça ao dono para subir o cargo do bot em Configurações do Servidor > Cargos.',
    );
  }
}

export async function assertRolePosition(guild, position) {
  if (position === undefined || position === null) return;
  const me = await getBotMember(guild);
  if (position >= me.roles.highest.position) {
    throw new ToolError(
      `Posição ${position} inválida: o bot só pode colocar cargos abaixo da posição ${me.roles.highest.position} ` +
        `(seu cargo mais alto, "${me.roles.highest.name}").`,
    );
  }
}

export async function assertBotHasPermissions(guild, permissions, action) {
  if (!permissions) return;
  const me = await getBotMember(guild);
  if (me.permissions.has(PermissionFlagsBits.Administrator)) return;
  const missing = new PermissionsBitField(permissions).remove(me.permissions).toArray();
  if (missing.length) {
    throw new ToolError(
      `O bot não pode ${action} com permissões que ele mesmo não tem: ${missing.join(', ')}.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Overwrites
// ---------------------------------------------------------------------------

export const OVERWRITES_SCHEMA = {
  type: 'array',
  description:
    'Permissões por cargo (ou membro) neste canal/categoria. Cada item: alvo + listas allow/deny com nomes de ' +
    'permissão do discord.js (ex.: ViewChannel, SendMessages, Connect). Permissões ausentes ficam neutras (herdadas).',
  items: {
    type: 'object',
    properties: {
      target: { type: 'string', description: 'Nome ou ID do cargo, "@everyone", ou ID de membro.' },
      target_type: { type: 'string', enum: ['role', 'member'], description: 'Padrão: role.' },
      allow: { type: 'array', items: { type: 'string' } },
      deny: { type: 'array', items: { type: 'string' } },
    },
    required: ['target'],
    additionalProperties: false,
  },
};

/** Converte o formato da tool em OverwriteResolvable[] do discord.js. */
export async function buildOverwrites(guild, overwrites) {
  if (!overwrites) return undefined;
  const result = [];
  for (const [i, ow] of overwrites.entries()) {
    const allow = parsePermissions(ow.allow ?? [], `permission_overwrites[${i}].allow`);
    const deny = parsePermissions(ow.deny ?? [], `permission_overwrites[${i}].deny`);
    await assertBotHasPermissions(guild, allow | deny, 'definir overwrites');
    if (ow.target_type === 'member') {
      const member = await guild.members.fetch(String(ow.target)).catch(() => null);
      if (!member) throw new ToolError(`Membro "${ow.target}" não encontrado (use o ID do usuário).`);
      result.push({ id: member.id, type: OverwriteType.Member, allow, deny });
    } else {
      const role = await resolveRole(guild, ow.target);
      result.push({ id: role.id, type: OverwriteType.Role, allow, deny });
    }
  }
  return result;
}

export function serializeOverwrites(channel) {
  return channel.permissionOverwrites.cache.map((ow) => {
    const role = ow.type === OverwriteType.Role ? channel.guild.roles.cache.get(ow.id) : null;
    return {
      target: role ? (role.id === channel.guild.id ? '@everyone' : role.name) : ow.id,
      target_id: ow.id,
      target_type: ow.type === OverwriteType.Role ? 'role' : 'member',
      allow: ow.allow.toArray(),
      deny: ow.deny.toArray(),
    };
  });
}

// ---------------------------------------------------------------------------
// Configurações do servidor
// ---------------------------------------------------------------------------

export const VERIFICATION_LEVELS = {
  none: GuildVerificationLevel.None,
  low: GuildVerificationLevel.Low,
  medium: GuildVerificationLevel.Medium,
  high: GuildVerificationLevel.High,
  very_high: GuildVerificationLevel.VeryHigh,
};

export const NOTIFICATION_LEVELS = {
  all_messages: GuildDefaultMessageNotifications.AllMessages,
  only_mentions: GuildDefaultMessageNotifications.OnlyMentions,
};

export const labelOf = (map, value) => Object.entries(map).find(([, v]) => v === value)?.[0] ?? String(value);

// ---------------------------------------------------------------------------
// Erros
// ---------------------------------------------------------------------------

export function formatError(err) {
  if (err instanceof ToolError) return err.message;
  if (err instanceof DiscordAPIError) {
    const details = err.rawError?.errors ? ` Detalhes: ${JSON.stringify(err.rawError.errors).slice(0, 800)}` : '';
    return `Erro da API do Discord (HTTP ${err.status}, código ${err.code}): ${err.message}.${details}`;
  }
  return `Erro inesperado: ${err?.message ?? String(err)}`;
}

/** Remove chaves undefined (o discord.js trata undefined e "não enviado" de forma diferente em alguns campos). */
export function compact(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}
