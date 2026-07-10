/* Мои табы — статическая new-tab страница с зашифрованными ссылками.
   Данные лежат в links.enc.json (AES-GCM, ключ из пароля через PBKDF2).
   После первого ввода пароля ключ кэшируется в localStorage этого браузера.

   Работает в двух окружениях:
   - сайт на GitHub Pages: links.enc.json лежит рядом;
   - Chrome-расширение (extension/): window.NT_REMOTE указывает на сайт,
     а при поиске дополнительно опрашивается история браузера.            */

const REMOTE = globalThis.NT_REMOTE || '';
const HISTORY = globalThis.chrome?.history;
const HISTORY_MAX = 8;
const PBKDF2_ITER_DEFAULT = 310000;
const LS_KEY = 'nt_key';
const LS_SALT = 'nt_salt';
const LS_THEME = 'nt_theme';

const $ = (sel) => document.querySelector(sel);

const b64decode = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64encode = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));

/* ---------- crypto ---------- */

async function deriveKey(password, salt, iterations) {
  const material = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    true,
    ['decrypt']
  );
}

async function decryptBlob(blob, key) {
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64decode(blob.iv) }, key, b64decode(blob.data)
  );
  return JSON.parse(new TextDecoder().decode(plain));
}

async function storedKeyFor(saltB64) {
  const keyB64 = localStorage.getItem(LS_KEY);
  if (!keyB64 || localStorage.getItem(LS_SALT) !== saltB64) return null;
  try {
    return await crypto.subtle.importKey(
      'raw', b64decode(keyB64), { name: 'AES-GCM' }, true, ['decrypt']
    );
  } catch {
    return null;
  }
}

async function rememberKey(key, saltB64) {
  const raw = await crypto.subtle.exportKey('raw', key);
  localStorage.setItem(LS_KEY, b64encode(raw));
  localStorage.setItem(LS_SALT, saltB64);
}

/* ---------- theme ---------- */

function initTheme() {
  const saved = localStorage.getItem(LS_THEME);
  if (saved) document.documentElement.dataset.theme = saved;
  updateThemeButton();
  $('#theme').addEventListener('click', () => {
    const isDark = document.documentElement.dataset.theme === 'dark'
      || (!document.documentElement.dataset.theme
          && matchMedia('(prefers-color-scheme: dark)').matches);
    const next = isDark ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem(LS_THEME, next);
    updateThemeButton();
  });
}

function updateThemeButton() {
  const isDark = document.documentElement.dataset.theme === 'dark'
    || (!document.documentElement.dataset.theme
        && matchMedia('(prefers-color-scheme: dark)').matches);
  $('#theme').textContent = isDark ? '☀️' : '🌙';
}

/* ---------- rendering ---------- */

let allLinks = [];      // [{name, url, keywords, icon, category}]
let resultTiles = [];   // ссылки на DOM-элементы результатов поиска
let selected = 0;
let searchToken = 0;    // отсекает устаревшие ответы истории

function monogramColor(name) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)) % 360;
  return `hsl(${h}, 55%, 46%)`;
}

function makeTile(link, query) {
  const a = document.createElement('a');
  a.className = 'tile';
  a.href = link.url;
  a.rel = 'noopener';

  if (link.icon) {
    const img = document.createElement('img');
    img.src = link.icon;
    img.alt = '';
    a.appendChild(img);
  } else {
    const m = document.createElement('div');
    m.className = 'monogram';
    m.style.background = monogramColor(link.name);
    m.textContent = [...link.name][0].toUpperCase();
    a.appendChild(m);
  }

  const span = document.createElement('span');
  span.className = 'name';
  span.title = link.name;
  const q = (query || '').trim().toLowerCase();
  const idx = q ? link.name.toLowerCase().indexOf(q) : -1;
  if (idx >= 0) {
    span.append(link.name.slice(0, idx));
    const mark = document.createElement('mark');
    mark.textContent = link.name.slice(idx, idx + q.length);
    span.append(mark, link.name.slice(idx + q.length));
  } else {
    span.textContent = link.name;
  }
  a.appendChild(span);
  return a;
}

function renderCategories(data) {
  const content = $('#content');
  content.innerHTML = '';
  resultTiles = [];
  for (const cat of data.categories) {
    const section = document.createElement('section');
    const h2 = document.createElement('h2');
    h2.textContent = cat.name;
    const grid = document.createElement('div');
    grid.className = 'grid';
    for (const link of cat.links) grid.appendChild(makeTile(link));
    section.append(h2, grid);
    content.appendChild(section);
  }
}

function score(link, q) {
  const name = link.name.toLowerCase();
  if (name.startsWith(q)) return 4;
  if (name.includes(q)) return 3;
  if ((link.keywords || []).some((k) => k.toLowerCase().includes(q))) return 2;
  if (link.url.toLowerCase().includes(q)) return 1;
  if (link.category.toLowerCase().includes(q)) return 1;
  return 0;
}

function resultSection(title, links, q) {
  const section = document.createElement('section');
  const h2 = document.createElement('h2');
  h2.textContent = title;
  const grid = document.createElement('div');
  grid.className = 'grid';
  const tiles = links.map((link) => {
    const tile = makeTile(link, q);
    grid.appendChild(tile);
    return tile;
  });
  section.append(h2, grid);
  return { section, tiles };
}

