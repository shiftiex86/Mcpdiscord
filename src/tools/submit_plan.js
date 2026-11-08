export default {
  kind: 'plan',
  definition: {
    name: 'submit_plan',
    description:
      'Envia o PLANO para o usuário revisar e confirmar. Chame exatamente uma vez, na fase de planejamento, depois de ' +
      'ler a estrutura do servidor. Nenhuma alteração é feita antes da confirmação. Toda exclusão que você pretende ' +
      'fazer DEVE estar em destructive_actions (com o ID real lido em get_server_structure); exclusões fora dessa ' +
      'lista serão bloqueadas na execução.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Título curto do plano (máx. 200 caracteres).' },
        summary: { type: 'string', description: 'Resumo em 1–3 frases do que será feito.' },
        sections: {
          type: 'array',
          description:
            'Seções do plano em ordem de execução (ex.: "Cargos", "Categorias e canais", "Permissões", "Mensagens", ' +
            '"Configurações"). Cada item é uma linha curta já no estilo final (ex.: "📢・avisos — anúncios, só Staff envia").',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              items: { type: 'array', items: { type: 'string' } },
            },
            required: ['title', 'items'],
            additionalProperties: false,
          },
        },
        destructive_actions: {
          type: 'array',
          description: 'Tudo o que será EXCLUÍDO. Lista vazia se nada for excluído.',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['role', 'channel', 'category'] },
              id: { type: 'string', description: 'ID real do item (de get_server_structure).' },
              name: { type: 'string' },
              reason: { type: 'string' },
            },
            required: ['type', 'id', 'name'],
            additionalProperties: false,
          },
        },
        warnings: {
          type: 'array',
          items: { type: 'string' },
          description: 'Limitações e avisos (ex.: cargo do bot baixo, Comunidade desativada, pedidos impossíveis).',
        },
      },
      required: ['title', 'summary', 'sections', 'destructive_actions'],
      additionalProperties: false,
    },
  },

  // A execução real é tratada pelo agente (pausa o loop e mostra o plano ao usuário).
  async execute() {
    return { ok: true };
  },
};
