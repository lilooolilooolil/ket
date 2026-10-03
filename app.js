'use strict';

/*
 * Кетский словарь — мини-приложение для мессенджера MAX (MVP).
 *
 * Данные: data/rus-ket.json и data/ket-rus.json (см. parse_dict.py).
 * Поиск идёт по полю key — оно содержит слово и все словоформы записи.
 * MAX Bridge (window.WebApp) подключается опционально: вне MAX приложение
 * работает как обычная веб-страница.
 */

const DIRS = {
  'rus-ket': { url: 'data/rus-ket.json', kbd: false },
  'ket-rus': { url: 'data/ket-rus.json', kbd: true },
};
const MAX_RESULTS = 50;
const DEBOUNCE_MS = 120;

const $ = (id) => document.getElementById(id);
const input = $('search');
const resultsEl = $('results');
const statusEl = $('status');
const kbdEl = $('kbd');
const clearBtn = $('clear');
const btnRus = $('dir-rus');
const btnKet = $('dir-ket');

// MAX Bridge доступен, только если приложение запущено внутри MAX:
// в веб-клиенте MAX мы в iframe, в мобильных клиентах MAX инжектит window.WebViewHandler
const IN_MAX = window.self !== window.top || 'WebViewHandler' in window;
const WebApp = IN_MAX ? window.WebApp || null : null;

let dir = 'rus-ket';   // текущее направление
let index = null;      // поисковый индекс текущего словаря
let loading = null;    // { dir, promise } — кэш загрузки
let debounceTimer = null;

// Тактильный отклик (только на мобильных клиентах MAX)
function haptic() {
  try { WebApp?.HapticFeedback?.impactOccurred?.('light'); } catch (_) { /* нетоп */ }
}

// Нормализация: регистр, ё→е, '→’
function norm(s) {
  return s.toLowerCase().replace(/ё/g, 'е').replace(/'/g, '’');
}

// Ленивая загрузка словаря нужного направления
function load(d) {
  if (!loading || loading.dir !== d) {
    loading = {
      dir: d,
      promise: fetch(DIRS[d].url).then((resp) => {
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        return resp.json();
      }),
    };
  }
  return loading.promise;
}

// Индекс: основная форма и ключи словоформ храним отдельно,
// чтобы совпадения по основной форме имели приоритет
function buildIndex(list) {
  return list.map((e) => ({
    e,
    word: norm(e.word || ''),
    keys: [...new Set(e.key || [])].map(norm),
  }));
}

// Оценка одного текста: точное (0) < префикс (1) < подстрока (2)
function scoreMatch(text, q) {
  if (text === q) return 0;
  if (text.startsWith(q)) return 1;
  if (text.includes(q)) return 2;
  return -1;
}

// Поиск: совпадения по основной форме (0–2) всегда выше,
// чем совпадения по ключам словоформ (3–5)
function search(query) {
  const q = norm(query.trim());
  if (!q) return [];
  const found = [];
  for (const item of index) {
    const wordScore = scoreMatch(item.word, q);
    if (wordScore >= 0) {
      found.push([wordScore, item.e]);
      continue;
    }
    let keyScore = -1;
    for (const k of item.keys) {
      const s = scoreMatch(k, q);
      if (s === 0) { keyScore = 0; break; }
      if (s >= 0 && (keyScore < 0 || s < keyScore)) keyScore = s;
    }
    if (keyScore >= 0) found.push([keyScore + 3, item.e]);
  }
  found.sort((a, b) => a[0] - b[0]);
  return found.slice(0, MAX_RESULTS).map(([, e]) => e);
}

function render(list) {
  resultsEl.textContent = '';
  for (const e of list) {
    const card = document.createElement('article');
    card.className = 'card';

    const head = document.createElement('div');
    head.className = 'card__head';
    const word = document.createElement('span');
    word.className = 'card__word';
    word.textContent = e.word;
    head.append(word);
    if (e.gram) {
      const gram = document.createElement('span');
      gram.className = 'card__gram';
      gram.textContent = e.gram;
      head.append(gram);
    }
    card.append(head);

    for (const sense of e.senses) {
      if (sense.transl) {
        const transl = document.createElement('div');
        transl.className = 'card__transl';
        transl.textContent = sense.transl;
        card.append(transl);
      }
      for (const f of sense.forms) {
        const row = document.createElement('div');
        row.className = 'card__form';
        const fw = document.createElement('span');
        fw.className = 'card__form-word';
        fw.textContent = f.word;
        const ft = document.createElement('span');
        ft.className = 'card__form-transl';
        ft.textContent = f.transl;
        row.append(fw, ft);
        card.append(row);
      }
    }
    resultsEl.append(card);
  }
}

function showHint(text) {
  resultsEl.textContent = '';
  const p = document.createElement('p');
  p.className = 'hint';
  p.textContent = text;
  resultsEl.append(p);
}

function update() {
  clearBtn.hidden = !input.value;
  if (!index) {
    statusEl.textContent = 'Загрузка словаря…';
    resultsEl.textContent = '';
    return;
  }
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    const q = input.value.trim();
    if (!q) {
      statusEl.textContent = '';
      showHint('Введите слово для поиска');
      return;
    }
    const found = search(q);
    statusEl.textContent = found.length ? 'Найдено: ' + found.length : '';
    if (found.length) render(found);
    else showHint('Ничего не найдено');
  }, DEBOUNCE_MS);
}

async function setDir(d) {
  if (d === dir && index) { update(); return; }
  dir = d;
  btnRus.classList.toggle('is-active', d === 'rus-ket');
  btnKet.classList.toggle('is-active', d === 'ket-rus');
  kbdEl.hidden = !DIRS[d].kbd;
  haptic();
  statusEl.textContent = 'Загрузка словаря…';
  resultsEl.textContent = '';
  try {
    const list = await load(d);
    index = buildIndex(list);
  } catch (err) {
    statusEl.textContent = 'Не удалось загрузить словарь';
    return;
  }
  update();
}

// Вставка глифа в позицию курсора
kbdEl.addEventListener('click', (ev) => {
  const btn = ev.target.closest('button[data-glyph]');
  if (!btn) return;
  haptic();
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  input.setRangeText(btn.dataset.glyph, start, end, 'end');
  input.focus();
  update();
});

input.addEventListener('input', update);

clearBtn.addEventListener('click', () => {
  input.value = '';
  input.focus();
  update();
});

btnRus.addEventListener('click', () => setDir('rus-ket'));
btnKet.addEventListener('click', () => setDir('ket-rus'));

// Стартовый параметр диплинка: max.ru/<бот>?startapp=ket — сразу кет→рус
const startParam = (WebApp?.initDataUnsafe?.start_param || '').toString();
const initialDir = /ket/i.test(startParam) ? 'ket-rus' : 'rus-ket';

setDir(initialDir);
