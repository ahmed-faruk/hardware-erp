# ابدأ من هنا — دليل خطوة بخطوة

الدليل ده للي عمره ما بنى برنامج قبل كده. امشي بالترتيب، ومتنقلش لخطوة قبل ما اللي قبلها تخلص.

## 1. الملفات دي إيه

انت مش محتاج تقرا ولا تعدّل أي ملف منهم. دول تعليمات مكتوبة لـ Claude، وشغلتك إنك تحطهم في مكان المشروع مرة واحدة (الخطوة 5)، وClaude هيقراهم لوحده في كل جلسة.

| الملف | ده إيه | مين بيستخدمه |
| --- | --- | --- |
| `CLAUDE.md` + `AGENTS.md` | قواعد الشغل: إزاي يكتب الكود، إيه الممنوع، إزاي يوفر في الرصيد | Claude، أول كل جلسة |
| `docs/PRD.md` | إيه اللي هنبنيه في الـ MVP ومين هيستخدمه | Claude |
| `docs/DESIGN_SYSTEM.md` | شكل الشاشات: الألوان والأيقونات والمقاسات | Claude |
| `docs/ARCHITECTURE.md` | تركيب النظام وأماكن الفولدرات | Claude |
| `docs/DATABASE.md` | الجداول وكل عمود فيها | Claude |
| `docs/API.md` | طرق تواصل البرنامج مع السحابة | Claude |
| `docs/SECURITY.md` | قواعد الأمان وحماية البيانات | Claude |
| `docs/CODE_STYLE.md` | طريقة كتابة الكود وتسمية الحاجات | Claude |
| `docs/costs.md` | جدول تكتب فيه تكلفة كل جلسة | انت |
| `docs/reference/` | النسخ العربي الكاملة من وثيقة المتطلبات والخطة | انت (للقراية) |
| `.claude/skills/` | الـ 8 skills: خبرات متخصصة بيفتحها Claude وقت الحاجة | Claude |
| `tools/ospos-export/export.js` | السكربت اللي سحب بيانات OpenSourcePOS | Claude يوم التحويل |
| `.gitignore` و`.env.example` | قائمة الملفات الممنوع رفعها، وأسماء الإعدادات | Claude وGitHub |
| ملفات zip المنفصلة للـ skills | نسخة للرفع على claude.ai | اختياري، مش لازم |

## 2. نقل البيانات من OpenSourcePOS

البيانات اتسحبت كلها النهارده من غير زرار النسخ الاحتياطي ومن غير phpMyAdmin. لقيت OpenSourcePOS مفتوح ومسجّل دخول في Chrome بتاعك، فشغّلت سكربت بيقرا شاشات وتقارير البرنامج نفسه (قراءة فقط، ما عدّلش أي حاجة) لمدة حوالي 15 دقيقة، ومن غير أي خطأ.

| البيانات | العدد |
| --- | --- |
| الأصناف (مع الكميات وحد الطلب) | 1,406 |
| العملاء / الموردون / الموظفون | 36 / 37 / 3 |
| فواتير البيع من يونيو 2017 | 63,049 |
| فواتير المرتجع | 5,455 |
| سطور الأصناف في الفواتير | 324,602 |
| فواتير الشراء وسطورها | 5,343 فاتورة، 23,740 سطر |
| المصروفات | 6,026 |
| حجم الملف | حوالي 58 ميجابايت |

### 2.1 حاجات لقيتها في البيانات ومهمة

- **ولا فاتورة آجل اتسجلت في OpenSourcePOS** (كل الفواتير تقريباً نقدي، و3 بطاقة). يعني أرصدة الآجل الحالية للعملاء والموردين مش موجودة في أي مكان؛ هتكتبها انت مرة واحدة في ملف Excel يوم التحويل.
- **ولا صنف عليه صورة.** الشاشة هتظهر أيقونة الفئة ولونها والكود لحد ما تصوّر الأصناف؛ ابدأ بأكتر 100 صنف بيتباعوا.
- **130 صنف من غير باركود.** دول هيتباعوا من الصور أو البحث، أو تطبعلهم ملصقات باركود بعدين.
- مبيعات 2025 حوالي 3.14 مليون جنيه، والنظام الجديد مصمم على حجم شغل أكبر من كده بكتير.

### 2.2 المطلوب منك

1. **وافق في المحادثة** إني أنزّل الملف (`ospos-export-2026-10-09.json`، حوالي 58 ميجابايت) على الماك في Downloads. الملف موجود دلوقتي في تاب OpenSourcePOS اللي فتحته في Chrome؛ ما تقفلوش قبل التنزيل.
2. بعد التنزيل حطه في `migration-data` (الخطوة 5-د).
3. **غيّر باسورد OpenSourcePOS** لأنه اتكتب في المحادثة.
4. يوم التحويل السكربت يتشغل مرة أخيرة علشان آخر مبيعات.

