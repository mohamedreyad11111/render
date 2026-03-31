const { chromium } = require('playwright');
const fs = require('fs');

const userCode = process.env.USER_CODE || '';
const MUXER_URL = "https://cdn.jsdelivr.net/npm/mp4-muxer@5.2.2/build/mp4-muxer.min.js";

(async () => {
  try {
    console.log("🚀 تشغيل المتصفح مع تفعيل WebCodecs...");

    const browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-gpu',
        '--use-gl=swiftshader',
        '--enable-webcodecs', // أهم flag لتشغيل VideoEncoder
        '--disable-software-rasterizer',
        '--disable-dev-shm-usage'
      ]
    });
    
    const page = await browser.newPage();
    page.on('console', msg => console.log('BROWSER:', msg.text()));
    page.on('pageerror', err => console.log('BROWSER ERROR:', err.message));

    let done = false;
    await page.exposeFunction('saveVideo', (buffer) => {
        fs.writeFileSync('output.mp4', Buffer.from(buffer));
        console.log(`✅ مبروك! الفيديو اتحفظ بنجاح.`);
        done = true;
    });

    await page.setContent(`
      <html>
        <head>
          <script src="${MUXER_URL}"></script>
        </head>
        <body style="margin:0; background:black;">
          <canvas id="c" width="1280" height="720"></canvas>
          <script>
            async function start() {
              try {
                // التأكد من أن WebCodecs مدعوم
                if (typeof VideoEncoder === 'undefined') {
                  throw new Error("VideoEncoder is NOT supported in this browser! Check flags.");
                }

                console.log("🎥 الفيديو إنكودر جاهز، الريندر بدأ...");
                
                const muxer = new Mp4Muxer.Muxer({
                  target: new Mp4Muxer.ArrayBufferTarget(),
                  video: { 
                    codec: 'avc', 
                    width: 1280, 
                    height: 720 
                  }
                });

                const encoder = new VideoEncoder({
                  output: (chunk, metadata) => muxer.addVideoChunk(chunk, metadata),
                  error: (e) => console.error("Encoder Error:", e.message)
                });

                // استخدام كودك متوافق أكتر مع المتصفحات الوهمية
                await encoder.configure({ 
                  codec: 'avc1.42E01E', 
                  width: 1280, 
                  height: 720, 
                  bitrate: 1_000_000,
                  latencyMode: 'quality',
                  hardwareAcceleration: 'prefer-software' // إجبار المتصفح على استخدام المعالج بدل كارت الشاشة
                });

                const canvas = document.getElementById('c');
                const ctx = canvas.getContext('2d');

                for (let i = 0; i < 90; i++) {
                  ctx.clearRect(0, 0, 1280, 720);
                  const t = i / 30;
                  try {
                    ${userCode}
                  } catch(e) { console.error("User Code Error:", e.message); }
                  
                  const frame = new VideoFrame(canvas, { timestamp: i * 33333 });
                  encoder.encode(frame, { keyFrame: i % 30 === 0 });
                  frame.close();
                  if(i % 30 === 0) console.log("⏳ Rendering Frame: " + i);
                }

                await encoder.flush();
                muxer.finalize();
                window.saveVideo(muxer.target.buffer);

              } catch(err) {
                console.error("CRITICAL:", err.message);
              }
            }
            window.onload = start;
          </script>
        </body>
      </html>
    `);

    const startWait = Date.now();
    while (!done) {
      if (Date.now() - startWait > 120000) {
          console.log("❌ السكريبت علق في الانتظار.");
          process.exit(1);
      }
      await new Promise(r => setTimeout(r, 1000));
    }
    
    await browser.close();
    console.log("🚀 انتهى بنجاح.");
    process.exit(0);

  } catch (err) {
    console.error("❌ Fatal Error:", err.message);
    process.exit(1);
  }
})();
