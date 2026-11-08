import { config } from './config.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Fila serial por servidor: executa uma ação de escrita por vez, com um pequeno
 * intervalo entre elas. O discord.js já respeita os headers de rate limit (429),
 * mas espaçar criações em massa evita estourar os limites por rota (ex.: criação
 * de canais) e deixa a ordem das ações previsível.
 */
class ActionQueue {
  constructor(delayMs) {
    this.delayMs = delayMs;
    this.tails = new Map(); // guildId -> Promise
  }

  run(guildId, fn) {
    const previous = this.tails.get(guildId) ?? Promise.resolve();
    const next = previous
      .catch(() => {})
      .then(async () => {
        try {
          return await fn();
        } finally {
          await sleep(this.delayMs);
        }
      });
    this.tails.set(guildId, next);
    // Limpa a referência quando a fila esvazia.
    next.finally(() => {
      if (this.tails.get(guildId) === next) this.tails.delete(guildId);
    }).catch(() => {});
    return next;
  }
}

export const actionQueue = new ActionQueue(config.actionDelayMs);
