const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const userCode = process.env.USER_CODE || '';
const muxerLibPath = path.resolve('mp4-muxer.js');

(async () => {
  console.log("🚀 تشغيل المحرك...");
  
  if (!fs.existsSync(muxerLibPath)) {
    console.error("❌ المكتبة مش موجودة جنبك! اتاكد ان الـ wget اشتغل صح.");
    process.exit(1);
  }

  const browser = await chromium.launch({
    args: ['--disable-gpu', '--use-gl=swiftshader', '--enable-webcodecs', '--no-sandbox']
  });
  
  const page = await browser.newPage();

  // متابعة اللوجات
  page.on('console', msg => console.log('BROWSER:', msg.text()));
  page.on('pageerror', err => console.log('BROWSER ERROR:', err.message));

  let done = false;
  await page.exposeFunction('saveMp4ChunkToNode', (chunkBuffer) => {
    if (chunkBuffer) {
      fs.writeFileSync('output.mp4', Buffer.from(chunkBuffer));
      console.log(`✅ عاااش! الفيديو طلع في output.mp4`);
      done = true;
    }
  });

  // 1. نجهز الصفحة فاضية الأول
  await page.setContent(`
    <html>
      <body style="margin:0; background:black;">
        <canvas id="c" width="1280" height="720"></canvas>
      </body>
    </html>
  `);

  // 2. نحقن المكتبة كملف (دي الطريقة الصح اللي بتمنع الـ Unexpected identifier)
  await page.addScriptTag({ path: muxerLibPath });

  // 3. نشغل الكود بعد ما نضمن ان المكتبة اتحقنت
  await page.evaluate(async (userCode) => {
    try {
      console.log("🎥 الموكسر جاهز، الريندر بدأ...");
      
      const muxer = new Mp4Muxer.Muxer({
        target: new Mp4Muxer.ArrayBufferTarget(),
        video: { codec: 'avc', width: 1280, height: 720 },
        fastStart: 'fragmented'
      });

      const encoder = new VideoEncoder({
        output: (chunk, metadata) => muxer.addVideoChunk(chunk, metadata),
        error: (e) => console.error("Encoder Error:", e.message)
      });

      encoder.configure({ 
        codec: 'avc1.42E01E', 
        width: 1280, 
        height: 720, 
        bitrate: 2_500_000 
      });

      const canvas = document.getElementById('c');
      const ctx = canvas.getContext('2d');

      for (let i = 0; i < 90; i++) {
        ctx.clearRect(0, 0, 1280, 720);
        const t = i / 30;
        
        try { 
          // تنفيذ كود المستخدم
          eval(userCode); 
        } catch(e) { console.error("User Code Error:", e.message); }
        
        const frame = new VideoFrame(canvas, { timestamp: i * 33333 });
        encoder.encode(frame, { keyFrame: i % 30 === 0 });
        frame.close();
        
        if (i % 30 === 0) console.log("⏳ Processing: " + i);
      }

      await encoder.flush();
      muxer.finalize();
      console.log("🏁 ريندر 10/10!");
      window.saveMp4ChunkToNode(muxer.target.buffer);

    } catch(err) {
      console.error("Critical Error inside browser:", err.message);
    }
  }, userCode);

  // تايم أوت أمان
  const timeout = setTimeout(() => {
    console.log("❌ السكربت طول زيادة عن اللزوم.");
    process.exit(1);
  }, 180000); 

  await new Promise(resolve => {
    const check = setInterval(() => {
      if (done) {
        clearTimeout(timeout);
        clearInterval(check);
        resolve();
      }
    }, 500);
  });

  await browser.close();
  console.log("🚀 Done.");
})();
