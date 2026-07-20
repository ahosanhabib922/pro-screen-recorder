// Recorder page: capture, audio mixing, camera bubble (Document PiP), preview & save.

const $ = (id) => document.getElementById(id);

const DEFAULTS = {
  resolution: '1080', fps: '30', quality: 'high', format: 'auto',
  micOn: true, micDevice: '', noiseSuppression: true, echoCancellation: true,
  autoGain: true, micVolume: '100', sysVolume: '100', audioProcessing: true,
  sysAudio: true, countdown: '3', cameraOn: false,
  camDevice: '', camSize: '240', floatControls: true, maxMinutes: '0',
  autoDownload: true, filePrefix: 'recording'
};

let S = { ...DEFAULTS };          // settings
let state = 'idle';               // idle | countdown | recording | paused | done
let recorder = null;
let chunks = [];
let bytes = 0;
let mimeType = '';
let startedAt = 0;                // wall clock of current run segment
let accumMs = 0;                  // accumulated before current segment
let micMuted = false;
let discardFlag = false;
let uiInterval = 0;

let screenStream = null, micStream = null, camStream = null;
let audioCtx = null, micGain = null, micBaseGain = 1;
let combinedStream = null;
let pipWin = null;
let pipEls = {};                  // {timer, size, pauseBtn, micBtn}
let blobUrl = null;
let recMeta = { w: 0, h: 0 };
let ownTabId = null;

let phonePeer = null;             // PeerJS peer (signaling via free public relay)
let phoneMicStream = null;        // remote audio stream from the phone
let phoneSink = null;             // hidden <audio> that "pumps" the remote track
let phoneMeterCtx = null, phoneMeterRAF = 0;

const PHONE_PAGE_URL = 'https://ahosanhabib922.github.io/pro-screen-recorder/phone.html';

/* ================= helpers ================= */

function fmtTime(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const sec = String(s % 60).padStart(2, '0');
  return (h ? h + ':' : '') + m + ':' + sec;
}

