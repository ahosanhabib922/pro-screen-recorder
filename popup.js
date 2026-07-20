// Popup: settings + live recording controls.

const $ = (id) => document.getElementById(id);

const SETTING_IDS = [
  'resolution', 'fps', 'quality', 'format',
  'micOn', 'micDevice', 'noiseSuppression', 'echoCancellation', 'autoGain',
  'micVolume', 'sysVolume', 'audioProcessing',
  'sysAudio', 'countdown', 'cameraOn', 'camDevice', 'camSize',
  'floatControls', 'maxMinutes', 'autoDownload', 'filePrefix'
];

const DEFAULTS = {
  resolution: '1080', fps: '30', quality: 'high', format: 'auto',
  micOn: true, micDevice: '', noiseSuppression: true, echoCancellation: true,
  autoGain: true, micVolume: '100', sysVolume: '100', audioProcessing: true,
  sysAudio: true, countdown: '3', cameraOn: false,
  camDevice: '', camSize: '240', floatControls: true, maxMinutes: '0',
  autoDownload: true, filePrefix: 'recording'
};

function readForm() {
  const s = {};
  for (const id of SETTING_IDS) {
    const el = $(id);
    s[id] = el.type === 'checkbox' ? el.checked : el.value;
  }
  return s;
}

function writeForm(s) {
  for (const id of SETTING_IDS) {
    const el = $(id);
    if (el.type === 'checkbox') el.checked = !!s[id];
    else el.value = s[id];
  }
  reflectVolumeLabels();
  reflectDependentRows();
}

function reflectVolumeLabels() {
  $('micVolVal').textContent = $('micVolume').value + '%';
  $('sysVolVal').textContent = $('sysVolume').value + '%';
}

function reflectDependentRows() {
  const micOn = $('micOn').checked;
  for (const id of ['micDeviceRow', 'noiseSuppression', 'echoCancellation', 'autoGain']) {
    const el = $(id).closest('.row') || $(id);
    el.style.opacity = micOn ? '1' : '.4';
  }
  const camOn = $('cameraOn').checked;
  $('camDeviceRow').style.opacity = camOn ? '1' : '.4';
  $('camSizeRow').style.opacity = camOn ? '1' : '.4';
}

async function saveSettings() {
  await chrome.storage.sync.set({ settings: readForm() });
}

async function loadSettings() {
  const { settings } = await chrome.storage.sync.get('settings');
  writeForm({ ...DEFAULTS, ...(settings || {}) });
}

async function populateDevices() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const micSel = $('micDevice'), camSel = $('camDevice');
    const savedMic = micSel.value, savedCam = camSel.value;
    micSel.innerHTML = '<option value="">Default</option>';
    camSel.innerHTML = '<option value="">Default</option>';
    for (const d of devices) {
      if (!d.deviceId) continue;
      const opt = document.createElement('option');
      opt.value = d.deviceId;
      opt.textContent = d.label || (d.kind === 'audioinput' ? 'Microphone' : 'Camera');
      if (d.kind === 'audioinput') micSel.appendChild(opt);
      if (d.kind === 'videoinput') camSel.appendChild(opt.cloneNode(true));
    }
    micSel.value = savedMic;
    camSel.value = savedCam;
  } catch (e) { /* no device access yet */ }
}

/* ---------- mic test meter ---------- */
let testStream = null, testCtx = null, testRAF = 0;

async function toggleMicTest() {
  if (testStream) return stopMicTest();
  try {
    testStream = await navigator.mediaDevices.getUserMedia({
      audio: $('micDevice').value ? { deviceId: { exact: $('micDevice').value } } : true
    });
    $('micTestBtn').classList.add('active');
    $('micTestBtn').textContent = '⏹ Stop test';
    testCtx = new AudioContext();
    const src = testCtx.createMediaStreamSource(testStream);
    const analyser = testCtx.createAnalyser();
    analyser.fftSize = 512;
    src.connect(analyser);
    const buf = new Uint8Array(analyser.frequencyBinCount);
    $('clipWarn').classList.add('hidden');
    let clipFrames = 0;
    const tick = () => {
      analyser.getByteTimeDomainData(buf);
      let peak = 0;
      for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
      const pct = peak / 128;
      $('micLevel').style.width = Math.min(100, pct * 160) + '%';
      if (pct > 0.94) {
        if (++clipFrames > 4) $('clipWarn').classList.remove('hidden');
      } else if (pct < 0.6) {
        clipFrames = 0;
      }
      testRAF = requestAnimationFrame(tick);
    };
    tick();
    // permission granted → labels now visible
    populateDevices();
  } catch (e) {
    alert('Microphone access দরকার: ' + e.message);
  }
}

