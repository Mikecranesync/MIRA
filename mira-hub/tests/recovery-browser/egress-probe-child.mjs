/** Runs UNDER the preload. Attempts every connection shape and prints one JSON verdict per attempt. */
import http from "node:http";
import net from "node:net";

const verdicts = {};
const attempt = (name, run) => Promise.race([
  run().then(() => "CONNECTED", (error) => `refused:${String(error.message).slice(0, 80)}`),
  new Promise((resolve) => setTimeout(() => resolve("TIMEOUT(no guard refusal)"), 3000)),
]).then((value) => { verdicts[name] = value; });
const tcp = (options, ...rest) => () => new Promise((resolve, reject) => {
  const socket = net.connect(options, ...rest, () => { socket.destroy(); resolve(); });
  socket.on("error", reject);
});
const portA = Number(process.env.PROBE_ALLOWED), portB = Number(process.env.PROBE_OTHER);

await attempt("allowed net.connect({host,port})", tcp({ host: "127.0.0.1", port: portA }));
await attempt("allowed net.connect(port,host)", tcp(portA, "127.0.0.1"));
await attempt("allowed http.get", () => new Promise((resolve, reject) => { http.get(`http://127.0.0.1:${portA}/`, () => resolve()).on("error", reject); }));
await attempt("allowed fetch", () => fetch(`http://127.0.0.1:${portA}/`));
await attempt("OTHER loopback net.connect({host,port})", tcp({ host: "127.0.0.1", port: portB }));
await attempt("OTHER loopback net.connect(port,host)", tcp(portB, "127.0.0.1"));
await attempt("OTHER loopback net.connect(port)", tcp(portB));
await attempt("OTHER loopback http.get", () => new Promise((resolve, reject) => { http.get(`http://127.0.0.1:${portB}/`, () => resolve()).on("error", reject); }));
await attempt("OTHER loopback fetch", () => fetch(`http://127.0.0.1:${portB}/`));
await attempt("unix socket net.connect({path})", tcp({ path: process.env.PROBE_UNIX }));
await attempt("unix socket net.connect(path)", tcp(process.env.PROBE_UNIX));
await attempt("documentation address net.connect", tcp({ host: "192.0.2.1", port: 80 }));
await attempt("documentation address fetch", () => fetch("http://192.0.2.1/"));
await attempt("hostname fetch", () => fetch("http://example.invalid/"));
console.log(JSON.stringify(verdicts));