function fmtSize(b) {
  if (b < 1024 * 1024) return (b / 1024).toFixed(0) + ' KB';
  if (b < 1024 * 1024 * 1024) return (b / 1024 / 1024).toFixed(1) + ' MB';
  return (b / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

function elapsedMs() {
  return state === 'recording' ? accumMs + (Date.now() - startedAt) : accumMs;
}

function timestampName() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${S.filePrefix || 'recording'}-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}`;
}

function show(viewId) {
  for (const v of ['readyView', 'countdownView', 'liveView', 'previewView', 'errorView']) {
    $(v).classList.toggle('hidden', v !== viewId);
  }
}

function setChip(text, cls) {
  const chip = $('statusChip');
  chip.textContent = text;
  chip.className = 'chip ' + cls;
}

async function pushState(extra = {}) {
  await chrome.storage.session.set({
    rec: {
      status: state, startedAt, accumMs, micMuted, tabId: ownTabId,
      info: recMeta.w ? `${recMeta.w}×${recMeta.h}` : '', ...extra
    }
  });
}

async function clearState() {
  await chrome.storage.session.remove('rec');
}

function fail(err) {
  console.error(err);
  cleanupStreams();
  closePip();
  clearState();
  state = 'idle';
  setChip('Error', 'idle');
  $('errorMsg').textContent = String(err && err.message ? err.message : err);
  show('errorView');
}

/* ================= mime & bitrate ================= */

function pickMime() {
  const candidates = {
    mp4: ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4'],
    vp9: ['video/webm;codecs=vp9,opus'],
    vp8: ['video/webm;codecs=vp8,opus'],
    auto: [
      'video/webm;codecs=vp9,opus',
      'video/mp4;codecs=avc1.640028,mp4a.40.2',
      'video/webm;codecs=vp8,opus',
      'video/webm'
    ]
  };
  const list = candidates[S.format] || candidates.auto;
  for (const m of list) if (MediaRecorder.isTypeSupported(m)) return m;
  // fall back across everything
  for (const m of candidates.auto) if (MediaRecorder.isTypeSupported(m)) return m;
  return '';
}

function calcBitrates(w, h, fps) {
  const perQ = { standard: 5, high: 9, ultra: 15 };            // Mbps at 1080p30
  const base = (perQ[S.quality] || 9) * 1e6;
  const areaFactor = Math.max(0.5, (w * h) / (1920 * 1080));
  const fpsFactor = fps >= 50 ? 1.35 : 1;
  const video = Math.min(45e6, Math.round(base * areaFactor * fpsFactor));
  const audio = S.quality === 'ultra' ? 256000 : 192000;
  return { video, audio };
}

/* ================= capture ================= */

function chooseSource() {
  return new Promise((resolve, reject) => {
    chrome.desktopCapture.chooseDesktopMedia(
      ['screen', 'window', 'tab', 'audio'],
      (streamId, opts) => {
        if (!streamId) reject(new Error('Screen selection cancelled'));
        else resolve({ streamId, canAudio: !!(opts && opts.canRequestAudioTrack) });
      }
    );
  });
}

async function getScreenStream(streamId, canAudio) {
  const maxH = S.resolution === 'auto' ? 2160 : parseInt(S.resolution, 10);
  const maxW = Math.round(maxH * (16 / 9)) * 2; // generous, ultrawide-safe
  const fps = parseInt(S.fps, 10) || 30;

  const constraints = {
    video: {
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: streamId,
        maxWidth: maxW,
        maxHeight: maxH,
        maxFrameRate: fps
      }
    },
    audio: (S.sysAudio && canAudio) ? {
      mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: streamId }
    } : false
  };

  try {
    return await navigator.mediaDevices.getUserMedia(constraints);
  } catch (e) {
    if (constraints.audio) {          // retry video-only if audio grab failed
      constraints.audio = false;
      return await navigator.mediaDevices.getUserMedia(constraints);
    }
    throw e;
  }
}

async function getMicStream() {
  if (!S.micOn) return null;
  const audio = {
    echoCancellation: !!S.echoCancellation,
    noiseSuppression: !!S.noiseSuppression,
    autoGainControl: !!S.autoGain,
    sampleRate: 48000,
    channelCount: 1
  };
  if (S.micDevice) audio.deviceId = { exact: S.micDevice };
  try {
    return await navigator.mediaDevices.getUserMedia({ audio });
  } catch (e) {
    if (S.micDevice) {                // saved device unplugged → fall back to default
      delete audio.deviceId;
      return await navigator.mediaDevices.getUserMedia({ audio });
    }
    throw e;
  }
}

function buildCombinedStream() {
  const videoTrack = screenStream.getVideoTracks()[0];
  const sysTrack = screenStream.getAudioTracks()[0] || null;
  const micTrack = micStream ? micStream.getAudioTracks()[0] : null;

  if (!sysTrack && !micTrack) {
    combinedStream = new MediaStream([videoTrack]);
    return;
  }

  audioCtx = new AudioContext({ sampleRate: 48000 });
  audioCtx.resume().catch(() => {});
  const dest = audioCtx.createMediaStreamDestination();

  // Mix bus: everything sums here, then passes through a brick-wall limiter
  // so mic + tab audio together can never clip ("fete jawa" fix).
  const mixBus = audioCtx.createGain();
  mixBus.gain.value = 1;

  if (S.audioProcessing) {
    const limiter = audioCtx.createDynamicsCompressor();
    limiter.threshold.value = -6;    // start catching peaks at -6 dB
    limiter.knee.value = 5;
    limiter.ratio.value = 15;        // near-limiter ratio
    limiter.attack.value = 0.002;    // fast enough to stop transient clipping
    limiter.release.value = 0.25;
    mixBus.connect(limiter).connect(dest);
  } else {
    mixBus.connect(dest);
  }

  if (sysTrack) {
    const src = audioCtx.createMediaStreamSource(new MediaStream([sysTrack]));
    const sysGain = audioCtx.createGain();
    sysGain.gain.value = (parseInt(S.sysVolume, 10) || 100) / 100 * 0.85; // headroom
    src.connect(sysGain).connect(mixBus);
    src.connect(audioCtx.destination);  // keep hearing tab audio while recording
  }

  if (micTrack) {
    const src = audioCtx.createMediaStreamSource(new MediaStream([micTrack]));
    micBaseGain = (parseInt(S.micVolume, 10) || 100) / 100 * 0.9; // headroom
    micGain = audioCtx.createGain();
    micGain.gain.value = micBaseGain;

    if (S.audioProcessing) {
      // High-pass: cuts AC hum, fan rumble, desk thumps below the voice range.
      const highpass = audioCtx.createBiquadFilter();
      highpass.type = 'highpass';
      highpass.frequency.value = 90;
      highpass.Q.value = 0.7;
      // Gentle voice compressor: evens out loud/quiet speech before the mix.
      const voiceComp = audioCtx.createDynamicsCompressor();
      voiceComp.threshold.value = -18;
      voiceComp.knee.value = 12;
      voiceComp.ratio.value = 3;
      voiceComp.attack.value = 0.01;
      voiceComp.release.value = 0.2;
      src.connect(highpass).connect(voiceComp).connect(micGain).connect(mixBus);
    } else {
      src.connect(micGain).connect(mixBus);
    }
  }

  combinedStream = new MediaStream([videoTrack, ...dest.stream.getAudioTracks()]);
}

/* ================= camera bubble / floating controls (Document PiP) ================= */

async function openPip() {
  if (!('documentPictureInPicture' in window)) return;
  if (!S.cameraOn && !S.floatControls) return;

  const camSize = parseInt(S.camSize, 10) || 240;
  const width = S.cameraOn ? camSize + 20 : 250;
  const height = (S.cameraOn ? camSize : 0) + 86;

  try {
    pipWin = await documentPictureInPicture.requestWindow({ width, height });
  } catch (e) {
    console.warn('PiP unavailable:', e.message);
    return;
  }

  const doc = pipWin.document;
  const style = doc.createElement('style');
  style.textContent = `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #14161d; color: #e7e9f0; font: 12px -apple-system, sans-serif;
           display: flex; flex-direction: column; align-items: center; gap: 8px;
           padding: 8px; overflow: hidden; height: 100vh; }
    .cam-wrap { width: ${camSize - 16}px; height: ${camSize - 16}px; border-radius: 50%;
                overflow: hidden; border: 3px solid #ef4444; flex: none; }
    .cam-wrap video { width: 100%; height: 100%; object-fit: cover; transform: scaleX(-1); }
    .bar { display: flex; gap: 6px; align-items: center; width: 100%; justify-content: center; }
    .t { font-weight: 800; font-size: 15px; font-variant-numeric: tabular-nums; min-width: 52px; }
    .sz { color: #8b91a5; font-size: 11px; }
    button { background: #262a37; color: #e7e9f0; border: none; border-radius: 7px;
             padding: 6px 9px; cursor: pointer; font-size: 13px; }
    button:hover { background: #333849; }
    .stop { background: #ef4444; color: #fff; }
    .muted-on { background: #7c2d12; }
  `;
  doc.head.appendChild(style);

  if (S.cameraOn && camStream) {
    const camWrap = doc.createElement('div');
    camWrap.className = 'cam-wrap';
    const v = doc.createElement('video');
    v.muted = true; v.autoplay = true; v.playsInline = true;
    v.srcObject = camStream;
    camWrap.appendChild(v);
    doc.body.appendChild(camWrap);
  }

  const bar = doc.createElement('div');
  bar.className = 'bar';
  const timer = doc.createElement('span'); timer.className = 't'; timer.textContent = '00:00';
  const size = doc.createElement('span'); size.className = 'sz'; size.textContent = '0 MB';
  const pauseBtn = doc.createElement('button'); pauseBtn.textContent = '⏸';
  const micBtn = doc.createElement('button'); micBtn.textContent = '🎙';
  const stopBtn = doc.createElement('button'); stopBtn.className = 'stop'; stopBtn.textContent = '⏹ Stop';

  pauseBtn.onclick = togglePause;
  micBtn.onclick = toggleMic;
  stopBtn.onclick = () => stopRecording(false);

  bar.append(timer, pauseBtn, micBtn, stopBtn);
  doc.body.appendChild(bar);
  const bar2 = doc.createElement('div');
  bar2.className = 'bar';
  bar2.appendChild(size);
  doc.body.appendChild(bar2);

  pipEls = { timer, size, pauseBtn, micBtn };
  pipWin.addEventListener('pagehide', () => { pipWin = null; pipEls = {}; });
}

function closePip() {
  try { if (pipWin) pipWin.close(); } catch (e) {}
  pipWin = null; pipEls = {};
}

/* ================= record lifecycle ================= */

async function begin() {
  try {
    await loadSettings();
    setChip('Choosing…', 'idle');

    // camera first (needs permission prompt while page is focused)
    if (S.cameraOn) {
      const video = S.camDevice
        ? { deviceId: { exact: S.camDevice }, width: 1280, height: 720 }
        : { width: 1280, height: 720 };
      try {
        camStream = await navigator.mediaDevices.getUserMedia({ video });
      } catch (e) {
        console.warn('Camera unavailable:', e.message);
        camStream = null;
      }
    }

    await openPip();  // needs the user-gesture from the click

    const { streamId, canAudio } = await chooseSource();
    screenStream = await getScreenStream(streamId, canAudio);
    // Phone mic (if connected) replaces the local mic; otherwise use a local device.
    micStream = phoneMicStream || await getMicStream();
    buildCombinedStream();

    const vs = screenStream.getVideoTracks()[0].getSettings();
    recMeta.w = vs.width || 0;
    recMeta.h = vs.height || 0;

    // stop when user hits Chrome's own "Stop sharing" bar
    screenStream.getVideoTracks()[0].addEventListener('ended', () => {
      if (state === 'recording' || state === 'paused') stopRecording(false);
    });

    const cd = parseInt(S.countdown, 10) || 0;
    if (cd > 0) await runCountdown(cd);

    startRecorder();
  } catch (err) {
    fail(err);
  }
}

function runCountdown(secs) {
  return new Promise((resolve) => {
    state = 'countdown';
    show('countdownView');
    setChip('Starting…', 'idle');
    let n = secs;
    $('countNum').textContent = n;
    const iv = setInterval(() => {
      n--;
      if (n <= 0) { clearInterval(iv); resolve(); }
      else $('countNum').textContent = n;
    }, 1000);
  });
}

function startRecorder() {
  mimeType = pickMime();
  if (!mimeType) throw new Error('এই Chrome version এ কোনো supported recording format পাওয়া যায়নি');

  const fps = parseInt(S.fps, 10) || 30;
  const { video, audio } = calcBitrates(recMeta.w || 1920, recMeta.h || 1080, fps);

  chunks = []; bytes = 0; discardFlag = false; micMuted = false;
  recorder = new MediaRecorder(combinedStream, {
    mimeType,
    videoBitsPerSecond: video,
    audioBitsPerSecond: audio
  });

  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size) { chunks.push(e.data); bytes += e.data.size; }
  };
  recorder.onerror = (e) => fail(e.error || new Error('MediaRecorder error'));
  recorder.onstop = onRecorderStop;

  recorder.start(1000);
  state = 'recording';
  startedAt = Date.now();
  accumMs = 0;

  $('livePreview').srcObject = combinedStream;
  $('livePreview').play().catch(() => {});
  $('liveRes').textContent = `${recMeta.w}×${recMeta.h} · ${fps}fps · ${Math.round(video / 1e6)}Mbps`;
  show('liveView');
  setChip('● REC', 'rec');
  pushState();

  uiInterval = setInterval(uiTick, 500);
  window.onbeforeunload = () => 'Recording চলছে — tab বন্ধ করলে recording হারিয়ে যাবে।';
}

function uiTick() {
  const el = elapsedMs();
  const t = fmtTime(el);
  const sz = fmtSize(bytes);
  $('liveTimer').textContent = t;
  $('liveSize').textContent = sz;
  if (pipEls.timer) { pipEls.timer.textContent = t; pipEls.size.textContent = sz; }
  document.title = (state === 'paused' ? '❚❚ ' : '● ') + t + ' — Recording';

  const maxMin = parseInt(S.maxMinutes, 10) || 0;
  if (maxMin && el >= maxMin * 60000 && state === 'recording') stopRecording(false);
}

function togglePause() {
  if (state === 'recording') {
    recorder.pause();
    accumMs += Date.now() - startedAt;
    state = 'paused';
    $('pauseBtn').textContent = '▶ Resume';
    if (pipEls.pauseBtn) pipEls.pauseBtn.textContent = '▶';
    setChip('❚❚ PAUSED', 'paused');
  } else if (state === 'paused') {
    recorder.resume();
    startedAt = Date.now();
    state = 'recording';
    $('pauseBtn').textContent = '⏸ Pause';
    if (pipEls.pauseBtn) pipEls.pauseBtn.textContent = '⏸';
    setChip('● REC', 'rec');
  }
  pushState();
}

function toggleMic() {
  micMuted = !micMuted;
  if (micGain) micGain.gain.value = micMuted ? 0 : micBaseGain;
  if (micStream) micStream.getAudioTracks().forEach(t => (t.enabled = !micMuted));
  $('micBtn').textContent = micMuted ? '🔇 Unmute mic' : '🎙 Mute mic';
  $('micBtn').classList.toggle('on', micMuted);
  if (pipEls.micBtn) {
    pipEls.micBtn.textContent = micMuted ? '🔇' : '🎙';
    pipEls.micBtn.classList.toggle('muted-on', micMuted);
  }
  pushState();
}

function stopRecording(discard) {
  if (!recorder || state === 'done' || state === 'idle') return;
  discardFlag = discard;
  if (state === 'recording') accumMs += Date.now() - startedAt;
  state = 'done';
  clearInterval(uiInterval);
  window.onbeforeunload = null;
  try { recorder.stop(); } catch (e) { onRecorderStop(); }
}

function cleanupStreams() {
  for (const s of [screenStream, micStream, camStream]) {
    // Don't stop the phone mic — it's a persistent connection reused across recordings.
    if (s && s !== phoneMicStream) s.getTracks().forEach(t => t.stop());
  }
  screenStream = micStream = camStream = null;
  if (audioCtx) { audioCtx.close().catch(() => {}); audioCtx = null; }
  micGain = null;
  combinedStream = null;
}

async function onRecorderStop() {
  cleanupStreams();
  closePip();
  await clearState();
  document.title = 'Pro Screen Recorder';
  setChip('Done', 'idle');

  if (discardFlag || !chunks.length) {
    chunks = []; bytes = 0;
    location.href = 'recorder.html';
    return;
  }

  const blob = new Blob(chunks, { type: mimeType.split(';')[0] });
  blobUrl = URL.createObjectURL(blob);
  const ext = mimeType.startsWith('video/mp4') ? 'mp4' : 'webm';

  const playback = $('playback');
  playback.src = blobUrl;
  // WebM from MediaRecorder reports Infinity duration — force it to compute so seeking works
  playback.onloadedmetadata = () => {
    if (playback.duration === Infinity) {
      playback.currentTime = Number.MAX_SAFE_INTEGER;
      playback.ontimeupdate = () => { playback.ontimeupdate = null; playback.currentTime = 0; };
    }
  };

  $('metaDuration').textContent = fmtTime(accumMs);
  $('metaSize').textContent = fmtSize(blob.size);
  $('metaFormat').textContent = ext.toUpperCase() + ' (' + (mimeType.match(/codecs=([^,;]+)/)?.[1] || '') + ')';
  $('metaRes').textContent = recMeta.w ? `${recMeta.w}×${recMeta.h}` : '—';
  $('fileName').value = timestampName() + '.' + ext;
  $('savedNote').classList.add('hidden');
  show('previewView');

  if (S.autoDownload) saveFile();
}

async function saveFile() {
  const filename = ($('fileName').value || timestampName() + '.webm').replace(/[\\/:*?"<>|]/g, '-');
  try {
    await chrome.downloads.download({ url: blobUrl, filename, saveAs: false });
    $('savedNote').classList.remove('hidden');
    chrome.runtime.sendMessage({ type: 'saved', filename, size: $('metaSize').textContent }).catch(() => {});
  } catch (e) {
    alert('Save failed: ' + e.message);
  }
}

/* ================= phone as mic (WebRTC over PeerJS relay, QR/code pairing) ================= */

function phoneSetStatus(text, cls) {
  const el = $('phoneStatus');
  if (!el) return;
  el.textContent = text;
  el.className = 'phone-status' + (cls ? ' ' + cls : '');
}

// Short, unambiguous pairing code (no 0/O/1/I to avoid typos on the phone).
function randomCode(n = 6) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const buf = new Uint8Array(n);
  crypto.getRandomValues(buf);
  let s = '';
  for (let i = 0; i < n; i++) s += alphabet[buf[i] % alphabet.length];
  return s;
}

function attachPhoneStream(stream) {
  phoneMicStream = stream;
  // Chromium won't pull samples from a remote WebRTC track into Web Audio /
  // MediaRecorder unless the stream is also sunk into a media element. Muted so
  // it never plays out of the speakers (no feedback), just keeps the pipe flowing.
  phoneSink = new Audio();
  phoneSink.muted = true;
  phoneSink.srcObject = stream;
  phoneSink.play().catch(() => {});
  startPhoneMeter(stream);
  phoneSetStatus('✔ কানেক্টেড — এই mic দিয়েই record হবে', 'ok');
  $('phoneDisconnectBtn').classList.remove('hidden');
}

function phoneStart(retries = 3) {
  disconnectPhoneMic();
  const code = randomCode();

  phonePeer = new Peer('psr-' + code, { debug: 0 });

  phonePeer.on('open', () => {
    $('phoneConnectWrap').classList.remove('hidden');
    $('phoneCode').textContent = code;
    $('phoneUrlText').textContent = 'phone.html';
    const url = PHONE_PAGE_URL + '?id=' + code;
    const qrEl = $('phoneQR');
    qrEl.innerHTML = '';
    new QRCode(qrEl, { text: url, width: 132, height: 132, correctLevel: QRCode.CorrectLevel.M });
    $('phoneDisconnectBtn').classList.remove('hidden');
    phoneSetStatus('ফোনের অপেক্ষায়… QR স্ক্যান করুন বা কোড টাইপ করুন', '');
  });

  // Phone calls us with its mic; we answer without sending anything back.
  phonePeer.on('call', (call) => {
    call.answer();
    call.on('stream', (stream) => attachPhoneStream(stream));
    call.on('close', () => phoneSetStatus('ফোনের কানেকশন বন্ধ হয়েছে', 'err'));
  });

  phonePeer.on('error', (err) => {
    if (err.type === 'unavailable-id' && retries > 0) {
      phonePeer.destroy(); phonePeer = null;
      phoneStart(retries - 1);          // code collided on the relay — pick another
    } else {
      phoneSetStatus('কানেকশন সমস্যা: ' + err.type, 'err');
    }
  });
}

function startPhoneMeter(stream) {
  stopPhoneMeter();
  phoneMeterCtx = new AudioContext();
  const src = phoneMeterCtx.createMediaStreamSource(stream);
  const an = phoneMeterCtx.createAnalyser(); an.fftSize = 512;
  src.connect(an);
  const buf = new Uint8Array(an.frequencyBinCount);
  const bar = $('phoneLevel');
  const tick = () => {
    an.getByteTimeDomainData(buf);
    let peak = 0;
    for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i] - 128));
    if (bar) bar.style.width = Math.min(100, (peak / 128) * 140) + '%';
    phoneMeterRAF = requestAnimationFrame(tick);
  };
  tick();
}

function stopPhoneMeter() {
  if (phoneMeterRAF) cancelAnimationFrame(phoneMeterRAF);
  phoneMeterRAF = 0;
  if (phoneMeterCtx) { phoneMeterCtx.close().catch(() => {}); phoneMeterCtx = null; }
  const bar = $('phoneLevel'); if (bar) bar.style.width = '0';
}

function disconnectPhoneMic() {
  stopPhoneMeter();
  if (phoneSink) { phoneSink.pause(); phoneSink.srcObject = null; phoneSink = null; }
  if (phonePeer) { try { phonePeer.destroy(); } catch (e) {} phonePeer = null; }
  if (phoneMicStream) { phoneMicStream.getTracks().forEach(t => t.stop()); phoneMicStream = null; }
  const wrap = $('phoneConnectWrap'); if (wrap) wrap.classList.add('hidden');
  const dis = $('phoneDisconnectBtn'); if (dis) dis.classList.add('hidden');
  phoneSetStatus('অসংযুক্ত', '');
}

function wirePhoneMic() {
  const startBtn = $('phoneStartBtn');
  if (!startBtn) return;
  startBtn.addEventListener('click', () => phoneStart());
  $('phoneDisconnectBtn').addEventListener('click', disconnectPhoneMic);
}

/* ================= settings & wiring ================= */

async function loadSettings() {
  const { settings } = await chrome.storage.sync.get('settings');
  S = { ...DEFAULTS, ...(settings || {}) };
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== 'cmd') return;
  switch (msg.cmd) {
    case 'start-stop':
      if (state === 'recording' || state === 'paused') stopRecording(false);
      else if (state === 'idle') begin();
      break;
    case 'pause-resume': togglePause(); break;
    case 'toggle-mic': toggleMic(); break;
    case 'stop': stopRecording(false); break;
    case 'discard': stopRecording(true); break;
  }
});

document.addEventListener('DOMContentLoaded', async () => {
  ownTabId = (await chrome.tabs.getCurrent())?.id ?? null;
  await loadSettings();

  $('beginBtn').addEventListener('click', begin);
  wirePhoneMic();
  $('pauseBtn').addEventListener('click', togglePause);
  $('micBtn').addEventListener('click', toggleMic);
  $('stopBtn').addEventListener('click', () => stopRecording(false));
  $('discardBtn').addEventListener('click', () => {
    if (confirm('Recording discard করবেন? Save হবে না।')) stopRecording(true);
  });
  $('saveBtn').addEventListener('click', saveFile);
  // Reset in place (no reload) so a connected phone mic survives between recordings.
  $('againBtn').addEventListener('click', () => {
    if (blobUrl) { URL.revokeObjectURL(blobUrl); blobUrl = null; }
    begin();
  });
  $('deleteBtn').addEventListener('click', () => {
    if (blobUrl) { URL.revokeObjectURL(blobUrl); blobUrl = null; }
    state = 'idle';
    setChip('Ready', 'idle');
    show('readyView');
  });
  $('retryBtn').addEventListener('click', () => location.href = 'recorder.html');

  // Autostart only when no PiP window is needed (PiP requires a real user click).
  const auto = new URLSearchParams(location.search).get('autostart');
  if (auto && !(S.cameraOn || S.floatControls)) begin();
  else if (auto) setChip('Click Start', 'idle');
});
