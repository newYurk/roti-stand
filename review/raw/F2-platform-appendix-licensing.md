# F2, приложение Б — лицензии на звук, шрифты и ассеты

> Даты обращения к источникам — **21–22.08.2026**. Это приложение закрывает раздел 6 файла `F2-platform.md`, где Epidemic Sound был помечен как **«НЕ ПРОВЕРЕНО»** и назван самым важным незакрытым вопросом всего ревью: «до ответа на оба вопроса Epidemic Sound в план ставить нельзя — цена ошибки здесь равна отзыву релиза».
>
> **Вопрос закрыт. Опасения подтвердились полностью, и в худшем варианте: дело не в тарифе, а в том, что сам тип использования не покрыт ни одной потребительской подпиской.**

---

# 1. Epidemic Sound — вычеркнуть для использования внутри игры

Формулировка чек-листа «нужна именно коммерческая подписка, не личная» **опровергнута**: тариф здесь ни при чём.

**Pro Subscription Music License**, обновление 27.04.2026 — https://www.epidemicsound.com/policy/pro-subscription/:

> «Epidemic Sound hereby grants to you… the right to access the Site and to make copies of the Licensed Works in order to synchronize them, in whole or in part, **in video and podcast productions** produced by or on behalf of yourself.»

Слов «game» или «software application» в документе **нет вообще**. Там же прямой запрет на интерактивное применение:

> «you may not use or in other way exploit the Licensed Works… in any way that is intended to allow third parties to download, reproduce, stream, and/or otherwise access or use the Licensed Works, in whole or in part, on a standalone basis, **including without limitation in any digital templates or other applications enabling end users to synchronize or otherwise combine the Licensed Works with other content**».

**Business Subscription Music License**, обновление 13.04.2026 — https://www.epidemicsound.com/policy/business-subscription/: та же формулировка «in video and podcast productions», слов «game» и «software» нет.

**Ловушка, которую легко прочитать наоборот.** В Pro-лицензии есть фраза: «This License grants you the right to publish your Productions anywhere online… **in apps**, and anywhere else online». Это про то, что ваше **видео** можно опубликовать в приложении, а не про то, что треки можно вшить в игру.

Куда Epidemic сам отправляет разработчиков игр — https://www.epidemicsound.com/blog/music-licensing-for-video-games/: «Music licensing for games is complex, but Epidemic Sound's **Enterprise solution** can simplify it». Какой тариф покрывает in-game, на публичных страницах не указано — нужен запрос в Enterprise-продажи.

## «Perpetual» есть, но не тот, о котором думают

Pro-лицензия: «Epidemic Sound hereby grants to you **the perpetual right to make available any Productions** containing any Licensed Works that you have completed during the Subscription Period». И тут же:

> «after expiration or termination of the Subscription Period you **may not use the Licensed Work(s) to create any new Productions, including without limitation that you may not use the Licensed Work(s) to create any new versions of Productions**, even if you have downloaded such Licensed Work(s) during the Subscription Period.»

**Это второй вопрос F2, и ответ на него тоже плохой.** Для игры, которая патчится и переиздаётся годами, «нельзя создавать новые версии» означает, что после отмены подписки каждая новая сборка формально уже не покрыта.

---

# 2. Чем заменить — проверено по первоисточникам

