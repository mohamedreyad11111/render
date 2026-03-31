const { chromium } = require('playwright');
const fs = require('fs');

const userCode = process.env.USER_CODE || '';
const MUXER_URL = "https://cdn.jsdelivr.net/npm/mp4-muxer@5.2.2/build/mp4-muxer.min.js";

(async () => {
  try {
    console.log("🚀 جاري تفعيل وضع الريندر الأقصى...");

    const browser = await chromium.launch({
      headless: false, // خليه false عشان الـ WebCodecs بيشتغل أحسن في الـ Headful mode وxvfb هيقوم بالواجب
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-gpu',
        '--use-gl=swiftshader', // محاكي كارت شاشة سوفتوير
        '--enable-features=WebCodecs,Vulkan', // تفعيل المزايا يدوياً
        '--enable-blink-features=WebCodecs',
        '--ignore-gpu-blocklist', // تجاهل إن مفيش كارت شاشة
        '--disable-software-rasterizer',
        '--disable-dev-shm-usage'
      ]
    });
    
    const context = await browser.newContext();
    const page = await context.newPage();
    
    page.on('console', msg => console.log('BROWSER:', msg.text()));
    page.on('pageerror', err => console.log('BROWSER ERROR:', err.message));

    let done = false;
    await page.exposeFunction('saveVideo', (buffer) => {
        fs.writeFileSync('output.mp4', Buffer.from(buffer));
        console.log(`✅ تم الريندر وحفظ الملف بنجاح!`);
        done = true;
    });

    // هنحقن السكريبت بطريقة تانية عشان نتفادى الـ Block اللي ظهر في اللوج
    await page.goto('about:blank');
    await page.addScriptTag({ url: MUXER_URL });

    await page.evaluate(async (code) => {
      // دالة مساعدة للتأكد من الدعم
      const checkSupport = () => {
        return typeof VideoEncoder !== 'undefined';
      };

      if (!checkSupport()) {
        console.error("❌ لسه VideoEncoder مش شغال.. بنجرب Force Start...");
      }

      console.log("🎥 بدء عملية الإنكودر...");
      
      const muxer = new Mp4Muxer.Muxer({
        target: new Mp4Muxer.ArrayBufferTarget(),
        video: { codec: 'avc', width: 1280, height: 720 }
      });

      const encoder = new VideoEncoder({
        output: (chunk, metadata) => muxer.addVideoChunk(chunk, metadata),
        error: (e) => console.error("Encoder Error:", e.message)
      });

      // إعدادات الـ Software Encoding
      await encoder.configure({ 
        codec: 'avc1.42E01E', 
        width: 1280, 
        height: 720, 
        bitrate: 1_500_000,
        hardwareAcceleration: 'prefer-software' // دي أهم واحدة!
      });

      const canvas = document.createElement('canvas'); // بنعمل الكانفاس جوه الـ JS أضمن
      canvas.width = 1280;
      canvas.height = 720;
      document.body.appendChild(canvas);
      const ctx = canvas.getContext('2d');

      for (let i = 0; i < 90; i++) {
        ctx.clearRect(0, 0, 1280, 720);
        try {
          const t = i / 30;
          eval(code); 
        } catch(e) { console.error("User Code Error:", e.message); }
        
        const frame = new VideoFrame(canvas, { timestamp: i * 33333 });
        encoder.encode(frame, { keyFrame: i % 30 === 0 });
        frame.close();
        if(i % 30 === 0) console.log("⏳ Processing Frame: " + i);
      }

      await encoder.flush();
      muxer.finalize();
      window.saveVideo(muxer.target.buffer);
    }, userCode);

    // انتظار لحد ما يخلص
    let waitTimer = 0;
    while (!done && waitTimer < 120) {
      await new Promise(r => setTimeout(r, 1000));
      waitTimer++;
    }

    await browser.close();
    process.exit(done ? 0 : 1);

  } catch (err) {
    console.error("❌ Fatal Error:", err.message);
    process.exit(1);
  }
})();