function stopMicTest() {
  cancelAnimationFrame(testRAF);
  if (testStream) testStream.getTracks().forEach(t => t.stop());
  if (testCtx) testCtx.close();
  testStream = testCtx = null;
  $('micLevel').style.width = '0%';
  $('micTestBtn').classList.remove('active');
  $('micTestBtn').textContent = '🎙 Test mic';
}

/* ---------- recording state ---------- */
let timerInterval = 0;

function fmt(ms) {
  const s = Math.floor(ms / 1000);
  const m = String(Math.floor(s / 60)).padStart(2, '0');
  return m + ':' + String(s % 60).padStart(2, '0');
}

function elapsed(rec) {
  if (!rec.startedAt) return 0;
  const base = rec.accumMs || 0;
  return rec.status === 'paused' ? base : base + (Date.now() - rec.startedAt);
}

async function renderState() {
  const { rec } = await chrome.storage.session.get('rec');
  clearInterval(timerInterval);

  const active = rec && (rec.status === 'recording' || rec.status === 'paused');
  $('setupView').classList.toggle('hidden', !!active);
  $('controlsView').classList.toggle('hidden', !active);
  $('stateChip').classList.toggle('hidden', !active);

  if (!active) return;

  $('stateChip').textContent = rec.status === 'paused' ? 'PAUSED' : 'REC';
  $('stateChip').classList.toggle('paused', rec.status === 'paused');
  $('pauseBtn').textContent = rec.status === 'paused' ? '▶ Resume' : '⏸ Pause';
  $('micBtn').textContent = rec.micMuted ? '🔇 Unmute mic' : '🎙 Mute mic';
  $('micBtn').classList.toggle('on', !!rec.micMuted);
  $('recInfo').textContent = rec.info || '';

  const update = async () => {
    const { rec: r } = await chrome.storage.session.get('rec');
    if (r) $('bigTimer').textContent = fmt(elapsed(r));
  };
  update();
  timerInterval = setInterval(update, 500);
}

async function sendToRecorder(cmd) {
  const { rec } = await chrome.storage.session.get('rec');
  if (rec && rec.tabId != null) {
    chrome.tabs.sendMessage(rec.tabId, { type: 'cmd', cmd }).catch(() => {});
  }
}

/* ---------- wire up ---------- */
function markFormatSupport() {
  const probes = {
    vp9: 'video/webm;codecs=vp9,opus',
    vp8: 'video/webm;codecs=vp8,opus',
    mp4: 'video/mp4;codecs=avc1.640028,mp4a.40.2'
  };
  for (const opt of $('format').options) {
    if (opt.value === 'auto') continue;
    if (!MediaRecorder.isTypeSupported(probes[opt.value])) {
      opt.disabled = true;
      opt.textContent += ' — not supported';
    }
  }
  // saved setting points at a format this Chrome can't record → reset to auto
  if ($('format').selectedOptions[0]?.disabled) {
    $('format').value = 'auto';
    saveSettings();
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  markFormatSupport();
  await populateDevices();
  await renderState();

  for (const id of SETTING_IDS) {
    $(id).addEventListener('change', () => { reflectDependentRows(); saveSettings(); });
  }
  for (const id of ['micVolume', 'sysVolume']) {
    $(id).addEventListener('input', reflectVolumeLabels);
  }

  $('micTestBtn').addEventListener('click', toggleMicTest);

  $('startBtn').addEventListener('click', async () => {
    await saveSettings();
    stopMicTest();
    await chrome.runtime.sendMessage({ type: 'open-recorder', autostart: true });
    window.close();
  });

  $('pauseBtn').addEventListener('click', () => sendToRecorder('pause-resume'));
  $('micBtn').addEventListener('click', () => sendToRecorder('toggle-mic'));
  $('stopBtn').addEventListener('click', () => { sendToRecorder('stop'); window.close(); });
  $('discardBtn').addEventListener('click', () => {
    if (confirm('Recording discard করবেন? Save হবে না।')) sendToRecorder('discard');
  });

  $('shortcutsLink').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
  });

  chrome.storage.session.onChanged.addListener((ch) => { if (ch.rec) renderState(); });
});

window.addEventListener('unload', stopMicTest);
