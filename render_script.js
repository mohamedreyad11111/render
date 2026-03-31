const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const userCode = process.env.USER_CODE || '';

// قراءة ملف المكتبة اللي نزلناه بالـ curl
const muxerLibPath = path.resolve('mp4-muxer.js');
if (!fs.existsSync(muxerLibPath)) {
    console.error("❌ ملف mp4-muxer.js مش موجود! التحميل فشل.");
    process.exit(1);
}
const muxerScriptContent = fs.readFileSync(muxerLibPath, 'utf8');

(async () => {
  console.log("🚀 جاري تشغيل المتصفح وتحضير الريندر...");
  
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

  // لوجات المتصفح عشان نشوف لو في مصيبة حصلت جوه
  page.on('console', msg => console.log('BROWSER:', msg.text()));
  page.on('pageerror', err => console.log('BROWSER ERROR:', err.message));

  let done = false;
  await page.exposeFunction('saveMp4ChunkToNode', (chunkBuffer) => {
    if (chunkBuffer) {
      fs.writeFileSync('output.mp4', Buffer.from(chunkBuffer));
      console.log(`✅ عااش! الفيديو اتحفظ في output.mp4`);
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
            console.log("🎥 الريندر بدأ فعلياً...");
            
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

            // ريندر 90 فريم (3 ثواني)
            for (let i = 0; i < 90; i++) {
              ctx.clearRect(0, 0, 1280, 720);
              const t = i / 30;
              
              try { 
                ${userCode} 
              } catch(e) { console.error("User Code Error:", e); }
              
              const frame = new VideoFrame(canvas, { timestamp: i * 33333 });
              encoder.encode(frame, { keyFrame: i % 30 === 0 });
              frame.close();
              
              if (i % 30 === 0) console.log("⏳ شغال في الثانية: " + (i/30));
            }

            await encoder.flush();
            muxer.finalize();
            console.log("🏁 الريندر خلص بنجاح!");
            window.saveMp4ChunkToNode(muxer.target.buffer);

          } catch(err) {
            console.error("Critical Render Error:", err.message);
          }
        }
        run();
      </script>
    </body>
    </html>
  `);

  // لو زاد عن 3 دقائق يبقى في حاجة غلط
  const timeout = setTimeout(() => {
    console.log("❌ السكربت علق وقفلت المهمة.");
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
  console.log("🚀 تمت المهمة بنجاح يا بطل.");
})();
