# F2, приложение — культурно-религиозный комплаенс и регуляторика Таиланда

> Дата обращения ко всем источникам — **21.08.2026**. Это приложение закрывает раздел 6 файла `F2-platform.md`, оставшийся пустым («зарезервировано») — линза упала на лимите сессии.
>
> Здесь нет вопросов API и цен: они разобраны в основном файле. Здесь — что площадки и тайское право говорят о **содержании** игры про тайскую уличную еду.

---

## Сводка вердиктов

| Вопрос | Вердикт |
|---|---|
| Apple App Store Guidelines | можно с оговорками |
| Google Play Policies | можно с оговорками |
| Обязательная классификация игр в Таиланде | можно — обязательного гейм-рейтинга для цифровой дистрибуции нет |
| Lèse-majesté / Computer Crime Act | можно с оговорками, но есть жёсткие красные линии |
| Буддийская образность | можно с оговорками; при **декоративном** использовании Будды — **нельзя** |
| Халяль и мусульманская чувствительность | можно с оговорками |
| Локализация на тайский | можно, юридического требования нет |
| **Проект в целом** | **можно с оговорками.** Юрист нужен, только если добавить королевскую или национальную символику, тайские деньги, монахов |

---

## 1. Apple: где именно проходит граница по религии и культуре

Источник: https://developer.apple.com/app-store/review/guidelines/

**1.1 (вводная):** «Apps should not include content that is offensive, insensitive, upsetting, intended to disgust, in exceptionally poor taste, or just plain creepy.»

**1.1.1 — религия, раса, культура:** «Defamatory, discriminatory, or mean-spirited content, including references or commentary about **religion**, race, sexual orientation, gender, national/ethnic origin, or other targeted groups, particularly if the app is likely to humiliate, intimidate, or harm a targeted individual or group.»

**1.1.2 — «враги» в играх:** «"Enemies" within the context of a game cannot solely target a specific race, culture, real government, corporation, or any other real entity.»

**1.1.5 — ссылки на религию:** «Inflammatory religious commentary or **inaccurate or misleading quotations of religious texts**.»

**Важное уточнение:** отдельного «пункта 1.2 про религию» не существует — 1.2 это User-Generated Content. Религиозная тематика полностью покрывается 1.1.1 и 1.1.5.

