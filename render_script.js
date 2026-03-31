const { chromium } = require('playwright');
const fs = require('fs');

const userCode = process.env.USER_CODE || '';
// الرابط اللي أنت بعته - النسخة الأحدث والمضمونة
const MUXER_URL = "https://cdn.jsdelivr.net/npm/mp4-muxer@5.2.2/build/mp4-muxer.min.js";

(async () => {
  try {
    console.log("🚀 بدء المحرك باستخدام نسخة Mp4Muxer 5.2.2...");

    const browser = await chromium.launch({
      args: ['--disable-gpu', '--no-sandbox', '--enable-webcodecs']
    });
    
    const page = await browser.newPage();

    // متابعة اللوجات بدقة
    page.on('console', msg => console.log('BROWSER:', msg.text()));
    page.on('pageerror', err => console.log('BROWSER ERROR:', err.message));

    let done = false;
    await page.exposeFunction('saveVideo', (buffer) => {
        fs.writeFileSync('output.mp4', Buffer.from(buffer));
        console.log(`✅ عاااش يا وحش! الفيديو طلع في output.mp4`);
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
                // التأكد من أن المكتبة تحملت
                if (typeof Mp4Muxer === 'undefined') {
                  throw new Error("لم يتم العثور على Mp4Muxer! الرابط قد يكون محجوباً.");
                }

                console.log("🎥 المكتبة جاهزة، بدء الريندر...");
                
                // في النسخة 5.2.2 الاسم بيبقى Mp4Muxer.Muxer
                const muxer = new Mp4Muxer.Muxer({
                  target: new Mp4Muxer.ArrayBufferTarget(),
                  video: { 
                    codec: 'avc', 
                    width: 1280, 
                    height: 720 
                  },
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
                  bitrate: 3_000_000 
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
                  if(i % 30 === 0) console.log("⏳ شغال في فريم: " + i);
                }

                await encoder.flush();
                muxer.finalize();
                console.log("🏁 الريندر انتهى بنجاح!");
                window.saveVideo(muxer.target.buffer);

              } catch(err) {
                console.error("CRITICAL:", err.message);
              }
            }

            // الانتظار للتأكد من تحميل المكتبة
            window.onload = start;
          </script>
        </body>
      </html>
    `);

    // انتظار النتيجة
    const startWait = Date.now();
    while (!done) {
      if (Date.now() - startWait > 120000) {
          console.log("❌ Timeout: الريندر خد أكتر من دقيقتين.");
          process.exit(1);
      }
      await new Promise(r => setTimeout(r, 500));
    }
    
    await browser.close();
    console.log("🚀 تمت العملية.");
    process.exit(0);

  } catch (err) {
    console.error("❌ Fatal Error:", err.message);
    process.exit(1);
  }
})();
