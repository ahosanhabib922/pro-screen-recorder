# Chrome Web Store Listing — Copy-paste Guide

## Basic Info

**Name:** Pro Screen Recorder

**Summary (132 chars max):**
> Record your screen in up to 4K 60fps with crystal-clear mixed audio — mic + tab sound, camera bubble, MP4/WebM, pause & shortcuts.

**Category:** Productivity → Tools

**Language:** English

## Detailed Description

```text
Record your screen the professional way — without leaving Chrome.

Pro Screen Recorder captures your entire screen, a single window, or one Chrome tab in stunning quality, with a real audio processing chain that keeps your voice clean and clipping-free.

🎥 VIDEO
• Up to 4K resolution at 24 / 30 / 60 fps
• Standard / High / Ultra quality presets — bitrate scales automatically with resolution
• Record straight to MP4 (H.264) or WebM (VP9 / VP8)
• Live preview, recording timer and file-size readout while you record

🎙 CRYSTAL-CLEAR AUDIO
• Record your microphone and tab audio together, mixed live
• Studio processing chain: rumble & hum filter, voice compressor, anti-clip limiter
• Separate volume sliders for mic and tab audio
• Noise suppression, echo cancellation and auto gain — each one toggleable
• Built-in mic test meter with clip warning, one-tap mic mute while recording

📷 CAMERA BUBBLE & FLOATING CONTROLS
• Round webcam overlay in three sizes — appears right in your recording
• Always-on-top mini window with timer, pause, mute and stop — follows you to any app

⚡ WORKFLOW
• Pause / resume as many times as you need
• Countdown (3/5/10s), auto-stop timer, auto-download
• Keyboard shortcuts: ⌥⇧R start/stop · ⌥⇧P pause · ⌥⇧M mute
• Instant preview after recording — check it, rename it, then save or discard
• 100% private: everything is processed and saved locally on your computer. No account, no upload, no watermark, no time limit.

NOTE FOR macOS USERS
Chrome can capture audio from a Chrome tab on macOS. When recording the entire screen or another app's window, your microphone is recorded (system-audio loopback is a Chrome/macOS platform limitation that applies to every extension).

Grant Chrome the Screen Recording permission in System Settings → Privacy & Security the first time you record.
```

## Privacy Practices Tab

**Single purpose description:**
> This extension records the user's screen (screen, window or Chrome tab) with optional microphone, tab audio and webcam overlay, and saves the recording as a local video file.

**Permission justifications:**

| Permission | Justification |
|---|---|
| `desktopCapture` | Core function — shows Chrome's screen/window/tab picker and captures the selected surface for recording. |
| `storage` | Saves the user's recording preferences (resolution, format, audio settings) locally and keeps track of the active recording session. |
| `downloads` | Saves the finished recording as a video file to the user's Downloads folder. |
| `tabs` | Opens and focuses the extension's own recorder page, and routes keyboard-shortcut commands to it. No browsing data is read. |
| `notifications` | Shows a "recording saved" confirmation notification. |

**Data usage disclosures — check these boxes:**
- ✅ "This item does NOT collect or use user data" (extension collects nothing; recordings never leave the device)
- Remote code: **No**

**Privacy policy URL (live):**
> https://ahosanhabib922.github.io/pro-screen-recorder/

(Source: https://github.com/ahosanhabib922/pro-screen-recorder — to update the policy, edit
`index.html` there; the page redeploys automatically.)

## Assets (in this folder)

| File | Use as |
|---|---|
| `../icons/icon128.png` | Store icon (128×128) |
| `screenshot-1-1280x800.png` … `screenshot-4-1280x800.png` | Screenshots (upload all 4, in order) |
| `small-tile-440x280.png` | Small promo tile |
| `marquee-1400x560.png` | Marquee promo tile |

## Upload

1. Go to https://chrome.google.com/webstore/devconsole (one-time $5 developer fee)
2. **New item** → upload `dist/pro-screen-recorder-v1.0.0.zip`
3. Fill Store listing with the text above + upload the images
4. Fill Privacy practices tab with the justifications above
5. Submit for review (usually 1–3 days)
