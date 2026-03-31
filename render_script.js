const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const userCode = process.env.USER_CODE || '';

// قراءة المكتبة المحملة
const muxerLibPath = path.resolve('mp4-muxer.js');
const muxerScriptContent = fs.readFileSync(muxerLibPath, 'utf8');

(async () => {
  console.log("🚀 بدء تشغيل المتصفح...");
  
  const browser = await chromium.launch({
    args: ['--disable-gpu', '--use-gl=swiftshader', '--enable-webcodecs', '--no-sandbox']
  });
  
  const page = await browser.newPage();

  // إظهار لوجات المتصفح في جيتهاب رانر
  page.on('console', msg => console.log('BROWSER:', msg.text()));
  page.on('pageerror', err => console.log('BROWSER ERROR:', err.message));

  let done = false;
  await page.exposeFunction('saveMp4ChunkToNode', (chunkBuffer) => {
    if (chunkBuffer) {
      fs.writeFileSync('output.mp4', Buffer.from(chunkBuffer));
      console.log(`✅ تم استقبال وحفظ الفيديو النهائي.`);
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
            console.log("🎥 بدء عملية الريندر داخل المتصفح...");
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

            for (let i = 0; i < 90; i++) {
              ctx.clearRect(0, 0, 1280, 720);
              const t = i / 30;
              try { 
                ${userCode} 
              } catch(e) { console.error("User Code Error:", e); }
              
              const frame = new VideoFrame(canvas, { timestamp: i * 33333 });
              encoder.encode(frame, { keyFrame: i % 30 === 0 });
              frame.close();
              if (i % 30 === 0) console.log("⏳ Processing frame: " + i);
            }

            await encoder.flush();
            muxer.finalize();
            console.log("🏁 الريندر خلص، ببعت الملف لـ Node...");
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

  // تايم أوت 3 دقائق عشان لو علق
  const timeout = setTimeout(() => {
    console.log("❌ التوقيت انتهى! السكريبت لسه معلق.");
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
  console.log("🚀 العملية انتهت بنجاح.");
})();
