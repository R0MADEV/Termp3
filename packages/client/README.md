# catunes 🎵

A **retro terminal music player** with a real **audio-reactive visualizer** —
stream YouTube & radios (no downloads), with playlists, themes and multi-language.

![catunes](https://raw.githubusercontent.com/R0MADEV/catunes/main/promo.png)

> Full docs & source: **https://github.com/R0MADEV/catunes**

## Install

```bash
npm install -g catunes
```

**Requirements:** [mpv](https://mpv.io) (audio engine). `yt-dlp` and `ffmpeg`
are **auto-downloaded** on first use. Check with `catunes doctor`.

## Use

```bash
catunes                # open the player with your playlist
catunes add "<url>"    # add a track
catunes doctor         # check dependencies
```

Inside the player: `↑↓` navigate · `↵` play · `space` pause · `/` search
YouTube · `a` add · `o` settings · `v` visualizer · `?` help · `q` quit.

## Features

- 🎧 Stream YouTube, radios and local files (pure streaming, no downloads)
- 📊 Real audio-reactive visualizer (FFT) with modes: bars, mirror, smooth, oscilloscope, plasma
- 📁 Multiple playlists · import YouTube playlists · search
- 🎨 Color themes (custom too) · 🌍 multi-language (English/Spanish)
- 📌 "Now playing" in the terminal title · control from any pane

## Disclaimer

catunes does **not** download, store or convert music — it only plays streams.
Use it only with content you have the right to play, and respect each
platform's terms of service.

## License

MIT
