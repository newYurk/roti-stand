# Рекомендация веб-стека для Roti Stand

> Принесено владельцем в чат 07.09.2026 вместе с `roti-web-implementation-direction.md`.
> Сохранено дословно; авторство текста — не владелец, это присланная рекомендация.
> Статус: **предложение, не решение**. Ссылки в конце — как в источнике, с `utm_source=chatgpt.com`.

Если писать вашу 2D-игру про роти на веб-технологиях, то современный и вполне профессиональный стек сейчас выглядит примерно так:

```text
TypeScript + Vite
        ↓
Phaser 4
        ↓
HTML/CSS-интерфейс при необходимости
        ↓
Capacitor → iPhone / Android
Electron → Steam
```

## Что я рекомендую именно вам

| Задача                  | Инструмент                    |
| ----------------------- | ----------------------------- |
| Язык                    | **TypeScript**                |
| Сборка и запуск проекта | **Vite 8**                    |
| Игровой движок          | **Phaser 4**                  |
| Обычный интерфейс       | HTML + CSS, возможно React    |
| Звук                    | **Howler.js** или звук Phaser |
| Сохранение              | **IndexedDB через Dexie.js**  |
| iPhone и Android        | **Capacitor**                 |
| Steam / Windows / macOS | **Electron**                  |
| Юнит-тесты              | **Vitest**                    |
| Автотесты экранов       | **Playwright**                |
| Репозиторий             | GitHub                        |
| Редактор                | VS Code / Cursor / Codex      |

### 1. TypeScript вместо чистого JavaScript

Практически всю серьёзную логику лучше писать на TypeScript:

```ts
type RotiState = {
  doughSize: number;
  temperature: number;
  filling: "banana" | "egg" | "mango";
  cookingProgress: number;
};
```

Он ловит ошибки ещё до запуска игры и очень полезен, когда появляются рецепты, персонажи, отношения, задания и сохранения.

### 2. Vite — основа проекта

Vite запускает локальную игру, автоматически обновляет её после изменения кода и собирает финальную версию. Современный Vite поддерживает TypeScript, CSS, Web Workers и WebAssembly из коробки. ([vite.dev][1])

Это современная замена старым громоздким конфигурациям Webpack.

### 3. Phaser 4 — основной кандидат для нашей игры

Phaser — полноценный 2D-фреймворк:

* сцены;
* изображения и анимации;
* обработка мыши и касаний;
* камеры;
* звук;
* загрузка ресурсов;
* частицы;
* таймеры;
* игровые циклы;
* масштабирование под разные экраны.

Phaser 4 официально вышел в апреле 2026 года, а актуальная ветка уже получила несколько обновлений. У него новый WebGL-рендерер и готовые шаблоны для TypeScript, Vite, React и других инструментов. ([phaser.io][2])

Для игры про роти Phaser будет отвечать за:

* тесто, сковороду и ингредиенты;
* drag, hold, swipe и другие жесты;
* анимации приготовления;
* персонажей;
* карту деревни;
* переходы между сценами;
* визуальные эффекты;
* расчёт времени и степени прожарки.

#### Phaser 3 или Phaser 4?

Если начинаем новый проект сейчас — **Phaser 4**.

Phaser 3 старше, обкатаннее и имеет больше старых уроков. Но в новом проекте я бы уже не строила архитектуру вокруг предыдущего поколения, если только не обнаружится критически нужный несовместимый плагин.

### 4. Альтернатива: PixiJS 8

PixiJS — очень современный и мощный рендерер, поддерживающий WebGL и WebGPU. ([PixiJS][3])

Но PixiJS — скорее «очень хорошая система рисования», чем готовый игровой движок. Многие вещи придётся организовывать самостоятельно:

* сцены;
* состояния;
* загрузку уровней;
* взаимодействия;
* игровой цикл;
* управление звуком;
* переходы.

То есть:

* **Phaser** — быстрее сделать законченную игру;
* **PixiJS** — больше свободы и собственной архитектуры.

Для первой полноценной игры я выбираю **Phaser**.

### 5. React нужен не для самой игры

React модный, но рисовать через него тесто, нож, лопатку и процесс жарки не нужно.

Оптимальное разделение:

| Phaser    | HTML/CSS/React            |
| --------- | ------------------------- |
| Прилавок  | Настройки                 |
| Тесто     | Главное меню              |
| Сковорода | Диалоги и текст           |
| Персонажи | Блокнот рецептов          |
| Анимации  | Экран сохранений          |
| Жесты     | Доступность и локализация |

Причём на первой версии можно обойтись вообще без React: Phaser + обычный HTML/CSS. React стоит добавить, только если интерфейс действительно станет сложным.

### 6. Сохранения

Для настроек вроде громкости можно использовать `localStorage`.

Для игрового состояния лучше:

```text
IndexedDB
└── Dexie.js
    ├── сохранённая игра
    ├── открытые рецепты
    ├── отношения с жителями
    ├── состояние деревни
    └── история выполненных просьб
```

IndexedDB — стандартная браузерная база данных, а Dexie делает работу с ней значительно проще. ([Dexie.js - Offline-First Database for JavaScript][4])

Сам формат сохранения я бы сразу сделала платформонезависимым:

```ts
interface SaveGame {
  version: number;
  player: PlayerState;
  village: VillageState;
  relationships: RelationshipState[];
  inventory: InventoryState;
}
```

Тогда один и тот же save можно хранить:

* в IndexedDB на вебе;
* в хранилище приложения на iPhone и Android;
* локальным файлом в Steam;
* позже — в iCloud, Google Play Games или Steam Cloud.

### 7. iPhone и Android — Capacitor

Capacitor берёт собранную веб-игру и помещает её в настоящее iOS- или Android-приложение. Он также даёт доступ к нативным возможностям через плагины. ([Capacitor Documentation][5])

Получается:

```text
Один игровой код
├── Safari / Chrome
├── iOS-проект в Xcode
└── Android-проект в Android Studio
```

Для публикации на iPhone всё равно понадобятся Xcode, Apple Developer Account, иконки, сертификаты и настройки App Store — но сама игра при этом остаётся вебовой.

### 8. Steam — Electron

Electron упаковывает HTML, CSS и JavaScript в настольное приложение. Официально он поддерживает создание установочных пакетов для десктопных платформ и распространение через магазины приложений. ([Electron][6])

Минус: Electron добавляет к игре собственный Chromium, поэтому сборка будет тяжелее нативной. Для нашей спокойной 2D-игры это не проблема производительности, только дополнительный размер установочного файла.

Steam-достижения и Steam Cloud подключаются отдельным адаптером. Основная игровая логика от этого не меняется.

### 9. Звук

Howler.js удобен для:

* музыки;
* зацикленных звуков;
* регулировки громкости;
* плавных переходов;
* звуковых спрайтов;
* корректной работы на мобильных браузерах.

Он использует Web Audio и при необходимости переключается на HTML5 Audio. ([howlerjs.com][7])

Но на первом этапе можно пользоваться встроенным звуком Phaser и не добавлять отдельную библиотеку без необходимости.

### 10. Тестирование

Здесь веб особенно приятен:

* **Vitest** — тестировать рецепты, сохранения, переходы состояний и экономику взаимопомощи;
* **Playwright** — запускать игру в Chromium, Firefox и WebKit, проверять разные разрешения и эмулировать мобильные устройства. ([Playwright][8])

Например, игровая механика может тестироваться без графики:

```ts
expect(foldDough(state)).toEqual({
  ...state,
  stage: "folded"
});
```

Это одно из важных преимуществ веб-разработки для вас как для QA.

## Остальные популярные варианты

* **Construct 3** — визуальный редактор с экспортом в веб, iOS, Android, desktop и Steam. Удобен для быстрого прототипа, но сложную собственную архитектуру контролировать труднее. ([Construct 3 Documentation][9])
* **GDevelop** — open-source/no-code движок с экспортом на те же платформы и готовой интеграцией Steam. ([GDevelop][10])
* **Three.js** — если нужна настоящая 3D-игра. Для нашей рисованной 2D-игры избыточен.
* **Babylon.js** — ещё более полноценный 3D-движок с WebGL/WebGPU, физикой и 3D-сценами. Нам тоже не нужен. ([babylonjs.com][11])

## Мой окончательный выбор

Для нашей игры я бы зафиксировала:

```text
Phaser 4
TypeScript
Vite
Dexie / IndexedDB
HTML + CSS для части интерфейса
Capacitor для iOS и Android
Electron для Steam
Vitest + Playwright
```

Это не «сайт, который притворяется игрой». Это нормальная современная игровая программа с аппаратным WebGL-рендерингом, единой кодовой базой и отдельными сборками для каждого магазина. Для камерной рисованной 2D-игры с жестами, диалогами, рецептами и несложной симуляцией такой стек подходит особенно хорошо.

[1]: https://vite.dev/guide/?utm_source=chatgpt.com "Getting Started"
[2]: https://phaser.io/news/2026/05/phaser-3-vs-phaser-4?utm_source=chatgpt.com "Phaser 3 vs Phaser 4: What Changed and Why You ..."
[3]: https://pixijs.com/8.x/guides/components/renderers?utm_source=chatgpt.com "Renderers"
[4]: https://dexie.org/docs/Dexie/Dexie?utm_source=chatgpt.com "Dexie Constructor | Dexie.js Documentation - Offline-First Database"
[5]: https://capacitorjs.com/docs?utm_source=chatgpt.com "Capacitor - Cross-platform Native Runtime for Web Apps"
[6]: https://www.electronjs.org/docs/latest/tutorial/distribution-overview?utm_source=chatgpt.com "Distribution Overview"
[7]: https://howlerjs.com/?utm_source=chatgpt.com "howler.js - JavaScript audio library for the modern web"
[8]: https://playwright.dev/docs/browsers?utm_source=chatgpt.com "Browsers"
[9]: https://www.construct.net/en/make-games/manuals/construct-3/overview/publishing-projects?utm_source=chatgpt.com "Publishing projects"
[10]: https://gdevelop.io/game-makers?utm_source=chatgpt.com "The Open-Source, No-Code game engine."
[11]: https://www.babylonjs.com/specifications/?utm_source=chatgpt.com "Babylon.js Specifications"
