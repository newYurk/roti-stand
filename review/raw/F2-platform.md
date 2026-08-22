# F2 «Платформа и право» — фактчек внешнего мира

**Дата проверки: 21–22 августа 2026.** Все утверждения ниже проверены на эти даты, а не по памяти; дата доступа указана при каждом источнике.
Правило линзы: **утверждение без URL и даты доступа в артефакт не попадает.**

Предмет проверки:
- `../Game/gamedev-tools-checklist.md` — чек-лист (общий для «Лягушки» и Roti Stand);
- `docs/archive/roti-stand-design-doc-v3.md`, раздел «Продвинутый режим: подброс через акселерометр»;
- `STATE.md` Roti Stand.

**Автор этого документа не юрист.** Места, где нужен юрист, помечены явно.

---

## 0. Короткий вердикт

Три вещи, которые меняют проект:

1. **Режим подброса в том виде, как он описан в v3, в App Store не пройдёт.** Не из-за формулировки disclaimer, а из-за самой механики: дизайн явно ожидает, что телефон окажется в свободном падении и приземлится на поверхность. Есть прямой прецедент отказа, где disclaimer не помог.
2. **`Touch.force` на актуальных iPhone возвращает 0 всегда.** Аппаратного датчика давления в экране нет с iPhone 11. Главная механика игры — «растягивание теста двумя точками захвата с контролем натяжения» — **не может опираться на силу нажатия ни в вебе, ни нативно.** Замены нет: `PointerEvent.pressure` по спецификации отдаёт константу 0.5.
3. **Юридическая часть v3 не защищает.** Отказ от ответственности за вред здоровью ничтожен в ЕС и Таиланде вне зависимости от чекбокса; за имущество — действует только «в пределах разумного». А шутливая шкала «Насколько тебе жить надоело» — это не смягчающее обстоятельство, а отягчающее: она попадает ровно в формулировку Apple про «побуждение к челленджам».

---

## 1. Таблица: утверждение чек-листа → вердикт → источник

