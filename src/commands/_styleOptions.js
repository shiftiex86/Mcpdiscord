/** Opções de estilo compartilhadas por /montar e /editar. */
export function addStyleOptions(builder) {
  return builder
    .addStringOption((opt) =>
      opt
        .setName('simbolos')
        .setDescription('Símbolos a usar (ex.: ・ ┃ 「 」 ✦) ou "criativo" para o Claude escolher. Vazio = Claude escolhe.')
        .setMaxLength(200),
    )
    .addStringOption((opt) =>
      opt
        .setName('idioma')
        .setDescription('Idioma do conteúdo do servidor (ex.: português, English, español). Vazio = idioma do pedido.')
        .setMaxLength(50),
    );
}

export function readStyleOptions(interaction) {
  return {
    symbols: interaction.options.getString('simbolos')?.trim() || null,
    language: interaction.options.getString('idioma')?.trim() || null,
  };
}
