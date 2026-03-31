const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const userCode = process.env.USER_CODE || '';

// تحديد مسار المكتبة من داخل node_modules بعد الـ npm install
const muxerLibPath = path.resolve('node_modules', 'mp4-muxer', 'dist', 'mp4-muxer.min.js');

(async () => {
  console.log("🚀 تشغيل المحرك (NPM Mode)...");
  
  if (!fs.existsSync(muxerLibPath)) {
    console.error("❌ خطأ قاتل: مكتبة mp4-muxer لم تثبت عبر npm!");
    process.exit(1);
  }

  const browser = await chromium.launch({
    args: ['--disable-gpu', '--use-gl=swiftshader', '--enable-webcodecs', '--no-sandbox']
  });
  
  const page = await browser.newPage();
  page.on('console', msg => console.log('BROWSER:', msg.text()));
  page.on('pageerror', err => console.log('BROWSER ERROR:', err.message));

  let done = false;
  await page.exposeFunction('saveMp4ChunkToNode', (chunkBuffer) => {
    if (chunkBuffer) {
      fs.writeFileSync('output.mp4', Buffer.from(chunkBuffer));
      console.log(`✅ تم الريندر بنجاح وحفظ الملف!`);
      done = true;
    }
  });

  await page.setContent(`
    <html>
      <body style="margin:0; background:black;">
        <canvas id="c" width="1280" height="720"></canvas>
      </body>
    </html>
  `);

  // حقن المكتبة من المسار المحلي لـ node_modules
  await page.addScriptTag({ path: muxerLibPath });

  await page.evaluate(async (userCode) => {
    try {
      if (typeof Mp4Muxer === 'undefined') throw new Error("Mp4Muxer fails to load from node_modules");
      
      console.log("🎥 الموكسر جاهز، بدأنا الريندر...");
      
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
          eval(userCode); 
        } catch(e) { console.error("JS Error:", e.message); }
        
        const frame = new VideoFrame(canvas, { timestamp: i * 33333 });
        encoder.encode(frame, { keyFrame: i % 30 === 0 });
        frame.close();
        if (i % 30 === 0) console.log("⏳ شغال في فريم: " + i);
      }

      await encoder.flush();
      muxer.finalize();
      console.log("🏁 ريندر 100%!");
      window.saveMp4ChunkToNode(muxer.target.buffer);

    } catch(err) {
      console.error("Critical Error:", err.message);
    }
  }, userCode);

  const timeout = setTimeout(() => {
    console.log("❌ السكريبت خد وقت طويل جداً.");
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
  console.log("🚀 انتهى.");
})();
