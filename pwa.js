/* Installation/cache UI only. No business data, localStorage or IndexedDB access. */
(function () {
  'use strict';
  var offline = document.getElementById('offline-status');
  var installed = document.getElementById('installed-status');
  var update = document.getElementById('pwa-update');
  var message = document.getElementById('pwa-update-message');
  var apply = document.getElementById('pwa-apply-update');
  var registration;
  var wasControlled = !!(navigator.serviceWorker && navigator.serviceWorker.controller);
  var activatedByUser = false;
  var cacheReady = false;

  function installationStatus() {
    var standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    installed.textContent = standalone ? '已安装 · 正在主屏幕应用中运行' : '尚未以主屏幕应用运行 · Safari 分享 → 添加到主屏幕';
    installed.dataset.installed = standalone ? 'true' : 'false';
  }
  function offlineStatus(ready) {
    cacheReady = ready;
    offline.dataset.ready = ready ? 'true' : 'false';
    offline.textContent = ready ? '离线已就绪 · ' + (navigator.onLine ? '可断网使用，数据保存在本机' : '当前离线，可继续学习') :
      '尚未缓存 · 请联网等待完整缓存后再离线使用';
  }
  function checkCache() {
    var worker = navigator.serviceWorker.controller || (registration && registration.active);
    if (!worker) { offlineStatus(false); return; }
    if (worker.state !== 'activated') {
      worker.addEventListener('statechange', function () {
        if (worker.state === 'activated') checkCache();
      }, { once: true });
    }
    var channel = new MessageChannel();
    var timeout = window.setTimeout(function () { offlineStatus(false); channel.port1.close(); }, 5000);
    channel.port1.onmessage = function (event) {
      window.clearTimeout(timeout);
      offlineStatus(!!event.data.ready);
      channel.port1.close();
    };
    worker.postMessage({ type: 'CACHE_STATUS' }, [channel.port2]);
  }
  function offerUpdate() {
    if (!registration || !registration.waiting) return;
    update.hidden = false;
    apply.hidden = false;
    apply.disabled = false;
    message.textContent = '有新版本。请先完成当前输入，再点启用更新。';
  }
  installationStatus();
  window.addEventListener('appinstalled', installationStatus);
  var display = window.matchMedia('(display-mode: standalone)');
  if (display.addEventListener) display.addEventListener('change', installationStatus);
  window.addEventListener('online', function () { offlineStatus(cacheReady); checkCache(); });
  window.addEventListener('offline', function () { offlineStatus(cacheReady); });
  if (!window.isSecureContext || !('serviceWorker' in navigator)) {
    offline.textContent = '尚未缓存 · 安装离线版需要 Safari + HTTPS（localhost 仅供本机开发）';
    offline.dataset.ready = 'false';
    return;
  }
  apply.addEventListener('click', function () {
    if (!registration || !registration.waiting) return;
    activatedByUser = true;
    apply.disabled = true;
    message.textContent = '正在启用更新，当前页面和输入会保留…';
    registration.waiting.postMessage({ type: 'SKIP_WAITING' });
  });
  navigator.serviceWorker.addEventListener('controllerchange', function () {
    checkCache();
    if (wasControlled || activatedByUser) {
      update.hidden = false;
      apply.hidden = true;
      message.textContent = '新版本已就绪；当前输入已保留。完成本题后，请自行刷新页面或关闭再打开。';
    }
    wasControlled = true;
    // Never reload automatically: an answer might still be in progress.
  });
  navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' }).then(function (reg) {
    registration = reg;
    checkCache();
    offerUpdate();
    reg.addEventListener('updatefound', function () {
      var worker = reg.installing;
      if (!worker) return;
      worker.addEventListener('statechange', function () {
        if (worker.state === 'installed') {
          if (reg.waiting) offerUpdate();
          checkCache();
        }
        if (worker.state === 'redundant') {
          checkCache();
          if (!navigator.serviceWorker.controller) {
            offline.textContent = '尚未缓存 · 缓存失败，请保持联网并重新打开页面重试';
          }
        }
      });
    });
    navigator.serviceWorker.ready.then(checkCache);
  }).catch(function () {
    offline.textContent = '尚未缓存 · 离线安装失败，请检查 HTTPS、网络和可用存储后重试';
    offline.dataset.ready = 'false';
  });
}());
