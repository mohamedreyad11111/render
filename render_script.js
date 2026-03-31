const { chromium } = require('playwright');
const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

const userCode = process.env.USER_CODE || '';
const framesDir = path.join(__dirname, 'frames');

(async () => {
  console.log("🚀 بدء الريندر باستخدام إستراتيجية FFmpeg...");
  
  if (!fs.existsSync(framesDir)) fs.mkdirSync(framesDir);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  await page.setViewportSize({ width: 1280, height: 720 });

  await page.setContent(`
    <html>
      <body style="margin:0; background:black;">
        <canvas id="c" width="1280" height="720"></canvas>
      </body>
    </html>
  `);

  // تنفيذ كود المستخدم ورسم الفريمات
  for (let i = 0; i < 90; i++) { // 3 ثواني بـ 30 فريم
    await page.evaluate(({ i, code }) => {
      const canvas = document.getElementById('c');
      const ctx = canvas.getContext('2d');
      const t = i / 30;
      ctx.clearRect(0, 0, 1280, 720);
      try {
        eval(code);
      } catch (e) { console.error(e); }
    }, { i, code: userCode });

    // أخذ لقطة من الكانفاس وحفظها
    const canvasElement = await page.$('#c');
    await canvasElement.screenshot({
      path: path.join(framesDir, `frame_${String(i).padStart(3, '0')}.png`),
      omitBackground: true
    });

    if (i % 10 === 0) console.log(`📸 Captured frame ${i}`);
  }

  await browser.close();

  console.log("🎬 جاري تجميع الفريمات باستخدام FFmpeg...");
  try {
    // أمر FFmpeg السحري لتجميع الصور لفيديو
    execSync(`ffmpeg -y -framerate 30 -i frames/frame_%03d.png -c:v libx264 -pix_fmt yuv420p -crf 18 output.mp4`);
    console.log("✅ تمت العملية بنجاح! الملف جاهز: output.mp4");
  } catch (error) {
    console.error("❌ فشل FFmpeg:", error.message);
  }
})();