| Источник | Игры покрыты | Условия |
|---|---|---|
| **Sonniss GDC Game Audio Bundle** | **да** | Бесплатно, без атрибуции, навсегда. https://sonniss.com/gameaudiogdc: «All of the sounds are royalty free and commercially usable»; «No attribution is required and you can use them on an unlimited number of projects for the rest of your lifetime». Запрет один: «Use for AI/ML training is strictly prohibited» |
| **Splice Sounds** | **да, игры названы явно** | https://splice.com/terms, §3.1.1.2: «non-exclusive, non-transferable, **perpetual** right to use Sounds… in other creative works, such as but not limited to, **video games**… for non-commercial and commercial purposes». Права остаются после отмены подписки. Запреты §3.1.1.3: нельзя сублицензировать звуки **в изоляции**, перепаковывать в сэмпл-паки, и «(h) use the Sounds as source or training material for **generative or other types of artificial intelligence models**» |
| **ZapSplat** | **да, прямо назван** | https://www.zapsplat.com/license-type/standard-license/ (обновление 08.05.2026): «You may use our sound effects and music, embedded or synchronized within a production, in any project including but not limited to: … **Games, apps, and software**». Free — обязателен кредит «ZapSplat»; Premium — без атрибуции, «remain licensed for attribution-free use **for life**… even if you cancel or downgrade». Права переходят при продаже проекта |
| **Freesound** | зависит от звука | https://freesound.org/help/faq/: CC0 — свободно; CC-BY — с атрибуцией; **CC-BY-NC и Sampling+ для коммерции не годятся**. ToS: «the User **warrants**… that he/she has all necessary rights in the sound» — проверка на вас |
| **Kenney (аудио)** | **да** | CC0, атрибуция не нужна. Годится для интерфейсных звуков, но не для «полевого» ASMR |
| **Artlist, Soundly** | **не проверено** | Обе страницы лицензий недоступны для автоматической проверки (404 и Cloudflare). До релиза либо прочитать своими глазами, либо не использовать |

## ⚠️ ASMR-специфичный риск у ZapSplat

В разделе Prohibited Uses: «Use our sounds as the **primary value in a relaxation video, soundboard, or similar standalone product**», и выше — «our sounds must not constitute the primary value of a product (for example a sound effects app)».

**Для Roti Stand это прямо по больному.** Ревью установило, что в этой игре звук работает как HUD и несёт половину замысла — то есть он и есть основная ценность продукта. Это серая зона, которую **нужно согласовать письменно с ZapSplat до релиза**, а не после.

**Рекомендуемый приоритет для ASMR-кухни:** Sonniss GDC bundle → Freesound с жёстким фильтром CC0 → Splice → ZapSplat Premium с письменным подтверждением.

---

# 3. Шрифты: три ловушки, которых нет в чек-листе

**Лицензий три, а не две.** https://raw.githubusercontent.com/google/fonts/main/README.md: «Most of the fonts… use the SIL Open Font License, v1.1. Some fonts use the Apache 2 license. **The Ubuntu fonts use the Ubuntu Font License v1.0.**» И там же: «It is important to always read the license for **every** font that you use.»

**Встраивание в игру разрешено.** OFL-FAQ п. 1.4 — https://openfontlicense.org/documents/OFL-FAQ.txt: «Examples of bundling made possible by the OFL would include… **games and entertainment software, mobile device applications**».

**Ловушка 1: сабсеттинг — это модификация.** OFL-FAQ пп. 2.2.1 и 2.6 относят к модификации в том числе сабсеттинг и конвертацию с изменением метаданных — ровно то, что делают при оптимизации шрифта под мобильную сборку. Срабатывает п. 3 OFL: «No Modified Version of the Font Software may use the Reserved Font Name(s)». **Шрифт придётся переименовать.**

**Ловушка 2: файл шрифта в бандле — это редистрибуция.** OFL п. 2: «may be bundled, redistributed and/or sold with any software, **provided that each copy contains the above copyright notice and this license**». Текст лицензии обязан ехать вместе со шрифтом, и веб-страница проекта этого не закрывает. Apache 2.0 §4 требует того же через NOTICE.

**Ловушка 3: экранных credits OFL не требует** (п. 1.1.2: «that is not required»), но лицензию в бандле — да. Разные вещи, легко перепутать.

---

# 4. CC0 ≠ права проверены

https://creativecommons.org/publicdomain/zero/1.0/legalcode, §4(b): «Affirmer **disclaims responsibility for clearing rights of other persons** that may apply to the Work or any use thereof».

То есть CC0 означает «автор отказался от **своих** прав», а не «права точно чистые». Если загрузивший не имел прав — CC0 вас не защищает.

