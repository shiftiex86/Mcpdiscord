import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

fs.mkdirSync(path.dirname(config.logFile), { recursive: true });
const stream = fs.createWriteStream(config.logFile, { flags: 'a' });

function write(level, scope, message, data) {
  const ts = new Date().toISOString();
  const line = `${ts} [${level}] [${scope}] ${message}`;
  const out = level === 'ERROR' ? console.error : level === 'WARN' ? console.warn : console.log;
  out(data === undefined ? line : `${line} ${safeJson(data)}`);
  stream.write(JSON.stringify({ ts, level, scope, message, ...(data === undefined ? {} : { data }) }) + '\n');
}

function safeJson(value) {
  try {
    const s = JSON.stringify(value);
    return s.length > 600 ? `${s.slice(0, 600)}…` : s;
  } catch {
    return String(value);
  }
}

export const logger = {
  info: (scope, message, data) => write('INFO', scope, message, data),
  warn: (scope, message, data) => write('WARN', scope, message, data),
  error: (scope, message, data) => write('ERROR', scope, message, data),
};
