/**
 * ============================================================================
 * Ofoq Studio — GitHub Actions Server Renderer
 * ============================================================================
 *
 * الدورة الكاملة:
 *  1. يقرأ JOB_ID من env → يجلب المهمة من Firestore
 *  2. إذا لا يوجد JOB_ID → يبحث عن مهام معلقة (scheduled run)
 *  3. يفتح Puppeteer + renderer-page.html → يرسم الإطارات
 *  4. FFmpeg يُشفّر الإطارات → MP4 / WebM
 *  5. يرفع الفيديو كـ GitHub Release asset (مجاناً + دائم)
 *  6. يُحدّث Firestore: { status: 'completed', videoUrl, progress: 100 }
 *
 * Secrets المطلوبة في GitHub:
 *   GH_PAT                   → Personal Access Token (repo scope)
 *   FIREBASE_SERVICE_ACCOUNT → JSON string من Firebase Console
 * ============================================================================
 */

'use strict';

const puppeteer = require('puppeteer');
const { exec }  = require('child_process');
const path      = require('path');
const fs        = require('fs');
const os        = require('os');
const admin     = require('firebase-admin');
const { Octokit } = require('@octokit/rest');

// ── إعداد Firebase Admin ─────────────────────────────────────────────────────
const SA_JSON = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!SA_JSON) {
  console.error('❌ FIREBASE_SERVICE_ACCOUNT secret غير موجود!');
  process.exit(1);
}
let serviceAccount;
try {
  serviceAccount = JSON.parse(SA_JSON);
} catch(e) {
  console.error('❌ فشل parse لـ FIREBASE_SERVICE_ACCOUNT:', e.message);
  process.exit(1);
}
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

// ── الثوابت ──────────────────────────────────────────────────────────────────
const GITHUB_OWNER = process.env.GITHUB_OWNER      || 'mohamedreyad11111';
const GITHUB_REPO  = process.env.GITHUB_REPO_NAME  || 'render';
const GITHUB_TOKEN = process.env.GH_PAT;

const RENDERER_PAGE = path.join(__dirname, 'renderer-page.html');

// ── نقطة الدخول ──────────────────────────────────────────────────────────────
async function main() {
  const jobId = process.env.JOB_ID;

  if (jobId && jobId.trim()) {
    console.log(`\n🎬 تشغيل مهمة محددة: ${jobId}`);
    await processJob(jobId.trim());
  } else {
    console.log('\n🔍 البحث عن مهام معلقة (scheduled run)…');
    await processPendingJobs();
  }

  // أغلق Firebase
  await admin.app().delete();
  console.log('\n✅ Renderer finished.');
  process.exit(0);
}

// ── معالجة المهام المعلقة (scheduled) ────────────────────────────────────────
async function processPendingJobs() {
  const snap = await db.collection('render_jobs')
    .where('status', '==', 'queued')
    .orderBy('createdAt', 'asc')
    .limit(5)
    .get();

  if (snap.empty) {
    console.log('✓ لا توجد مهام معلقة.');
    return;
  }

  console.log(`📋 وُجدت ${snap.size} مهمة معلقة`);
  for (const doc of snap.docs) {
    await processJob(doc.id);
  }
}

// ── معالجة مهمة واحدة ────────────────────────────────────────────────────────
async function processJob(jobId) {
  console.log(`\n━━━ بدء معالجة المهمة: ${jobId} ━━━`);
  const jobRef  = db.collection('render_jobs').doc(jobId);
  const jobSnap = await jobRef.get();

  if (!jobSnap.exists) {
    console.error(`❌ المهمة ${jobId} غير موجودة في Firestore`);
    return;
  }

  const job = jobSnap.data();

  // تحقق من الحالة
  if (job.status !== 'queued' && job.status !== 'processing') {
    console.log(`ℹ️  المهمة ${jobId} في حالة "${job.status}" — تخطي.`);
    return;
  }

  // تحديث الحالة إلى processing
  await jobRef.update({
    status:    'processing',
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });

  try {
    await doRender(jobId, job, jobRef);
  } catch(e) {
    console.error(`\n❌ فشل الريندر للمهمة ${jobId}:`, e.message);
    console.error(e.stack);
    await jobRef.update({
      status:    'failed',
      errorMsg:  e.message,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }).catch(() => {});
  }
}

