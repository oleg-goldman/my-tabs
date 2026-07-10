/* Восстанавливает links.local.json из links.enc.json (для нового компьютера).
   Использование:  node scripts/decrypt.mjs [--force]   (или npm run decrypt)  */

import { webcrypto as wc } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENC = path.join(ROOT, 'links.enc.json');
const OUT = path.join(ROOT, 'links.local.json');

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
    };
  });
}

async function main() {
  if (!fs.existsSync(ENC)) {
    console.error('Нет links.enc.json — нечего расшифровывать.');
    process.exit(1);
  }
  if (fs.existsSync(OUT) && !process.argv.includes('--force')) {
    console.error('links.local.json уже существует. Перезаписать: npm run decrypt -- --force');
    process.exit(1);
  }

  const blob = JSON.parse(fs.readFileSync(ENC, 'utf8'));
  const password = process.env.NT_PASSWORD
    || process.argv.find((a) => a.startsWith('--password='))?.slice('--password='.length)
    || await promptHidden('Пароль: ');

  const material = await wc.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']
  );
  const key = await wc.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: Buffer.from(blob.salt, 'base64'),
      iterations: blob.iter || 310000,
      hash: 'SHA-256',
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );

  let plain;
  try {
    plain = await wc.subtle.decrypt(
      { name: 'AES-GCM', iv: Buffer.from(blob.iv, 'base64') },
      key,
      Buffer.from(blob.data, 'base64')
    );
  } catch {
    console.error('Неверный пароль.');
    process.exit(1);
  }

  const data = JSON.parse(Buffer.from(plain).toString('utf8'));
  // data URI иконок — производные данные, в локальном файле они только мешают
  for (const cat of data.categories) {
    for (const link of cat.links) {
      if (link.icon?.startsWith('data:')) delete link.icon;
    }
  }

  fs.writeFileSync(OUT, JSON.stringify(data, null, 2) + '\n');
  console.log(`✓ ${OUT}`);
}

main();
