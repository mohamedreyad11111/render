const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const userCode = process.env.USER_CODE || '';

// 1. قراءة كود مكتبة Muxer من الملفات المحلية (بدون إنترنت)
const muxerLibPath = path.resolve('node_modules', 'mp4-muxer', 'dist', 'mp4-muxer.min.js');
const muxerScriptContent = fs.readFileSync(muxerLibPath, 'utf8');

(async () => {
  console.log("🚀 بدء تشغيل المتصفح الوهمي...");
  
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
      console.log(`✅ تم استلام الفيديو وحفظه بنجاح.`);
      done = true;
    }
  });

  // 2. حقن المكتبة كنص مباشر داخل الـ HTML
  await page.setContent(`
    <html>
    <head>
      <script>
        ${muxerScriptContent}
      </script>
    </head>
    <body style="margin:0; background:black;">
      <canvas id="c" width="1280" height="720"></canvas>
      <script>
        async function start() {
          try {
            console.log("🔍 فحص وجود المكتبة المحلية...");
            if (typeof Mp4Muxer === 'undefined') {
               throw new Error("المكتبة المحلية لم تعمل!");
            }

            console.log("🎥 بدء الريندر الحقيقي...");
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
              ctx.clearRect(0,0,1280,720);
              const t = i/30;
              try { ${userCode} } catch(e) { console.error("User Code Error:", e); }
              
              const frame = new VideoFrame(canvas, { timestamp: i * 33333 });
              encoder.encode(frame, { keyFrame: i % 30 === 0 });
              frame.close();
              if(i % 30 === 0) console.log("⏳ تم معالجة فريم: " + i);
            }

            await encoder.flush();
            muxer.finalize();
            console.log("🏁 انتهى الريندر، جاري نقل البيانات...");
            window.saveMp4ChunkToNode(muxer.target.buffer);

          } catch (err) {
            console.error("CRITICAL ERROR:", err.message);
          }
        }

        // تشغيل مباشر فوراً لأن المكتبة محقونة مسبقاً
        start();
      </script>
    </body>
    </html>
  `);

  const timeout = setTimeout(() => {
    console.log("❌ التوقيت انتهى! السكريبت معلق.");
    process.exit(1);
  }, 120000); 

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
  console.log("🚀 تم بنجاح.");
})();