// ── الريندر الفعلي ────────────────────────────────────────────────────────────
async function doRender(jobId, job, jobRef) {
  const {
    sceneCode,
    sceneConfig,
    renderSettings,
    audioUrl,
    outputName,
    trimStart,
    trimEnd
  } = job;

  const { resolution, fps: fpsSetting, bitrate, codec } = renderSettings;
  const [W, H] = resolution.split('x').map(Number);
  const fps      = fpsSetting  || 60;
  const dur      = sceneConfig.dur || 10;
  const bgColor  = sceneConfig.bg  || '#000000';

  // نطاق الإطارات
  const startSec   = parseFloat(trimStart)  || 0;
  const endSec     = parseFloat(trimEnd)    || dur;
  const startFrame = Math.round(startSec * fps);
  const endFrame   = Math.round(endSec   * fps);
  const totalF     = endFrame - startFrame;

  if (totalF <= 0) throw new Error('عدد الإطارات صفر — تحقق من مدة المشهد وإعدادات Trim');

  const safeName  = (outputName || 'ofoq_video').replace(/[^\w\u0600-\u06FF.-]/g, '_');
  const outputExt = (codec === 'vp9' || codec === 'av1') ? 'webm' : 'mp4';
  const framesDir = path.join(os.tmpdir(), `frames_${jobId}`);
  const outputFile= path.join(os.tmpdir(), `output_${jobId}.${outputExt}`);

  fs.mkdirSync(framesDir, { recursive: true });

  await logJob(jobRef, `🚀 بدء الريندر: ${W}x${H} @ ${fps}fps — ${totalF} إطار (${startSec}s → ${endSec}s)`);

  // ── ① Puppeteer — رسم الإطارات ─────────────────────────────────────────
  await logJob(jobRef, '🌐 تشغيل المتصفح…');

  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-web-security',
      '--allow-file-access-from-files',
      '--disable-features=VizDisplayCompositor',
      `--window-size=${W},${H}`
    ]
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });

    // حقن بيانات المشهد قبل تحميل الصفحة
    await page.evaluateOnNewDocument(
      (sceneData) => { window.__SCENE_DATA__ = sceneData; },
      {
        code:   sceneCode,
        cfg:    {
          ...sceneConfig,
          w:   W,
          h:   H,
          fps: fps
        },
        fonts:  sceneConfig.fonts  || [],
        images: sceneConfig.images || {},
        bg:     bgColor
      }
    );

    // تحميل صفحة الريندر
    console.log(`📄 تحميل: file://${RENDERER_PAGE}`);
    await page.goto(`file://${RENDERER_PAGE}`, {
      waitUntil: 'networkidle0',
      timeout:   60_000
    });

    // انتظار اكتمال تهيئة المشهد
    await page.waitForFunction(() => window.__READY__ !== undefined, {
      timeout: 120_000, polling: 500
    });

    const readyState = await page.evaluate(() => window.__READY__);
    if (readyState !== 'ok') {
      const errMsg = await page.evaluate(() => window.__ERROR__ || 'خطأ في تهيئة المشهد');
      throw new Error(errMsg);
    }

    const reportedTotal = await page.evaluate(() => window.getTotalFrames ? window.getTotalFrames() : -1);
    await logJob(jobRef, `✓ المشهد جاهز — ${reportedTotal} إطار إجمالي. بدء الرسم…`);

    // ── رسم الإطارات واحداً بواحد ─────────────────────────────────────────
    let lastPctReported = 0;
    for (let i = 0; i < totalF; i++) {
      const frameIdx = startFrame + i;

      // طلب PNG من الصفحة
      const dataUrl = await page.evaluate((fi) => {
        return window.renderFrame(fi);
      }, frameIdx);

      // حفظ الإطار
      const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');
      const framePath  = path.join(framesDir, `frame_${String(i).padStart(6, '0')}.png`);
      fs.writeFileSync(framePath, base64Data, 'base64');

      // تحديث التقدم كل 5%
      const pct = Math.round((i + 1) / totalF * 85); // 0–85% للإطارات
      if (pct >= lastPctReported + 5) {
        lastPctReported = pct;
        const eta = Math.round((totalF - i - 1) * (1000 / Math.max(i + 1, 1)));
        await jobRef.update({
          progress:  pct,
          eta:       Math.round(eta / 1000),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        console.log(`  📸 ${i + 1}/${totalF} إطارات (${pct}%)`);
      }
    }

    console.log(`✓ تم رسم ${totalF} إطار.`);
  } finally {
    await browser.close();
  }

  // ── ② FFmpeg — ترميز الفيديو ───────────────────────────────────────────
  await logJob(jobRef, `🎬 FFmpeg: ترميز ${codec.toUpperCase()} @ ${Math.round(bitrate/1000)}kbps…`);
  await jobRef.update({ progress: 87, updatedAt: admin.firestore.FieldValue.serverTimestamp() });

  const ffmpegCmd = buildFFmpegCmd({
    framesDir, outputFile, fps, bitrate, codec, audioUrl
  });

  console.log('\n[FFmpeg CMD]', ffmpegCmd.slice(0, 200), '…');
  await runCmd(ffmpegCmd, 'FFmpeg');

  const outputSizeKB = Math.round(fs.statSync(outputFile).size / 1024);
  await logJob(jobRef, `✓ الترميز اكتمل — الحجم: ${outputSizeKB} KB`);
  await jobRef.update({ progress: 93, updatedAt: admin.firestore.FieldValue.serverTimestamp() });

  // ── ③ رفع الفيديو كـ GitHub Release ───────────────────────────────────
  await logJob(jobRef, '☁️ رفع الفيديو على GitHub Releases…');
  await jobRef.update({ progress: 95, updatedAt: admin.firestore.FieldValue.serverTimestamp() });

  const videoUrl = await uploadToGitHubRelease({
    jobId, safeName, outputFile, outputExt, codec, resolution, fps
  });

  // ── ④ تحديث Firestore: مكتمل ──────────────────────────────────────────
  await jobRef.update({
    status:     'completed',
    progress:   100,
    videoUrl,
    eta:        0,
    updatedAt:  admin.firestore.FieldValue.serverTimestamp()
  });

  await logJob(jobRef, `🎉 اكتمل! رابط الفيديو: ${videoUrl}`);
  console.log(`\n✅ المهمة ${jobId} اكتملت بنجاح.\n   🔗 ${videoUrl}`);

  // ── تنظيف ─────────────────────────────────────────────────────────────
  try {
    fs.rmSync(framesDir, { recursive: true, force: true });
    fs.unlinkSync(outputFile);
  } catch(_) {}
}

