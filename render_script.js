const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const userCode = process.env.USER_CODE || '';

// قراءة المكتبة اللي حملناها بـ wget من الفولدر الرئيسي
const muxerLibPath = path.resolve('mp4-muxer.js');
const muxerScriptContent = fs.readFileSync(muxerLibPath, 'utf8');

(async () => {
  console.log("🚀 بدء تشغيل المتصفح...");
  
  const browser = await chromium.launch({
    args: [
      '--disable-gpu', 
      '--use-gl=swiftshader', 
      '--enable-webcodecs', 
      '--no-sandbox',
      '--disable-dev-shm-usage'
    ]
  });
  
  const page = await browser.newPage();

  // إظهار اللوجات عشان نتابع الخطوات
  page.on('console', msg => console.log('BROWSER:', msg.text()));
  page.on('pageerror', err => console.log('BROWSER ERROR:', err.message));

  let done = false;
  await page.exposeFunction('saveMp4ChunkToNode', (chunkBuffer) => {
    if (chunkBuffer) {
      fs.writeFileSync('output.mp4', Buffer.from(chunkBuffer));
      console.log(`✅ تم استقبال وحفظ الفيديو النهائي (output.mp4)`);
      done = true;
    }
  });

  await page.setContent(`
    <html>
    <head>
      <script>${muxerScriptContent}</script>
    </head>
    <body style="margin:0; background:black;">
      <canvas id="c" width="1280" height="720"></canvas>
      <script>
        async function run() {
          try {
            console.log("🎥 بدء الريندر...");
            if (typeof Mp4Muxer === 'undefined') throw new Error("Muxer library failed to load!");

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
              bitrate: 2_000_000 
            });

            const canvas = document.getElementById('c');
            const ctx = canvas.getContext('2d');

            // ريندر لـ 90 فريم (3 ثواني)
            for (let i = 0; i < 90; i++) {
              ctx.clearRect(0, 0, 1280, 720);
              const t = i / 30;
              
              // تنفيذ كود المستخدم
              try { 
                ${userCode} 
              } catch(e) { console.error("User JS Error:", e); }
              
              const frame = new VideoFrame(canvas, { timestamp: i * 33333 });
              encoder.encode(frame, { keyFrame: i % 30 === 0 });
              frame.close();
              
              if (i % 30 === 0) console.log("⏳ شغال في فريم: " + i);
            }

            await encoder.flush();
            muxer.finalize();
            console.log("🏁 خلصت ريندر، ببعت الداتا...");
            window.saveMp4ChunkToNode(muxer.target.buffer);

          } catch(err) {
            console.error("Critical Error:", err.message);
          }
        }
        run();
      </script>
    </body>
    </html>
  `);

  // لو السكربت علق أكتر من 3 دقائق يقفل عشان ميحرقش وقت
  const timeout = setTimeout(() => {
    console.log("❌ Timeout: السكريبت علق أو خد وقت طويل.");
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
  console.log("🚀 المهمة تمت بنجاح.");
})();
