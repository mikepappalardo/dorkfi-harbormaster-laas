import { config } from './env.mjs';

export async function sendTelegram(message, chatId = null) {
  const token = config.telegramToken;
  const target = chatId || config.telegramChatId;
  if (!token || !target) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: target, text: message, parse_mode: 'Markdown' }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {}
}

export function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

export function hfEmoji(hf) {
  if (!hf || isNaN(hf)) return '❓';
  if (hf >= 2.0) return '✅';
  if (hf >= 1.5) return '🟢';
  if (hf >= 1.3) return '🟡';
  if (hf >= 1.1) return '🟠';
  return '🔴';
}
