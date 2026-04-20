import QRCode from "qrcode";

const targets = [
  {
    label: "A — FUTURE-PROD (won't work until #412 deploys)",
    url: "https://app.factorylm.com/m/TEST-VFD-01",
  },
  {
    label: "B — LAN DEV (works if mira-web is running on :3201 + phone on same Wi-Fi)",
    url: "http://192.168.4.32:3201/m/TEST-VFD-01",
  },
];

for (const t of targets) {
  console.log(`\n=== ${t.label} ===`);
  console.log(`URL: ${t.url}\n`);
  const ascii = await QRCode.toString(t.url, {
    type: "terminal",
    small: true,
    errorCorrectionLevel: "M",
  });
  console.log(ascii);
}
