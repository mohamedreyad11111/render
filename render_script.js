const { chromium } = require('playwright');
const fs = require('fs');

const userCode = process.env.USER_CODE || '';
const MUXER_URL = "https://cdn.jsdelivr.net/npm/mp4-muxer@5.2.2/build/mp4-muxer.min.js";

(async () => {
  try {
    console.log("🚀 تشغيل وضع الريندر الأقصى (V5.2.2 Optimized)...");

    const browser = await chromium.launch({
      headless: false, // ضروري جداً لفتح الـ WebCodecs في بيئة جيتهاب
      args: [
        '--no-sandbox',
        '--disable-gpu',
        '--use-gl=swiftshader',
        '--enable-webcodecs',
        '--ignore-gpu-blocklist',
        '--disable-dev-shm-usage'
      ]
    });
    
    const page = await browser.newPage();
    page.on('console', msg => console.log('BROWSER:', msg.text()));
    page.on('pageerror', err => console.log('BROWSER ERROR:', err.message));

    let done = false;
    await page.exposeFunction('saveVideo', (buffer) => {
        fs.writeFileSync('output.mp4', Buffer.from(buffer));
        console.log(`✅ عاااش! الفيديو اتحفظ في output.mp4`);
        done = true;
    });

    await page.goto('about:blank');
    await page.addScriptTag({ url: MUXER_URL });

    await page.evaluate(async (code) => {
      // انتظار بسيط للتأكد من تحميل كل الـ Features
      await new Promise(r => setTimeout(r, 1000));

      if (typeof VideoEncoder === 'undefined') {
        console.error("❌ للأسف VideoEncoder لسه مش مدعوم في النسخة دي.");
        return;
      }

      try {
        console.log("🎥 بدء الموكسر والإنكودر...");
        
        const muxer = new Mp4Muxer.Muxer({
          target: new Mp4Muxer.ArrayBufferTarget(),
          video: { 
            codec: 'avc', 
            width: 1280, 
            height: 720 
          },
          // التصليح هنا: النسخة الجديدة بتقبل 'fragmented' كقيمة صحيحة 
          // أو لازم تتشال لو هتعمل مشاكل
          fastStart: 'in-memory' 
        });

        const encoder = new VideoEncoder({
          output: (chunk, metadata) => muxer.addVideoChunk(chunk, metadata),
          error: (e) => console.error("Encoder Error:", e.message)
        });

        await encoder.configure({ 
          codec: 'avc1.42E01E', 
          width: 1280, 
          height: 720, 
          bitrate: 1_500_000,
          hardwareAcceleration: 'prefer-software' 
        });

        const canvas = document.createElement('canvas');
        canvas.width = 1280; canvas.height = 720;
        document.body.appendChild(canvas);
        const ctx = canvas.getContext('2d');

        for (let i = 0; i < 90; i++) {
          ctx.clearRect(0, 0, 1280, 720);
          const t = i / 30;
          try { eval(code); } catch(e) { }
          
          const frame = new VideoFrame(canvas, { timestamp: i * 33333 });
          encoder.encode(frame, { keyFrame: i % 30 === 0 });
          frame.close();
        }

        await encoder.flush();
        muxer.finalize();
        window.saveVideo(muxer.target.buffer);
      } catch(err) {
        console.error("CRITICAL:", err.message);
      }
    }, userCode);

    // تايم أوت للانتظار
    let timer = 0;
    while (!done && timer < 60) {
      await new Promise(r => setTimeout(r, 1000));
      timer++;
    }

    await browser.close();
    process.exit(done ? 0 : 1);
  } catch (err) {
    console.error("❌ Fatal Error:", err.message);
    process.exit(1);
  }
})();
