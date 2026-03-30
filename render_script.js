const { chromium } = require('playwright');
const fs = require('fs');

// جلب كود المستخدم من المتغيرات البيئية
const userCode = process.env.USER_CODE || '';

(async () => {
  console.log("🚀 بدء تشغيل المتصفح الوهمي لريندر WebCodecs...");
  // تشغيل المتصفح مع دعم تقنيات الفيديو الحديثة
  const browser = await chromium.launch({
    args: ['--enable-webcodecs', '--use-gl=angle', '--use-angle=vulkan'] 
  });
  const page = await browser.newPage();
  
  const outputPath = 'output.mp4';
  if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); // مسح القديم لو موجود

  // 1. إنشاء الجسر: دالة في Node.js سيتم استدعاؤها من داخل المتصفح
  let done = false;
  await page.exposeFunction('saveMp4ChunkToNode', (chunkBuffer) => {
    // استقبال الـ Buffer النهائي وحفظه مباشرة في ملف MP4
    if (chunkBuffer) {
      fs.writeFileSync(outputPath, Buffer.from(chunkBuffer));
      console.log(`✅ تم استقبال وحفظ الفيديو النهائي (${chunkBuffer.byteLength} بايت).`);
      done = true;
    }
  });

  // 2. حقن HTML ومكتبة الـ Muxer الأساسية (Web Muxer لتغليف WebCodecs)
  await page.setContent(`
    <html>
    <head>
      <script src="https://unpkg.com/mp4-muxer@4.0.1/dist/mp4-muxer.min.js"></script>
    </head>
    <body style="margin: 0; background: black;">
      <canvas id="c" width="1280" height="720"></canvas>
      <script>
        // تعريف سياق الكانفاس
        const canvas = document.getElementById('c');
        const ctx = canvas.getContext('2d');
        const width = 1280;
        const height = 720;
        const fps = 30;
        const totalFrames = 90; // 3 ثواني للتجربة

        async function startWebCodecsRender() {
          console.log("🎥 بدء عملية الريندر عبر WebCodecs...");

          // أ. إعداد الـ Muxer لتغليف الفيديو في حاوية MP4
          const muxer = new Mp4Muxer.Muxer({
            target: new Mp4Muxer.ArrayBufferTarget(),
            video: {
              codec: 'avc', // استخدام h264
              width: width,
              height: height
            },
            fastStart: 'fragmented' // مناسب للتدفق
          });

          // ب. إعداد الـ VideoEncoder (WebCodecs API)
          const encoder = new VideoEncoder({
            output: (chunk, metadata) => muxer.addVideoChunk(chunk, metadata), // إرسال الخام لـ Muxer
            error: (e) => console.error(e),
          });

          const config = {
            codec: 'avc1.42E01E', // h264 baseline
            width: width,
            height: height,
            bitrate: 4_000_000, // 4 Mbps لضمان الجودة
            framerate: fps,
          };
          
          // التأكد من دعم المتصفح للإعدادات
          const support = await VideoEncoder.isConfigSupported(config);
          if (!support.supported) {
            console.error("❌ المتصفح لا يدعم إعدادات WebCodecs هذه.");
            return;
          }
          encoder.configure(config);

          // ج. حلقة الريندر (حقن كود المستخدم ورسم الفريمات)
          for (let i = 0; i < totalFrames; i++) {
            ctx.clearRect(0, 0, width, height);
            const t = i / fps; // توفير متغير الزمن لكود المستخدم
            
            // --- حقن كود المستخدم هنا ---
            try {
              ${userCode}
            } catch (e) { console.error("Error in User Code:", e); }
            // ---------------------------

            // تحويل الكانفاس لـ VideoFrame (قلب WebCodecs)
            const frame = new VideoFrame(canvas, { timestamp: i * (1_000_000 / fps) }); // تحويل الميكروثانية
            
            // إرسال الفريم للإنكودر (Keyframe كل ثانيتين كحد أقصى)
            encoder.encode(frame, { keyFrame: i % 60 === 0 });
            frame.close(); // إغلاق الفريم لتوفير الذاكرة
          }

          // د. إنهاء العملية
          await encoder.flush();
          muxer.finalize(); // إنهاء ملف MP4 في الذاكرة

          // هـ. إرسال ملف الـ MP4 النهائي (ArrayBuffer) إلى Node.js عبر الجسر
          const buffer = muxer.target.buffer;
          await sendMp4ChunkToNode(buffer); 
        }

        // بدء التنفيذ
        startWebCodecsRender();
      </script>
    </body>
    </html>
  `);

  // 3. انتظار جيتهاب حتى ينتهي المتصفح من الريندر (الوصول لإشارة Done عبر الجسر)
  await new Promise(resolve => {
    const check = setInterval(() => {
      if (done) {
        clearInterval(check);
        resolve();
      }
    }, 100);
  });

  await browser.close();
  console.log("✅ اكتملت عملية الريندر عبر WebCodecs وتم حفظ الملف!");
})();