function renderResults(query) {
  const content = $('#content');
  content.innerHTML = '';
  const q = query.trim().toLowerCase();

  const matches = allLinks
    .map((link, i) => ({ link, i, s: score(link, q) }))
    .filter((m) => m.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i);

  resultTiles = [];
  if (!matches.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = HISTORY ? 'В моих табах не нашлось' : 'Ничего не нашлось';
    content.appendChild(empty);
  } else {
    const { section, tiles } = resultSection(
      `Результаты · ${matches.length}`, matches.map((m) => m.link), q
    );
    content.appendChild(section);
    resultTiles = tiles;
    selected = 0;
    updateSelection();
  }

  appendHistoryResults(query, ++searchToken);
}

/* Поиск по истории браузера — только внутри расширения (chrome.history). */

function faviconUrl(pageUrl) {
  const u = new URL(chrome.runtime.getURL('/_favicon/'));
  u.searchParams.set('pageUrl', pageUrl);
  u.searchParams.set('size', '32');
  return u.toString();
}

async function appendHistoryResults(query, token) {
  if (!HISTORY) return;
  const q = query.trim();
  if (!q) return;

  const items = await HISTORY.search({ text: q, maxResults: 24, startTime: 0 });
  // ответ пришёл к уже изменившемуся запросу — выбрасываем
  if (token !== searchToken) return;

  const own = new Set(allLinks.map((l) => l.url.replace(/\/+$/, '')));
  const fresh = items
    .filter((it) => it.url && !own.has(it.url.replace(/\/+$/, '')))
    .slice(0, HISTORY_MAX)
    .map((it) => ({
      name: it.title || new URL(it.url).hostname,
      url: it.url,
      icon: faviconUrl(it.url),
    }));
  if (!fresh.length) return;

  const content = $('#content');
  if (!resultTiles.length) content.innerHTML = '';
  const { section, tiles } = resultSection('История', fresh, q.toLowerCase());
  content.appendChild(section);
  const wasEmpty = !resultTiles.length;
  resultTiles.push(...tiles);
  if (wasEmpty) {
    selected = 0;
    updateSelection();
  }
}

function updateSelection() {
  resultTiles.forEach((t, i) => t.classList.toggle('selected', i === selected));
  resultTiles[selected]?.scrollIntoView({ block: 'nearest' });
}

function gridColumns() {
  const grid = $('#content .grid');
  if (!grid) return 1;
  return getComputedStyle(grid).gridTemplateColumns.split(' ').length;
}

/* ---------- search & keyboard ---------- */

function initSearch(data) {
  allLinks = data.categories.flatMap((cat) =>
    cat.links.map((link) => ({ ...link, category: cat.name }))
  );

  const input = $('#search');

  input.addEventListener('input', () => {
    if (input.value.trim()) renderResults(input.value);
    else renderCategories(data);
  });

  input.addEventListener('keydown', (e) => {
    if (!resultTiles.length || !input.value.trim()) return;
    const cols = gridColumns();
    const move = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols }[e.key];
    if (move !== undefined) {
      e.preventDefault();
      selected = Math.min(Math.max(selected + move, 0), resultTiles.length - 1);
      updateSelection();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const tile = resultTiles[selected];
      if (!tile) return;
      if (e.metaKey || e.ctrlKey) window.open(tile.href, '_blank', 'noopener');
      else location.href = tile.href;
    } else if (e.key === 'Escape') {
      input.value = '';
      renderCategories(data);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (document.activeElement === input) return;
    if (document.activeElement === $('#password')) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === '/' || e.key.length === 1) {
      input.focus();
      if (e.key === '/') e.preventDefault();
    }
  });

  input.focus();
}

/* ---------- boot ---------- */

function showError(message) {
  document.body.innerHTML = `<p class="empty" style="margin-top:20vh">${message}</p>`;
}

async function unlock(blob) {
  return new Promise((resolve) => {
    const lock = $('#lock');
    const form = $('#lock-form');
    const passwordInput = $('#password');
    const error = $('#lock-error');
    lock.classList.remove('hidden');
    passwordInput.focus();

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      error.textContent = '';
      const salt = b64decode(blob.salt);
      const key = await deriveKey(
        passwordInput.value, salt, blob.iter || PBKDF2_ITER_DEFAULT
      );
      try {
        const data = await decryptBlob(blob, key);
        await rememberKey(key, blob.salt);
        lock.classList.add('hidden');
        resolve(data);
      } catch {
        error.textContent = 'Неверный пароль';
        form.classList.remove('shake');
        requestAnimationFrame(() => form.classList.add('shake'));
        passwordInput.select();
      }
    });
  });
}

async function main() {
  initTheme();

  let blob;
  try {
    const res = await fetch(REMOTE + 'links.enc.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error();
    blob = await res.json();
  } catch {
    showError('Файл links.enc.json не найден. Запустите <code>npm run encrypt</code> и задеплойте.');
    return;
  }

  let data = null;
  const cachedKey = await storedKeyFor(blob.salt);
  if (cachedKey) {
    try {
      data = await decryptBlob(blob, cachedKey);
    } catch {
      /* пароль сменился — спросим заново */
    }
  }
  if (!data) data = await unlock(blob);

  $('#app').classList.remove('hidden');
  renderCategories(data);
  initSearch(data);
}

main();
