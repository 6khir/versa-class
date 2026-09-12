(() => {
  'use strict';

  const api = window.tptDesktop;
  const aboutDialog = document.getElementById('about-dialog');
  const aboutContent = document.getElementById('about-content');
  const guideDialog = document.getElementById('how-it-works-dialog');
  const guideMain = document.getElementById('guide-main');
  const scenarioList = document.getElementById('guide-scenario-list');
  const printDocument = document.getElementById('guide-print-document');
  const progressFill = document.getElementById('guide-progress-fill');
  const progressValue = document.getElementById('guide-progress-value');
  const progressKicker = document.getElementById('guide-progress-kicker');
  const downloadLabel = document.getElementById('guide-download-label');

  let aboutLanguage = 'en';
  let guideLanguage = 'en';
  let activeScenario = 0;

  const text = (language, darija, english) => language === 'darija' ? darija : english;

  const scenarios = [
    {
      id: 'orientation', icon: '⌂', scene: 'orientation',
      title: { darija: 'تعرّف على الواجهة', en: 'Meet the workspace' },
      lead: {
        darija: 'الواجهة مقسومة بطريقة بسيطة: الهيدر للحساب والمتصفح والمساعدة، الشريط الجانبي للمشاريع، والوسط فيه مراحل خدمة الكتاب الحالي.',
        en: 'The app is organized into a header for account, browser, and help; a project sidebar; and a central workspace for every stage of the current book.'
      },
      steps: {
        darija: ['راقب حالة Browser فالهيدر قبل ما تبدا.', 'اختار مشروع من Book projects أو دير New book.', 'تنقّل بين Overview والمراحل الستة من داخل المشروع.'],
        en: ['Check Browser status in the header before starting.', 'Choose a saved project or select New book.', 'Move between Overview and the six project stages.']
      },
      tip: { darija: 'كل مشروع والطابور ديالو كيتحفظو محلياً فالجهاز، وتقدر ترجع تكمل منين وقفتي.', en: 'Every project and its queue are saved locally, so you can safely continue where you stopped.' }
    },
    {
      id: 'connection', icon: '◎', scene: 'connection',
      title: { darija: 'ربط Gemini والإعدادات', en: 'Connect Gemini and settings' },
      lead: {
        darija: 'الأداة كتستعمل الجلسة ديالك فـ Gemini بطريقة محلية. Manage Gemini login كيفتح نافذة الربط، وProfile كيجمع الهوية وإعدادات TPT والـworkflow.',
        en: 'The tool uses your Gemini session locally. Manage Gemini login opens the connection flow, while Profile stores identity, TPT defaults, and workflow preferences.'
      },
      steps: {
        darija: ['كليك على Manage Gemini login وسجّل الدخول.', 'رجع للتطبيق ودير Verify again حتى تبان Connected.', 'عمّر اسم المؤلف، حقوق النشر، وإعدادات TPT الافتراضية.'],
        en: ['Select Manage Gemini login and sign in.', 'Return and verify until the connection shows Connected.', 'Complete author, copyright, and default TPT settings.']
      },
      tip: { darija: 'الأداة ما كتطلبش API key وما كترسلش المشاريع لسيرفر خارجي ديال التطبيق.', en: 'The app does not require an API key or send projects to an external app server.' }
    },
    {
      id: 'new-book', icon: '＋', scene: 'new-book',
      title: { darija: 'إنشاء كتاب جديد', en: 'Create a new book' },
      lead: {
        darija: 'عندك ثلاثة مسارات: لصق prompts واجدين، بناء فكرة منتوج تعليمي، أو إنشاء storybook كامل بالنص والشخصيات.',
        en: 'Start in one of three ways: paste ready prompts, build an educational product concept, or create a complete storybook with text and characters.'
      },
      steps: {
        darija: ['دير New book واختار الطريقة المناسبة.', 'حدد المقاس والاتجاه وعدد الصفحات.', 'راجع المعلومات قبل إنشاء المشروع.'],
        en: ['Select New book and choose a creation method.', 'Set page size, orientation, and page count.', 'Review the inputs before creating the project.']
      },
      tip: { darija: 'US Letter هو الاختيار الشائع فـTPT، ولكن A4 وSquare وPoster حتى هما مدعومين.', en: 'US Letter is common on TPT, while A4, Square, Poster, and other formats are also supported.' }
    },
    {
      id: 'planning', icon: '✦', scene: 'planning',
      title: { darija: 'الفكرة، الـprompts والـstorybook', en: 'Concepts, prompts, and storybooks' },
      lead: {
        darija: 'Product Builder كينظم الفكرة حسب العمر والهدف والنوع، وPrompt Builder كيحوّلها لصفحات مرتّبة. Storybook كيزيد blueprint، النص الدقيق، الغلاف، والشخصيات الثابتة.',
        en: 'Product Builder structures age, purpose, and product type, then Prompt Builder turns the concept into ordered pages. Storybook adds a blueprint, exact text, covers, and consistent characters.'
      },
      steps: {
        darija: ['زيد معلومات الفكرة باستعمال الاختيارات والحقول.', 'راجع تحليل المنتوج والعناوين المقترحة.', 'ولّد prompts؛ كل Prompt كيولي صفحة بنفس الترتيب.'],
        en: ['Add concept details with the pickers and text fields.', 'Review the product analysis and suggested title.', 'Generate prompts; each prompt becomes one ordered page.']
      },
      tip: { darija: 'فـstorybook راجع النص حرف بحرف قبل Phase 2، حيث هو اللي غادي يبان فالصفحات.', en: 'For storybooks, review the exact text before Phase 2 because that is what appears on the pages.' }
    },
    {
      id: 'overview', icon: '▦', scene: 'overview',
      title: { darija: 'لوحة المشروع ومراحل الخدمة', en: 'Project dashboard and stages' },
      lead: {
        darija: 'Overview كيعطيك الحالة الكاملة فلقطة وحدة: الشخصيات، صفحات الداخل، listing، الصور المصغّرة، والتصدير. كل كارت كيدخلك مباشرة للمرحلة ديالو.',
        en: 'Overview shows the entire product at a glance: characters, interior pages, listing, thumbnails, and export. Each card opens its stage directly.'
      },
      steps: {
        darija: ['شوف النسبة العامة وعدد الصفحات الباقية.', 'كليك على أي كارت باش تمشي للمرحلة ديالو.', 'استعمل Current lock باش تعرف علاش المرحلة الموالية مازال مسدودة.'],
        en: ['Check overall progress and remaining pages.', 'Select any stage card to open that workspace.', 'Use Current lock to see why a later stage is unavailable.']
      },
      tip: { darija: 'المراحل كتتحل بالتسلسل باش ما يتصدرش أو يترفع منتوج ناقص.', en: 'Stages unlock in sequence to prevent exporting or uploading an incomplete product.' }
    },
    {
      id: 'characters', icon: '♙', scene: 'characters',
      title: { darija: 'الشخصيات المتناسقة', en: 'Consistent characters' },
      lead: {
        darija: 'فكتب الأطفال، التطبيق كيخلق Character Reference Sheet لكل شخصية رئيسية قبل الصفحات باش يبقى الوجه واللباس والألوان متناسقين.',
        en: 'For children’s books, the app creates a reference sheet for each main character before page generation to keep faces, clothing, and colors consistent.'
      },
      steps: {
        darija: ['راجع وصف كل شخصية والـprompt الكامل.', 'ولّد الـreference sheet أو عاود الشخصية بوحدها.', 'تأكد أن جميع الشخصيات Ready قبل interior.'],
        en: ['Review each character description and full prompt.', 'Generate or regenerate one reference sheet at a time.', 'Confirm every character is Ready before the interior.']
      },
      tip: { darija: 'الصورة المرجعية كترافق prompts ديال الصفحات آلياً؛ ما خاصكش تعاود ترفعها كل مرة.', en: 'Reference images are attached to page prompts automatically; you do not need to upload them repeatedly.' }
    },
    {
      id: 'generation', icon: '▶', scene: 'generation',
      title: { darija: 'تشغيل طابور الصفحات', en: 'Run the page queue' },
      lead: {
        darija: 'Run / Resume كيشغل الصفحات وحدة بوحدة بنفس الترتيب. كل صفحة كتدوز من Preparing حتى Complete، والفشل كيبقى فبلاصتو باش يتعاود بلا ما يتخلط الكتاب.',
        en: 'Run / Resume processes pages one by one in order. Each page moves from Preparing to Complete, and failures stay in their original slot for safe retry.'
      },
      steps: {
        darija: ['تأكد أن Browser online ومن بعد دير Run / Resume.', 'راقب الحالة والـheartbeat والنسبة.', 'استعمل Pause safely قبل ما تسد التطبيق أو تحتاج توقف.'],
        en: ['Confirm Browser online, then select Run / Resume.', 'Watch status, heartbeat, and progress.', 'Use Pause safely before closing or taking a break.']
      },
      tip: { darija: 'إلى وصل Gemini للـusage limit، المشروع كيتوقف بأمان وتقدر ترجع Resume من بعد.', en: 'If Gemini reaches a usage limit, the project pauses safely and can be resumed later.' }
    },
    {
      id: 'review-edit', icon: '✎', scene: 'review-edit',
      title: { darija: 'مراجعة وتعديل كل صفحة', en: 'Review and edit every page' },
      lead: {
        darija: 'اختار أي صفحة باش تشوف الصورة والـprompt والحالة. تقدر تكبّر، تعدّل بتعليمة جديدة، تعاود التوليد، تستورد صورة، أو تصلح zoom وcrop.',
        en: 'Select any page to inspect its image, prompt, and status. You can preview, edit with an instruction, regenerate, import an image, or adjust zoom and crop.'
      },
      steps: {
        darija: ['فتح الصورة بالحجم الكبير وراجع النص والحواف.', 'استعمل Edit لتغيير محدد أو Regenerate لنسخة جديدة.', 'صلّح Zoom & Crop وخزّن الصفحة فـنفس الرقم.'],
        en: ['Open the large preview and inspect text and edges.', 'Use Edit for a specific change or Regenerate for a new result.', 'Adjust Zoom & Crop; the page stays in the same numbered slot.']
      },
      tip: { darija: 'Import image مفيد إلى صلحت الصفحة فبرنامج خارجي وبغيتي ترجعها لنفس المكان.', en: 'Import image is useful when you fix a page externally and want it returned to the same slot.' }
    },
    {
      id: 'listing', icon: '≡', scene: 'listing',
      title: { darija: 'إنشاء SEO', en: 'Generate best-seller SEO' },
      lead: {
        darija: 'منين يكمل الداخل، Generate SEO كيحلل وثيقة الكتاب وكيكتب العنوان والوصف والـtags فكتلة وحدة واضحة.',
        en: 'When the interior is complete, Generate SEO reads the book document and writes title, description, and tags into one clear copy block.'
      },
      steps: {
        darija: ['كمّل الصفحات أولاً.', 'ولّد SEO وراجع TITLE / DESCRIPTION / TAGS.', 'Copier أو Save قبل ما تكمّل باقي المراحل.'],
        en: ['Finish pages first.', 'Generate SEO and review TITLE / DESCRIPTION / TAGS.', 'Copy or Save before you finish the other stages.']
      },
      tip: { darija: 'راجع العنوان والوصف يدوياً؛ الأداة كيساعد ولكن القرار التجاري الأخير ديالك.', en: 'Review the title and description manually; the studio assists, but the final commercial decision is yours.' }
    },
    {
      id: 'thumbnails', icon: '▧', scene: 'thumbnails',
      title: { darija: 'الغلاف وThumbnails', en: 'Cover and thumbnails' },
      lead: {
        darija: 'الأداة كتجهز Main Cover وحتى ثلاثة optional thumbnails. فـManual كتراجعهم وتحملهم، وAuto أو Upload Later يقدر يخدم بلا slots محلية حسب اختيارك.',
        en: 'The app prepares one Main Cover and up to three optional thumbnails. Manual mode saves them locally, while Auto or Upload Later follows the selected workflow.'
      },
      steps: {
        darija: ['اختار Thumbnail mode من الإعدادات أو listing.', 'ولّد الأربع صور وراجع الرسالة ديال كل وحدة.', 'Preview أو Regenerate غير الصورة اللي ما عجباتكش.'],
        en: ['Choose a thumbnail mode in settings or listing.', 'Generate the four images and review each result.', 'Preview or regenerate only the image that needs work.']
      },
      tip: { darija: 'Main Cover هي الصورة الإلزامية فـManual؛ الصور الثلاثة الباقية اختيارية.', en: 'The Main Cover is required in Manual mode; the remaining three images are optional.' }
    },
    {
      id: 'export', icon: '↓', scene: 'export',
      title: { darija: 'تصدير PDF وZIP والملفات', en: 'Export PDF, ZIP, and files' },
      lead: {
        darija: 'Export & upload كيعطيك PDF جاهز للبيع، ZIP ديال الصور، أو All files. وتقدر تختار ترتيب عادي أو Booklet Saddle Stitch للطباعة المطوية.',
        en: 'Export & upload creates a sale-ready PDF, a ZIP of images, or the full file package. Choose normal page order or Booklet Saddle Stitch imposition.'
      },
      steps: {
        darija: ['تأكد أن جميع الصفحات Complete.', 'اختار Standard أو Booklet حسب الاستعمال.', 'صدّر PDF/ZIP أو All files وافتح Output folder.'],
        en: ['Confirm every page is Complete.', 'Choose Standard or Booklet for the intended use.', 'Export PDF, ZIP, or All files and open the output folder.']
      },
      tip: { darija: 'Standard مناسب للمنتوج الرقمي وTPT؛ Booklet مناسب للطباعة والطي والتدبيس.', en: 'Standard is ideal for digital products and TPT; Booklet is for folded, saddle-stitched printing.' }
    },
    {
      id: 'upload', icon: '↗', scene: 'export',
      title: { darija: 'التصدير بعد SEO', en: 'Export after SEO' },
      lead: {
        darija: 'الرفع الأوتوماتيكي لـ TPT ما بقاش فالأستوديو. بعد SEO، صدّر PDF / ZIP / PPTX وكمّل النشر يدوياً إلا بغيتي.',
        en: 'Automatic TPT upload is no longer part of this studio. After SEO, export PDF / ZIP / PPTX and publish manually if you want.'
      },
      steps: {
        darija: ['كمّل الصفحات والـSEO.', 'صدّر الملفات من Export.', 'Copier نص SEO من كتلة TITLE / DESCRIPTION / TAGS.'],
        en: ['Finish pages and SEO.', 'Export files from Export.', 'Copy SEO from the TITLE / DESCRIPTION / TAGS block.']
      },
      tip: { darija: 'SEO هو آخر مرحلة فالسير؛ التصدير كيبقا متاح منين الصفحات تكمّل.', en: 'SEO is the last studio stage; export stays available once pages are complete.' }
    },
    {
      id: 'bundle', icon: '⚡', scene: 'export',
      title: { darija: 'تصدير عدة كتب', en: 'Export multiple books' },
      lead: {
        darija: 'Bundle Upload لـ TPT تحيّد. صدّر كل كتاب من Export بعد ما يكمّل.',
        en: 'TPT Bundle Upload was removed. Export each finished book from Export.'
      },
      steps: {
        darija: ['كمّل كل كتاب.', 'ولّد SEO إلا بغيتي.', 'صدّر الملفات من Export.'],
        en: ['Finish each book.', 'Generate SEO if you want.', 'Export files from Export.']
      },
      tip: { darija: 'نص SEO كيتCopى من كتلة وحدة فمرحلة SEO.', en: 'SEO copy lives in one labeled block on the SEO stage.' }
    },
    {
      id: 'automation', icon: '↻', scene: 'automation',
      title: { darija: 'الأتمتة، التوقف والاسترجاع', en: 'Automation, pauses, and recovery' },
      lead: {
        darija: 'Automation Pipeline تقدر تخلي كل مرحلة Auto أو Ask أو Manual. التنبيهات كتعلمك بالنجاح أو الخطأ، وReset incomplete وResume كيعالجو التوقف بلا ضياع الخدمة.',
        en: 'Automation Pipeline can set every stage to Auto, Ask, or Manual. Notifications report success or errors, while Reset incomplete and Resume recover work without losing progress.'
      },
      steps: {
        darija: ['حدد Auto/Ask/Manual لكل مرحلة فـSettings.', 'استعمل Pause safely وما تسدش المتصفح وسط توليد صفحة.', 'عند الخطأ، قرا الرسالة، صلح السبب، ودير Retry أو Resume.'],
        en: ['Choose Auto, Ask, or Manual for every stage in Settings.', 'Use Pause safely and avoid closing the browser mid-page.', 'On error, read the message, fix the cause, then Retry or Resume.']
      },
      tip: { darija: 'تقدر تختار Do Nothing أو Sleep PC أو Shutdown PC منين تكمل الأتمتة، وكاين countdown للإلغاء.', en: 'After automation, choose Do Nothing, Sleep PC, or Shutdown PC; a countdown lets you cancel.' }
    }
  ];

  function renderAbout() {
    aboutContent.dir = 'ltr';
    aboutContent.innerHTML = `
      <article class="about-sheet">
        <img class="about-cover" src="../assets/brand/versa-class-cover.jpg" alt="VERSA CLASS">
        <div class="about-copy">
          <img class="about-copy-logo" src="../assets/brand/versa-class-logo.png" alt="VERSA CLASS">
          <span class="about-kicker">Makes Success</span>
          <h3>VERSA CLASS</h3>
          <p class="about-intro">A developed software to help teachers and parents make valuable teaching materials in a few minutes.</p>
          <p class="about-credits">Credits go to <strong>Said Moutafattin</strong>, the founder of the first software version.</p>
        </div>
      </article>
      <footer class="about-copyright"><span><strong>© 2026 VERSA CLASS.</strong> All rights reserved.</span></footer>`;
  }

  function mockSidebar(active, language) {
    const items = [
      ['overview', '▦', text(language, 'نظرة عامة', 'Overview')],
      ['characters', '♙', text(language, 'الشخصيات', 'Characters')],
      ['interior', '▤', text(language, 'داخل الكتاب', 'Book interior')],
      ['listing', '≡', text(language, 'SEO', 'SEO')],
      ['export', '↗', text(language, 'التصدير والرفع', 'Export & upload')]
    ];
    return `<aside class="guide-mock-sidebar">${items.map(([id, icon, label]) => `<div class="guide-mock-nav ${active === id ? 'is-active' : ''}"><b>${icon}</b><span>${label}</span></div>`).join('')}</aside>`;
  }

  function demoButton(label, messageDarija, messageEnglish, extra = '') {
    return `<button class="guide-demo-button ${extra}" data-guide-demo data-demo-darija="${messageDarija}" data-demo-en="${messageEnglish}" type="button">${label}</button>`;
  }

  function shellFrame(inner, active, language) {
    return `<div class="guide-scene-window">
      <div class="guide-scene-topbar"><div class="guide-scene-brand"><img src="../assets/brand/versa-monogram.png" alt=""><span>VERSA CLASS</span></div><div class="guide-window-dots"><i></i><i></i><i></i></div></div>
      <div class="guide-scene-body">${mockSidebar(active, language)}<section class="guide-scene-content">${inner}</section></div>
    </div>`;
  }

  function sceneTitle(kicker, title, action = '') {
    return `<div class="guide-mock-title"><div><span>${kicker}</span><strong>${title}</strong></div>${action}</div>`;
  }

  function renderScene(scene, language) {
    const d = language === 'darija';
    const feedback = `<div class="guide-demo-feedback"><b>✓</b><span data-guide-feedback>${d ? 'جرّب الأزرار داخل هاد السكرين باش تشوف شنو كيوقع.' : 'Try the buttons in this screen to see what happens.'}</span></div>`;
    let inner = '';

    if (scene === 'orientation') {
      inner = `${sceneTitle('BOOK-FIRST WORKFLOW', d ? 'مساحة الخدمة ديالك' : 'Your product workspace', demoButton(d ? '＋ كتاب جديد' : '＋ New book', 'غادي يفتح اختيار طريقة إنشاء الكتاب.', 'The book creation method picker will open.', 'is-green'))}
        <div class="guide-stage-strip"><span class="is-active">Overview</span><span>Characters</span><span>Interior</span><span>Editable</span><span>Listing</span><span>Thumbnails</span><span>Export</span></div>
        <div class="guide-mini-grid"><div class="guide-mini-card is-accent"><strong>${d ? 'الهيدر' : 'Header'}</strong><small>${d ? 'المساعدة، الحساب، حالة المتصفح' : 'Help, profile, and browser status'}</small></div><div class="guide-mini-card"><strong>${d ? 'المشاريع' : 'Projects'}</strong><small>${d ? 'كل الكتب المحفوظة فالجهاز' : 'Every locally saved book'}</small></div><div class="guide-mini-card is-success"><strong>${d ? 'المراحل' : 'Stages'}</strong><small>${d ? 'من الفكرة حتى الرفع' : 'From concept through upload'}</small></div></div>${feedback}`;
      return shellFrame(inner, 'overview', language);
    }
    if (scene === 'connection') {
      inner = `${sceneTitle('PROFILE & SETTINGS', d ? 'الحساب والربط' : 'Account and integrations')}
        <div class="guide-mini-grid cols-2"><div class="guide-mini-card is-success"><strong>● Gemini · ${d ? 'متصل' : 'Connected'}</strong><small>${d ? 'الجلسة مؤكدة وجاهزة للأتمتة' : 'Session verified and ready'}</small><div class="guide-mock-actions" style="margin-top:8px">${demoButton(d ? 'تحقق مرة أخرى' : 'Verify again', 'تم التأكد من جلسة Gemini.', 'Gemini session verified.', 'is-green')}</div></div><div class="guide-mini-card is-accent"><strong>${d ? 'هوية المشروع' : 'Project identity'}</strong><small>VERSA CLASS · © 2026</small><div class="guide-mock-actions" style="margin-top:8px">${demoButton(d ? 'حفظ الإعدادات' : 'Save settings', 'تحفظات الهوية والإعدادات الافتراضية محلياً.', 'Identity and defaults were saved locally.')}</div></div></div>
        <div class="guide-mini-grid" style="margin-top:8px"><div class="guide-mini-card"><strong>TPT defaults</strong><small>Subjects · Grades · Price</small></div><div class="guide-mini-card"><strong>Workflow</strong><small>Format · Orientation · Completion</small></div><div class="guide-mini-card"><strong>Notifications</strong><small>Sounds · Toasts · Desktop</small></div></div>${feedback}`;
      return shellFrame(inner, 'overview', language);
    }
    if (scene === 'new-book') {
      inner = `${sceneTitle('NEW BOOK', d ? 'كيفاش بغيتي تنشئ هاد الكتاب؟' : 'How do you want to create this book?')}
        <div class="guide-mini-grid"><button class="guide-mini-card is-accent" data-guide-demo data-demo-darija="اختار هاد المسار إلا عندك prompts واجدين." data-demo-en="Choose this when your prompts are ready." type="button"><strong>⌁ ${d ? 'لصق Prompts' : 'Paste prompts'}</strong><small>${d ? 'كل prompt = صفحة' : 'Each prompt becomes one page'}</small></button><button class="guide-mini-card" data-guide-demo data-demo-darija="Product Builder غادي ينظم الفكرة ويولّد الصفحات." data-demo-en="Product Builder will structure the idea and generate pages." type="button"><strong>✦ Product Builder</strong><small>${d ? 'فكرة منتوج تعليمي' : 'Educational product concept'}</small></button><button class="guide-mini-card" data-guide-demo data-demo-darija="Storybook كيبني القصة والنص والشخصيات والأغلفة." data-demo-en="Storybook builds the story, text, characters, and covers." type="button"><strong>♙ Storybook</strong><small>${d ? 'كتاب أطفال متكامل' : 'Complete children’s book'}</small></button></div>
        <div class="guide-mock-actions" style="margin-top:11px">${demoButton('US Letter · Portrait', 'يمكن تبدل المقاس والاتجاه قبل الإنشاء.', 'You can change size and orientation before creation.')}${demoButton(d ? 'متابعة ←' : 'Continue →', 'غادي تمشي لإعدادات المسار المختار.', 'You will continue to the selected method.', 'is-green')}</div>${feedback}`;
      return shellFrame(inner, 'overview', language);
    }
    if (scene === 'planning') {
      inner = `${sceneTitle('PRODUCT BUILDER', d ? 'بني فكرة المنتوج' : 'Build the product concept')}
        <div class="guide-mock-actions">${['Math','Grade 2','Worksheets','Fractions','20 pages'].map((label) => demoButton(label, 'تزاد هاد المعلومة للفكرة.', 'This detail was added to the concept.')).join('')}</div>
        <div class="guide-mini-grid cols-2" style="margin-top:9px"><div class="guide-mini-card is-accent"><strong>${d ? 'تحليل الفكرة' : 'Concept analysis'}</strong><small>${d ? 'العمر، الهدف، العنوان، النقاط القوية' : 'Age, purpose, title, and highlights'}</small></div><div class="guide-mini-card"><strong>Storybook Blueprint</strong><small>${d ? 'النص الدقيق + الشخصيات + الأغلفة' : 'Exact text + characters + covers'}</small></div></div>
        <div class="guide-mock-actions" style="margin-top:10px">${demoButton(d ? 'ولّد 20 Prompt' : 'Generate 20 prompts', 'غادي يتحولو لمهام مرقمة من 001 حتى 020.', 'They will become numbered jobs from 001 through 020.', 'is-green')}</div>${feedback}`;
      return shellFrame(inner, 'overview', language);
    }
    if (scene === 'overview') {
      inner = `${sceneTitle('PROJECT OVERVIEW', d ? 'Math Fractions Activity Book' : 'Math Fractions Activity Book', demoButton(d ? 'تشغيل / متابعة' : 'Run / Resume', 'غادي يبدا طابور الصفحات من أول صفحة ناقصة.', 'The queue will start from the first incomplete page.', 'is-green'))}
        <div class="guide-stage-strip"><span class="is-active">Overview</span><span>Characters</span><span>Interior</span><span>Editable</span><span>Listing</span><span>Thumbnails</span><span>Export</span></div>
        <div class="guide-mini-grid"><div class="guide-mini-card is-accent"><strong>65%</strong><small>${d ? 'التقدم العام' : 'Overall generation'}</small></div><div class="guide-mini-card is-success"><strong>3 / 3 ready</strong><small>${d ? 'الشخصيات' : 'Characters'}</small></div><div class="guide-mini-card"><strong>13 / 20</strong><small>${d ? 'صفحات كاملة' : 'Interior complete'}</small></div><div class="guide-mini-card"><strong>${d ? 'جاهز' : 'SEO ready'}</strong><small>SEO</small></div><div class="guide-mini-card"><strong>2 / 4</strong><small>Thumbnails</small></div><div class="guide-mini-card is-warning"><strong>${d ? 'مقفول مؤقتاً' : 'Locked'}</strong><small>Export</small></div></div>${feedback}`;
      return shellFrame(inner, 'overview', language);
    }
    if (scene === 'characters') {
      inner = `${sceneTitle('CHARACTER REFERENCES', d ? 'الشخصيات الرئيسية' : 'Main characters')}
        <div class="guide-mini-grid"><div class="guide-mini-card is-success"><div class="guide-thumb">Lina</div><strong>Lina · Ready ✓</strong><small>${d ? 'القميص الأزرق · شعر كيرلي' : 'Blue shirt · curly hair'}</small></div><div class="guide-mini-card is-success"><div class="guide-thumb">Omar</div><strong>Omar · Ready ✓</strong><small>${d ? 'نظارات · حقيبة خضراء' : 'Glasses · green backpack'}</small></div><div class="guide-mini-card is-accent"><div class="guide-thumb">Milo</div><strong>Milo · ${d ? 'قيد التوليد' : 'Generating'}</strong><small>${d ? 'القط البرتقالي المساعد' : 'Helpful orange cat'}</small></div></div>
        <div class="guide-mock-actions" style="margin-top:9px">${demoButton(d ? 'إظهار الـPrompt' : 'Show full prompt', 'بان الـprompt المرجعي الكامل للشخصية.', 'The complete character reference prompt is visible.')}${demoButton(d ? 'إعادة Milo' : 'Regenerate Milo', 'غير Milo غادي يتعاود، الشخصيات الأخرى ما تتبدلش.', 'Only Milo will regenerate; other characters remain unchanged.', 'is-green')}</div>${feedback}`;
      return shellFrame(inner, 'characters', language);
    }
    if (scene === 'generation') {
      inner = `${sceneTitle('BOOK INTERIOR', d ? 'طابور 20 صفحة' : '20-page generation queue', demoButton(d ? '▶ تشغيل' : '▶ Run queue', 'الصفحة 014 ولات Generating والطابور خدام.', 'Page 014 is now Generating and the queue is running.', 'is-green'))}
        <div class="guide-progress-line"><i></i></div><div class="guide-queue" style="margin-top:9px"><div class="guide-queue-row"><b>12</b><span>${d ? 'مقارنة الكسور' : 'Compare fractions'}</span><em class="guide-status is-done">Complete</em></div><div class="guide-queue-row"><b>13</b><span>${d ? 'لوّن الكسر الصحيح' : 'Color the correct fraction'}</span><em class="guide-status is-done">Complete</em></div><div class="guide-queue-row"><b>14</b><span>${d ? 'مسائل حياتية' : 'Real-world problems'}</span><em class="guide-status is-running">Generating</em></div><div class="guide-queue-row"><b>15</b><span>${d ? 'صفحة مراجعة' : 'Review page'}</span><em class="guide-status">Pending</em></div></div>${feedback}`;
      return shellFrame(inner, 'interior', language);
    }
    if (scene === 'review-edit') {
      inner = `${sceneTitle('PAGE 014', d ? 'مراجعة الصفحة' : 'Review page')}
        <div class="guide-mini-grid cols-2"><div class="guide-page-preview">14</div><div class="guide-mini-card is-accent"><strong>${d ? 'الحالة: كاملة' : 'Status: Complete'} ✓</strong><small>${d ? 'راجع النص، الحواف، والأبعاد قبل الموافقة.' : 'Inspect text, edges, and dimensions before approval.'}</small><div class="guide-mock-actions" style="margin-top:10px">${demoButton(d ? '⛶ تكبير' : '⛶ Preview', 'تفتح الصورة بالحجم الكبير.', 'The full-size preview opens.')}${demoButton(d ? '✎ تعديل' : '✎ Edit', 'كتب تعليمة دقيقة باش تتبدل هاد الصفحة فقط.', 'Enter a precise instruction to edit only this page.')}${demoButton(d ? '↻ إعادة' : '↻ Regenerate', 'غادي تتولد نسخة جديدة فـنفس الصفحة 014.', 'A new result will be generated in slot 014.')}${demoButton('Zoom & Crop', 'تقدر تكبر وتحرك الصورة داخل مقاس الصفحة.', 'Adjust zoom and position inside the page frame.', 'is-green')}</div></div></div>${feedback}`;
      return shellFrame(inner, 'interior', language);
    }
    if (scene === 'listing') {
      inner = `${sceneTitle('SEO', d ? 'نسخة جاهزة للنسخ' : 'Paste-ready copy', demoButton(d ? 'إنشاء SEO' : 'Generate SEO', 'غادي يتحلل وثيقة الكتاب ويتوجد TITLE و DESCRIPTION و TAGS.', 'The book document will be analyzed to draft TITLE, DESCRIPTION, and TAGS.', 'is-green'))}
        <div class="guide-field-row"><span>Title</span><p>Fractions Made Easy: 20 No-Prep Math Worksheets</p>${demoButton(d ? 'إعادة' : 'Regenerate', 'غادي يتبدل العنوان بوحدو.', 'Only the title will regenerate.')}</div><div class="guide-field-row"><span>Description</span><p>${d ? 'أنشطة عملية ممتعة لتعليم الكسور...' : 'Engaging, no-prep activities for mastering fractions…'}</p>${demoButton(d ? 'إعادة' : 'Regenerate', 'غادي يتبدل الوصف بوحدو.', 'Only the description will regenerate.')}</div><div class="guide-field-row"><span>Tags</span><p>Fractions · Math · Grade 2 · Worksheets</p>${demoButton(d ? 'إعادة' : 'Regenerate', 'غادي تتراجع الكلمات المفتاحية.', 'Keywords will be refreshed.')}</div>
        <div class="guide-mock-actions">${demoButton('$4.50', 'حدد الثمن المناسب للمنتوج.', 'Set the appropriate product price.')}${demoButton(d ? 'Inactive Draft' : 'Inactive Draft', 'المنتوج غادي يبقى Draft من بعد الرفع.', 'The product will remain a Draft after upload.')}</div>${feedback}`;
      return shellFrame(inner, 'listing', language);
    }
    if (scene === 'thumbnails') {
      inner = `${sceneTitle('LISTING IMAGES', d ? 'الغلاف والصور الاختيارية' : 'Cover and optional thumbnails', demoButton(d ? 'ولّد الصور' : 'Generate images', 'غادي يتحفظ كل thumbnail مباشرة منين يكمل.', 'Each thumbnail will be saved as soon as it completes.', 'is-green'))}
        <div class="guide-mini-grid cols-4"><div><div class="guide-thumb">★</div><small>Main Cover ✓</small></div><div><div class="guide-thumb">1</div><small>Preview 1 ✓</small></div><div><div class="guide-thumb">2</div><small>Preview 2 ✓</small></div><div><div class="guide-thumb">3</div><small>${d ? 'قيد التوليد' : 'Generating'}…</small></div></div>
        <div class="guide-mock-actions" style="margin-top:9px">${demoButton(d ? 'Preview الغلاف' : 'Preview cover', 'غادي تشوف الغلاف بالحجم الكامل.', 'The cover opens at full size.')}${demoButton(d ? 'إعادة الصورة 3' : 'Regenerate image 3', 'غير الصورة الثالثة غادي تتعاود.', 'Only image 3 will regenerate.')}${demoButton('Manual · 4 slots', 'Manual كيحفظ الصور باش تراجعها وترفعها.', 'Manual saves images for review and upload.')}</div>${feedback}`;
      return shellFrame(inner, 'listing', language);
    }
    if (scene === 'export') {
      inner = `${sceneTitle('EXPORT & UPLOAD', d ? 'خرّج المنتوج النهائي' : 'Create the final product')}
        <div class="guide-mini-grid"><div class="guide-mini-card is-accent"><strong>PDF</strong><small>${d ? 'ملف واحد مرتب وجاهز للبيع' : 'One ordered, sale-ready file'}</small>${demoButton(d ? 'تصدير PDF' : 'Export PDF', 'غادي يتصاوب PDF بجميع الصفحات.', 'A PDF containing all pages will be created.', 'is-green')}</div><div class="guide-mini-card"><strong>ZIP</strong><small>${d ? 'الصور المفردة مرتبة بالأرقام' : 'Numbered individual page images'}</small>${demoButton(d ? 'تصدير ZIP' : 'Export ZIP', 'غادي يتجمعو صور الصفحات فـZIP.', 'Page images will be collected in a ZIP.')}</div><div class="guide-mini-card"><strong>${d ? 'جميع الملفات' : 'All files'}</strong><small>PDF + ZIP + listing assets</small>${demoButton(d ? 'تصدير الكل' : 'Export all', 'غادي يتوجد package كامل ديال المنتوج.', 'The complete product package will be created.')}</div></div>
        <div class="guide-mock-actions" style="margin-top:9px">${demoButton('Standard pages', 'مناسب للتحميل الرقمي وTPT.', 'Best for digital download and TPT.')}${demoButton('Booklet Saddle Stitch', 'كيعاود ترتيب الصفحات للطباعة المطوية.', 'Reorders pages for folded booklet printing.')}</div>${feedback}`;
      return shellFrame(inner, 'export', language);
    }
    if (scene === 'upload') {
      inner = `${sceneTitle('FINAL QUALITY GATE', d ? 'راجع قبل الرفع' : 'Review before upload')}
        <div class="guide-mini-grid"><div class="guide-mini-card is-success"><strong>✓ Product PDF</strong><small>20 pages · 14.8 MB</small></div><div class="guide-mini-card is-success"><strong>✓ Listing metadata</strong><small>${d ? 'الحقول الإلزامية كاملة' : 'Required fields complete'}</small></div><div class="guide-mini-card is-success"><strong>✓ Main Cover</strong><small>2400 × 1800 px</small></div></div>
        <div class="guide-mini-grid cols-2" style="margin-top:8px"><button class="guide-mini-card is-accent" data-guide-demo data-demo-darija="مناسب لآخر مراجعة داخل TPT قبل النشر." data-demo-en="Best for a final check inside TPT before publishing." type="button"><strong>Inactive Draft</strong><small>${d ? 'غير منشور للعموم' : 'Not public'}</small></button><button class="guide-mini-card" data-guide-demo data-demo-darija="Active كينشر المنتوج للعموم من بعد التأكيد." data-demo-en="Active publishes publicly after confirmation." type="button"><strong>Active listing</strong><small>${d ? 'منشور مباشرة' : 'Publish immediately'}</small></button></div>
        <div class="guide-mock-actions" style="margin-top:9px">${demoButton(d ? 'Review & mark ready' : 'Review & mark ready', 'تسجل أن المراجعة التجارية والتقنية تمت.', 'Confirms that commercial and technical review is complete.', 'is-green')}${demoButton(d ? 'حضّر فورم TPT' : 'Prepare TPT form', 'غادي يتعمر الفورم، والتأكيد الأخير باقي ضروري.', 'The form will be prepared; final confirmation is still required.')}</div>${feedback}`;
      return shellFrame(inner, 'export', language);
    }
    if (scene === 'bundle') {
      inner = `${sceneTitle('GLOBAL AUTOMATION', 'Bundle Upload Queue', demoButton(d ? '⚡ تشغيل Bundle' : '⚡ Start bundle', 'الكتب Ready غادي يترفعو واحد بواحد.', 'Ready projects will upload sequentially.', 'is-green'))}
        <div class="guide-queue"><div class="guide-queue-row"><b>1</b><span>Fractions Made Easy</span><em class="guide-status is-running">Uploading 62%</em></div><div class="guide-queue-row"><b>2</b><span>Alphabet Tracing Book</span><em class="guide-status">Ready</em></div><div class="guide-queue-row"><b>3</b><span>Spring Coloring Pages</span><em class="guide-status">Ready</em></div><div class="guide-queue-row"><b>4</b><span>Ocean Storybook</span><em class="guide-status is-done">Complete</em></div></div>
        <div class="guide-mock-actions" style="margin-top:9px">${demoButton(d ? '⏹ إيقاف آمن' : '⏹ Stop safely', 'غادي يكمل العملية الحالية ويوقف قبل الكتاب الموالي.', 'The current operation finishes before the next book starts.')}</div>${feedback}`;
      return shellFrame(inner, 'overview', language);
    }
    inner = `${sceneTitle('AUTOMATION PIPELINE', d ? 'تحكم فكل مرحلة' : 'Control every stage', demoButton(d ? '⚡ تشغيل الأتمتة' : '⚡ Start automation', 'الأتمتة غادي تتبع الاختيارات Auto وAsk وManual.', 'Automation follows your Auto, Ask, and Manual choices.', 'is-green'))}
      <div class="guide-stage-strip"><span class="is-active">Overview · Auto</span><span>Characters · Auto</span><span>Interior · Auto</span><span>Editable · Ask</span><span>Listing · Ask</span><span>Thumbs · Ask</span><span>Export · Auto</span></div>
      <div class="guide-mini-grid"><div class="guide-mini-card is-success"><strong>Auto</strong><small>${d ? 'المرحلة كتخدم بلا توقف' : 'Stage runs without pausing'}</small></div><div class="guide-mini-card is-warning"><strong>Ask</strong><small>${d ? 'كيطلب منك التأكيد' : 'Requests your confirmation'}</small></div><div class="guide-mini-card"><strong>Manual</strong><small>${d ? 'كتشغلها بيدك' : 'You start it yourself'}</small></div></div>
      <div class="guide-queue" style="margin-top:8px"><div class="guide-queue-row"><b>!</b><span>${d ? 'Usage limit — توقف آمن' : 'Usage limit — safely paused'}</span><em class="guide-status is-warning">Action needed</em></div></div>
      <div class="guide-mock-actions" style="margin-top:8px">${demoButton(d ? '↻ Reset incomplete' : '↻ Reset incomplete', 'غير المهام الناقصة غادي ترجع Pending.', 'Only incomplete jobs return to Pending.')}${demoButton(d ? '▶ متابعة' : '▶ Resume', 'غادي يكمل من أول مهمة ناقصة.', 'Work resumes from the first incomplete job.')}${demoButton(d ? 'Sleep PC عند النهاية' : 'Sleep PC when complete', 'كاين countdown قبل Sleep وتقدر تلغيه.', 'A cancellable countdown appears before sleep.')}</div>${feedback}`;
    return shellFrame(inner, 'overview', language);
  }

  function renderScenarioList() {
    scenarioList.innerHTML = scenarios.map((scenario, index) => `<button class="guide-scenario-button ${index === activeScenario ? 'is-active' : ''}" data-guide-index="${index}" type="button"><span class="guide-scenario-icon">${scenario.icon}</span><strong>${scenario.title[guideLanguage]}</strong><small>${String(index + 1).padStart(2, '0')}</small></button>`).join('');
  }

  function renderGuide() {
    const scenario = scenarios[activeScenario];
    const d = guideLanguage === 'darija';
    guideMain.dir = d ? 'rtl' : 'ltr';
    progressKicker.textContent = d ? 'المسار الكامل' : 'Complete workflow';
    progressValue.textContent = `${activeScenario + 1} / ${scenarios.length}`;
    progressFill.style.width = `${((activeScenario + 1) / scenarios.length) * 100}%`;
    downloadLabel.textContent = d ? 'حمّل الشرح PDF' : 'Download PDF guide';
    document.querySelectorAll('[data-guide-language]').forEach((button) => button.classList.toggle('is-active', button.dataset.guideLanguage === guideLanguage));
    renderScenarioList();
    guideMain.innerHTML = `<article class="guide-article">
      <div class="guide-article-head"><div><span class="guide-step-number">${d ? 'السيناريو' : 'Scenario'} ${String(activeScenario + 1).padStart(2, '0')} · ${scenario.icon}</span><h3>${scenario.title[guideLanguage]}</h3><p class="guide-article-lead">${scenario.lead[guideLanguage]}</p></div><span class="guide-scene-badge"><i></i>${d ? 'سكرين تفاعلي' : 'Interactive screen'}</span></div>
      <div class="guide-visual-wrap"><span class="guide-screenshot-label">${d ? 'محاكاة من داخل التطبيق' : 'In-app simulation'}</span>${renderScene(scenario.scene, guideLanguage)}</div>
      <div class="guide-explanation-grid"><section class="guide-steps-card"><h4>${d ? 'كيفاش تستعمل هاد المرحلة' : 'How to use this stage'}</h4><div class="guide-steps">${scenario.steps[guideLanguage].map((step, index) => `<div class="guide-step"><b>${index + 1}</b><span>${step}</span></div>`).join('')}</div></section><aside class="guide-tip-card"><h4>${d ? 'معلومة مهمة' : 'Good to know'}</h4><p>${scenario.tip[guideLanguage]}</p></aside></div>
      <footer class="guide-footer-nav"><button id="guide-previous-button" class="button button-ghost" type="button" ${activeScenario === 0 ? 'disabled' : ''}>${d ? '→ السابق' : '← Previous'}</button><span>${d ? 'تقدر تختار أي سيناريو من القائمة' : 'Choose any scenario from the sidebar'}</span><button id="guide-next-button" class="button button-primary" type="button">${activeScenario === scenarios.length - 1 ? (d ? 'رجع للبداية ↻' : 'Start again ↻') : (d ? 'التالي ←' : 'Next →')}</button></footer>
    </article>`;
  }

  function buildPrintDocument(language) {
    const d = language === 'darija';
    printDocument.innerHTML = `<section class="guide-print-cover" dir="${d ? 'rtl' : 'ltr'}">
      <header class="guide-print-brand"><img src="../assets/brand/versa-class-logo.png" alt="VERSA CLASS"><span class="guide-print-gift">${d ? 'دليل VERSA CLASS الشخصي' : 'Personal VERSA CLASS guide'}</span></header>
      <div class="guide-print-cover-main"><small>${d ? 'الدليل الشامل · الدارجة المغربية' : 'Complete guide · English'}</small><h1>${d ? 'كيفاش تخدم بـ VERSA CLASS' : 'How VERSA CLASS works'}</h1><p>${d ? 'دليل عملي ومصوّر كيشرح الواجهة وجميع مراحل الخدمة: من الفكرة والـprompts حتى الصفحات، الـlisting، التصدير والرفع إلى TPT.' : 'A practical visual guide to the complete workflow—from concept and prompts through pages, listing, export, and TPT upload.'}</p></div>
      <footer><div class="guide-print-cover-footer"><span>© 2026 VERSA CLASS. ${d ? 'جميع الحقوق محفوظة.' : 'All rights reserved.'}</span><span>VERSA CLASS</span></div></footer>
    </section>${scenarios.map((scenario, index) => `<section class="guide-print-section" dir="${d ? 'rtl' : 'ltr'}"><header class="guide-print-section-head"><div><small>${d ? 'السيناريو' : 'Scenario'} ${String(index + 1).padStart(2, '0')} · ${scenario.icon}</small><h2>${scenario.title[language]}</h2><p>${scenario.lead[language]}</p></div><span class="guide-print-page-number">${index + 1}/${scenarios.length}</span></header><div class="guide-print-shot">${renderScene(scenario.scene, language)}</div><div class="guide-print-content"><section class="guide-print-steps"><h3>${d ? 'الخطوات' : 'Steps'}</h3><ol>${scenario.steps[language].map((step) => `<li>${step}</li>`).join('')}</ol></section><aside class="guide-print-tip"><h3>${d ? 'معلومة مهمة' : 'Good to know'}</h3><p>${scenario.tip[language]}</p></aside></div></section>`).join('')}`;
  }

  function openAbout() {
    renderAbout();
    if (!aboutDialog.open) aboutDialog.showModal();
  }

  function openGuide() {
    renderGuide();
    if (!guideDialog.open) guideDialog.showModal();
    requestAnimationFrame(() => guideMain.focus());
  }

  async function downloadGuide() {
    const button = document.getElementById('guide-download-button');
    const original = button.innerHTML;
    const d = guideLanguage === 'darija';
    button.disabled = true;
    button.textContent = d ? 'كيتهيأ PDF…' : 'Preparing PDF…';
    buildPrintDocument(guideLanguage);
    document.body.classList.add('printing-guide');
    try {
      await document.fonts?.ready;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const outputPath = await api.exportGuidePdf(guideLanguage);
      const feedback = guideMain.querySelector('[data-guide-feedback]');
      if (outputPath && feedback) feedback.textContent = d ? `تحفظ الدليل بنجاح: ${outputPath}` : `Guide saved successfully: ${outputPath}`;
    } catch (error) {
      const feedback = guideMain.querySelector('[data-guide-feedback]');
      if (feedback) feedback.textContent = d ? `ما قدرناش نحفظو PDF: ${error.message}` : `PDF could not be saved: ${error.message}`;
    } finally {
      document.body.classList.remove('printing-guide');
      button.disabled = false;
      button.innerHTML = original;
      printDocument.innerHTML = '';
    }
  }

  window.versaGuide = { openAbout, openGuide, downloadGuide };
  document.getElementById('about-close-button')?.addEventListener('click', () => aboutDialog.close());
  document.getElementById('guide-close-button')?.addEventListener('click', () => guideDialog.close());
  document.getElementById('guide-download-button')?.addEventListener('click', downloadGuide);
  document.getElementById('guide-about-button')?.addEventListener('click', () => { guideDialog.close(); openAbout(); });
  document.getElementById('about-button')?.addEventListener('click', () => {
    document.getElementById('settings-dialog')?.close();
    openAbout();
  });
  document.getElementById('how-it-works-button')?.addEventListener('click', () => {
    document.getElementById('settings-dialog')?.close();
    openGuide();
  });

  document.querySelectorAll('[data-guide-language]').forEach((button) => button.addEventListener('click', () => {
    guideLanguage = button.dataset.guideLanguage;
    renderGuide();
  }));

  scenarioList?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-guide-index]');
    if (!button) return;
    activeScenario = Number(button.dataset.guideIndex);
    renderGuide();
    guideMain.scrollTop = 0;
  });

  guideMain?.addEventListener('click', (event) => {
    if (event.target.closest('#guide-previous-button')) {
      activeScenario = Math.max(0, activeScenario - 1);
      renderGuide();
      guideMain.scrollTop = 0;
      return;
    }
    if (event.target.closest('#guide-next-button')) {
      activeScenario = activeScenario === scenarios.length - 1 ? 0 : activeScenario + 1;
      renderGuide();
      guideMain.scrollTop = 0;
      return;
    }
    const demo = event.target.closest('[data-guide-demo]');
    if (!demo) return;
    guideMain.querySelectorAll('[data-guide-demo]').forEach((item) => item.classList.remove('is-demo-active'));
    demo.classList.add('is-demo-active');
    const feedback = guideMain.querySelector('[data-guide-feedback]');
    if (feedback) feedback.textContent = guideLanguage === 'darija' ? demo.dataset.demoDarija : demo.dataset.demoEn;
  });

  aboutContent?.addEventListener('click', async (event) => {
    const link = event.target.closest('[data-external-url]');
    if (!link) return;
    try { await api.openExternal(link.dataset.externalUrl); } catch (error) { console.error('Could not open external resource', error); }
  });

  aboutDialog?.addEventListener('click', (event) => { if (event.target === aboutDialog) aboutDialog.close(); });
  guideDialog?.addEventListener('click', (event) => { if (event.target === guideDialog) guideDialog.close(); });
  renderAbout();
})();
