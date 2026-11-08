import 'dotenv/config';

function required(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`[config] Variável de ambiente obrigatória ausente: ${name} (veja .env.example)`);
    process.exit(1);
  }
  return value;
}

function intEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const config = {
  discordToken: required('DISCORD_TOKEN'),
  clientId: required('CLIENT_ID'),
  anthropicApiKey: required('ANTHROPIC_API_KEY'),

  // Opcional: registra os comandos só neste servidor (aparecem na hora; ótimo para desenvolvimento).
  devGuildId: process.env.GUILD_ID || null,

  model: 'claude-sonnet-5-5',
  effort: 'high',
  maxTokens: 64000,

  // Limite de iterações do loop agêntico (cada iteração = 1 chamada ao Claude).
  maxPlanIterations: intEnv('MAX_PLAN_ITERATIONS', 8),
  maxExecIterations: intEnv('MAX_EXEC_ITERATIONS', 40),

  // Pausa entre ações no Discord (ms), além do controle de rate limit do próprio discord.js.
  actionDelayMs: intEnv('ACTION_DELAY_MS', 400),

  // Tempo para o usuário confirmar o plano.
  confirmTimeoutMs: intEnv('CONFIRM_TIMEOUT_MS', 5 * 60 * 1000),

  logFile: process.env.LOG_FILE || 'logs/actions.log',
};
