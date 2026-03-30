const { chromium } = require('playwright');
const { execSync } = require('child_process');
const fs = require('fs');

const userCode = process.env.USER_CODE || '';

(async () => {
  console.log("🚀 بدء تشغيل المتصفح الوهمي...");
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  await page.setContent(`
    <html>
      <body style="margin: 0; background: black;">
        <canvas id="c" width="1280" height="720"></canvas>
        <script>
          const canvas = document.getElementById('c');
          const ctx = canvas.getContext('2d');
          
          window.renderFrame = function(frameIndex) {
            ctx.clearRect(0, 0, 1280, 720);
            const t = frameIndex / 30;
            ${userCode}
          }
        </script>
      </body>
    </html>
  `);

  console.log("📸 جاري التقاط الفريمات...");
  if (!fs.existsSync('frames')) fs.mkdirSync('frames');
  
  for (let i = 0; i < 90; i++) { // 90 فريم = 3 ثواني
    await page.evaluate((frame) => window.renderFrame(frame), i);
    await page.screenshot({ path: `frames/frame_${i.toString().padStart(3, '0')}.png` });
  }

  await browser.close();

  console.log("🎞️ جاري دمج الفريمات إلى فيديو...");
  execSync('npx -y ffmpeg-static -framerate 30 -i frames/frame_%03d.png -c:v libx264 -pix_fmt yuv420p output.mp4');
  console.log("✅ تم إنشاء الفيديو بنجاح!");
})();