**Kenney:** CC0 подтверждён (https://kenney.nl/support: «all game assets on the asset pages are public domain licensed (CC0)»), но **логотип и имя студии под CC0 не подпадают** — «Do not use our logo». Отдельно: формулировка «assets on the asset pages» покрывает только паки на kenney.nl, не автоматически то, что продаётся на itch и Patreon — там лицензию проверить не удалось.

**itch.io ничего не гарантирует.** https://itch.io/docs/legal/terms: площадка перекладывает гарантию прав на автора пака и снимает с себя ответственность за содержание.

---

# 5. AI-инструменты запрещены тремя лицензиями сразу

Это не гипотетический риск, а прямой текст:

- **Splice** §3.1.1.3(h): нельзя использовать звуки «as source or training material for generative or other types of artificial intelligence models»
- **ZapSplat**: «Use our sounds or music to train Artificial Intelligence (AI) or machine learning models of any kind» — запрещено
- **Epidemic Pro**: нельзя «upload or use them, in whole or in part, **in any third party AI tool**»
- **Sonniss**: «Use for AI/ML training is strictly prohibited»

**Практическое следствие:** прогнать купленный звук через AI-денойзер или генератор вариаций — нарушение сразу нескольких лицензий. Для проекта, который делается с AI-ассистентом, это неочевидная и легко нарушаемая граница.

---

# 6. Собственная запись: риск не только в музыке

Частично подтверждено, только вторичные источники — в чек-лист вносить как «риск, требующий консультации», а не как норму.

Случайно попавшая в запись коммерческая музыка остаётся объектом авторского права. Защита de minimis существует, но нестабильна: в деле *VMG Salsoul v. Ciccone* (9-й округ) она была подтверждена для звукозаписей, тогда как другие округа занимают противоположную позицию.

Практика, снижающая риск (не подтверждена первоисточником): писать в контролируемых локациях или в часы без музыки; вести журнал каждой сессии — дата, место, что было слышно; прослушивать дубли на узнаваемые треки; собирать «рыночную» атмосферу из отдельных чистых слоёв (шкварчание, посуда, шаги, гул голосов, дождь), а не одним длинным полевым дублем. **Второй риск помимо музыки — разборчивая речь и узнаваемые голоса прохожих.**

---

# 7. Атрибуция и App Store

**Требует ли Apple отдельный экран credits — источник не найден.** В App Review Guidelines такого требования нет, есть только общее (п. 5.2.1): «Don't use protected third-party material… without permission», и п. 5.2.2: «Authorization must be provided upon request». То есть Apple требует **иметь** права и уметь их подтвердить, а форму атрибуции диктует лицензия ассета.

**Практический вывод:** экран «Настройки → Лицензии» внутри игры с текстовым списком (название звука, автор, ссылка, лицензия) закрывает одновременно CC-BY, OFL п. 2 и Apache §4. Ревью Apple такой экран не отклоняет.

---

# Что добавить в чек-лист инструментов

1. **Epidemic Sound вычеркнуть для in-game полностью.** Ни Pro, ни Business не покрывают синхронизацию в игру — только видео и подкасты. Нужен отдельный Enterprise-договор, цену которого надо узнать **до** того, как звук ляжет в проект.
2. **«Perpetual» у подписочных стоков = «выпущенное можно оставить», а не «можно делать новые версии».** Для игры, которая патчится, это критично.
3. **CC0 не означает «права проверены».** По каждому ассету хранить URL, дату скачивания, скриншот страницы с лицензией и файл лицензии — это то, что придётся показать Apple по п. 5.2.2.
4. **Логотип и имя Kenney под CC0 не подпадают.**
5. **itch.io ничего не гарантирует** — лицензия только от автора пака.
6. **Google Fonts: три лицензии, не две.** Читать LICENSE в папке конкретного семейства.
7. **Сабсеттинг шрифта = модификация** → срабатывает Reserved Font Name, шрифт надо переименовать.
8. **Файл шрифта в бандле = редистрибуция** → копия лицензии едет вместе с ним.
9. **ZapSplat запрещает использование, где звук — основная ценность продукта.** Для ASMR-игры согласовывать письменно до релиза.
10. **CC-BY-NC и Sampling+ на Freesound — стоп-лист.** Фильтровать по лицензии до прослушивания, иначе звук приживётся в прототипе.
11. **Ни один сток нельзя прогонять через AI-инструменты.**
12. **Полевая запись: фоновая музыка и разборчивая речь — чужие права.** Писать слоями, вести журнал.
13. **Artlist и Soundly не проверены** — их лицензии закрыты от автоматической проверки.

**Пункты 1–3, 6–8 и 11 касаются обеих игр, не только Roti Stand.**
