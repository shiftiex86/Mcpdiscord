import fs from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';
import { ChannelType } from 'discord.js';
import { config } from './config.js';
import { logger } from './logger.js';
import { actionQueue } from './queue.js';
import { TOOL_DEFINITIONS, toolsByName, validateInput } from './tools/index.js';
import { ToolError, formatError } from './tools/_helpers.js';
import { findMalformedStrings, safeSlice, wellFormed, wellFormedDeep } from './text.js';

const SYSTEM_PROMPT = fs.readFileSync(new URL('./prompts/system.md', import.meta.url), 'utf8');

const anthropic = new Anthropic({ apiKey: config.anthropicApiKey });

// Fallback no servidor: se o modelo recusar por política (stop_reason "refusal"), a API
// re-executa a requisição num modelo substituto recomendado pela Anthropic.
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

export class AgentError extends Error {}

const APPROVAL_MESSAGE = (deletions) =>
  [
    'PLANO APROVADO pelo usuário. Você agora está na fase de EXECUÇÃO.',
    'Execute todas as etapas do plano, na ordem, usando as tools (agrupe ações independentes na mesma resposta).',
    deletions.length
      ? `Exclusões aprovadas (somente estes IDs): ${deletions.join(', ')}.`
      : 'Nenhuma exclusão foi aprovada: não exclua nada.',
    'Ao terminar, responda com o resumo final (sem chamar mais tools).',
  ].join('\n');

/**
 * Loop agêntico em duas fases sobre UMA conversa:
 *   1. plan():    o Claude lê o servidor e chama submit_plan. Tools de escrita são bloqueadas.
 *   2. execute(): após a confirmação, o tool_result do submit_plan diz "aprovado" e o loop segue
 *                 executando as tools até stop_reason "end_turn" (ou o limite de iterações).
 * O histórico é só acrescentado (nunca editado) e system/tools nunca mudam entre as fases — isso
 * mantém o cache do prompt e os blocos de thinking válidos de uma fase para a outra.
 */
export class ServerAgent {
  constructor({ guild, user, mode, request, style = {}, invokingChannelId, onAction = () => {}, client = anthropic }) {
    this.client = client;
    this.guild = guild;
    this.user = user;
    this.mode = mode; // 'montar' | 'editar'
    this.request = request;
    this.style = { symbols: style.symbols ?? null, language: style.language ?? null };
    this.invokingChannelId = invokingChannelId;
    this.onAction = onAction;

    this.phase = 'plan';
    this.messages = [{ role: 'user', content: this.#initialMessage() }];
    this.plan = null;
    this.pendingResults = null;
    this.planResultIndex = -1;
    this.approvedDeletions = new Set();
    this.iteration = 0;
    this.stats = { actions: 0, errors: 0, created: 0, edited: 0, deleted: 0, messages: 0 };
    this.usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    this.scope = `agent:${guild.id}`;
  }

  #initialMessage() {
    const header =
      this.mode === 'montar'
        ? 'Modo: MONTAR — montar o servidor a partir da descrição abaixo.'
        : 'Modo: EDITAR — fazer ajustes pontuais no servidor existente, conforme o pedido abaixo.';
    return [
      header,
      `Servidor: ${this.guild.name} (ID ${this.guild.id})`,
      `Solicitado por: ${this.user.tag} (ID ${this.user.id})`,
      '',
      'Pedido do usuário:',
      '"""',
      this.request,
      '"""',
      '',
      'Preferências de estilo (aplique conforme o GUIA DE ESTILO):',
      this.#symbolsLine(),
      this.style.language
        ? `- Idioma do conteúdo do servidor: ${this.style.language}`
        : '- Idioma do conteúdo do servidor: não informado — use o idioma em que o pedido foi escrito.',
      '- Emojis, cores, nomes e textos: você escolhe, combinando com o tema (salvo pedido explícito).',
      '',
      'Fase atual: PLANEJAMENTO. Leia a estrutura com get_server_structure e envie o plano com submit_plan.',
    ].join('\n');
  }

  #symbolsLine() {
    const s = this.style.symbols;
    if (!s) {
      return '- Símbolos: não informados na opção — se o pedido mencionar símbolos, siga-o; senão, escolha você um kit coerente com o tema.';
    }
    if (/(criativ|livre|aleat[oó]ri|random|creative|surpreend|voc[eê] escolhe|tanto faz|qualquer|escolha voc)/i.test(s)) {
      return `- Símbolos: "${s}" — liberdade criativa: escolha você um kit coerente com o tema, a partir da biblioteca (se o texto também citar símbolos específicos, inclua-os no kit).`;
    }
    return `- Símbolos: "${s}" — use exatamente estes (e só estes) como decoração, distribuídos pelos papéis do guia.`;
  }

