// いあきゃらのページ本体の世界で動く。
// サイト自身が取得したキャラクターデータの応答(/v3/charasheet/{id})を、受け身で控えるだけ。
// 認証情報には触れず、応答も改変しない。クリップボードや画面操作には一切関与しない。
(() => {
  'use strict';
  const SHEET = /apiv3\.iachara\.com\/v3\/charasheet\/(\d+)/;
  window.__iaSheets = window.__iaSheets || {};
  const keep = (url, text) => {
    const m = SHEET.exec(url);
    if (m) window.__iaSheets[m[1]] = text;
  };

  const of = window.fetch;
  window.fetch = function (...a) {
    const p = of.apply(this, a);
    try {
      const url = typeof a[0] === 'string' ? a[0] : (a[0] && a[0].url) || '';
      if (SHEET.test(url)) p.then(r => r.clone().text().then(t => keep(url, t))).catch(() => {});
    } catch (e) {}
    return p;
  };

  const oo = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (m, url, ...r) {
    try {
      if (SHEET.test(String(url))) {
        this.addEventListener('load', () => {
          try { keep(String(url), this.responseText); } catch (e) {}
        });
      }
    } catch (e) {}
    return oo.call(this, m, url, ...r);
  };

  document.addEventListener('iaext-getsheet', e => {
    const id = String(e.detail);
    document.dispatchEvent(new CustomEvent('iaext-sheet-res', {
      detail: JSON.stringify({ id, text: window.__iaSheets[id] || null })
    }));
  });
})();
