// Service worker: badge state, keyboard commands, notifications.

const RECORDER_URL = chrome.runtime.getURL('recorder.html');

async function getRecState() {
  const { rec } = await chrome.storage.session.get('rec');
  return rec || null;
}

async function findRecorderTab() {
  const tabs = await chrome.tabs.query({ url: RECORDER_URL + '*' });
  return tabs[0] || null;
}

function setBadge(status) {
  if (status === 'recording') {
    chrome.action.setBadgeText({ text: 'REC' });
    chrome.action.setBadgeBackgroundColor({ color: '#ef4444' });
  } else if (status === 'paused') {
    chrome.action.setBadgeText({ text: '❚❚' });
    chrome.action.setBadgeBackgroundColor({ color: '#f59e0b' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

chrome.storage.session.onChanged.addListener((changes) => {
  if (changes.rec) setBadge(changes.rec.newValue ? changes.rec.newValue.status : null);
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'saved') {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'Recording saved',
      message: msg.filename + ' (' + msg.size + ')'
    });
  }
  if (msg.type === 'open-recorder') {
    (async () => {
      const existing = await findRecorderTab();
      if (existing) {
        await chrome.tabs.update(existing.id, { active: true });
        await chrome.windows.update(existing.windowId, { focused: true });
      } else {
        await chrome.tabs.create({ url: RECORDER_URL + (msg.autostart ? '?autostart=1' : '') });
      }
      sendResponse({ ok: true });
    })();
    return true; // async response
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  const rec = await getRecState();
  const tab = await findRecorderTab();

  if (command === 'start-stop' && !tab) {
    // Nothing running: open recorder ready to start.
    await chrome.tabs.create({ url: RECORDER_URL + '?autostart=1' });
    return;
  }
  if (tab) {
    chrome.tabs.sendMessage(tab.id, { type: 'cmd', cmd: command, state: rec?.status }).catch(() => {});
  }
});

// Cleanup if the recorder tab is closed manually.
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const rec = await getRecState();
  if (rec && rec.tabId === tabId) {
    await chrome.storage.session.remove('rec');
    setBadge(null);
  }
});
