// Teste local sem rede: valida schemas, helpers, embeds e o loop agêntico com um cliente Claude falso.
// Uso: npm run check
import assert from 'node:assert/strict';

process.env.DISCORD_TOKEN ??= 'test';
process.env.CLIENT_ID ??= '123';
process.env.ANTHROPIC_API_KEY ??= 'test';
process.env.LOG_FILE ??= 'logs/selftest.log';
process.env.ACTION_DELAY_MS ??= '1';

const { TOOL_DEFINITIONS, validateInput, toolsByName } = await import('../src/tools/index.js');
const { parsePermissions, parseColor } = await import('../src/tools/_helpers.js');
const { planEmbeds, progressLine, summaryEmbed } = await import('../src/ui/embeds.js');
const { commands } = await import('../src/commands/index.js');
const { ServerAgent } = await import('../src/agent.js');

let passed = 0;
const test = async (name, fn) => {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
};

await test('definições de tools', () => {
  assert.equal(TOOL_DEFINITIONS.length, 14);
  for (const t of TOOL_DEFINITIONS) {
    assert.ok(/^[a-z_]+$/.test(t.name));
    assert.equal(t.input_schema.type, 'object');
    assert.equal(t.eager_input_streaming, true);
    assert.ok(t.description.length > 20);
  }
});

await test('validador de input', () => {
  const schema = toolsByName.get('create_channel').definition.input_schema;
  assert.deepEqual(validateInput(schema, { name: 'x', type: 'text' }), []);
  assert.ok(validateInput(schema, { name: 'x' }).some((e) => e.includes('type')));
  assert.ok(validateInput(schema, { name: 'x', type: 'banana' }).some((e) => e.includes('deve ser um de')));
  assert.ok(validateInput(schema, { name: 'x', type: 'text', foo: 1 }).some((e) => e.includes('foo')));
  assert.ok(validateInput(schema, { name: 'x', type: 'text', slowmode: 1.5 }).some((e) => e.includes('inteiro')));
  assert.ok(
    validateInput(schema, { name: 'x', type: 'text', permission_overwrites: [{ allow: [] }] }).some((e) => e.includes('target')),
  );
});

await test('permissões e cores', () => {
  assert.equal(parsePermissions(['ViewChannel', 'SEND_MESSAGES']), (1n << 10n) | (1n << 11n));
  assert.throws(() => parsePermissions(['Voar']), /inválidas/);
  assert.equal(parseColor('#5865F2'), 0x5865f2);
  assert.equal(parseColor('ED4245'), 0xed4245);
  assert.throws(() => parseColor('azul-bebe'), /Cor inválida/);
});

await test('embeds do plano respeitam limites', () => {
  const plan = {
    title: 'Servidor de teste',
    summary: 'Resumo',
    sections: Array.from({ length: 40 }, (_, i) => ({ title: `Seção ${i}`, items: Array.from({ length: 30 }, (_, j) => `item ${j} `.repeat(5)) })),
    destructive_actions: [{ type: 'channel', id: '1', name: 'geral', reason: 'substituído' }],
    warnings: ['aviso'],
    style: { language: 'pt-BR', symbols: '꒰ ꒱ moldura · ♡ marcador', examples: ['꒰ 🌸 informações ꒱'] },
  };
  const embeds = planEmbeds(plan, { mode: 'montar', requestedBy: 'user#0' });
  const total = embeds.reduce((n, e) => n + JSON.stringify(e.toJSON()).length, 0);
  assert.ok(embeds.length <= 10);
  for (const e of embeds) assert.ok((e.data.fields?.length ?? 0) <= 25);
  assert.ok(total < 9000);
  assert.equal(embeds[0].data.fields[0].name, '🎨 Estilo');
  assert.ok(progressLine({ ok: true, tool: 'create_role', output: { name: '👑 Dono' } }).includes('Dono'));
  summaryEmbed('ok', { created: 1, edited: 0, deleted: 0, messages: 0, errors: 0, actions: 1 }, { limitReached: false, usage: { input: 1, output: 1, cacheRead: 0 } });
});

await test('preferência "criativo" libera a escolha dos símbolos', async () => {
  const mk = (symbols) =>
    new ServerAgent({ guild: { id: '1', name: 'G' }, user: { id: '2', tag: 'u' }, mode: 'montar', request: 'x', style: { symbols } })
      .messages[0].content;
  assert.match(mk('criativo'), /liberdade criativa/);
  assert.match(mk('seja criativo com os símbolos'), /liberdade criativa/);
  assert.match(mk('criativo, mas use ✦'), /inclua-os no kit/);
  assert.match(mk('・ ┃'), /use exatamente estes/);
  assert.match(mk(null), /escolha você um kit/);
});

await test('slash commands serializam', () => {
  for (const c of commands.values()) {
    const json = c.data.toJSON();
    assert.equal(json.options.length, 3);
    assert.deepEqual(json.options.map((o) => o.name).slice(1), ['simbolos', 'idioma']);
    assert.equal(json.options[1].required ?? false, false);
  }
});

