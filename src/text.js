/**
 * Utilitários de texto seguros para Unicode.
 *
 * Strings JS são UTF-16: emojis como 🌸 ocupam DOIS code units (um par de surrogates).
 * Cortar com .slice() no meio do par deixa um "surrogate isolado", que o JSON.stringify
 * serializa como "\ud83c" — e a API da Anthropic rejeita o corpo da requisição com
 * "unexpected end of hex escape". Todo texto que vai para o Claude passa por aqui.
 */

const isHighSurrogate = (code) => code >= 0xd800 && code <= 0xdbff;

/** Corta em até `max` code units sem partir um par de surrogates. */
export function safeSlice(text, max) {
  const s = String(text);
  if (s.length <= max) return s;
  let end = max;
  if (end > 0 && isHighSurrogate(s.charCodeAt(end - 1))) end -= 1;
  return s.slice(0, end);
}

/** Corta e adiciona reticências, sem partir emojis. */
export function truncate(text, max) {
  const s = String(text);
  return s.length > max ? `${safeSlice(s, max - 1)}…` : s;
}

/** Troca surrogates isolados por U+FFFD, garantindo texto serializável. */
export const wellFormed = (text) => String(text).toWellFormed();

/** Lista os caminhos de strings malformadas (com surrogate isolado) dentro de um valor. */
export function findMalformedStrings(value, path = 'input', out = []) {
  if (typeof value === 'string') {
    if (!value.isWellFormed()) out.push(path);
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => findMalformedStrings(v, `${path}[${i}]`, out));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) findMalformedStrings(v, `${path}.${k}`, out);
  }
  return out;
}

/**
 * Retorna uma cópia com todas as strings bem-formadas. Se nada precisar mudar, retorna
 * o MESMO objeto (não altera o histórico à toa).
 */
export function wellFormedDeep(value) {
  if (typeof value === 'string') return value.isWellFormed() ? value : value.toWellFormed();
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((v) => {
      const n = wellFormedDeep(v);
      if (n !== v) changed = true;
      return n;
    });
    return changed ? next : value;
  }
  if (value && typeof value === 'object') {
    let changed = false;
    const next = {};
    for (const [k, v] of Object.entries(value)) {
      const n = wellFormedDeep(v);
      if (n !== v) changed = true;
      next[k] = n;
    }
    return changed ? next : value;
  }
  return value;
}
