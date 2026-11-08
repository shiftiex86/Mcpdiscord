import { ToolError, assertManageableRole, resolveRole } from './_helpers.js';

export default {
  kind: 'destructive',
  definition: {
    name: 'delete_role',
    description:
      'Exclui um cargo. AÇÃO DESTRUTIVA: só funciona se o ID do cargo estiver em "destructive_actions" do plano aprovado. ' +
      'Use o ID (não o nome).',
    input_schema: {
      type: 'object',
      properties: {
        role: { type: 'string', description: 'ID do cargo a excluir.' },
      },
      required: ['role'],
      additionalProperties: false,
    },
  },

  async execute(input, { guild, reason, approvedDeletions }) {
    const role = await resolveRole(guild, input.role);
    if (!approvedDeletions.has(role.id)) {
      throw new ToolError(
        `Exclusão do cargo "${role.name}" (${role.id}) NÃO foi aprovada no plano. ` +
          'Exclusões só podem ser feitas em itens listados em destructive_actions do plano confirmado.',
      );
    }
    await assertManageableRole(guild, role);
    const { id, name } = role;
    await role.delete(reason);
    return { deleted: 'role', id, name };
  },
};