// ── بناء أمر FFmpeg ───────────────────────────────────────────────────────────
function buildFFmpegCmd({ framesDir, outputFile, fps, bitrate, codec, audioUrl }) {
  const bitrateK = Math.round(bitrate / 1000);
  let cmd = `ffmpeg -y -framerate ${fps} -i "${framesDir}/frame_%06d.png"`;

  // إضافة الصوت إذا وُجد
  if (audioUrl) {
    cmd += ` -i "${audioUrl}"`;
  }

  if (codec === 'vp9') {
    // VP9 + WebM + Opus
    cmd += ` -c:v libvpx-vp9 -b:v ${bitrateK}k -crf 18 -row-mt 1 -tile-columns 2 -frame-parallel 1`;
    if (audioUrl) cmd += ' -c:a libopus -b:a 192k';
    else          cmd += ' -an';
  } else if (codec === 'av1') {
    // AV1 + WebM (أبطأ لكن أعلى جودة)
    cmd += ` -c:v libaom-av1 -b:v ${bitrateK}k -crf 28 -strict experimental`;
    if (audioUrl) cmd += ' -c:a libopus -b:a 192k';
    else          cmd += ' -an';
  } else {
    // H.264 + MP4 + AAC (الافتراضي — الأسرع والأعلى توافقاً)
    cmd += ` -c:v libx264 -preset medium`;
    cmd += ` -b:v ${bitrateK}k -maxrate ${Math.round(bitrateK * 1.5)}k -bufsize ${bitrateK * 2}k`;
    cmd += ` -profile:v high -level:v 4.2`;
    cmd += ` -pix_fmt yuv420p`;       // ضروري لـ iOS / Android
    cmd += ` -g ${fps * 2}`;           // GOP = 2 ثانية
    if (audioUrl) cmd += ' -c:a aac -b:a 192k -ar 48000';
    else          cmd += ' -an';
    cmd += ` -movflags +faststart`;   // Web-optimized: metadata في البداية
  }

  if (audioUrl) cmd += ' -shortest';  // قطع عند نهاية المسار الأقصر
  cmd += ` "${outputFile}"`;
  return cmd;
}