  // ---------------------------------------------------------------------------
  // Fases
  // ---------------------------------------------------------------------------

  /** @returns {Promise<{plan: object} | {text: string}>} */
  async runPlanning() {
    const outcome = await this.#loop(config.maxPlanIterations);
    if (outcome.plan) return { plan: outcome.plan };
    if (outcome.limitReached) throw new AgentError('O Claude não conseguiu montar um plano dentro do limite de iterações.');
    return { text: outcome.text || 'O Claude encerrou sem enviar um plano.' };
  }

  /** @returns {Promise<{text: string, limitReached: boolean}>} */
  async runExecution() {
    if (!this.plan || !this.pendingResults) throw new AgentError('Não há plano pendente para executar.');
    this.phase = 'execute';
    this.approvedDeletions = new Set(this.plan.destructive_actions.map((a) => a.id));

    // Responde ao submit_plan com a aprovação (append-only: é o próximo turno "user").
    const results = this.pendingResults;
    results[this.planResultIndex] = {
      ...results[this.planResultIndex],
      content: APPROVAL_MESSAGE([...this.approvedDeletions]),
    };
    this.messages.push({ role: 'user', content: results });
    this.pendingResults = null;
    this.iteration = 0;
    this.stats.errors = 0; // conta só os erros da execução

    logger.info(this.scope, 'Plano aprovado; iniciando execução', { deletions: [...this.approvedDeletions] });
    const outcome = await this.#loop(config.maxExecIterations);
    logger.info(this.scope, 'Execução finalizada', { stats: this.stats, usage: this.usage, limitReached: !!outcome.limitReached });
    return { text: outcome.text ?? '', limitReached: !!outcome.limitReached };
  }

  // ---------------------------------------------------------------------------
  // Loop agêntico
  // ---------------------------------------------------------------------------