## 3. الحسابات المطلوبة

3 حسابات مجانية، كلهم من غير كارت بنكي. اعملهم بنفسك (أنا ممنوع أعمل حسابات أو أكتب كلمات سر)، واحفظ كل كلمة سر في مكان آمن زي Passwords على الماك. فعّل التحقق بخطوتين (2FA) في التلاتة.

| الحساب | الرابط | تعمل فيه إيه | تحتفظ بإيه |
| --- | --- | --- | --- |
| GitHub | [github.com/signup](https://github.com/signup) | مكان حفظ الكود، وهو اللي بيشغّل الاختبارات والنشر | اسم المستخدم |
| Cloudflare | [dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up) | استضافة البرنامج على الإنترنت | Account ID وAPI Token (الخطوة 6) |
| Supabase | [supabase.com/dashboard](https://supabase.com/dashboard) (ادخل بحساب GitHub) | قاعدة البيانات السحابية | لكل مشروع: Project ref، URL، المفتاح العام، كلمة سر القاعدة |

### 3.1 جوه Supabase

1. **New project** ← الاسم `hanafy-staging` ← Region: **Central EU (Frankfurt)** ← اكتب كلمة سر قوية للقاعدة واحفظها ← Create.
2. كرر نفس الخطوة لمشروع تاني باسم `hanafy-production`.
3. لكل مشروع افتح **Project Settings**: هتلاقي الـ **Project ref** (حروف وأرقام في الرابط)، والـ **Project URL**، والمفتاح العام (اسمه anon أو publishable). المفتاح المكتوب عليه **secret** أو **service\_role** ما تحطوش في أي حتة؛ Claude هيطلبه منك مرة واحدة بس يوم نقل البيانات، في ملف على الماك مش بيترفع.
4. من صورتك فوق ← **Account ← Access Tokens ← Generate new token** باسم `github-actions`، واحفظه.

### 3.2 جوه Cloudflare

1. **Workers & Pages ← Create ← Pages ← Upload assets** ← اسم المشروع `hanafy-pos` ← ارفع أي ملف صغير مؤقت علشان المشروع يتعمل (Claude هيستبدله).
2. انسخ **Account ID** من الصفحة الرئيسية للحساب (على اليمين).
3. **My Profile ← API Tokens ← Create Token ← Create Custom Token**: الصلاحية **Account ← Cloudflare Pages ← Edit** ← Create، واحفظ الـ token.

كل القيم دي هتحطها في GitHub في الخطوة 6، مش في أي ملف.

## 4. تجهيز الماك (مرة واحدة، حوالي ساعة)

نزّل وثبّت البرامج دي بالترتيب. كل برنامج له زرار Download واضح في موقعه.

1. **VS Code** من [code.visualstudio.com](https://code.visualstudio.com) ← افتح الملف ← اسحب البرنامج لـ Applications.
2. **Node.js** نسخة **LTS** من [nodejs.org](https://nodejs.org) ← افتح الملف وكمّل التثبيت.
3. **Docker Desktop** من [docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop/) ← اختار Mac (Apple Silicon لو الماك M1 أو أحدث) ← افتحه مرة ووافق على الشروط وسيبه شغال.
4. **Homebrew** (برنامج بيثبّت أدوات): افتح **Terminal** (اضغط Cmd+Space واكتب Terminal) والصق السطر ده واضغط Enter، واكتب كلمة سر الماك لما يطلبها:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

في الآخر هيكتب **Next steps** وتحتها سطرين؛ انسخهم والصقهم في Terminal واضغط Enter.

**5.** في نفس Terminal الصق السطر ده لتثبيت git وأداة GitHub وأداة Supabase:

```bash
brew install git gh supabase/tap/supabase
```

6. اربط الماك بحساب GitHub: اكتب `gh auth login` ← اختار **GitHub.com** ← **HTTPS** ← **Login with a web browser** ← انسخ الكود اللي هيظهر والصقه في المتصفح.
7. **إضافة Claude Code**: افتح VS Code ← اضغط **Cmd+Shift+X** ← اكتب **Claude Code** ← اختار اللي ناشرها **Anthropic** ← **Install** ← هتظهر أيقونة على شكل نجمة على الشمال ← اضغطها ← **Sign in** بحسابك اللي فيه الـ 100 دولار.

للتأكد إن كله تمام، الصق ده في Terminal؛ كل سطر لازم يطبع رقم إصدار، مش رسالة خطأ:

```bash
node -v && git --version && gh --version && supabase --version && docker --version
```

## 5. إنشاء المستودع ووضع الملفات فيه (10 دقايق)

«المستودع» هو فولدر المشروع على GitHub. هنعمله ونحط فيه الملفات بأوامر جاهزة؛ الصق كل مجموعة في Terminal واضغط Enter.

**أ. عرّف نفسك لـ git** (مرة واحدة، غيّر الاسم والإيميل):

```bash
git config --global user.name "Ahmed Faruk"
git config --global user.email "you@example.com"
```

**ب. اعمل المستودع الخاص وانسخه على الماك** في فولدر Documents:

```bash
cd ~/Documents
gh repo create hardware-erp --private --clone
```

**ج. فك ملف `hardware-erp-starter.zip`** جوه المستودع (افترضنا إنه في Downloads). الأمر ده بينقل كمان الملفات المخفية زي `.claude` اللي Finder ما بيظهرهاش:

```bash
unzip ~/Downloads/hardware-erp-starter.zip -d ~/Documents/hardware-erp
```

**د. حط ملف بيانات OpenSourcePOS** في فولدر `migration-data` (الفولدر ده ممنوع يترفع، والـ `.gitignore` بيمنعه لوحده):

```bash
mkdir -p ~/Documents/hardware-erp/migration-data
mv ~/Downloads/ospos-export-*.json ~/Documents/hardware-erp/migration-data/
```

**هـ. ارفع الملفات على GitHub:**

```bash
cd ~/Documents/hardware-erp
git add -A
git status
git commit -m "chore: project docs and skills"
git branch -M main
git push -u origin main
```

قبل `commit` بص على ناتج `git status`: لازم ما يظهرش فيه `migration-data`. لو ظهر، وقف واسأل.

**و. افتح المشروع في VS Code:** File ← Open Folder ← `Documents/hardware-erp` ← Open ← لو سألك «Do you trust the authors» اختار **Yes**.

## 6. أسرار GitHub (15 دقيقة)

GitHub محتاج القيم دي علشان ينشر البرنامج ويحدّث القاعدة لوحده. بتتحط مرة واحدة، ومحدش يقدر يقراها بعد كده، ولا حتى Claude.

افتح `github.com/<اسمك>/hardware-erp` ← **Settings ← Secrets and variables ← Actions**.

**تبويب Secrets ← New repository secret** (اسم + قيمة لكل سطر):

| الاسم | القيمة منين |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | الـ token من Cloudflare (3.2) |
| `CLOUDFLARE_ACCOUNT_ID` | Account ID من Cloudflare |
| `SUPABASE_ACCESS_TOKEN` | Access Token من Supabase (3.1) |
| `SUPABASE_PROJECT_REF_STAGING` | Project ref لمشروع hanafy-staging |
| `SUPABASE_PROJECT_REF_PROD` | Project ref لمشروع hanafy-production |
| `SUPABASE_DB_PASSWORD_STAGING` | كلمة سر قاعدة staging |
| `SUPABASE_DB_PASSWORD_PROD` | كلمة سر قاعدة production |
| `BACKUP_PASSPHRASE` | جملة سر طويلة تختارها انت لتشفير النسخ الاحتياطية — اكتبها في مكان آمن، من غيرها النسخ ما تتفتحش |

**تبويب Variables ← New repository variable** (دي قيم عامة مش سرية):

| الاسم | القيمة |
| --- | --- |
| `STAGING_SUPABASE_URL` | Project URL لـ staging |
| `STAGING_SUPABASE_ANON_KEY` | المفتاح العام (anon / publishable) لـ staging |
| `PROD_SUPABASE_URL` | Project URL لـ production |
| `PROD_SUPABASE_ANON_KEY` | المفتاح العام لـ production |
| `STAGING_URL` | سيبه فاضي دلوقتي؛ Claude هيقولك تكتب فيه إيه بعد أول نشر |

ما تبعتش ولا قيمة من دول في المحادثة مع Claude. لو Claude احتاج يتأكد، بيكفيه يشوف إن الاسم موجود.

## 7. أول جلسة مع Claude Code

الجلسة الأولى هدفها رابط شغال على الإنترنت فيه صفحة «تحت الإنشاء»، وكل الاختبارات الآلية مجهزة. سقفها 3 دولار.

**1.** في VS Code والمشروع مفتوح: اضغط **✻ Claude Code** تحت على اليمين (أو أيقونة النجمة) ← جلسة جديدة.

**2.** اكتب `/model` واختار **Sonnet**.

**3.** من القائمة تحت خانة الكتابة اختار **Plan mode**، علشان Claude يعرض خطته الأول قبل ما يكتب أي كود.

**4.** الصق الرسالة دي كما هي:

```text
اقرأ CLAUDE.md. المهمة: المرحلة 1 في docs/reference/mvp-plan.ar.md.
استخدم skill ci-cd-deploy: جهّز هيكل المشروع (Vite + React + TypeScript + PWA)،
وملفات ci.yml وdeploy.yml وnightly.yml، وصفحة واحدة مكتوب فيها «حنفي POS — تحت الإنشاء».
اسم مشروع Cloudflare Pages هو hanafy-pos.
معيار القبول: CI أخضر على Pull Request، وبعد الدمج رابط الإنتاج يفتح الصفحة.
اعرض الخطة الأول.
```

**5.** Claude هيعرض خطة. لو مفهومة وافق عليها. أثناء الشغل هيستأذنك قبل ما يشغّل أوامر؛ وافق على أوامر المشروع (npm، git، supabase). لو طلب حاجة مش مفهومة، اسأله «ليه؟» قبل ما توافق.

**6.** في الآخر هيعمل **Pull Request** على GitHub. افتحه من الرابط اللي هيديهولك، استنى العلامات تبقى خضرا ✓ (حوالي 10 دقايق)، واضغط **Merge pull request**.

**7.** بعد الدمج بحوالي 5 دقايق افتح `https://hanafy-pos.pages.dev` على الموبايل والكمبيوتر. لو الصفحة ظهرت، المرحلة 1 خلصت.

**8.** اكتب `/usage` وشوف التكلفة، وقول لـ Claude «سجّل تكلفة الجلسة دي في docs/costs.md: X دولار»، وبعدين اكتب `/clear`.

لو التكلفة عدّت 4.5 دولار (السقف 3 + 50%)، وقف وابعتلي قبل ما تكمل.

## 8. الروتين لكل مرحلة بعد كده

كل مرحلة من الـ 9 مراحل بتمشي بنفس الخطوات. الرسالة اللي تبدأ بيها كل مرحلة مكتوبة في جدول القسم 8.2 في تبويب خطة الـ MVP.

1. جلسة جديدة في VS Code ← `/model` ← **Sonnet** (المرحلة 3 بس: خطتها على **Opus** والتنفيذ على Sonnet).
2. **Plan mode** ← الصق رسالة المرحلة ← راجع الخطة ← وافق.
3. Claude يشتغل ويعمل Pull Request.
4. استنى العلامات الخضرا ✓ ← افتح **رابط المعاينة** اللي Cloudflare بيكتبه في الـ Pull Request ← جرّبه على الموبايل والكمبيوتر.
5. لو تمام: **Merge**. لو فيه مشكلة: اكتبها لـ Claude في نفس الجلسة بكلامك العادي.
6. `/usage` ← سجّل التكلفة ← `/clear`.

حاجات بتمشي لوحدها من غير ما تعمل حاجة: الاختبارات الليلية، والنسخة الاحتياطية الليلية للقاعدة. مرة في الأسبوع افتح تبويب **Actions** في GitHub؛ لو لقيت حاجة حمرا ✗، افتح جلسة وقول لـ Claude «اختبار nightly فشل، صلّحه».

**جلسات لازم تكون من الماك:** المرحلة 3 (محتاجة Docker)، والمرحلة 4 (فيها بيانات العملاء)، والمرحلة 9. باقي المراحل ينفع تشتغلها كمان من [claude.ai/code](https://claude.ai/code) على الويب بعد ما تختار مستودع hardware-erp.

## 9. لو حاجة وقفت معاك

| اللي ظهر قدامك | تعمل إيه |
| --- | --- |
| `command not found: brew` | شغّل سطرين **Next steps** اللي ظهروا بعد تثبيت Homebrew، أو اقفل Terminal وافتحه تاني |
| `Cannot connect to the Docker daemon` | افتح Docker Desktop واستنى لحد ما أيقونة الحوت فوق تثبت |
| `git push` بيطلب باسورد | شغّل `gh auth login` تاني |
| علامة حمرا ✗ في الـ Pull Request | اضغط **Details** ← انسخ آخر سطور الخطأ ← الصقها لـ Claude: «صلّح فشل CI ده» |
| Claude بيطلب منك باسورد أو مفتاح | ما تلصقوش في المحادثة؛ حطه في GitHub Secrets (الخطوة 6) أو في ملف `.env.local` بنفسك |
| التكلفة بتزيد بسرعة | `/usage` ← `/clear` ← جلسة جديدة بمهمة أصغر وأوضح |
| الرابط مش بيظهر آخر تعديل | البرنامج هيظهر «تحديث متاح»؛ اضغطه، أو اعمل تحديث للصفحة |
| رسالة إن حد الاستخدام خلص | استنى الوقت اللي مكتوب في الرسالة، أو راجع رصيدك من `/usage` |
| مش فاهم Claude بيعمل إيه | اكتبله «اشرحلي اللي بتعمله بكلام بسيط من غير مصطلحات» |
