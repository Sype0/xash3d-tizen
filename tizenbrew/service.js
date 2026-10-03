/*
 * TizenBrew service: lets a phone on the same network send the game data
 * zip to the TV.
 *
 * TizenBrew runs this file in a Node.js vm sandbox on the TV (Node 4 on old
 * models), so stick to ES5 and built-in modules.
 *
 * The zip is hundreds of MB, so it is never buffered here: the TV app keeps
 * a request open and the phone's upload is piped straight into its response.
 *
 *   phone  --GET /-------------> phone.html (proxied from the module files)
 *   TV app --GET /api/data-----> stays open until a phone uploads
 *   phone  --POST /api/upload--> body is piped into the open /api/data response
 */
"use strict";

var http = require("http");
var https = require("https");
var os = require("os");

var PORT = 8086;
var FILES_BASE = (typeof process !== "undefined" && process.env && process.env.XASH_PHONE_BASE) ||
   "https://cdn.jsdelivr.net/gh/Sype0/xash3d-tizen/app/";
var CORS = {
   "Access-Control-Allow-Origin": "*",
   "Access-Control-Allow-Headers": "*",
   "Cache-Control": "no-store"
};

var waiting = null;   /* the TV app's open /api/data response */
var busy = false;     /* an upload is being piped into it */
var phonePage = null; /* { data, at } */

function localIp() {
   var ifaces = os.networkInterfaces();
   var best = null;
   Object.keys(ifaces).forEach(function (name) {
      ifaces[name].forEach(function (a) {
         if (a.family !== "IPv4" && a.family !== 4) return;
         if (a.internal) return;
         /* prefer private LAN ranges */
         if (!best || /^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))/.test(a.address)) best = a.address;
      });
   });
   return best || "127.0.0.1";
}

function send(res, status, body, type) {
   var head = { "Content-Type": type || "application/json; charset=utf-8" };
   Object.keys(CORS).forEach(function (h) { head[h] = CORS[h]; });
   try {
      res.writeHead(status, head);
      res.end(body);
   } catch (e) { /* connection already gone */ }
}

function kill(stream) {
   var sock = stream.socket || stream.connection;
   if (sock) sock.destroy();
}

function servePhonePage(res) {
   var type = "text/html; charset=utf-8";
   if (phonePage && Date.now() - phonePage.at < 10 * 60 * 1000) {
      send(res, 200, phonePage.data, type);
      return;
   }
   var url = FILES_BASE + "phone.html";
   (url.indexOf("https:") === 0 ? https : http).get(url, function (r) {
      var chunks = [];
      r.on("data", function (c) { chunks.push(c); });
      r.on("end", function () {
         if (r.statusCode === 200) phonePage = { data: Buffer.concat(chunks), at: Date.now() };
         if (phonePage) send(res, 200, phonePage.data, type);
         else send(res, 502, "The TV could not download the page: HTTP " + r.statusCode, "text/plain; charset=utf-8");
      });
   }).on("error", function (err) {
      if (phonePage) send(res, 200, phonePage.data, type);
      else send(res, 502, "The TV could not reach the internet: " + err.message, "text/plain; charset=utf-8");
   });
}

function handleData(req, res) {
   if (busy) { send(res, 409, "{}"); return; }
   if (waiting) send(waiting, 409, "{}"); /* an older launcher instance */
   waiting = res;
   req.on("close", function () {
      if (waiting === res && !busy) waiting = null;
   });
}

function handleUpload(req, res) {
   if (!waiting || busy) {
      send(res, 503, JSON.stringify({
         error: busy ? "Another transfer is in progress." : "The TV is not ready. The Xash3D launcher must be open on the TV."
      }));
      req.resume();
      return;
   }
   var tv = waiting;
   var done = false;
   busy = true;

   function finish(failed) {
      if (done) return;
      done = true;
      busy = false;
      waiting = null;
      if (failed) {
         kill(tv); /* the TV app sees a broken download */
         send(res, 500, JSON.stringify({ error: "The transfer was interrupted." }));
      } else {
         send(res, 200, JSON.stringify({ ok: true }));
      }
   }

   var head = { "Content-Type": "application/zip" };
   Object.keys(CORS).forEach(function (h) { head[h] = CORS[h]; });
   if (req.headers["content-length"]) head["Content-Length"] = req.headers["content-length"];
   tv.writeHead(200, head);

   req.pipe(tv);
   req.on("end", function () { finish(false); });
   req.on("error", function () { finish(true); });
   req.on("close", function () { finish(true); });   /* phone gave up; no-op after "end" */
   tv.on("close", function () {                      /* TV app gave up */
      if (done) return;
      req.unpipe(tv);
      kill(req);
      finish(true);
   });
}

var server = http.createServer(function (req, res) {
   var path = req.url.split("?")[0];
   if (req.method === "OPTIONS") { send(res, 204, ""); return; }

   if (path === "/api/info") {
      var ip = localIp();
      send(res, 200, JSON.stringify({ ip: ip, port: PORT, url: "http://" + ip + ":" + PORT + "/" }));
   } else if (path === "/api/data") {
      handleData(req, res);
   } else if (path === "/api/upload" && req.method === "POST") {
      handleUpload(req, res);
   } else if (path === "/" || path === "/phone.html") {
      servePhonePage(res);
   } else {
      send(res, 404, "Not found", "text/plain");
   }
});

/* /api/data stays open for as long as the launcher is on screen */
server.timeout = 0;

server.on("error", function (e) {
   /* Already running from an earlier launch of the module. */
   if (e.code !== "EADDRINUSE") console.log("[xash3d-tizen] service error: " + e.message);
});

server.listen(PORT, "0.0.0.0");