await test('loop agêntico: plano → bloqueio de escrita → aprovação → execução', async () => {
  // Cliente falso que devolve respostas roteirizadas e registra cada requisição.
  const script = [
    // Fase de plano: tenta criar um cargo (deve ser bloqueado) e lê a estrutura.
    { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'create_role', input: { name: 'X' } }] },
    // Envia o plano junto com um input inválido em outra tool.
    {
      stop_reason: 'tool_use',
      content: [
        { type: 'thinking', thinking: '', signature: 'sig' },
        { type: 'tool_use', id: 't2', name: 'edit_role', input: { nome: 'errado' } },
        {
          type: 'tool_use',
          id: 't3',
          name: 'submit_plan',
          input: {
            title: 'Plano',
            summary: 'Resumo',
            style: { language: 'português', symbols: '・ separador', examples: ['📢・avisos'] },
            sections: [{ title: 'Cargos', items: ['👑 Dono'] }],
            destructive_actions: [],
          },
        },
      ],
    },
    // Execução: tenta excluir algo não aprovado.
    { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't4', name: 'delete_role', input: { role: '999999999999999999' } }] },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Resumo final' }] },
  ];
  const requests = [];
  const fakeClient = {
    beta: {
      messages: {
        stream(body) {
          requests.push(structuredClone(body));
          const next = script.shift();
          return { finalMessage: async () => ({ model: body.model, usage: { input_tokens: 10, output_tokens: 5 }, ...next }) };
        },
      },
    },
  };
  const role = { id: '999999999999999999', name: 'Alvo', managed: false, position: 1 };
  const roleCache = new Map([[role.id, role]]);
  roleCache.filter = (fn) => {
    const m = new Map([...roleCache].filter(([, v]) => fn(v)));
    m.first = () => m.values().next().value;
    return m;
  };
  const fakeGuild = {
    id: '1',
    name: 'Teste',
    channels: { fetch: async () => {}, cache: new Map() },
    roles: { fetch: async () => role, cache: roleCache, everyone: { id: '1' } },
  };
  const agent = new ServerAgent({
    guild: fakeGuild,
    user: { id: '2', tag: 'user#0' },
    mode: 'montar',
    request: 'um servidor',
    style: { symbols: '「 」 ✦', language: 'English' },
    invokingChannelId: '3',
    client: fakeClient,
  });

  const planning = await agent.runPlanning();
  // Preferências de estilo chegam ao Claude na primeira mensagem.
  assert.match(requests[0].messages[0].content, /Símbolos: "「 」 ✦" — use exatamente estes/);
  assert.match(requests[0].messages[0].content, /Idioma do conteúdo do servidor: English/);
  assert.equal(planning.plan.title, 'Plano');
  // A 2ª requisição recebeu o erro de fase para create_role.
  const blocked = requests[1].messages.at(-1).content[0];
  assert.equal(blocked.is_error, true);
  assert.match(blocked.content, /PLANEJAMENTO/);

  const execution = await agent.runExecution();
  assert.equal(execution.text, 'Resumo final');

  // 3ª requisição: tool_results da rodada do plano, todos juntos, com a aprovação no submit_plan.
  const approvalTurn = requests[2].messages.at(-1);
  assert.equal(approvalTurn.role, 'user');
  assert.equal(approvalTurn.content.length, 2);
  assert.equal(approvalTurn.content[0].is_error, true); // edit_role com input inválido
  assert.match(approvalTurn.content[0].content, /INVALID_INPUT/);
  assert.match(approvalTurn.content[1].content, /PLANO APROVADO/);

  // Exclusão fora do plano foi bloqueada.
  const deletion = requests[3].messages.at(-1).content[0];
  assert.equal(deletion.is_error, true);
  assert.match(deletion.content, /NÃO foi aprovada/);

  // Histórico só cresce: cada requisição é prefixo da seguinte; system/tools/params iguais.
  for (let i = 1; i < requests.length; i++) {
    const prev = requests[i - 1];
    const cur = requests[i];
    assert.deepEqual(cur.messages.slice(0, prev.messages.length), prev.messages);
    assert.equal(cur.system, prev.system);
    assert.deepEqual(cur.tools, prev.tools);
  }
  const first = requests[0];
  assert.equal(first.model, 'claude-sonnet-5-5');
  assert.deepEqual(first.thinking, { type: 'adaptive' });
  assert.deepEqual(first.output_config, { effort: 'high' });
  assert.equal(first.fallbacks, 'default');
  // O bloco de thinking voltou intacto no histórico.
  assert.ok(requests[2].messages.some((m) => m.role === 'assistant' && m.content.some((b) => b.type === 'thinking')));
});

console.log(`\n${passed} testes passaram.`);
process.exit(0);
