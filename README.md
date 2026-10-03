# Xash3D for Tizen

Runs the [Xash3D FWGS](https://github.com/FWGS/xash3d-fwgs) engine (WebAssembly build) on Samsung Tizen TVs, so that Half-Life can be played from your own copy of the game.

**Experimental.** The build is tested in headless Chromium without game data; it has not been confirmed on a real TV yet.

No game data is included. You need the `valve` folder of a Half-Life copy you own. This project is not affiliated with Valve.

## Requirements

- Samsung TV with Tizen 6.5 or newer (2022+)
- [TizenBrew](https://github.com/reisxd/TizenBrew), or a way to install a `.wgt`
- A phone or computer on the same network that holds your Half-Life folder
- A USB/Bluetooth gamepad or keyboard + mouse for actually playing; the remote is only good for the menus

## Install

- **TizenBrew:** add the GitHub module `Sype0/xash3d-tizen`.
- **.wgt:** take `Xash3D.wgt` from the releases and install it with your usual tool.

## Game data

On the machine that has Half-Life (Python 3 needed, Termux works):

```
python3 tools/serve.py "/path/to/Half-Life"
```

The first run packs `valve` into `valve.zip`, leaving out what the TV cannot use (native libraries, videos, music), and prints an address such as `http://192.168.1.20:8000/`. Enter that address on the TV under *Oyun dosyalarının adresi*.

The data is downloaded on every start and kept in memory, so the TV needs a few hundred MB of free RAM. Saved games and settings are stored on the TV.

## Remote keys

| Remote | Game |
| --- | --- |
| Arrows | Move / turn (menu navigation) |
| OK | Fire (menu select) |
| Back | Game menu |
| Red / Green / Yellow / Blue | Jump / Use / Reload / Duck |
| CH + / CH − | Next / previous weapon |
| 1 – 5 | Weapon slots |
| Play/Pause | Quick save |
| Rewind | Quick load |

## URL parameters

- `res=1080` — render height (default 720, scaled up to the screen)
- `music=1` — keep the soundtrack (`media/`, mp3) when unpacking
- `args=...` — extra engine arguments, e.g. `args=-dev 2`

## How it is built

- Engine: the `xash3d-fwgs` 1.2.2 package from npm, pinned by hash (engine source: FWGS/xash3d-fwgs fork network, commit `f85aa0c8`).
- Game libraries: [hlsdk-portable](https://github.com/FWGS/hlsdk-portable) (commit `371cdf3b`) built from source in CI with Emscripten 4.0.23.
- Copies of both upstream packages are kept in the `upstream` release.

## Licenses

The launcher in this repository is GPL-3.0-or-later. Xash3D FWGS is GPL-3.0. hlsdk-portable is covered by Valve's Half-Life SDK license. [fflate](https://github.com/101arrowz/fflate) is MIT.
