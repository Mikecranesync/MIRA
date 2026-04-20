import QRCode from "qrcode";
import { writeFile } from "node:fs/promises";

const targets = [
  {
    file: "C:/Users/hharp/Documents/MIRA/qr-TEST-VFD-01-prod.png",
    url: "https://app.factorylm.com/m/TEST-VFD-01",
    note: "Scan to hit prod (404 until #412 deploys)",
  },
  {
    file: "C:/Users/hharp/Documents/MIRA/qr-TEST-VFD-01-lan.png",
    url: "http://192.168.4.32:3201/m/TEST-VFD-01",
    note: "Scan to hit laptop (needs dev server + same Wi-Fi)",
  },
];

for (const t of targets) {
  const buf = await QRCode.toBuffer(t.url, {
    width: 512,
    errorCorrectionLevel: "M",
    margin: 2,
  });
  await writeFile(t.file, buf);
  console.log(`Wrote ${t.file}  (${buf.length} bytes) — ${t.note}`);
}
