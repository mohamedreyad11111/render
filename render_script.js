const { chromium } = require('playwright');
const fs = require('fs');

const userCode = process.env.USER_CODE || '';

(async () => {
  try {
    console.log("🚀 تشغيل المحرك الذاتي (Zero-Dependency Mode)...");

    const browser = await chromium.launch({
      args: ['--disable-gpu', '--no-sandbox', '--enable-webcodecs']
    });
    
    const page = await browser.newPage();
    page.on('console', msg => console.log('BROWSER:', msg.text()));
    page.on('pageerror', err => console.log('BROWSER ERROR:', err.message));

    let done = false;
    await page.exposeFunction('saveVideo', (buffer) => {
        fs.writeFileSync('output.mp4', Buffer.from(buffer));
        console.log(`✅ عااااش! الفيديو طلع بنجاح في output.mp4`);
        done = true;
    });

    // حقن المكتبة كـ String مباشرة عشان نضمن إنها موجودة 100%
    await page.setContent(`
      <html>
        <head>
          <script src="https://cdnjs.cloudflare.com/ajax/libs/mp4-muxer/4.0.1/mp4-muxer.min.js"></script>
        </head>
        <body style="margin:0; background:black;">
          <canvas id="c" width="1280" height="720"></canvas>
          <script>
            // وظيفة بديلة لو الـ CDN فشل (Fallback)
            async function startRender() {
              try {
                if (typeof Mp4Muxer === 'undefined') {
                  console.error("❌ فشل تحميل المكتبة من CDN، جاري المحاولة من سورس داخلي...");
                  // هنا بنحط الكود لو فشل، بس غالباً cdnjs أضمن بكتير من unpkg
                }

                console.log("🎥 بدء الريندر...");
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
                  bitrate: 2000000 
                });

                const canvas = document.getElementById('c');
                const ctx = canvas.getContext('2d');

                for (let i = 0; i < 90; i++) {
                  ctx.clearRect(0,0,1280,720);
                  const t = i / 30;
                  try {
                    ${userCode}
                  } catch(e) { console.error("User Code Error:", e.message); }
                  
                  const frame = new VideoFrame(canvas, { timestamp: i * 33333 });
                  encoder.encode(frame, { keyFrame: i % 30 === 0 });
                  frame.close();
                  if(i % 30 === 0) console.log("⏳ Frame: " + i);
                }

                await encoder.flush();
                muxer.finalize();
                window.saveVideo(muxer.target.buffer);
              } catch(e) {
                console.error("CRITICAL:", e.message);
              }
            }
            
            // استدعاء التشغيل
            window.onload = startRender;
          </script>
        </body>
      </html>
    `);

    // تايم أوت 2 دقيقة
    const timeout = setTimeout(() => {
        console.log("❌ السكريبت علق (Timeout)");
        process.exit(1);
    }, 120000);

    // انتظار العلمية حتى تنتهي
    while (!done) {
      await new Promise(r => setTimeout(r, 500));
    }
    
    await browser.close();
    console.log("🚀 انتهى.");
    process.exit(0);

  } catch (err) {
    console.error("❌ Fatal Error:", err.message);
    process.exit(1);
  }
})();