  async #loop(maxIterations) {
    while (this.iteration < maxIterations) {
      this.iteration += 1;
      const message = await this.#callClaude();

      if (message.stop_reason === 'refusal') {
        throw new AgentError(
          `O Claude recusou o pedido${message.stop_details?.category ? ` (categoria: ${message.stop_details.category})` : ''}. ` +
            'Reformule a descrição e tente novamente.',
        );
      }

      const toolUses = message.content.filter((b) => b.type === 'tool_use');

      if (message.stop_reason === 'max_tokens' && toolUses.length) {
        // Input de tool possivelmente truncado: não executa nada.
        throw new AgentError('A resposta do Claude foi cortada no meio de uma ação (max_tokens). Tente um pedido menor.');
      }

      // Sempre acrescenta o conteúdo completo (inclui thinking/fallback blocks, que precisam voltar intactos).
      // Exceção: se a resposta trouxer um emoji corrompido (surrogate isolado) num input de tool, o corpo
      // da próxima requisição seria JSON inválido (400 "unexpected end of hex escape"); nesse caso raro
      // trocamos só o caractere quebrado por U+FFFD. O tool_use em si é recusado em #runTool.
      const content = wellFormedDeep(message.content);
      if (content !== message.content) logger.warn(this.scope, 'Resposta com surrogate isolado; texto saneado antes de reenviar');
      this.messages.push({ role: 'assistant', content });

      if (message.stop_reason === 'pause_turn') continue;
      if (toolUses.length === 0) return { text: extractText(message) };

      const results = [];
      let submittedPlan = null;
      for (const block of toolUses) {
        const { result, plan } = await this.#runTool(block, submittedPlan !== null);
        if (plan) {
          submittedPlan = plan;
          this.planResultIndex = results.length;
        }
        results.push(result);
      }

      if (submittedPlan) {
        // Pausa o loop: os tool_results ficam guardados até o usuário confirmar.
        this.plan = submittedPlan;
        this.pendingResults = results;
        logger.info(this.scope, 'Plano recebido', { title: submittedPlan.title, deletions: submittedPlan.destructive_actions.length });
        return { plan: submittedPlan };
      }

      // Todos os tool_results da rodada vão juntos em uma única mensagem "user".
      this.messages.push({ role: 'user', content: results });
    }
    logger.warn(this.scope, `Limite de ${maxIterations} iterações atingido na fase ${this.phase}`);
    return { limitReached: true };
  }

  async #callClaude() {
    let jsonRetries = 0;
    for (;;) {
      const stream = this.client.beta.messages.stream({
        model: config.model,
        max_tokens: config.maxTokens,
        betas: [FALLBACK_BETA],
        fallbacks: 'default',
        thinking: { type: 'adaptive' },
        output_config: { effort: config.effort },
        cache_control: { type: 'ephemeral' },
        system: SYSTEM_PROMPT,
        tools: TOOL_DEFINITIONS,
        messages: this.messages,
      });
      try {
        const message = await stream.finalMessage();
        this.#trackUsage(message);
        return message;
      } catch (err) {
        // Erros da API (auth, rate limit, 5xx...) sobem; o SDK já faz retry dos transitórios.
        // Só re-tentamos o turno quando o input de uma tool veio como JSON impossível de parsear.
        if (err instanceof Anthropic.APIError || jsonRetries >= 2) throw err;
        jsonRetries += 1;
        logger.warn(this.scope, 'Input de tool com JSON inválido; repetindo o turno', { error: err.message });
      }
    }
  }

  #trackUsage(message) {
    const u = message.usage ?? {};
    this.usage.input += u.input_tokens ?? 0;
    this.usage.output += u.output_tokens ?? 0;
    this.usage.cacheRead += u.cache_read_input_tokens ?? 0;
    this.usage.cacheWrite += u.cache_creation_input_tokens ?? 0;
    logger.info(this.scope, `Claude respondeu (fase ${this.phase}, iteração ${this.iteration})`, {
      model: message.model,
      stop_reason: message.stop_reason,
      usage: { in: u.input_tokens, out: u.output_tokens, cache_read: u.cache_read_input_tokens },
    });
  }

  // ---------------------------------------------------------------------------
  // Execução de tools
  // ---------------------------------------------------------------------------

  async #runTool(block, planAlreadySubmitted) {
    const fail = (content) => {
      this.stats.errors += 1;
      return { result: { type: 'tool_result', tool_use_id: block.id, is_error: true, content: wellFormed(content) } };
    };
    const tool = toolsByName.get(block.name);
    if (!tool) return fail(`Tool desconhecida: ${block.name}`);

    // Defesa extra: valida o input contra o schema antes de executar.
    const errors = validateInput(tool.definition.input_schema, block.input);
    const malformed = findMalformedStrings(block.input);
    if (malformed.length) {
      errors.push(
        `${malformed.join(', ')} contém um emoji/símbolo corrompido (surrogate UTF-16 isolado). ` +
          'Reenvie escrevendo os caracteres diretamente, sem sequências de escape \\u',
      );
    }
    if (errors.length) {
      logger.warn(this.scope, `Input inválido para ${block.name}`, { errors });
      return fail(`INVALID_INPUT: ${errors.join('; ')}. Input recebido: ${safeSlice(JSON.stringify(wellFormedDeep(block.input)), 1500)}`);
    }

    // Regras de fase
    if (this.phase === 'plan' && (tool.kind === 'write' || tool.kind === 'destructive')) {
      return fail(
        'Fase de PLANEJAMENTO: nenhuma alteração pode ser feita antes da confirmação do usuário. ' +
          'Inclua esta ação no plano e envie-o com submit_plan.',
      );
    }
    if (tool.kind === 'plan') {
      if (this.phase !== 'plan') return fail('O plano já foi aprovado. Execute as ações; não envie outro plano.');
      if (planAlreadySubmitted) return fail('submit_plan já foi chamado nesta resposta.');
      try {
        await this.#validatePlan(block.input);
      } catch (err) {
        return fail(formatError(err));
      }
      // O conteúdo real deste tool_result é definido na aprovação (runExecution).
      return {
        plan: block.input,
        result: { type: 'tool_result', tool_use_id: block.id, content: 'Plano enviado ao usuário.' },
      };
    }

    const ctx = {
      guild: this.guild,
      reason: `MCP Discord • pedido de ${this.user.tag}`,
      approvedDeletions: this.approvedDeletions,
      invokingChannelId: this.invokingChannelId,
    };

    try {
      const output =
        tool.kind === 'read'
          ? await tool.execute(block.input, ctx)
          : await actionQueue.run(this.guild.id, () => tool.execute(block.input, ctx));

      if (tool.kind !== 'read') {
        this.stats.actions += 1;
        if (output.created) this.stats.created += 1;
        else if (output.deleted) this.stats.deleted += 1;
        else if (output.sent) this.stats.messages += 1;
        else this.stats.edited += 1;
        logger.info(this.scope, `OK ${block.name}`, { input: block.input, output });
        this.#notify({ ok: true, tool: block.name, input: block.input, output });
      }
      return { result: { type: 'tool_result', tool_use_id: block.id, content: wellFormed(JSON.stringify(output)) } };
    } catch (err) {
      const message = formatError(err);
      if (!(err instanceof ToolError)) logger.error(this.scope, `Falha em ${block.name}`, { input: block.input, error: message });
      else logger.warn(this.scope, `Recusado ${block.name}`, { input: block.input, error: message });
      if (tool.kind !== 'read') this.#notify({ ok: false, tool: block.name, input: block.input, error: message });
      return fail(message);
    }
  }

  async #validatePlan(plan) {
    await this.guild.channels.fetch();
    await this.guild.roles.fetch();
    const problems = [];
    for (const action of plan.destructive_actions) {
      if (action.type === 'role') {
        const role = this.guild.roles.cache.get(action.id);
        if (!role) problems.push(`cargo ${action.id} ("${action.name}") não existe`);
        else if (role.id === this.guild.id || role.managed) problems.push(`cargo "${role.name}" não pode ser excluído`);
      } else {
        const channel = this.guild.channels.cache.get(action.id);
        if (!channel) problems.push(`${action.type} ${action.id} ("${action.name}") não existe`);
        else if ((action.type === 'category') !== (channel.type === ChannelType.GuildCategory)) {
          problems.push(`${action.id} ("${channel.name}") não é do tipo ${action.type}`);
        }
      }
    }
    if (problems.length) {
      throw new ToolError(`destructive_actions inválido: ${problems.join('; ')}. Corrija os IDs e envie o plano de novo.`);
    }
  }

  #notify(event) {
    try {
      this.onAction({ ...event, stats: { ...this.stats }, iteration: this.iteration });
    } catch (err) {
      logger.warn(this.scope, 'Falha no callback de progresso', { error: err.message });
    }
  }
}

function extractText(message) {
  return message.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
}