// ── رفع الفيديو على GitHub Releases ──────────────────────────────────────────
async function uploadToGitHubRelease({ jobId, safeName, outputFile, outputExt, codec, resolution, fps }) {
  if (!GITHUB_TOKEN) throw new Error('GH_PAT secret غير موجود — لا يمكن الرفع على GitHub');

  const octokit  = new Octokit({ auth: GITHUB_TOKEN });
  const tagName  = `render-${jobId.slice(0, 12)}`;
  const relTitle = `${safeName} (${resolution} · ${fps}fps · ${codec.toUpperCase()})`;

  // إنشاء الـ Release
  let releaseId;
  try {
    const rel = await octokit.rest.repos.createRelease({
      owner:      GITHUB_OWNER,
      repo:       GITHUB_REPO,
      tag_name:   tagName,
      name:       relTitle,
      body:       `**أفق ستوديو** — ريندر آلي\n\n- Job ID: \`${jobId}\`\n- الدقة: ${resolution}\n- FPS: ${fps}\n- الكوديك: ${codec.toUpperCase()}\n- تاريخ الإنشاء: ${new Date().toISOString()}`,
      draft:      false,
      prerelease: false
    });
    releaseId = rel.data.id;
    console.log(`✓ Release أُنشئ: ${tagName}`);
  } catch(e) {
    // قد تكون العلامة موجودة مسبقاً
    throw new Error(`فشل إنشاء GitHub Release: ${e.message}`);
  }

  // رفع ملف الفيديو
  const mimeType  = outputExt === 'webm' ? 'video/webm' : 'video/mp4';
  const assetName = `${safeName}.${outputExt}`;
  const videoData = fs.readFileSync(outputFile);

  console.log(`☁️  رفع "${assetName}" (${Math.round(videoData.length / 1024)} KB)…`);

  const assetResp = await octokit.rest.repos.uploadReleaseAsset({
    owner:      GITHUB_OWNER,
    repo:       GITHUB_REPO,
    release_id: releaseId,
    name:       assetName,
    data:       videoData,
    headers: {
      'content-type':   mimeType,
      'content-length': videoData.length
    }
  });

  const videoUrl = assetResp.data.browser_download_url;
  console.log(`✓ تم الرفع: ${videoUrl}`);
  return videoUrl;
}

// ── أدوات مساعدة ──────────────────────────────────────────────────────────────
async function logJob(jobRef, msg) {
  console.log('[JOB]', msg);
  await jobRef.update({
    log:       admin.firestore.FieldValue.arrayUnion(msg),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }).catch(() => {});
}

function runCmd(cmd, label = 'CMD') {
  return new Promise((resolve, reject) => {
    const proc = exec(cmd, { maxBuffer: 100 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        // FFmpeg يكتب في stderr حتى في حالة النجاح
        const lastLines = (stderr || '').split('\n').slice(-10).join('\n');
        reject(new Error(`${label} فشل:\n${lastLines}`));
      } else {
        resolve(stdout);
      }
    });
    // طباعة تقدم FFmpeg
    if (proc.stderr) {
      proc.stderr.on('data', chunk => {
        const line = chunk.toString().trim();
        if (line.includes('frame=') || line.includes('time=')) {
          process.stdout.write('\r  🎬 ' + line.slice(0, 80));
        }
      });
    }
  });
}

// ── تشغيل ──────────────────────────────────────────────────────────────────────
main().catch(e => {
  console.error('\n❌ خطأ غير متوقع:', e);
  process.exit(1);
});
