# CLAUDE.md

Личная new-tab страница (см. README.md — там полная документация).
Сайт: https://oleg-goldman.github.io/my-tabs/ · Pages деплоится из main/root (~1 мин).

## Правила

- `links.local.json` и `.favicon-cache.json` — в `.gitignore`, НИКОГДА не коммитить:
  публикуется только зашифрованный `links.enc.json`.
- Пароль шифрования знает пользователь; в репозиторий/код/доки не записывать.
- После любого изменения `app.js`/`style.css` обязательно `npm run build:ext`
  (копирует их в `extension/`) — иначе сайт и расширение разъедутся.
- `npm run encrypt` переиспользует соль из старого блоба — браузеры не
  переспрашивают пароль. `--new-salt` только при смене пароля.
- Подписи ссылок и названия категорий — латиницей: заголовочный шрифт
  (Avenir Next Condensed Italic) не имеет кириллицы.
- Без внешних зависимостей и внешних запросов со страницы (favicon'ы
  встраиваются в блоб на этапе шифрования).

## Команды

```bash
npm run serve        # локально: http://localhost:4173
npm run encrypt      # links.local.json → links.enc.json (пароль: NT_PASSWORD / --password= / скрытый ввод)
npm run decrypt      # обратно (--force для перезаписи)
npm run build:ext    # app.js + style.css → extension/
```

## Тестирование

`--load-extension` не работает в Chrome 137+; headless-тест расширения — через
puppeteer-core: `launch({ pipe: true, enableExtensions: true })` +
`browser.installExtension(path)`, страница `chrome-extension://<id>/newtab.html`.
Примеры готовых e2e-скриптов были в scratchpad сессии (unlock → поиск → History).
