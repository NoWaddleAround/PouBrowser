// Proves content scripts run: a green bar at the top of every page.
const bar = document.createElement('div');
bar.textContent = 'PouBrowser Test extension is running';
bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#1a7f37;color:#fff;font:600 14px system-ui;padding:6px;text-align:center';
document.documentElement.appendChild(bar);