| # | Утверждение чек-листа | Вердикт | Источник (URL + дата доступа) |
|---|---|---|---|
| 1 | Apple Developer Program — **$99/год** | **Подтверждено**, с уточнением: «в местной валюте там, где доступно; цены могут отличаться по регионам», плюс налог по ставке региона | [developer.apple.com/support/enrollment/](https://developer.apple.com/support/enrollment/), доступ 21.08.2026: «The Apple Developer Program annual fee is 99 USD… in local currency where available. Prices may vary by region and are listed in local currency during the enrollment process… your membership purchase will be taxed using the tax rate for your region or state» |
| 2 | С **28.04.2026** сборка обязательно на **Xcode 26 / SDK iOS 26** | **Подтверждено дословно** | [developer.apple.com/news/upcoming-requirements/](https://developer.apple.com/news/upcoming-requirements/), доступ 21.08.2026: «Since April 28, 2026 — Apps uploaded to App Store Connect must be built with Xcode 26 or later using an SDK for iOS 26, iPadOS 26, tvOS 26, visionOS 26, or watchOS 26» |
| 3 | Google Play — **$25 разово** | **Подтверждено**; невозвратно, и **добавилась обязательная верификация личности** (документы, иногда селфи) | [support.google.com/googleplay/android-developer/answer/6112435](https://support.google.com/googleplay/android-developer/answer/6112435), доступ 21.08.2026 |
| 4 | Личным аккаунтам после **13.11.2023** — закрытый тест, **12 тестировщиков, 14 дней непрерывно** | **Подтверждено дословно.** Было 20, снижено до 12 в декабре 2024; срок 14 дней не менялся | [support.google.com/googleplay/android-developer/answer/14151465](https://support.google.com/googleplay/android-developer/answer/14151465), доступ 21.08.2026: «personal developer accounts created after November 13, 2023… a minimum of 12 testers who have been opted in continuously for at least 14 days». **Ключевая деталь оттуда же:** если тестировщик отписался до конца 14 дней и вернулся — счётчик обнуляется |
| 5 | С **31.08.2026** обязателен **targetSdk 36** | **Подтверждено, но неполно.** Для новых приложений и апдейтов — да, API 36. Уже опубликованные остаются на API 35 для сохранения видимости новым пользователям. **Чек-лист упускает: можно запросить продление до 01.11.2026** | [support.google.com/googleplay/android-developer/answer/11926878](https://support.google.com/googleplay/android-developer/answer/11926878), доступ 21.08.2026: «request an extension to November 1, 2026 if you need more time to update your app» |
| 6 | С **31.08.2026** обязателен **Play Billing 8+** | **Подтверждено, но применимо не всегда — и для Roti, скорее всего, неприменимо вовсе** | [developer.android.com/google/play/billing/deprecation-faq](https://developer.android.com/google/play/billing/deprecation-faq), доступ 21.08.2026: «By Aug 31, 2026, all new apps and updates to existing apps must use Billing Library version 8 or later». Три уточнения оттуда же: **(а)** требование касается **только приложений с биллингом Play** — «These dependencies only appear in APKs that require the `com.android.vending.BILLING` permission»; **(б)** это **publishing gate, а не runtime**: уже опубликованные сборки продолжают проводить платежи, блокируется только выпуск апдейта; **(в)** продление запрашивается формой на странице Policy status в Play Console. Следующая ступень — **v9, дедлайн 31.08.2027, продление до 01.11.2027**; прямого перехода 7→9 нет ([developer.android.com/google/play/billing/migrate-gpblv8](https://developer.android.com/google/play/billing/migrate-gpblv8), доступ 21.08.2026) |
| 7 | Политика конфиденциальности обязательна в обоих сторах и **внутри приложения** | **Подтверждено дословно** | [App Store Review Guidelines 5.1.1(i)](https://developer.apple.com/app-store/review/guidelines/), доступ 21.08.2026: «All apps must include a link to their privacy policy in the App Store Connect metadata field **and within the app in an easily accessible manner**» — то есть двух ссылок мало, обе обязательны, и политика должна перечислять собираемые данные, третьих лиц и порядок удаления |
| 8 | При анонимной аналитике **промпт ATT не нужен** | **Подтверждено, но с существенной оговоркой** | [developer.apple.com/app-store/user-privacy-and-data-use/](https://developer.apple.com/app-store/user-privacy-and-data-use/), доступ 21.08.2026. Определение: «tracking refers to the act of linking user or device data collected from your app with user or device data collected from **other companies'** apps, websites, or offline properties for targeted advertising or advertising measurement… Tracking also refers to sharing user or device data with data brokers». Оговорка оттуда же: ATT нужен, **даже если вы сами не рекламируете**, — если сторонний SDK перепрофилирует данные под таргетинг в чужих приложениях. То есть освобождение держится не на слове «анонимная», а на выборе SDK |
| 9 | **IARC self-certification** — «бесплатный возрастной рейтинг, встроен в консоли **всех площадок**» | **Устарело / неверно для Apple.** Google Play — да, IARC. **Apple использует собственную анкету, не IARC**, и с 2025 года систему переработал | Google Play: [support.google.com/googleplay/android-developer/answer/9898843](https://support.google.com/googleplay/android-developer/answer/9898843), доступ 21.08.2026. Apple: [developer.apple.com/news/upcoming-requirements/](https://developer.apple.com/news/upcoming-requirements/), доступ 21.08.2026 — «Since January 31, 2026: Ratings for all apps and games on the App Store have been automatically updated to align with our new age rating system». Первоисточник по содержанию реформы — [developer.apple.com/news/?id=ks775ehf](https://developer.apple.com/news/?id=ks775ehf), анонс 24.07.2025, доступ 21.08.2026: добавлены ступени **13+, 16+, 18+** к существующим 4+ и 9+ (12+ и 17+ упразднены), и «We've introduced a new set of required questions to the ratings questionnaire for all apps. These new questions cover: **In-app controls, Capabilities, Medical or wellness topics, Violent themes in your app or game**» |
| 10 | **ИП/LLC не нужно на старте** | **Формально подтверждено, но чек-лист умалчивает о цене вопроса — и она наступает при монетизации** | Apple: [developer.apple.com/support/enrollment/](https://developer.apple.com/support/enrollment/), доступ 21.08.2026 — «Your **personal legal name** will be listed as the seller on the App Store»; D-U-N-S требуется только организациям. Google Play: [support.google.com/googleplay/android-developer/answer/13628312](https://support.google.com/googleplay/android-developer/answer/13628312), доступ 21.08.2026 — для личного аккаунта «Google will display your legal name, your country (as per your legal address), and developer email address on Google Play. **If you decide to monetize on Google Play then Google will display your full address**». Для приёма денег: [developer.apple.com/help/app-store-connect/manage-agreements/sign-and-update-agreements/](https://developer.apple.com/help/app-store-connect/manage-agreements/sign-and-update-agreements/), доступ 21.08.2026 — «To sell your apps on the App Store or offer In-App Purchases, the Account Holder must sign the Paid Apps Agreement» + отдельно налоговая и банковская информация |
| 11 | EULA/ToS с disclaimer снимает ответственность за повреждение устройства | **Опровергнуто как способ защиты** — см. раздел 4 | Директива ЕС 93/13/EEC, приложение; Thailand UCTA B.E. 2540 s.8; Apple Standard EULA |
| 12 | Kenney.nl / itch.io — часто CC0, проверять каждый ассет | см. раздел 6 | — |
| 13 | Google Fonts — Apache/OFL, безопасны для коммерции | см. раздел 6 | — |
| 14 | Epidemic Sound — нужна коммерческая подписка | см. раздел 6 | — |

### Чего в чек-листе нет и что надо добавить

| Что упущено | Почему это важно сейчас | Источник |
|---|---|---|
| **Дедлайн новой возрастной анкеты Apple — 31.01.2026, он уже прошёл** | Приложение, не заполнившее новую анкету, блокируется на приёме сабмитов и апдейтов. Для нового приложения это просто новый набор вопросов, но старая формулировка «IARC везде» ведёт по ложному следу | [developer.apple.com/news/upcoming-requirements/](https://developer.apple.com/news/upcoming-requirements/), доступ 21.08.2026 |
| **Android Developer Verification вступает в силу в сентябре 2026 — в том числе в Таиланде** | Через 1–2 недели от даты этого ревью. Первые страны: Бразилия, Индонезия, Сингапур, **Таиланд**. Касается **всех** приложений на сертифицированных Android-устройствах, включая распространяемые мимо Play | [android-developers.googleblog.com/2025/08/elevating-android-security.html](https://android-developers.googleblog.com/2025/08/elevating-android-security.html), доступ 21.08.2026: «September 2026: Requirements take effect in Brazil, Indonesia, Singapore, and Thailand» |
| **DSA trader status для ЕС** | Без указанного trader status приложение удаляется из App Store в ЕС. Действует с 17.02.2025 | [developer.apple.com/news/upcoming-requirements/](https://developer.apple.com/news/upcoming-requirements/), доступ 21.08.2026 |
| **Privacy manifest / approved reasons for APIs** | Обязательно с 01.05.2024 для загрузки в App Store Connect, включая сторонние SDK. Для Capacitor-обёртки это касается и плагинов | там же |

---

## 2. `Touch.force` и `Touch.radiusX` — вердикт для главной механики

**Это самый важный пункт ревью: он касается не режима подброса, а ядра игры.**
`STATE.md` фиксирует, что «отсутствие давления и площади касания для растягивания теста критичнее, чем было для „Лягушки"». Проверка показывает: **проблема не в движке, а в железе. Ни один движок её не решает.**

### 2.1 Что говорит спецификация

W3C Touch Events Level 2, [w3c.github.io/touch-events/](https://w3c.github.io/touch-events/), доступ 21.08.2026:

- `force` — «**0 if no value is known.** In environments where force is known, the absolute pressure represented by the force attribute, and the sensitivity in levels of pressure, may vary»;
- `radiusX` / `radiusY` — «**0 if no value is known.** The value must not be negative»;
- `rotationAngle` — «0 if no value is known».

То есть спецификация прямо предписывает отдавать **ноль**, а не приближение.

MDN, [developer.mozilla.org/en-US/docs/Web/API/Touch/force](https://developer.mozilla.org/en-US/docs/Web/API/Touch/force), доступ 21.08.2026: «A value of `0.0` is returned if no value is known (for example the touch device does not support this property)». Статус фичи — «Limited availability. This feature is not Baseline».

### 2.2 Что говорит железо

3D Touch — единственная технология, дававшая веб-странице настоящее давление на iPhone, — **снята с устройств начиная с iPhone 11 (2019)**. Haptic Touch, пришедший на замену, распознаёт только длительность удержания, а не уровни силы: «The touchscreen no longer has a pressure sensitive layer, so the software waits for a long-press to activate certain features instead… Haptic Touch can't detect multiple levels of pressure like 3D Touch did» — [macrumors.com/guide/haptic-touch-vs-3d-touch-whats-the-difference/](https://www.macrumors.com/guide/haptic-touch-vs-3d-touch-whats-the-difference/), доступ 21.08.2026; [en.wikipedia.org/wiki/Force_Touch](https://en.wikipedia.org/wiki/Force_Touch), доступ 21.08.2026.

**Практическое следствие, подтверждённое разработчиками:** на устройствах без 3D Touch `touch.force` в touch-событиях всегда `0` (документировано в issue-трекерах библиотеки [github.com/stuyam/pressure](https://github.com/stuyam/pressure), доступ 21.08.2026 — «The `touch.force` property will always be 0 if the device does not have 3D Touch»; там же отмечено, что даже на 3D-Touch-устройствах первые несколько значений приходят нулевыми).

**Вердикт: любой iPhone, выпущенный с 2019 года, отдаёт `Touch.force === 0`. Всегда. Это не баг Safari и не ограничение веба — датчика в экране физически нет.**

### 2.3 Альтернативы — и почему они не работают

| Кандидат | Что реально даёт | Источник |
|---|---|---|
| **`PointerEvent.pressure`** | **Константу.** Спецификация: «For hardware and platforms that do not support pressure, the value _MUST_ be `0.5` when in the active buttons state and `0` otherwise» | [w3.org/TR/pointerevents3/](https://www.w3.org/TR/pointerevents3/), доступ 21.08.2026 |
| **`PointerEvent.width` / `height`** | Тоже константу при отсутствии геометрии: «the user agent _MUST_ return a default value of `1`» | там же |
| **Force Touch на трекпадах (`webkitmouseforce*`, `webkitForce`)** | Работает, но **только macOS 10.11+ на трекпадах с Force Touch**. В документации Apple **нет ни слова про iOS**. Для мобильной игры бесполезно | [developer.apple.com/library/archive/…/RespondingtoForceTouchEventsfromJavaScript.html](https://developer.apple.com/library/archive/documentation/AppleApplications/Conceptual/SafariJSProgTopics/RespondingtoForceTouchEventsfromJavaScript.html), доступ 21.08.2026 |
| **`Touch.radiusX` / `radiusY`** | Свойства **существуют** в Safari on iOS с версии 10 (MDN browser-compat-data, `api/Touch.json`, `safari_ios: {"version_added": "10"}`, доступ 21.08.2026 через [raw.githubusercontent.com/mdn/browser-compat-data](https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/Touch.json)). **Но наличие свойства не равно осмысленному значению** — спецификация разрешает вернуть 0, и на iOS исторически возвращаются константы, а не реальная площадь пятна. **Это единственный пункт, который нельзя закрыть по документации: нужен замер на живом устройстве** | там же |
| **Native (Swift/UIKit) `UITouch.force`** | Обход не даёт ничего: `UITouch.force` питается тем же отсутствующим датчиком. Осмысленные значения остаются только для **Apple Pencil на iPad** | вывод из 2.2, отдельного замера не требует |

### 2.4 Что это значит для дизайна

Механика «растягивание теста двумя точками захвата **с контролем натяжения**» должна быть переизобретена на входах, которые на самом деле есть:

- **расстояние между двумя точками касания** и скорость его изменения — есть, точно и бесплатно;
- **скорость движения пальца** (px/ms) как прокси силы — есть; это стандартная замена давлению в мобильных играх;
- **длительность удержания** — есть (это и есть Haptic Touch по сути);
- **площадь пятна** — **под вопросом, требует замера**;
- **сила нажатия** — **нет и не будет**.

Отдельно: `../night-skip/DECISION.md` дисквалифицировал Godot в том числе за отсутствие давления и площади касания в тач-событиях. **Для Roti Stand этот довод против Godot надо снять**: давления нет ни у кого, поэтому оно не может быть критерием выбора движка. Godot должен оцениваться заново по другим основаниям.

---

## 3. `DeviceMotion` / `DeviceOrientation` — вердикт

### 3.1 Политика разрешений

Требования к `DeviceMotionEvent.requestPermission()` — [developer.mozilla.org/en-US/docs/Web/API/DeviceMotionEvent/requestPermission_static](https://developer.mozilla.org/en-US/docs/Web/API/DeviceMotionEvent/requestPermission_static), доступ 21.08.2026:

- **Secure context (HTTPS)**: «This feature is available only in secure contexts (HTTPS)»;
- **Transient activation**: «This method requires transient activation, meaning that it must be triggered by a UI event such as a button click». Без жеста промис отклоняется с `NotAllowedError`;
- статус: «not Baseline because it does not work in some of the most widely-used browsers» — то есть на не-iOS браузерах метода может не быть вовсе, проверка `typeof DeviceMotionEvent.requestPermission === 'function'` обязательна.

Для GitHub Pages это не проблема: там HTTPS по умолчанию. Для плейтестов с локального сервера по HTTP — проблема будет.

### 3.2 Safari против WKWebView под Capacitor — **они ведут себя по-разному**

Это самая практически важная находка раздела, и она неочевидна.

**В чистом WKWebView** системный диалог разрешения **не появляется вообще**, даже когда тот же код работает в Safari. Приложение обязано реализовать делегат `WKUIDelegate` — метод `webView(_:requestDeviceOrientationAndMotionPermissionFor:initiatedByFrame:decisionHandler:)` (iOS 15+). Подтверждено обсуждением на форуме Apple: [developer.apple.com/forums/thread/125490](https://developer.apple.com/forums/thread/125490), доступ 21.08.2026 — «no permission dialog appears… The most complete answer suggests setting a `uiDelegate` on your WKWebView».

**Capacitor этот делегат реализует — и безусловно выдаёт разрешение.** Проверено по исходнику, не по документации:

```swift
// ios/Capacitor/Capacitor/WebViewDelegationHandler.swift
open func webView(_ webView: WKWebView,
                  requestDeviceOrientationAndMotionPermissionFor origin: WKSecurityOrigin,
                  initiatedByFrame frame: WKFrameInfo,
                  decisionHandler: @escaping (WKPermissionDecision) -> Void) {
    decisionHandler(.grant)
}
```

Источник: [raw.githubusercontent.com/ionic-team/capacitor/main/ios/Capacitor/Capacitor/WebViewDelegationHandler.swift](https://raw.githubusercontent.com/ionic-team/capacitor/main/ios/Capacitor/Capacitor/WebViewDelegationHandler.swift), доступ 21.08.2026. Наличие проверено в тегах **6.2.1, 7.4.3 и 8.0.0** — то есть это стабильное поведение, а не свежий коммит в main.

**Следствия, которые надо заложить в дизайн:**

1. Под Capacitor **промпт «Разрешить доступ к движению?» пользователь не увидит** — `requestPermission()` немедленно резолвится в `'granted'`. Дизайнить экран «сейчас появится системный запрос» не нужно и вредно.
2. Требование transient activation при этом **остаётся** (оно живёт в WebKit, а не в делегате) — вызывать `requestPermission()` всё равно надо из обработчика клика.
3. **Один и тот же код ведёт себя по-разному в Safari и в собранном приложении.** Плейтест на GitHub Pages через Safari **не является проверкой** того, как поведёт себя релизная сборка. Это ловушка ровно того типа, который «Лягушка» уже прошла с аудиозадержкой.
4. В `Info.plist` обязателен **`NSMotionUsageDescription`** — [developer.apple.com/documentation/bundleresources/information-property-list/nsmotionusagedescription](https://developer.apple.com/documentation/bundleresources/information-property-list/nsmotionusagedescription), доступ 21.08.2026. Без него приложение упадёт при обращении к датчикам, и текст этой строки читает ревьюер Apple. Для режима подброса он же станет уликой — см. раздел 4.
5. Молчаливая выдача разрешения — **отдельный аргумент за то, чтобы игра спрашивала пользователя сама**, своим экраном. Не ради юридической защиты (она не работает, см. раздел 4), а потому что иначе доступ к датчикам движения включается вообще без ведома игрока.

### 3.3 Частота опроса

`DeviceMotionEvent` даёт **порядка 60 Гц** на большинстве устройств (диапазон по браузерам и устройствам примерно 10–60 Гц). Гадать не нужно: у события есть поле `interval` — «returns the interval, **in milliseconds**, at which data is obtained from the underlying hardware» ([developer.mozilla.org/en-US/docs/Web/API/DeviceMotionEvent/interval](https://developer.mozilla.org/en-US/docs/Web/API/DeviceMotionEvent/interval), доступ 21.08.2026). **Это и есть инструмент замера — одна строка в прототипе закрывает вопрос.** Потолок нативного пути: третьесторонние iOS-приложения через CoreMotion получают акселерометр максимум около **100 Гц** независимо от запрошенного интервала и возможностей железа ([developer.apple.com/forums/thread/813136](https://developer.apple.com/forums/thread/813136), доступ 21.08.2026).

**Что это значит для v3.** Дизайн строит на данных датчиков три вещи: детекцию свободного падения, различение «поймано в руке» и «упало на поверхность» по микротремору, и DTW-классификацию четырёх типов жеста. 60 Гц — это ~17 мс между отсчётами. Бросок длится доли секунды, то есть на весь жест приходится порядка 20–40 точек. Для грубой детекции free fall этого хватит; **для устойчивого различения «вертолёт» / «слепой полёт» / «переброс двумя руками» через DTW — почти наверняка нет**, и v3 сам ставит это открытым вопросом («Проверить точность DTW-классификации на реальных тестовых бросках (нужен прототип)»). Переход на нативный CoreMotion поднимает потолок примерно вдвое — этого может не хватить, а стоит он отказа от веб-стека.

---

## 4. App Store и режим подброса: почему юридическая часть v3 не спасает

### 4.1 Применимые пункты руководства

[App Store Review Guidelines](https://developer.apple.com/app-store/review/guidelines/), доступ 21.08.2026:

> **1.4 Physical Harm.** If your app behaves in a way that risks physical harm, we may reject it.
>
> **1.4.5** Apps should not urge customers to participate in activities (like bets, challenges, etc.) **or use their devices in a way that risks physical harm to themselves or others.**

> **2.4.2** Design your app to use power efficiently and **be used in a way that does not risk damage to the device.**

Отдельно относится к рейтингу:

> **2.3.6** Answer the age rating questions in App Store Connect honestly… If your app is mis-rated, customers might be surprised by what they get, or it could trigger an inquiry from government regulators.

### 4.2 Прецедент, который закрывает вопрос

**Send Me To Heaven (S.M.T.H.), Carrot Pop, 2013** — игра, измеряющая высоту подброса телефона. Apple отклонила её с формулировкой про «поощрение поведения, которое может привести к повреждению устройства пользователя», — и **отклонила несмотря на заметный дисклеймер, показывавшийся при каждом запуске**:

> «Apple's App Store review team rejected the software on the basis of "encouraging behavior that could result in damage to the user's device," **in spite of an appropriate disclaimer showing up prominently upon launching the app**»
> — [idownloadblog.com/2013/08/06/apple-rejects-send-me-to-heaven-game/](https://www.idownloadblog.com/2013/08/06/apple-rejects-send-me-to-heaven-game/), доступ 21.08.2026; см. также [en.wikipedia.org/wiki/Send_Me_to_Heaven](https://en.wikipedia.org/wiki/Send_Me_to_Heaven), доступ 21.08.2026.

Игра до сих пор жива в Google Play и отсутствует в App Store — то есть это не разовая ошибка ревьюера, а устойчивая позиция.

**Это прямо опровергает конструкцию v3.** v3 считает disclaimer инструментом, который делает режим допустимым. Прецедент показывает: disclaimer — не пропуск, и наличие явного предупреждения Apple прочитала как **подтверждение** того, что разработчик сам осознаёт риск.

### 4.3 Насколько именно v3 попадает под 1.4.5

Проблема не в том, что игра «использует акселерометр». Гироскоп и акселерометр использует половина каталога. Проблема в том, что **дизайн v3 явно предполагает, что телефон окажется в свободном падении и приземлится**:

- «**Состояние 1 — Отрыв (Release).** Свободное падение → почти нулевые показания акселерометра по всем осям» — нулевые показания по всем осям возникают, только если в свободном падении находится **сам телефон**;
- «**Состояние 2 — Приземление на поверхность («упал»).** …Реакция игры: „Тесто приземлилось на диван. **Мастер роти, подбери телефон**, чтобы продолжить"» — игра штатно обрабатывает сценарий, в котором телефон лежит на полу.

Это в точности механика Send Me To Heaven, встроенная в кулинарный симулятор.

Дальше — формулировки, которые **ухудшают** положение, а не улучшают:

| Элемент v3 | Как это читается под 1.4.5 |
|---|---|
| «Тренироваться **строго над диваном/кроватью** — на свой страх и риск 😅» | Прямая инструкция бросать телефон. Смайлик не меняет смысла — он показывает, что риск осознан и подан как забава |
| Шкала чувствительности **«Насколько тебе жить надоело»**, от «Осторожно» до «Настоящий стритфуд-мастер» | Геймификация степени риска. 1.4.5 запрещает «urge customers to participate in activities (**like bets, challenges**)» — шкала риска с поощрительными названиями и есть челлендж |
| Кнопка «**Я всё понял, готов рисковать**» | Фиксирует, что приложение осознанно предлагает рисковать |
| «Не играть рядом с котом, вазой и начальником» | Признание риска для третьих лиц — 1.4.5 упоминает «themselves **or others**» |
| Бейджи в «Книге бросков», шаринг клипов, «органическая виральность: люди выкладывают видео **себя**, пытающихся повторить бросок» | Соревновательная петля вокруг физического риска. Это ровно бизнес-модель S.M.T.H. |

**Вывод: как написано, режим не пройдёт ревью, а попытка его протащить рискует не отказом в фиче, а вниманием к приложению целиком.**

### 4.4 Что можно сохранить

Отделимо и, по всей видимости, проходимо:

- **взмах кистью с телефоном в руке**, без отрыва — телефон не покидает ладонь, свободного падения нет. Это уже существует в каталоге (условные «шейкеры»), 1.4.5 не задевается;
- **вся визуальная и звуковая часть**: «пауза в невесомости», слоу-мо, реконструкция броска, «паспорт роти», названия трюков — они не требуют, чтобы телефон летел;
- **дефолт свайпом** — v3 это уже предусматривает и это правильно.

Неотделимо и подлежит удалению:

- детекция состояния «телефон приземлился на поверхность» — эта фича существует только ради сценария броска;
- любая формулировка, поощряющая риск, включая название шкалы;
- шаринг и лидерборды, привязанные к физической рискованности жеста.

**Это решение уровня дизайна, а не текста disclaimer.** Переписать предупреждение недостаточно.

### 4.5 Состоятельность самой юридической конструкции

**Автор не юрист. Это карта рисков, а не заключение.** Ниже — что видно из первичных источников.

**(а) Отказ от ответственности за вред здоровью — ничтожен, и чекбокс тут ничего не меняет.**

- **ЕС.** Директива 93/13/EEC, приложение, п.1(a) прямо относит к недобросовестным условия, «excluding or limiting the legal liability of a seller or supplier in the event of the death of a consumer or personal injury to the latter resulting from an act or omission of that seller or supplier» — [eur-lex.europa.eu/eli/dir/1993/13/oj/eng](https://eur-lex.europa.eu/eli/dir/1993/13/oj/eng), доступ 21.08.2026. Список индикативный, национальные законы могут быть строже.
- **Таиланд** (важно, учитывая привязку проекта). Unfair Contract Terms Act B.E. 2540 (1997), s.8: условия, заранее исключающие ответственность «respecting loss of life, body or health of another person as a result of an action deliberately or negligently committed… **shall not be raised** as an exclusion or restriction of the liability». Всё остальное — «shall only be enforceable **to the extent that they are fair and reasonable** according to the circumstances» — [samuiforsale.com/law-texts/unfair-contract-terms-act.html](https://www.samuiforsale.com/law-texts/unfair-contract-terms-act.html), доступ 21.08.2026.

**(б) Отказ от ответственности за повреждение устройства — не ничтожен, но и не абсолютен.** В Таиланде он действует «в пределах справедливого и разумного» (s.8, там же). В ЕС оценивается через общий тест на значительный дисбаланс. В США clickwrap как форма согласия суды признают устойчиво (в отличие от browsewrap), но само по себе это не спасает оговорку об ответственности: суды отдельно оценивают её разумность, особенно когда ущерб вызван небрежностью или умыслом — обзор практики: [goodwinlaw.com/en/insights/publications/2022/08/08_10-recent-court-decisions-shed-light](https://www.goodwinlaw.com/en/insights/publications/2022/08/08_10-recent-court-decisions-shed-light), доступ 21.08.2026.

**Практический вывод: клик-through с чекбоксом решает вопрос „было ли согласие", но не решает вопрос „допустима ли сама оговорка". v3 путает эти два вопроса.**

**(в) Юмор — это юридический риск, а не украшение.** «Насколько тебе жить надоело» и «Я привязан к жизни» — это шутки о смерти в интерфейсе, предлагающем физически рискованное действие. В споре такая формулировка работает против разработчика: она демонстрирует, что риск был не просто известен, а подан как развлечение. Ровно это же читает и ревьюер Apple. **Это самая дешёвая правка во всём разделе и её надо сделать независимо от судьбы режима.**

**(г) Свой EULA возможен, но не обязателен.** Apple допускает кастомный EULA: «Your license to each App is subject to your prior acceptance of either this Licensed Application End User License Agreement… **or a custom end user license agreement** between you and the Application Provider» — [apple.com/legal/internet-services/itunes/dev/stdeula/](https://www.apple.com/legal/internet-services/itunes/dev/stdeula/), доступ 21.08.2026. Стандартный EULA Apple уже содержит «USE OF THE LICENSED APPLICATION IS AT YOUR SOLE RISK», отказ от гарантий и **потолок ответственности в 50 USD**, «except where prohibited by law involving personal injury». То есть базовая защита есть по умолчанию; писать свой EULA ради ещё одного отказа от ответственности — работа с почти нулевой отдачей.

**(д) Где нужен юрист — и по какому конкретно вопросу.** Не «проверить формулировку disclaimer» (открытый вопрос v3 сформулирован именно так, и это неверная постановка). Правильные вопросы: **1)** какой перечень юрисдикций реально релевантен при глобальном релизе через App Store; **2)** нужна ли страховка ответственности производителя (product liability) при наличии режима с физическим риском; **3)** как оговорка соотносится с обязательными нормами о защите прав потребителей в странах основной аудитории. **Но задавать их имеет смысл только если режим подброса выживет после раздела 4.3.** Если механика броска убирается — потребность в юристе по этому поводу отпадает вместе с ней, и это самый дешёвый способ закрыть вопрос.

---

## 5. Товарные знаки, топонимы, названия блюд и бренды

### 5.0 Сначала — что корпус на самом деле делает

Вопрос был поставлен как «можно ли называть фестивали настоящими именами». Проверка корпуса показывает, что **корпус уже выбрал не называть**, и это стоит зафиксировать до всякой юридической оценки:

| Что | Как в корпусе | Где |
|---|---|---|
| Сонгкран | В игре — «**Водный фестиваль** (аналог Сонгкрана)». Настоящее имя присутствует только как пояснение для разработчика | `roti-stand-retention-and-seasonality-addendum-v4.md`, строка 40 |
| Лой Кратонг | В игре — «**Фестиваль фонариков** (аналог Лой Кратонг)». То же самое | там же, строка 41 |
| Ко Чанг | «**Скрытая** географическая привязка для разработчиков… Игроку не обязательно это сообщать — для него это просто узнаваемый островной Таиланд» | `roti-stand-design-doc-v3.md`, строки 6 и 77–78 |
| Nutella | Упомянута **один раз**, в справочном абзаце о том, что реально кладут уличные торговцы. **В игровой список начинок не входит** — все десять авторских начинок носят выдуманные имена («Зелёный дождь», «Чёрное золото», «Ночной жасмин») | `roti-cultural-and-filling-brief.md`, строка 42 и таблица «Авторские начинки игры» |
| Роти клуай / матаба / сай май | Реальные родовые названия блюд, в справочной таблице «Реальные тайские варианты» | `roti-cultural-and-filling-brief.md`, раздел 3 |

**Практический вывод: поверхность риска здесь заметно меньше, чем предполагал вопрос.** Открытым остаётся не «можно ли», а «стоит ли отказываться от уже принятого решения в пользу настоящих имён ради узнаваемости». Ниже — фактура для этого выбора.

### 5.1 Что удалось проверить

| Вопрос | Что установлено | Источник |
|---|---|---|
| **Сонгкран и статус ЮНЕСКО** | Сонгкран внесён в Репрезентативный список нематериального культурного наследия человечества в **2023 году** (сессия 18.COM). **Это инструмент охраны и признания, а не режим исключительных прав:** на странице объекта нет никаких положений об ограничении использования названия, в том числе коммерческого. Внесение в список **не создаёт** монополии на слово | [ich.unesco.org/en/RL/songkran-in-thailand-traditional-thai-new-year-festival-01719](https://ich.unesco.org/en/RL/songkran-in-thailand-traditional-thai-new-year-festival-01719), доступ 22.08.2026 |
| **Названия блюд** | «Роти клуай», «матаба», «роти сай май» — родовые названия еды, и корпус использует их именно как родовые, в справочной таблице. Родовое обозначение товара по общему принципу товарно-знакового права не может быть чьим-то исключительным знаком для того же товара | принцип; проверка по конкретным реестрам **не выполнена**, см. 5.2 |
| **Ко Чанг** | Топоним. Игра его игроку не называет — по корпусу это внутренняя опора для разработчиков | `roti-stand-design-doc-v3.md`, строки 6, 77–78 |
| **Nutella** | В игровом контенте отсутствует. Упомянута один раз в справочном абзаце культурного брифа как факт о реальной уличной торговле | `roti-cultural-and-filling-brief.md`, строка 42 |

### 5.2 Что проверить не удалось — и это надо знать честно

**Поиск по товарно-знаковым реестрам (USPTO, EUIPO, DIP Thailand) в этом ревью не выполнен.** Бюджет веб-поиска сессии был исчерпан, а реестры не отдаются простым запросом страницы. Поэтому:

- **не подтверждено и не опровергнуто**, есть ли действующие знаки на «Songkran» / «Loy Krathong» / «Koh Chang» / названия блюд в классах 9 и 41 (софт и игры);
- **не проверены** тайские географические указания (GI) на конкретные наименования блюд;
- **не проверена** судебная практика по изображению реальных брендов в играх.

Это не «рисков нет» — это «проверка не сделана». Ставить сюда утверждение без источника было бы нарушением правила линзы.

### 5.3 Что из этого следует практически

Хорошая новость в том, что **решение уже принято и оно консервативное**. Корпус использует вымышленные имена для фестивалей, скрывает топоним и не тянет Nutella в игру. При таком раскладе:

- **делать ничего не нужно** — риск в текущей конфигурации минимальный;
- **вопрос возникает только если кто-то захочет вернуть настоящие имена** ради узнаваемости. Вот тогда и понадобится поиск по реестрам, и делать его надо **до** того, как имя попадёт в маркетинг и в метаданные стора, а не после;
- **отдельно про Nutella:** если фундук-шоколадная начинка всё же появится, называть её надо родовым описанием («шоколадно-ореховая паста»), а не брендом, и не изображать узнаваемую банку с фирменной этикеткой. Это дешевле любой юридической консультации и снимает вопрос целиком;
- **культурная сторона** — тайско-мусульманские корни блюда — это вопрос не товарных знаков, а точности и уважительности. Культурный бриф проекта уже формулирует правило («уважать мусульманско-тайские корни блюда; не сводить культурный слой к экзотическому фону», строка 71). Формального требования сторов здесь нет; ближайшее применимое — общий запрет на оскорбительный контент в Guideline 1.1, но он не про добросовестное изображение кухни.

**Где нужен юрист:** только при отказе от текущего консервативного решения. Пока настоящие имена в игре не используются, юрист по этому блоку не нужен.

---

## 6. Лицензии на ассеты, шрифты и звук

Для ASMR-игры это не формальность: звук здесь — не оформление, а механика («читать еду по звуку и виду, а не по проценту готовности»). Лицензионная ошибка в звуке стоит дороже, чем в графике, потому что заменить звук на поздней стадии значит перепроверить баланс механики.

### 6.1 Таблица проверки

| Утверждение чек-листа | Вердикт | Источник |
|---|---|---|
| **Kenney.nl** — «часто CC0, проверять лицензию на каждый ассет» | **Подтверждено, формулировка чек-листа корректна.** Проверено на конкретном паке, релевантном проекту: Kenney **Food Kit** — лицензия «Creative Commons CC0». Лицензия указывается на странице каждого пака, а не единым правилом сайта, — поэтому оговорка «проверять каждый» не перестраховка, а точное описание | [kenney.nl/assets/food-kit](https://kenney.nl/assets/food-kit), доступ 22.08.2026 |
| **itch.io** — то же | **Подтверждено, и это важнее, чем звучит.** itch.io **не задаёт и не гарантирует** лицензию: «You will always fully own your content», площадка запрашивает лишь минимальные права на хостинг и показ страниц, а условия устанавливает сам автор. То есть на itch.io «CC0» — это утверждение продавца, за которое площадка не отвечает | [itch.io/docs/creators/faq](https://itch.io/docs/creators/faq), доступ 22.08.2026 |
| **Google Fonts** — «почти все под Apache/OFL, безопасны для коммерции» | **Подтверждено, но лицензий три, а не две, и есть условия** | [github.com/google/fonts](https://raw.githubusercontent.com/google/fonts/main/README.md), доступ 22.08.2026: «Most of the fonts in the collection use the SIL Open Font License, v1.1. Some fonts use the Apache 2 license. **The Ubuntu fonts use the Ubuntu Font License v1.0**». Оттуда же прямое предупреждение: «**It is important to always read the license for every font that you use**» и «The SIL Open Font License has an option for copyright holders to include a **Reserved Font Name** requirement, and this option is used with some of the fonts» |
| **Epidemic Sound** — «нужна именно коммерческая подписка, не личная» | **НЕ ПРОВЕРЕНО.** Лицензионные страницы Epidemic Sound по всем испробованным адресам отдали 404 или редирект в справочный центр без содержательного текста. **Утверждение не подтверждено и не опровергнуто** | источник не найден |
| **Собственная запись** | Подтверждается как вариант, но имеет собственный риск — см. 6.4 | — |

### 6.2 Чего в чек-листе нет: CC0 закрывает не всё

Самая недооценённая строчка во всём разделе. CC0 отказывается от авторских прав — **и только от них**. Текст лицензии, [creativecommons.org/publicdomain/zero/1.0/legalcode.en](https://creativecommons.org/publicdomain/zero/1.0/legalcode.en), доступ 22.08.2026:

> «**No trademark or patent rights held by Affirmer are waived**, abandoned, surrendered, licensed or otherwise affected by this document.»

> «Affirmer offers the Work as-is and makes no representations or warranties of any kind concerning the Work… **Affirmer disclaims responsibility for clearing rights of other persons that may apply to the Work.**»

Два практических следствия:

1. **CC0-ассет с чужим логотипом или узнаваемым брендом остаётся проблемой** — товарные знаки лицензией не затронуты. Для игры про еду это не абстракция: упаковки, вывески, этикетки в фоне.
2. **Автор CC0-ассета не гарантирует, что права третьих лиц очищены.** Если он сам взял что-то чужое и выложил под CC0, ответственность не переносится на него автоматически. Отсюда — рекомендация чек-листа сохранять скриншот страницы лицензии на дату скачивания **верна, но недостаточна**: скриншот доказывает добросовестность, а не чистоту прав.

### 6.3 OFL 1.1 — три условия, которые надо соблюсти

[openfontlicense.org/open-font-license-official-text/](https://openfontlicense.org/open-font-license-official-text/), доступ 22.08.2026:

| Условие | Точная формулировка | Что делать в игре |
|---|---|---|
| Встраивание разрешено, но с уведомлением | «Original or Modified Versions of the Font Software may be **bundled, redistributed and/or sold with any software**, provided that each copy contains **the above copyright notice and this license**» | Положить текст лицензии и copyright в приложение (экран «Лицензии» или файл в бандле) |
| Reserved Font Name | «No Modified Version of the Font Software may use the Reserved Font Name(s) unless explicit written permission is granted» | **Если шрифт правится** (а для игрового UI это частое дело — подрезать глифы, изменить метрики) — переименовать файл и семейство |
| Нельзя продавать шрифт отдельно | «Neither the Font Software nor any of its individual components… **may be sold by itself**» | Не касается игры: шрифт идёт внутри продукта, а не как товар |

Уведомление можно оформить «either as stand-alone text files, human-readable headers or in the appropriate machine-readable metadata fields… as long as those fields can be easily viewed by the user» — то есть экран «О программе → Лицензии» этому удовлетворяет. Apache 2.0 требует похожего (сохранение NOTICE), поэтому один общий экран закрывает оба случая.

### 6.4 Звук: где именно дорого ошибиться

**Freesound** — годится, но лицензии там разные, и одна из них ловушка. [freesound.org/help/faq/](https://freesound.org/help/faq/), доступ 22.08.2026:

| Лицензия на Freesound | Годится для коммерческой игры? |
|---|---|
| **CC0** | Да, без атрибуции |
| **CC-BY** | Да, **но с обязательной атрибуцией** — нужен экран credits |
| **CC-BY-NC** | **Нет.** «you can't earn any money with the piece of work you create» — платная игра или игра с покупками это нарушает |
| **Sampling+** (устаревшая, встречается на старых загрузках) | **Нет** для коммерции; дополнительно запрещает использование в рекламе |

**Это ровно тот случай, где ошибка тихая:** CC-BY-NC-файл ничем не отличается от CC0-файла на слух, разница видна только в метаданных страницы. Для игры, где сотни звуковых сэмплов, нужен не «проверить при скачивании», а **реестр**: файл → источник → лицензия → дата → ссылка. Заводить его надо с первого сэмпла, а не когда их станет двести.

**Собственная запись на улице — отдельный риск, которого чек-лист не называет.** Запись уличной еды в реальной макашнице почти наверняка захватит фоновую музыку из соседнего заведения или с проезжающего мопеда. Это чужая фонограмма в вашем миксе, и статус «я записал это сам» её не отмывает. Практика простая: писать точечно и близко к источнику (шкварчание, скрип теста, звон лопатки), а атмосферу — отдельными дублями в моменты без музыки, и прослушивать дубли на постороннюю музыку до того, как они попадут в сборку.

**Epidemic Sound — незакрытый вопрос, и он важнее остальных.** Проверить не удалось (см. таблицу). Существенно вот что: подписочные музыкальные сервисы традиционно продают лицензию под видеоконтент и соцсети, а **синхронизация в игру или приложение** часто идёт отдельным продуктом либо запрещена. Второй вопрос того же порядка — **что происходит с уже выпущенной игрой после отмены подписки**: если права не перпетуальные, отмена подписки означает, что игра в сторе становится нарушением. **До ответа на оба вопроса Epidemic Sound в план ставить нельзя** — не потому, что он плох, а потому, что цена ошибки здесь равна отзыву релиза.

### 6.5 Что добавить в чек-лист

- CC0 не отказывается от товарных знаков и не гарантирует чистоту прав третьих лиц;
- itch.io лицензию не гарантирует — за неё отвечает автор пака;
- у Google Fonts три лицензии, а не две; при модификации шрифта с Reserved Font Name его надо переименовать; нужен экран «Лицензии» в приложении;
- **CC-BY-NC на Freesound не годится для коммерческой игры** — вынести отдельной строкой, это самая частая ошибка;
- завести реестр ассетов «файл → источник → лицензия → дата → ссылка» с первого сэмпла;
- при собственной записи на улице проверять дубли на фоновую чужую музыку;
- **перед выбором музыкального стока выяснить два вопроса: покрывает ли лицензия использование внутри приложения и остаются ли права после отмены подписки.**

---

## 7. Что из этого касается обеих игр

**Общее для «Лягушки» и Roti Stand** (правки идут в `../Game/gamedev-tools-checklist.md`):

- цены и сборы Apple / Google Play — подтверждены;
- Xcode 26 / SDK 26, targetSdk 36, Play Billing 8 — подтверждены с уточнениями;
- 12 тестировщиков / 14 дней — подтверждено; для «Лягушки» это уже учтено в `../night-skip/DECISION.md`;
- **IARC — исправить: у Apple собственная система**, и она сменилась в 2026;
- политика конфиденциальности и ATT — подтверждены с оговоркой про сторонние SDK;
- публичность имени и адреса разработчика — добавить;
- Android Developer Verification (сентябрь 2026, Таиланд) — добавить;
- DSA trader status для ЕС и privacy manifest — добавить, обоих пунктов в чек-листе нет;
- **лицензии — весь раздел 6.** Оговорка про CC0 и товарные знаки, «itch.io ничего не гарантирует», три лицензии Google Fonts вместо двух, экран «Лицензии» в приложении и **запрет CC-BY-NC для коммерции** касаются обеих игр одинаково;
- **незакрытый вопрос по Epidemic Sound** — общий: пока не выяснено, покрывает ли подписка использование внутри приложения и остаются ли права после её отмены, ставить сервис в план нельзя ни в одной из игр.

**Только Roti Stand:**

- всё по `Touch.force` / `radiusX` (у «Лягушки» механика на этом не стоит; но довод против Godot в `../night-skip/DECISION.md` стоит перечитать — он ссылался на давление касания);
- всё по режиму подброса и его юридической части;
- культурные и товарно-знаковые риски раздела 5.

**Только «Лягушка»:** ничего нового этим ревью не найдено. Пункт чек-листа про EULA с disclaimer для неё корректно помечен как неактуальный (наклон удалён).
