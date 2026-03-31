const { chromium } = require('playwright');
const fs = require('fs');

const userCode = process.env.USER_CODE || '';

(async () => {
  console.log("🚀 بدء تشغيل المتصفح الوهمي بنظام Software Rendering...");
  
  const browser = await chromium.launch({
    args: [
      '--disable-gpu',
      '--use-gl=swiftshader', // استخدام المعالج للرسم
      '--enable-webcodecs',
      '--no-sandbox'
    ]
  });
  
  const page = await browser.newPage();

  // توجيه لوجات المتصفح للـ Node.js عشان نشوف إيه اللي بيحصل جوه
  page.on('console', msg => console.log('BROWSER LOG:', msg.text()));

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
    <head><script src="https://unpkg.com/mp4-muxer@4.0.1/dist/mp4-muxer.min.js"></script></head>
    <body style="margin:0; background:black;">
      <canvas id="c" width="1280" height="720"></canvas>
      <script>
        async function run() {
          console.log("🎥 جاري بدء الريندر...");
          const muxer = new Mp4Muxer.Muxer({
            target: new Mp4Muxer.ArrayBufferTarget(),
            video: { codec: 'avc', width: 1280, height: 720 },
            fastStart: 'fragmented'
          });

          const encoder = new VideoEncoder({
            output: (chunk, metadata) => muxer.addVideoChunk(chunk, metadata),
            error: (e) => console.error("Encoder Error:", e)
          });

          encoder.configure({ codec: 'avc1.42E01E', width: 1280, height: 720, bitrate: 4_000_000 });

          const canvas = document.getElementById('c');
          const ctx = canvas.getContext('2d');

          for (let i = 0; i < 90; i++) {
            ctx.clearRect(0,0,1280,720);
            const t = i/30;
            try { ${userCode} } catch(e) {}
            
            const frame = new VideoFrame(canvas, { timestamp: i * 33333 }); // 30fps
            encoder.encode(frame, { keyFrame: i % 30 === 0 });
            frame.close();
          }

          await encoder.flush();
          muxer.finalize();
          console.log("🏁 الريندر اكتمل، جاري إرسال الملف...");
          window.saveMp4ChunkToNode(muxer.target.buffer);
        }
        run();
      </script>
    </body>
    </html>
  `);

  // حماية: لو السكريبت مخلصش في دقيقتين اقفله
  const timeout = setTimeout(() => {
    console.log("❌ التوقيت انتهى! السكريبت علّق.");
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
  console.log("🚀 انتهى كل شيء بنجاح.");
})();
