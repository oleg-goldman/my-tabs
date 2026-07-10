/* Шифрует links.local.json → links.enc.json (тот файл, что публикуется на Pages).
   Заодно скачивает favicon'ы сайтов и встраивает их как data URI, чтобы
   готовая страница не делала внешних запросов и не светила ваши домены.

   Пароль: аргумент --password=..., переменная NT_PASSWORD или скрытый ввод.
   Использование:  node scripts/encrypt.mjs   (или npm run encrypt)          */

import { webcrypto as wc, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'links.local.json');
const OUT = path.join(ROOT, 'links.enc.json');
const ICON_CACHE = path.join(ROOT, '.favicon-cache.json');
const PBKDF2_ITER = 310000;

function promptHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const orig = rl._writeToOutput.bind(rl);
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
    rl._writeToOutput = (s) => {
      if (s.includes(question)) orig(question);
      // сам ввод не печатаем
    };
  });
}

async function getPassword() {
  const arg = process.argv.find((a) => a.startsWith('--password='));
  if (arg) return arg.slice('--password='.length);
  if (process.env.NT_PASSWORD) return process.env.NT_PASSWORD;
  const pw = await promptHidden('Пароль для шифрования: ');
  if (!pw) {
    console.error('Пустой пароль не допускается.');
    process.exit(1);
  }
  return pw;
}

async function fetchImage(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const type = res.headers.get('content-type') || '';
    if (!type.startsWith('image/')) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) return null;
    return `data:${type.split(';')[0]};base64,${buf.toString('base64')}`;
  } catch {
    return null; /* нет сети или таймаут — останется монограмма */
  }
}

// иконка из <link rel="icon"> на самой странице (для SPA и мелких доменов,
// которых нет в сервисе Google)
async function fetchIconFromHtml(domain) {
  try {
    const res = await fetch(`https://${domain}/`, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const html = (await res.text()).slice(0, 100_000);
    const tags = html.match(/<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]*>/gi) || [];
    for (const tag of tags) {
      if (/rel=["'][^"']*(apple|mask)/i.test(tag)) continue;
      const href = tag.match(/href=["']([^"']+)["']/i)?.[1];
      if (!href) continue;
      const icon = await fetchImage(new URL(href, `https://${domain}/`).href);
      if (icon) return icon;
    }
  } catch { /* ignore */ }
  return null;
}

async function fetchFavicon(domain, cache) {
  if (cache[domain]) return cache[domain]; // null в кэше = пробуем снова
  const dataUri =
    await fetchImage(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`)
    ?? await fetchImage(`https://${domain}/favicon.ico`)
    ?? await fetchIconFromHtml(domain);
  cache[domain] = dataUri;
  return dataUri;
}

async function main() {
  if (!fs.existsSync(SRC)) {
    console.error('Нет links.local.json. Скопируйте links.example.json и заполните:');
    console.error('  cp links.example.json links.local.json');
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(SRC, 'utf8'));
  const cache = fs.existsSync(ICON_CACHE)
    ? JSON.parse(fs.readFileSync(ICON_CACHE, 'utf8'))
    : {};

  let iconCount = 0;
  let linkCount = 0;
  for (const cat of data.categories) {
    for (const link of cat.links) {
      linkCount++;
      if (link.icon) { iconCount++; continue; } // свой icon в links.local.json уважаем
      const domain = new URL(link.url).hostname;
      const icon = await fetchFavicon(domain, cache);
      if (icon) {
        link.icon = icon;
        iconCount++;
      }
    }
  }
  fs.writeFileSync(ICON_CACHE, JSON.stringify(cache, null, 2));

  const password = await getPassword();
  const salt = randomBytes(16);
  const iv = randomBytes(12);

  const material = await wc.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']
  );
  const key = await wc.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITER, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );
  const cipher = await wc.subtle.encrypt(
    { name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(data))
  );

  fs.writeFileSync(OUT, JSON.stringify({
    v: 1,
    iter: PBKDF2_ITER,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    data: Buffer.from(cipher).toString('base64'),
  }));

  console.log(`✓ ${OUT}`);
  console.log(`  ссылок: ${linkCount}, с иконками: ${iconCount}`);
  console.log('  Теперь: git add links.enc.json && git commit && git push');
}

main();
