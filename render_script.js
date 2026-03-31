const { chromium } = require('playwright');
const fs = require('fs');
const https = require('https');
const path = require('path');

const userCode = process.env.USER_CODE || '';
const libUrl = 'https://unpkg.com/mp4-muxer@4.0.1/dist/mp4-muxer.min.js';
const libPath = path.join(__dirname, 'mp4-muxer.js');

// دالة لتحميل المكتبة لو مش موجودة
async function downloadLib() {
    return new Promise((resolve, reject) => {
        console.log("📥 جاري التأكد من وجود المكتبة...");
        const file = fs.createWriteStream(libPath);
        https.get(libUrl, (response) => {
            response.pipe(file);
            file.on('finish', () => {
                file.close();
                console.log("✅ المكتبة جاهزة للعمل.");
                resolve();
            });
        }).on('error', (err) => {
            fs.unlink(libPath, () => reject(err));
        });
    });
}

(async () => {
  try {
    await downloadLib();

    console.log("🚀 تشغيل المتصفح...");
    const browser = await chromium.launch({
      args: ['--disable-gpu', '--no-sandbox']
    });
    
    const page = await browser.newPage();
    page.on('console', msg => console.log('BROWSER:', msg.text()));
    page.on('pageerror', err => console.log('BROWSER ERROR:', err.message));

    let done = false;
    await page.exposeFunction('saveVideo', (buffer) => {
        fs.writeFileSync('output.mp4', Buffer.from(buffer));
        console.log(`✅ تم حفظ الفيديو بنجاح!`);
        done = true;
    });

    await page.setContent(`
      <html>
        <body style="margin:0; background:black;">
          <canvas id="c" width="1280" height="720"></canvas>
        </body>
      </html>
    `);

    // حقن المكتبة من الملف اللي لسه محملينه حالا
    await page.addScriptTag({ path: libPath });

    await page.evaluate(async (code) => {
      try {
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

        encoder.configure({ codec: 'avc1.42E01E', width: 1280, height: 720, bitrate: 2000000 });

        const canvas = document.getElementById('c');
        const ctx = canvas.getContext('2d');

        for (let i = 0; i < 90; i++) {
          ctx.clearRect(0,0,1280,720);
          eval(code); 
          const frame = new VideoFrame(canvas, { timestamp: i * 33333 });
          encoder.encode(frame, { keyFrame: i % 30 === 0 });
          frame.close();
          if(i%30===0) console.log("⏳ Frame: " + i);
        }

        await encoder.flush();
        muxer.finalize();
        window.saveVideo(muxer.target.buffer);
      } catch(e) { console.error("Critical:", e.message); }
    }, userCode);

    const timeout = setTimeout(() => process.exit(1), 120000);
    while (!done) { await new Promise(r => setTimeout(r, 500)); }
    
    await browser.close();
    console.log("🚀 Done.");
    process.exit(0);

  } catch (err) {
    console.error("❌ Fatal Error:", err.message);
    process.exit(1);
  }
})();
