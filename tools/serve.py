#!/usr/bin/env python3
"""Serve your Half-Life game data to Xash3D on the TV.

Usage:  python3 serve.py [Half-Life folder] [port]

The folder is the one that contains `valve` (or an existing valve.zip). On
the first run valve.zip is created next to it, leaving out what the TV
cannot use (native libraries, videos, music) so that it fits in memory.

Works on Windows, Linux, macOS and Android (Termux).
"""
import http.server
import os
import re
import socket
import sys
import zipfile

SKIP = re.compile(r"^(cl_dlls|dlls|save|media)/|\.(dll|so|dylib|exe|avi|bik|mp3)$", re.I)


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # the TV app runs on another origin when started from TizenBrew
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()


def local_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


def make_zip(game_dir, out):
    print(f"Creating valve.zip ({game_dir}) ...")
    count = size = 0
    tmp = out + ".tmp"
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for root, _, names in os.walk(game_dir):
            for name in names:
                full = os.path.join(root, name)
                rel = os.path.relpath(full, game_dir).replace(os.sep, "/")
                if SKIP.search(rel):
                    continue
                z.write(full, "valve/" + rel)
                count += 1
                size += os.path.getsize(full)
    os.replace(tmp, out)
    print(f"{count} files, {size / 1048576:.0f} MB unpacked, zip {os.path.getsize(out) / 1048576:.0f} MB")


def main():
    folder = sys.argv[1] if len(sys.argv) > 1 else "."
    port = int(sys.argv[2]) if len(sys.argv) > 2 else 8000
    os.chdir(folder)
    if not os.path.exists("valve.zip"):
        game_dir = next((d for d in os.listdir(".") if d.lower() == "valve" and os.path.isdir(d)), None)
        if not game_dir:
            sys.exit(f"no valve folder or valve.zip in {os.getcwd()}")
        make_zip(game_dir, "valve.zip")
    server = http.server.ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"Enter this address on the TV: http://{local_ip()}:{port}/")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
