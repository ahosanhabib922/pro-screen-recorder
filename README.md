# Pro Screen Recorder (Chrome Extension)

Mac-এর জন্য high-quality screen recorder Chrome extension — screen / window / tab record, mic + tab audio mixing, camera bubble, pause/resume, keyboard shortcuts সহ।

## Install করার নিয়ম

1. Chrome-এ যান: `chrome://extensions`
2. উপরে ডান দিকে **Developer mode** চালু করুন
3. **Load unpacked** ক্লিক করে এই folder টি (`screen recorder`) select করুন
4. Toolbar-এ extension icon pin করে নিন (puzzle icon → pin)

### macOS Permission (প্রথমবার অবশ্যই)

- **System Settings → Privacy & Security → Screen & System Audio Recording** → Google Chrome **allow** করুন, তারপর Chrome **restart** করুন
- **Privacy & Security → Microphone** → Chrome allow করুন
- **Privacy & Security → Camera** → Chrome allow করুন (camera bubble ব্যবহার করলে)

## Features

- 🎥 **Screen / Window / Tab** — যেকোনোটা record করুন (Chrome-এর picker থেকে বাছুন)
- 🖥 **Resolution**: Auto / 4K / 1440p / 1080p / 720p, **24/30/60 fps**
- ⚡ **Quality presets**: Standard / High / Ultra (bitrate auto-scale হয় resolution + fps অনুযায়ী)
- 📦 **Format**: WebM VP9 / VP8, MP4 H.264 (Chrome support করলে)
- 🎙 **Microphone recording** — device select, noise suppression, echo cancellation, auto gain, **live mic test meter**
- 🔊 **Tab audio + mic একসাথে mix** হয়ে record হয় (Web Audio mixing)
- 📷 **Camera bubble** — always-on-top গোল webcam overlay (Document Picture-in-Picture), size choose করা যায়
- 🎛 **Floating controls** — always-on-top ছোট window-তে timer, pause, mic mute, stop
- ⏸ **Pause / Resume**, 🔇 **mic mute/unmute** recording চলাকালীন
- ⏱ **Countdown** (3/5/10 sec), **auto-stop timer** (5–60 min)
- ⌨️ **Keyboard shortcuts**: `⌥⇧R` start/stop · `⌥⇧P` pause/resume · `⌥⇧M` mic mute — বদলাতে: `chrome://extensions/shortcuts`
- 🔴 Toolbar icon-এ **REC badge** + timer, শেষে **notification**
- 👀 Recording শেষে **preview player**, duration/size/format info, filename rename, **auto-download** option
- 🗑 Discard option — ভুল recording save না করেই ফেলে দিন

## Audio ভালো পাওয়ার টিপস

- **Studio processing** on রাখুন (default on) — anti-clip limiter + rumble filter + voice compressor
- Popup-এ **🎙 Test mic** চেপে মিটার দেখুন — কমলা warning এলে **Mic volume** slider কমান
- Mac-এর input gain বেশি থাকলেও ফাটে: System Settings → Sound → Input → **Input volume** ৬০–৭০%-এ রাখুন
- Mic থেকে ৬–১২ ইঞ্চি দূরে থেকে কথা বলুন, built-in mic হলে fan-এর কাছে laptop রাখবেন না
- Noise suppression + echo cancellation on রাখুন; গান/music record করলে বরং এগুলো off করুন (voice-এর জন্যই এরা ভালো)

## জরুরি নোট (macOS)

- **System audio**: macOS-এ Chrome শুধুমাত্র **tab-এর audio** capture করতে পারে। Picker-এ **Chrome Tab** বেছে **"Also share tab audio"** টিক দিন। পুরো screen/window record করলে শুধু microphone record হবে (এটা Chrome/macOS-এর limitation, extension-এর না)।
- **Camera bubble** পুরো **screen** record করলে recording-এ দেখা যাবে (bubble টা screen-এর উপরে থাকে)। শুধু একটা window record করলে bubble recording-এ আসবে না।
- Recording চলার সময় **recorder tab টি বন্ধ করবেন না** — recording ওই tab-এ চলে। অন্য tab/app-এ কাজ করতে পারবেন সমস্যা নেই।
- File save হয় Chrome-এর **Downloads** folder-এ।

## Structure

```text
manifest.json    — MV3 config, permissions, shortcuts
background.js    — badge, notifications, keyboard command routing
popup.html/js    — settings UI + live controls
recorder.html/js — capture engine, audio mixing, camera PiP, preview/save
icons/           — extension icons
```