**5.0 Legal:** «Apps must comply with all legal requirements in any location where you make them available (if you're not sure, check with a lawyer)… it is your responsibility to understand and make sure your app conforms with all local laws.»

**2.3.6 — рейтинги по территориям:** «If your app includes media that requires the display of content ratings or warnings… **you are responsible for complying with local requirements in each territory where your app is available**.»

**Проверено и не подтвердилось:** в живом тексте гайдлайнов **нет** отдельного пункта о культурной или религиозной чувствительности для конкретных сторфронтов. Слово «storefront» встречается только в 3.1.1 (внешние ссылки на оплату) — к контенту отношения не имеет. Единственный механизм регионального контроля — 5.0 плюс 2.3.6.

**Вердикт:** кулинарный симулятор про роти сам по себе 1.1.1/1.1.5 не нарушает. Риск появляется только при карикатурных изображениях мусульман или тайцев, шутках про религию, цитатах из Корана в текстах и музыке, религиозных деятелях как персонажах.

---

## 2. Google Play

Источник: https://support.google.com/googleplay/android-developer/answer/9878810

**Hate Speech:** «We don't allow apps that promote violence, or incite hatred against individuals or groups based on race or ethnic origin, **religion**, disability, age, nationality…». Примеры нарушений включают «Apps that contain hateful slurs, **stereotypes**, or theories about a protected group possessing negative characteristics (for example, malicious, corrupt, evil, etc.)».

**Sensitive Events:** «We don't allow apps that capitalize on or are insensitive toward a sensitive event with significant social, cultural, or political impact… Apps with content related to a sensitive event are generally allowed if that content has **EDSA** (Educational, Documentary, Scientific, or Artistic) value».

**Content Ratings — обязательны.** https://support.google.com/googleplay/android-developer/answer/9898843 — приложения без рейтинга не допускаются; рейтинг выдаётся через IARC-анкету в Play Console, обязательную для новых приложений, активных и всех обновлений, меняющих контент. **Это и есть de-facto «рейтинг для Таиланда»** — IARC выдаёт локально релевантные рейтинги.

**Вердикт:** стереотипизация мусульман или тайцев-мусульман (жадный торговец, «грязная еда») — прямое попадание в Hate Speech. Sensitive Events не применяется, если не привязывать содержание к реальным событиям — например к конфликту в южных провинциях Паттани, Яла, Наратхиват. **Сюжет на этом не строить.**

---

## 3. Таиланд: нужна ли классификация игры

**Действующий закон — Film and Video Act B.E. 2551 (2008).** Источник: Nagashima Ohno & Tsunematsu, https://www.nagashima.com/en/publications/publication20230612-1/

> «"games" are included within the definition of "video," but only those **"recorded in the form of physical copies, such as, Blu-ray disc or cartridge."**»

> «The Film and Video Inspection Committee shall have the authority to order censoring or editing of, or shall impose a ban on, videos or games which are against public order or good morals.»

> «Unlike movies, the Film and Video Act **does not have a rating system to classify games** for suitable ages.»

**Ключевой вывод:** действующий закон покрывает игры на **физических носителях**. Цифровая дистрибуция через App Store и Google Play формально вне предварительной цензуры, и **тайского рейтингового органа для игр не существует**.

**Готовящийся Film and Game Act** внесён Минкультуры в Палату представителей 19.04.2023, вводит рейтинги для игр и уведомительный режим вместо разрешительного (https://www.nagashima.com/en/publications/publication20230612-1/, https://fosrlaw.com/2025/thailand-media-law-2025/).

**Не удалось верифицировать:** на дату обращения законопроект, по найденным источникам, **ещё не принят** и проходил существенную переработку (https://www.legal500.com/developments/thought-leadership/the-draft-film-and-game-act-thailand-reportedly-will-go-through-substantive-revisions/). Официального подтверждения с сайта Department of Cultural Promotion найти не удалось — сайт в основном на тайском и не индексируется в англоязычной выдаче. **Перед релизом проверить заново.**

**Вердикт:** отдельный тайский рейтинг получать не нужно. Достаточно IARC-анкеты и Age Rating в App Store Connect.

---

## 4. Lèse-majesté и Computer Crime Act — красные линии

**Уголовный кодекс, Section 112** (https://en.wikipedia.org/wiki/Lèse-majesté_in_Thailand, https://www.article19.org/resources/thailand-lese-majeste/):

> «Whoever defames, insults or threatens the King, the Queen, the Heir-apparent or the Regent, shall be punished with imprisonment of **three to fifteen years**.»

**Computer-Related Crime Act B.E. 2550 (2007), Section 14** (https://www.thailawforum.com/unofficial-translation-of-computer-related-crime-act-b-e-2550-2007/) — до пяти лет и/или штраф до 100 000 бат за ввод в систему данных, угрожающих национальной безопасности, либо непристойных данных, доступных публике. **Section 20** даёт должностным лицам право ходатайствовать перед судом о блокировке данных, угрожающих безопасности Королевства (сюда попадает ст. 112) и противоречащих общественному порядку и морали.

**Прецедент запрета игры: Tropico 5, август 2014.** https://www.bangkokpost.com/thailand/politics/424398/tropico-5-computer-game-banned-in-thailand, https://time.com/3079463/thailand-bans-tropico-5-city-building-game-over-security-concerns/, https://www.hollywoodreporter.com/news/general-news/tropico-5-banned-by-thailands-723386/ — Управление цензуры фильмов и видео при военной хунте заблокировало продажи, опасаясь, что «some part of its content might affect peace and order in the country». **Оговорка:** это формулировка в журналистском пересказе; дословного официального заявления в англоязычных источниках нет. Дистрибьютор решение не обжаловал.

### Практические красные линии для этой игры

1. **Тайские банкноты и монеты несут портрет Короля.** Если в игре есть касса и наличные — **не рисовать реалистичные баты**. Абстрактные монеты или стилизованная валюта. **Это самый недооценённый риск в кулинарном симуляторе**, и он прямо пересекается с открытой развилкой «валюта есть или нет»: отказ от валюты снимает его целиком.
2. Никаких портретов членов королевской семьи, королевских гербов и штандартов — даже фоновым декором улицы.
3. Тайский флаг и гимн не осквернять, не использовать в гэгах, не «пачкать» едой.
4. Никакой политики, армии, переворотов, южного конфликта.

**Вердикт:** сам по себе кулинарный симулятор вне зоны 112. Но при появлении тайских денег, королевских портретов или национальной символики **нужен тайский юрист**: ст. 112 применяется экстерриториально к контенту, доступному в Таиланде, а Section 20 CCA даёт механизм блокировки.

---

## 5. Буддийская образность — прямо влияет на домики духов из v3

**Уголовный кодекс, Section 206** (https://www.thailawonline.com/thai-criminal-code/section-206/):

> «Whoever commits any act against an object or place held in religious veneration by any group of people, in a manner that insults that religion, shall be liable to imprisonment from **one year to seven years**, or a fine from twenty thousand baht to one hundred and forty thousand baht, or both.»

Секции 206–208 защищают объекты и места почитания всех признанных религий (https://library.siam-legal.com/thai-law/criminal-code-religion-sections-206-208/ — 403 при прямой загрузке, содержание подтверждено через выдачу и https://end-blasphemy-laws.org/countries/asia-central-southern-and-south-eastern/thailand/).

**Кампания «Buddha is not for decoration».** https://theworld.org/stories/2021/03/09/thai-organization-s-crusade-against-blaspheming-buddha — кампанию ведёт Knowing Buddha Organisation, основанная в 2012 году. Слова основательницы: «If anything touches Mohammed or Jesus, [people know] they'll be in deep trouble. But if they touch Buddhism, the Buddhists hardly have a voice to stop them.» Материал прямо отмечает, что тайские законы против неуважения к религии «are seldom enforced», а KBO — НКО, а не госорган: она рассылает предупреждения, и примерно половина адресатов прекращает. Билборды в аэропортах: «BUDDHA IS NOT FOR DECORATION» (https://en.wikipedia.org/wiki/Knowing_Buddha).

**Оговорка:** официального заявления Минкультуры именно по этой кампании найти не удалось — подтверждённый источник это НКО. Отдельно подтверждается, что министерство выступало против буддийских татуировок у туристов (https://www.nbcnews.com/id/wbna43249699), то есть готовность реагировать на декоративную эксплуатацию символики есть.

### Что это значит для корпуса Roti Stand

**Нельзя:** статуэтка или голова Будды как покупаемый предмет декора точки, Будда на вывеске, в иконке приложения, как бонус, в комическом контексте; амулет как игровой лут.

**Осторожно — и это прямо про v3:** домик духов (сан пхра пхум) как аутентичная деталь допустим, но **не делать его интерактивно-разрушаемым и не класть на него еду**. v3 строит на уходе за ним утренний ритуал героя — сама идея безопасна, опасны детали реализации.

**Осторожно с монахами:** монахи Тхеравады не едят после полудня и не берут деньги в руки. **Монах-клиент, который платит наличными за роти в 19:00, — грубая ошибка, которую тайский игрок заметит мгновенно.** Если монахи нужны — только утреннее подношение (tak bat), без оплаты, до полудня. Для игры, чья смена начинается с закатом, это означает: монах в вечернем потоке клиентов невозможен.

Не размещать изображения Будды и храмов там, где они окажутся под едой, ногами или мусором.

---

## 6. Халяль и мусульманская чувствительность

**Специальных требований у площадок нет — проверено.** Ни в App Store Review Guidelines, ни в Google Play Inappropriate Content нет ни одного упоминания «halal», «pork» или «Islam». Применяются только общие 1.1.1 / 1.1.5 и Hate Speech.

**Но регуляторы стран действуют помимо площадок.** Прецеденты:

**Fight of Gods, Малайзия, сентябрь 2017.** MCMC заблокировала **весь Steam** из-за файтинга с религиозными фигурами как играбельными персонажами; игра угрожала «solidarity, harmony, and wellbeing of the multiracial and multireligious people». Steam получил 24 часа на блокировку игры для малайзийских пользователей; после исполнения доступ восстановили. (https://www.gamedeveloper.com/game-platforms/malaysian-commission-blocks-steam-access-over-fighting-game-i-fight-of-gods-i-, https://kotaku.com/publisher-of-god-fighting-game-says-malaysian-governmen-1802729743, https://soyacincau.com/2017/09/09/why-did-the-obscure-game-fight-of-gods-cause-mcmc-to-ban-steam-in-malaysia/)

**LittleBigPlanet, отзыв тиража, октябрь 2008.** Sony отозвала уже отгруженную игру менее чем за четыре дня до релиза: фоновый трек «Tapha Niang» малийского музыканта Тумани Диабате содержал две арабские фразы из Корана. Проблему нашёл мусульманский игрок в бете. Релиз перенесли на неделю, трек заменили. (https://www.gamedeveloper.com/game-platforms/-i-littlebigplanet-i-delayed-worldwide-due-to-qur-an-sampling-audio, https://www.pcworld.com/article/531667/littlebigplanet_recall.html, https://www.salon.com/2008/10/20/islam_sony/)

**Индонезия:** PUBG получил фатву от индонезийской мусульманской организации (2019); Fortnite министр назвал «blasphemous» (2021). **С января 2026 действует обязательная регистрация игр** — IGRS на основе Ministerial Regulation MCI 2/2024 и Presidential Regulation 19/2024; сервис запущен 11.10.2025, правоприменение началось в январе 2026. Все игры, распространяемые в Индонезии, должны отображать метку 3+, 7+, 13+, 15+, 18+ или RC. (https://en.wikipedia.org/wiki/Indonesia_Game_Rating_System, https://nikopartners.com/indonesia-game-rating-system-heavily-criticized-on-its-rollout/)

**Залив (ОАЭ, Саудовская Аравия):** контроль через национальных регуляторов, не через сторы. Публичных документов с конкретными правилами для игр найти не удалось.

**Свинина рядом с мусульманским блюдом — реальный ли риск?** Документированного прецедента бана игры именно за изображение свинины **не найдено ни одного**. Все найденные случаи — про религиозные фигуры, цитаты из Корана, общее «богохульство». Отсутствие прецедента не равно отсутствию риска, но и раздувать его не стоит.

### Рекомендации, прямо применимые к корпусу

1. **Не смешивать свинину с роти-тележкой.** Реальный тайско-мусульманский роти-карт свинину не продаёт вообще. Это даже не столько вопрос оскорбления, сколько фактическая ошибка, которая мгновенно читается как «авторы не разобрались». Мясные начинки — курица, говядина, яйцо. Это касается и таблицы десяти авторских начинок.
2. **Никакого алкоголя** в ассортименте точки.
3. Никаких реальных мечетей с идентифицируемыми названиями; если нужна на фоне — обобщённый силуэт.
4. **Ни одного арабского текста, который не проверен носителем.** Декоративная «арабская вязь» на вывеске почти наверняка окажется чем-то из Корана или шахадой — ровно кейс LittleBigPlanet.
5. **Никакой музыки и семплов непроверенного происхождения**, особенно вокальных «этнических» — это та самая мина, на которой подорвалась Sony. Для игры, где звук несёт половину замысла, это самый дорогой пункт списка.
6. Не изображать мусульманских персонажей карикатурно — прямое нарушение Apple 1.1.1 и Google Hate Speech.
7. При релизе в Индонезии — оформить IGRS заранее.

---

## 7. Товарные знаки, топонимы, названия блюд

Реальные названия фестивалей (Сонгкран, Лой Кратонг), топоним «Ко Чанг» и реальные названия блюд (роти клуай, มะตะบะ, роти сай май) — это общеупотребительные наименования и топонимы, а не товарные знаки; их использование само по себе проблемы не создаёт. Осторожность нужна с **брендами**: Nutella, мелькающая в культурном брифе, — зарегистрированный знак Ferrero, и в игре его быть не должно. Заменить родовым описанием («шоколадная паста»).

---

## 8. Локализация на тайский — не обязательна

Юридического требования локализовать игру на тайский нет.

**Apple:** каждое приложение имеет primary language, дополнительные локализации опциональны и служат фолбэком (https://developer.apple.com/help/app-store-connect/reference/app-information/app-store-localizations/). **Google Play:** требований по локализации нет, обязательна только IARC-анкета.

**Тайское право:** общего требования «интерфейс на тайском» нет. Требования языка возникают в других контекстах — договоры и квитанции по Consumer Protection Act (https://gam-legalalliance.com/thai-statutory-laws/consumer-protection-act-thailand/), маркировка физических товаров (https://www.tilleke.com/insights/thailands-new-labeling-readability-requirements/), реклама (https://www.tilleke.com/insights/thailand-issues-regulation-on-language-and-other-content-in-advertisements/).

**Вердикт:** не обязательна. Но при наличии платных покупок тайская версия условий снижает потребительско-правовой риск, а маркетингово тайский почти наверняка окупается для игры о тайской уличной еде.

---

## Чего проверить не удалось — честный список

1. Официальную позицию Министерства культуры Таиланда по игровой классификации и по буддийской образности — сайт на тайском, англоязычных первоисточников нет.
2. Точный статус Film and Game Act на 21.08.2026 — источники говорят «не принят, перерабатывается», свежего подтверждения из первоисточника нет.
3. Дословное официальное заявление тайского цензурного органа по Tropico 5 — только журналистские пересказы.
4. Дословный текст Section 206–208 УК из официального источника — Siam Legal вернул 403; использован альтернативный перевод. Все английские переводы тайского УК неофициальные.
5. Официальные правила по религиозному контенту для стран Залива — публичных документов не найдено.
6. Прецедент бана игры именно за изображение свинины — не найден ни один.

---

## Чек-лист перед релизом

**Обязательно:** честно заполнить IARC-анкету и Age Rating · не добавлять изображения Будды в декоративной роли · заменить реалистичные тайские банкноты абстрактной валютой · проверить у носителя весь арабский и тайский текст в графике · проверить происхождение каждого аудиосемпла · убрать свинину и алкоголь из ассортимента · при релизе в Индонезии оформить IGRS · убрать бренд Nutella из брифа.

**Нужен тайский юрист, если добавить:** королевскую символику, портреты, банкноты с портретом Короля · тайский флаг или гимн в игровом контексте · сюжет, затрагивающий политику, армию или южные провинции · монахов как персонажей с денежными транзакциями.
