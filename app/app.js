/*
 * Xash3D for Tizen - launcher and glue around the Xash3D FWGS WebAssembly
 * build (npm package xash3d-fwgs, dist/raw.js).
 *
 * The game data is not part of this app: the valve folder of the user's own
 * Half-Life copy is downloaded as a zip from a machine on the local network
 * and unpacked into the engine's in-memory filesystem.
 */
(function () {
   "use strict";

   var REMOTE_BASE = "https://sype0.github.io/xash3d-tizen/";
   var GAME_ROOT = "/rodir";
   var GAME_DIR = GAME_ROOT + "/valve";

   /* Inside the .wgt (file://) and inside TizenBrew (served by its local
      proxy on 127.0.0.1) the engine comes from GitHub Pages. */
   var ASSET_BASE = (function () {
      var m = /[?&]base=([^&]+)/.exec(location.search);
      if (m) return decodeURIComponent(m[1]);
      if (location.protocol === "file:" || location.hostname === "127.0.0.1")
         return REMOTE_BASE;
      return "./";
   })();
   var ENGINE = ASSET_BASE + "engine/";

   function param(name) {
      var m = new RegExp("[?&]" + name + "=([^&]*)").exec(location.search);
      return m ? decodeURIComponent(m[1]) : null;
   }

   var hasTizen = typeof tizen !== "undefined";
   var $ = function (id) { return document.getElementById(id); };
   var canvas = $("canvas");

   (window.__xashEarlyErrors || []).forEach(window.xashShowError);

   function log() {
      console.log.apply(console, ["[xash-tizen]"].concat([].slice.call(arguments)));
   }

   /* ------------------------------------------------------------------ */
   /* Remote keys                                                          */
   /* ------------------------------------------------------------------ */

   var TV_KEYS = ["ColorF0Red", "ColorF1Green", "ColorF2Yellow", "ColorF3Blue",
      "MediaPlayPause", "MediaPlay", "MediaPause", "MediaRewind", "MediaFastForward",
      "ChannelUp", "ChannelDown",
      "0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];

   if (hasTizen && tizen.tvinputdevice) {
      TV_KEYS.forEach(function (k) {
         try { tizen.tvinputdevice.registerKey(k); } catch (e) { /* not on this model */ }
      });
   }

   var KEY = {
      LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13,
      BACK: 10009, ESC: 27, BACKSPACE: 8, IME_DONE: 65376
   };

   function k(code, key, keyCode) { return { code: code, key: key, keyCode: keyCode }; }

   /* Remote key -> keyboard key bound in Half-Life's default config. */
   var REMOTE_MAP = {
      37: k("ArrowLeft", "ArrowLeft", 37),
      38: k("ArrowUp", "ArrowUp", 38),
      39: k("ArrowRight", "ArrowRight", 39),
      40: k("ArrowDown", "ArrowDown", 40),
      13: k("Enter", "Enter", 13),
      10009: k("Escape", "Escape", 27),
      403: k("Space", " ", 32),
      404: k("KeyE", "e", 69),
      405: k("KeyR", "r", 82),
      406: k("ControlLeft", "Control", 17),
      427: k("BracketRight", "]", 221),
      428: k("BracketLeft", "[", 219),
      10252: k("F6", "F6", 117),
      415: k("F6", "F6", 117),
      19: k("F6", "F6", 117),
      412: k("F7", "F7", 118)
   };
   for (var d = 0; d <= 9; d++) REMOTE_MAP[48 + d] = k("Digit" + d, String(d), 48 + d);

   function sendKey(type, m) {
      var ev = new KeyboardEvent(type, { key: m.key, code: m.code, bubbles: true, cancelable: true });
      try {
         Object.defineProperty(ev, "keyCode", { get: function () { return m.keyCode; } });
         Object.defineProperty(ev, "which", { get: function () { return m.keyCode; } });
      } catch (e) { /* ignore */ }
      ev.__xash = true;
      canvas.dispatchEvent(ev);
   }

   var playing = false;

   function onKey(e) {
      if (e.__xash) return;
      if (engineDead) {
         /* a stopped engine cannot be restarted in the same page */
         e.preventDefault();
         if (e.type === "keydown") location.reload();
         return;
      }
      if (playing) {
         /* SDL keys off event.code, which TV remotes don't provide;
            re-dispatch a proper keyboard event. Real keyboards pass through. */
         if (e.code && e.keyCode < 256) return;
         var m = REMOTE_MAP[e.keyCode];
         if (!m) return;
         e.preventDefault();
         e.stopImmediatePropagation();
         sendKey(e.type, m);
         return;
      }
      if (e.type !== "keydown") return;
      if (loadingActive) { e.preventDefault(); return; }
      navKey(e);
   }

   window.addEventListener("keydown", onKey, true);
   window.addEventListener("keyup", onKey, true);

   /* ------------------------------------------------------------------ */
   /* Launcher navigation                                                  */
   /* ------------------------------------------------------------------ */

   var screenStack = [];
   var currentScreen = null;

   function showScreen(id, push) {
      if (push !== false && currentScreen) screenStack.push(currentScreen);
      var screens = document.querySelectorAll(".screen");
      for (var i = 0; i < screens.length; i++) screens[i].classList.remove("active");
      currentScreen = id;
      $(id).classList.add("active");
      setFocus(focusables()[0]);
   }

   function goBack() {
      if (!screenStack.length) {
         exitApp();
         return;
      }
      showScreen(screenStack.pop(), false);
   }

   function exitApp() {
      if (hasTizen && tizen.application) {
         try { tizen.application.getCurrentApplication().exit(); return; } catch (e) { /* ignore */ }
      }
      history.back();
   }

   function focusables() {
      return [].slice.call($(currentScreen).querySelectorAll(".btn, .item, input.focusable"));
   }

   function setFocus(el) {
      var old = document.querySelector(".focused");
      if (old) old.classList.remove("focused");
      if (!el) return;
      el.classList.add("focused");
      if (el.tagName === "INPUT") el.focus();
      else if (document.activeElement && document.activeElement.tagName === "INPUT") document.activeElement.blur();
   }

   function moveFocus(step) {
      var els = focusables();
      var i = els.indexOf(document.querySelector(".focused"));
      var next = els[i + step];
      if (i < 0) next = els[0];
      if (next) setFocus(next);
   }

   function navKey(e) {
      var focused = document.querySelector(".focused");
      var inInput = focused && focused.tagName === "INPUT";
      switch (e.keyCode) {
         case KEY.LEFT: if (inInput) return; moveFocus(-1); break;
         case KEY.RIGHT: if (inInput) return; moveFocus(1); break;
         case KEY.UP: moveFocus(-1); break;
         case KEY.DOWN: moveFocus(1); break;
         case KEY.IME_DONE:
         case KEY.ENTER:
            if (inInput) { $("btn-url-ok").click(); break; }
            if (focused) focused.click();
            break;
         case KEY.BACK:
         case KEY.ESC:
            goBack();
            break;
         case KEY.BACKSPACE:
            if (inInput) return;
            goBack();
            break;
         default:
            return;
      }
      e.preventDefault();
   }

   /* Gamepad support in the launcher (the engine handles pads itself). */
   var padPrev = {};
   function pollPads() {
      if (!playing && navigator.getGamepads) {
         var pads = navigator.getGamepads();
         for (var i = 0; i < pads.length; i++) {
            var p = pads[i];
            if (!p) continue;
            var map = { 12: KEY.UP, 13: KEY.DOWN, 0: KEY.ENTER, 1: KEY.BACK };
            var ax = p.axes || [];
            var state = {
               12: p.buttons[12] && p.buttons[12].pressed || ax[1] < -0.6,
               13: p.buttons[13] && p.buttons[13].pressed || ax[1] > 0.6,
               0: p.buttons[0] && p.buttons[0].pressed,
               1: p.buttons[1] && p.buttons[1].pressed
            };
            Object.keys(map).forEach(function (b) {
               var id = i + ":" + b;
               if (state[b] && !padPrev[id] && !loadingActive)
                  navKey({ keyCode: map[b], preventDefault: function () {} });
               padPrev[id] = state[b];
            });
         }
      }
      if (!playing) requestAnimationFrame(pollPads);
   }
   requestAnimationFrame(pollPads);

   function fmtSize(n) {
      if (n > 1048576) return (n / 1048576).toFixed(1) + " MB";
      return Math.max(1, Math.round(n / 1024)) + " KB";
   }

   /* ------------------------------------------------------------------ */
   /* Loading overlay                                                      */
   /* ------------------------------------------------------------------ */

   var loadingActive = false;

   function loading(text, frac) {
      loadingActive = text !== null;
      $("loading").classList.toggle("active", loadingActive);
      if (text) $("loading-text").textContent = text;
      $("loading-bar").style.width = (frac == null ? 0 : Math.round(frac * 100)) + "%";
   }

   function fail(msg, err) {
      loading(null);
      window.xashShowError(msg + (err ? ": " + (err.message || err) : ""));
      log(msg, err);
   }

   function loadScript(url) {
      return new Promise(function (resolve, reject) {
         var s = document.createElement("script");
         s.src = url;
         s.onload = resolve;
         s.onerror = function () { reject(new Error("Script yüklenemedi: " + url)); };
         document.body.appendChild(s);
      });
   }

   function fetchBytes(url) {
      return fetch(url).then(function (res) {
         if (!res.ok) throw new Error("HTTP " + res.status + " " + url);
         return res.arrayBuffer();
      }).then(function (buf) { return new Uint8Array(buf); });
   }

   /* ------------------------------------------------------------------ */
   /* Game data: streamed download + unzip                                 */
   /* ------------------------------------------------------------------ */

   /* Left out to save memory: native libraries (the wasm ones are used
      instead), videos, PC saves and, unless ?music=1, the soundtrack. */
   var SKIP = /^(cl_dlls|dlls|save)\/|\.(dll|so|dylib|exe|avi|bik)$/i;
   var SKIP_MUSIC = /^media\/|\.mp3$/i;
   var wantMusic = param("music") === "1";

   /* "Half-Life/valve/maps/c0a0.bsp" -> "/rodir/valve/maps/c0a0.bsp" */
   function gamePath(name) {
      name = name.replace(/\\/g, "/");
      var m = /(^|\/)valve\/(.+)$/i.exec(name);
      if (!m || name.charAt(name.length - 1) === "/") return null;
      if (SKIP.test(m[2]) || (!wantMusic && SKIP_MUSIC.test(m[2]))) return null;
      return GAME_DIR + "/" + m[2];
   }

   /* The zip is never held in memory as a whole: network chunks go straight
      into the unzipper and only the unpacked files are kept. */
   function unzipResponse(res, files) {
      return Promise.resolve().then(function () {
         if (!res.ok) throw new Error("HTTP " + res.status + " " + res.url);
         var total = parseInt(res.headers.get("Content-Length"), 10) || 0;
         var loaded = 0, count = 0, bytes = 0, zipErr = null;
         var unz = new fflate.Unzip();
         unz.register(fflate.UnzipInflate);
         unz.onfile = function (file) {
            var path = gamePath(file.name);
            if (!path) return;
            var buf = file.originalSize != null ? new Uint8Array(file.originalSize) : null;
            var parts = [], off = 0;
            file.ondata = function (err, chunk, final) {
               if (err) { zipErr = err; return; }
               if (buf) buf.set(chunk, off);
               else parts.push(chunk.slice());
               off += chunk.length;
               if (!final) return;
               if (!buf) {
                  buf = new Uint8Array(off);
                  for (var i = 0, o = 0; i < parts.length; o += parts[i++].length) buf.set(parts[i], o);
               }
               files[path] = buf;
               count++;
               bytes += off;
            };
            file.start();
         };
         var reader = res.body.getReader();
         function pump() {
            return reader.read().then(function (r) {
               if (zipErr) throw zipErr;
               if (r.done) { unz.push(new Uint8Array(0), true); return; }
               loaded += r.value.length;
               unz.push(r.value);
               loading("Oyun dosyaları alınıyor (" + fmtSize(loaded) + (total ? " / " + fmtSize(total) : "") + ")",
                  total ? loaded / total : null);
               return pump();
            });
         }
         return pump().then(function () {
            if (zipErr) throw zipErr;
            if (!count) throw new Error("zip içinde valve klasörü bulunamadı");
            log("game data:", count, "files,", fmtSize(bytes));
         });
      });
   }

   /* ------------------------------------------------------------------ */
   /* Saves and settings (IndexedDB)                                       */
   /* ------------------------------------------------------------------ */

   var DB_NAME = "xash3d-tizen";      /* what the engine wrote: saves, .cfg */
   var GAME_DB = "xash3d-game";       /* unpacked game data, so it is sent only once */
   var STORE = "files";

   function openDb(name) {
      return new Promise(function (resolve, reject) {
         if (!window.indexedDB) { reject(new Error("IndexedDB yok")); return; }
         var req = indexedDB.open(name, 1);
         req.onupgradeneeded = function () { req.result.createObjectStore(STORE); };
         req.onsuccess = function () { resolve(req.result); };
         req.onerror = function () { reject(req.error); };
      });
   }

   /* Puts what the engine wrote in earlier sessions on top of the game data. */
   function deleteDb(name) {
      return new Promise(function (resolve, reject) {
         if (!window.indexedDB) { resolve(); return; }
         var req = indexedDB.deleteDatabase(name);
         req.onsuccess = resolve;
         req.onerror = function () { reject(req.error); };
      });
   }

   /* Copies every stored file (path -> Uint8Array) into files. */
   function readAll(db, files, onCount) {
      return new Promise(function (resolve, reject) {
         var n = 0;
         var req = db.transaction(STORE).objectStore(STORE).openCursor();
         req.onsuccess = function () {
            var c = req.result;
            if (!c) { resolve(n); return; }
            files[c.key] = c.value;
            n++;
            if (onCount && n % 100 === 0) onCount(n);
            c.continue();
         };
         req.onerror = function () { reject(req.error); };
      });
   }

   function gameCached() {
      try { return localStorage.getItem("xash_game_cached") === "1"; } catch (e) { return false; }
   }

   function setGameCached(on) {
      try {
         if (on) localStorage.setItem("xash_game_cached", "1");
         else localStorage.removeItem("xash_game_cached");
      } catch (e) { /* ignore */ }
   }

   /* Keeps the unpacked game data on the TV. Without it (storage full or
      unavailable) the game still starts, the data just has to be sent again. */
   function cacheGame(files) {
      setGameCached(false);
      var paths = Object.keys(files);
      var i = 0;
      return deleteDb(GAME_DB).then(function () { return openDb(GAME_DB); }).then(function (db) {
         function next() {
            if (i >= paths.length) return;
            return new Promise(function (resolve, reject) {
               var tx = db.transaction(STORE, "readwrite");
               var st = tx.objectStore(STORE);
               /* a transaction per ~16 MB keeps the copies made by put() small */
               for (var bytes = 0; i < paths.length && bytes < 16777216; i++) {
                  st.put(files[paths[i]], paths[i]);
                  bytes += files[paths[i]].length;
               }
               tx.oncomplete = resolve;
               tx.onerror = tx.onabort = function () { reject(tx.error || new Error("IndexedDB")); };
            }).then(function () {
               loading("TV'ye kaydediliyor…", i / paths.length);
               return next();
            });
         }
         return Promise.resolve(next()).then(function () {
            db.close();
            setGameCached(true);
            if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
         }, function (e) { db.close(); throw e; });
      }).catch(function (e) {
         log("game data not kept on the TV:", e);
         return deleteDb(GAME_DB).catch(function () {});
      });
   }

   function loadCachedGame(files) {
      return openDb(GAME_DB).then(function (db) {
         return readAll(db, files, function (n) {
            loading("Oyun dosyaları okunuyor (" + n + ")", null);
         }).then(function (n) {
            db.close();
            if (!n) { setGameCached(false); throw new Error("TV'de kayıtlı oyun dosyası yok"); }
            log("game data:", n, "files (cached)");
         });
      });
   }

   function restoreUserFiles(files) {
      return openDb(DB_NAME).then(function (db) {
         return readAll(db, files).then(function () { return db; });
      }).catch(function (e) {
         log("saves will not persist:", e);
         return null;
      });
   }

   /* Saved games and the .cfg files the engine writes into the game folder. */
   function userFiles(FS) {
      var out = {};
      function scan(dir, test) {
         var names;
         try { names = FS.readdir(dir); } catch (e) { return; }
         names.forEach(function (n) {
            if (n === "." || n === ".." || !test(n)) return;
            var st = FS.stat(dir + "/" + n);
            if (FS.isFile(st.mode)) out[dir + "/" + n] = +st.mtime;
         });
      }
      scan(GAME_DIR + "/save", function () { return true; });
      scan(GAME_DIR, function (n) { return /\.cfg$/i.test(n); });
      return out;
   }

   function startPersisting(FS, db) {
      var stored = userFiles(FS); /* state at boot: nothing to write yet */
      setInterval(function () {
         var now = userFiles(FS), tx = null;
         function store() { return (tx = tx || db.transaction(STORE, "readwrite")).objectStore(STORE); }
         Object.keys(now).forEach(function (p) {
            if (stored[p] !== now[p]) store().put(FS.readFile(p), p);
         });
         Object.keys(stored).forEach(function (p) {
            if (!(p in now)) store().delete(p);
         });
         stored = now;
      }, 5000);
   }

   function wipe(btn, name, after) {
      var meta = $(btn).querySelector(".meta");
      deleteDb(name).then(function () {
         meta.textContent = "silindi";
         if (after) after();
      }, function () { meta.textContent = "silinemedi"; });
   }

   /* ------------------------------------------------------------------ */
   /* Starting the engine                                                  */
   /* ------------------------------------------------------------------ */

   var ENGINE_FILES = {
      "xash.wasm": "xash.wasm",
      "filesystem_stdio.wasm": "filesystem_stdio.wasm",
      "libref_webgl2.wasm": "libref_webgl2.wasm",
      "cl_dlls/menu_emscripten_wasm32.wasm": "libmenu.wasm",
      "dlls/hl_emscripten_wasm32.wasm": "hl_emscripten_wasm32.wasm",
      "cl_dlls/client_emscripten_wasm32.wasm": "client_emscripten_wasm32.wasm"
   };

   var engineLog = [];
   var engineStarted = false, engineDead = false;
   var frames = 0, lastFrame = 0;

   function engineFailed(what) {
      if (engineDead) return;
      engineDead = true;
      playing = false;
      document.body.classList.remove("playing");
      $("errors").textContent = "";
      fail("Motor durdu" + (what ? " (" + what + ")" : "") + ":\n" + engineLog.slice(-6).join("\n") +
         "\nBaşlatıcıya dönmek için bir tuşa bas.");
   }

   /* A fatal engine error during start-up (missing or broken game data)
      unwinds out of main() as an uncaught exception. */
   function onUncaught() {
      if (engineStarted && !frames) engineFailed();
   }
   window.addEventListener("error", onUncaught);
   window.addEventListener("unhandledrejection", onUncaught);

   function onEngineLog(text) {
      console.log("xash:", text);
      engineLog.push(text);
      if (engineLog.length > 200) engineLog.shift();
   }

   /* Render below the panel resolution and let the compositor scale it up. */
   function sizeCanvas() {
      var h = parseInt(param("res"), 10) || 720;
      var w = Math.round(h * window.innerWidth / window.innerHeight);
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      canvas.style.transform = "scale(" + (window.innerWidth / w) + ")";
      return ["-width", String(w), "-height", String(h)];
   }

   function startEngine(files, db) {
      var extra = (param("args") || "").split(" ").filter(Boolean);

      return Xash3D({
         arguments: ["-windowed", "-ref", "webgl2"].concat(sizeCanvas(), extra),
         canvas: canvas,
         dynamicLibraries: Object.keys(ENGINE_FILES).filter(function (f) { return f !== "xash.wasm"; }),
         locateFile: function (p) { return ENGINE_FILES[p] ? ENGINE + ENGINE_FILES[p] : p; },
         print: onEngineLog,
         printErr: onEngineLog,
         postMainLoop: function () { frames++; lastFrame = Date.now(); },
         onAbort: engineFailed,
         onRuntimeInitialized: function () {
            var FS = this.FS;
            var made = {};
            Object.keys(files).forEach(function (p) {
               var dir = p.slice(0, p.lastIndexOf("/"));
               if (!made[dir]) { FS.mkdirTree(dir); made[dir] = true; }
               /* canOwn: the filesystem keeps our buffer instead of copying it */
               FS.writeFile(p, files[p], { canOwn: true });
               delete files[p];
            });
            FS.chdir(GAME_ROOT);
            try { FS.mkdir("/rwdir"); } catch (e) { /* exists */ }
            if (db) startPersisting(FS, db);

            loading(null);
            engineStarted = true;
            playing = true;
            document.body.classList.add("playing");
            canvas.focus();

            /* "Quit" in the game menu stops the main loop without telling
               us; go back to the launcher when frames stop coming. */
            setInterval(function () {
               if (frames && !engineDead && !document.hidden && Date.now() - lastFrame > 4000)
                  location.reload();
            }, 1000);
            /* frames also stop while the app is in the background */
            document.addEventListener("visibilitychange", function () { lastFrame = Date.now(); });
         }
      }).then(function (mod) {
         window.__xash = mod;
      });
   }

   /* getFiles(files) fills files from one of the sources below. */
   function loadGame(what, getFiles) {
      if (phoneAbort) { phoneAbort.abort(); phoneAbort = null; }
      var files = {};
      var db = null;
      loading("Oyun dosyaları alınıyor…", null);
      getFiles(files).then(function () {
         return restoreUserFiles(files);
      }).then(function (d) {
         db = d;
         loading("Motor indiriliyor…", null);
         return Promise.all([fetchBytes(ENGINE + "extras.pk3"), loadScript(ENGINE + "raw.js")]);
      }).then(function (r) {
         files[GAME_DIR + "/extras.pk3"] = r[0];
         loading("Başlatılıyor…", 1);
         return startEngine(files, db);
      }).catch(function (err) {
         playing = false;
         document.body.classList.remove("playing");
         fail("Başlatılamadı (" + what + ")", err);
         updateHome();
         if (phoneLink) waitForPhone();
      });
   }

   function startFromUrl(url) {
      loadGame(url, function (files) {
         return fetch(url).then(function (res) {
            return unzipResponse(res, files);
         }).then(function () { return cacheGame(files); });
      });
   }

   function startGame() {
      var url = savedUrl();
      if (param("data")) startFromUrl(url);
      else if (gameCached()) loadGame("TV'deki kayıt", loadCachedGame);
      else if (url) startFromUrl(url);
      else showScreen("screen-howto");
   }

   /* ---- Phone link (TizenBrew service in tizenbrew/service.js) ----
      The service relays the zip the phone uploads straight into a request
      this app keeps open, so nothing is buffered on the way. */

   var SERVICE = "http://127.0.0.1:8086/";
   var phoneLink = false;
   var phoneAbort = null;

   function waitForPhone() {
      if (playing || loadingActive || phoneAbort) return;
      var ctl = phoneAbort = new AbortController();
      fetch(SERVICE + "api/data", { signal: ctl.signal }).then(function (res) {
         if (phoneAbort === ctl) phoneAbort = null;
         if (!res.ok) throw new Error("HTTP " + res.status);
         loadGame("telefon", function (files) {
            return unzipResponse(res, files).then(function () { return cacheGame(files); });
         });
      }).catch(function (e) {
         if (phoneAbort === ctl) phoneAbort = null;
         if (e && e.name === "AbortError") return;
         setTimeout(waitForPhone, 3000);
      });
   }

   function initPhoneLink() {
      if (location.protocol === "https:") return; /* mixed content */
      fetch(SERVICE + "api/info").then(function (res) { return res.json(); }).then(function (info) {
         var qr = qrcode(0, "M");
         qr.addData(info.url);
         qr.make();
         $("qr").innerHTML = qr.createSvgTag({ cellSize: 5, margin: 3, scalable: true });
         $("phone-url").textContent = info.url;
         $("phone-panel").style.display = "flex";
         phoneLink = true;
         waitForPhone();
      }).catch(function () {
         /* TizenBrew starts the service asynchronously; retry a few times.
            Outside TizenBrew there is no service and the panel stays hidden. */
         initPhoneLink.tries = (initPhoneLink.tries || 0) + 1;
         if (initPhoneLink.tries < 6) setTimeout(initPhoneLink, 2000);
      });
   }

   /* ------------------------------------------------------------------ */
   /* Screens                                                              */
   /* ------------------------------------------------------------------ */

   function savedUrl() {
      var u = param("data");
      if (u) return u;
      try { return localStorage.getItem("xash_data_url") || ""; } catch (e) { return ""; }
   }

   function openUrlScreen() {
      $("url-input").value = savedUrl() || "http://";
      showScreen("screen-url");
   }

   $("btn-url-ok").onclick = function () {
      var url = $("url-input").value.trim();
      if (!/^https?:\/\//.test(url)) url = "http://" + url;
      if (!/\.zip$/i.test(url)) url += (url.charAt(url.length - 1) === "/" ? "" : "/") + "valve.zip";
      try { localStorage.setItem("xash_data_url", url); } catch (e) { /* ignore */ }
      showScreen("screen-home", false);
      screenStack = [];
      startFromUrl(url);
   };

   function updateHome() {
      $("play-meta").textContent = gameCached() ? "oyun dosyaları TV'de kayıtlı" : (savedUrl() || "önce oyun dosyalarını gönder");
   }

   $("btn-play").onclick = startGame;
   $("btn-url").onclick = openUrlScreen;
   $("btn-howto-url").onclick = openUrlScreen;
   $("btn-help").onclick = function () { showScreen("screen-help"); };
   $("btn-reset").onclick = function () { wipe("btn-reset", DB_NAME); };
   $("btn-wipe").onclick = function () {
      wipe("btn-wipe", GAME_DB, function () { setGameCached(false); updateHome(); });
   };

   /* Desktop: "... Chrome/120.0.0.0 ...". Samsung TVs omit "Chrome/":
      "... Tizen 9.0) AppleWebKit/537.36 (KHTML, like Gecko) 120.0.6099.5/9.0 TV Safari/537.36" */
   (function () {
      var ua = navigator.userAgent;
      var tizenVer = (/Tizen ([\d.]+)/.exec(ua) || [])[1];
      var chromium = (/Chrome\/(\d+)/.exec(ua) || /\) (\d+)\.\d+\.\d+\.\d+\//.exec(ua) || [])[1];
      $("subtitle").textContent = "Half-Life motoru (Xash3D FWGS) · " +
         (tizenVer ? "Tizen " + tizenVer : (hasTizen ? "Tizen" : "tarayıcı")) +
         " · " + (chromium ? "Chromium " + chromium : ua);
   })();

   updateHome();
   initPhoneLink();
   showScreen("screen-home", false);
})();
