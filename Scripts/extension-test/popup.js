// Proves the popup and extension storage work: the count survives closing the popup and restarting the app.
chrome.storage.local.get({ opened: 0 }).then(({ opened }) => {
  document.getElementById('count').textContent = opened + 1;
  chrome.storage.local.set({ opened: opened + 1 });
});
