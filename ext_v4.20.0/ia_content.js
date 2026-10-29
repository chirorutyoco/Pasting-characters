// いあきゃらのページ: ツールバーのボタンが押されたら、API応答から駒データ文字列を組み立てて、拡張機能内の「待機列」に追加する(store.js)。
// 組み立ては koma_build.js。確認済みの規則だけで出力し、当てはまらない状況では停止する(推測しない)。
// 立ち絵(profile.icons)は全枚を取得して保存する。1枚目=コマのアイコン。2枚以上あるときは全枚(1枚目を含む)が立ち絵(label=名前)になる。
(() => {
  'use strict';

  function getSheet() {
    const id = location.pathname.split('/').pop();
    let res = null;
    const on = e => { res = e.detail; };
    document.addEventListener('iaext-sheet-res', on);
    document.dispatchEvent(new CustomEvent('iaext-getsheet', { detail: id }));
    document.removeEventListener('iaext-sheet-res', on);
    const r = res ? JSON.parse(res) : null;
    if (!r || !r.text) throw new Error('データ未取得。ページを再読み込み(F5)してから押してください');
    return JSON.parse(r.text);
  }

  const toDataUrl = blob => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });

  // 画像の取得は、まずページ内で直接取得し、だめなら拡張機能の背景(CORSの影響を受けない)に頼む。
  const viaBackground = url => new Promise(res => {
    try {
      chrome.runtime.sendMessage({ cmd: 'fetchImage', url }, r => {
        void chrome.runtime.lastError;
        res(r && r.ok ? r : null);
      });
    } catch (e) { res(null); }
  });

  // 先頭バイトから画像の種類を判定する(URLに拡張子がなく、Content-Type が不正確でも正しい種類で保存する)
  function sniffType(dataUrl) {
    try {
      const b = atob(dataUrl.slice(dataUrl.indexOf(',') + 1, dataUrl.indexOf(',') + 17));
      const c = i => b.charCodeAt(i);
      if (c(0) === 0x89 && b.slice(1, 4) === 'PNG') return 'image/png';
      if (c(0) === 0xFF && c(1) === 0xD8 && c(2) === 0xFF) return 'image/jpeg';
      if (b.slice(0, 4) === 'GIF8') return 'image/gif';
      if (b.slice(0, 4) === 'RIFF' && b.slice(8, 12) === 'WEBP') return 'image/webp';
    } catch (e) {}
    return null;
  }
  const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };

  async function webpToPng(dataUrl) {
    if (typeof createImageBitmap !== 'function') return null;
    const bin = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const bmp = await createImageBitmap(new Blob([u8], { type: 'image/webp' }));
    const cv = document.createElement('canvas');
    cv.width = bmp.width; cv.height = bmp.height;
    cv.getContext('2d').drawImage(bmp, 0, 0);
    const out = await new Promise(res => cv.toBlob(res, 'image/png'));
    return out ? await toDataUrl(out) : null;
  }

  async function fetchImage(url, baseName, k, label) {
    let declared, dataUrl;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const b = await res.blob();
      declared = b.type; dataUrl = await toDataUrl(b);
    } catch (e) {   // だめなら背景経由(CORSの影響を受けない)
      const r = await viaBackground(url);
      if (!r) throw e;
      declared = r.type; dataUrl = r.dataUrl;
    }
    let type = sniffType(dataUrl) || (/^image\//.test(declared || '') ? declared.split(';')[0] : 'image/png');
    if (type === 'image/webp') {   // ココフォリアの対応形式は JPG / PNG / GIF / APNG(公式)。WebP は PNG に変換する
      try { const p = await webpToPng(dataUrl); if (p) { dataUrl = p; type = 'image/png'; } } catch (e) {}
    }
    const ext = EXT[type] || (type.split('/')[1] || 'png').split('+')[0];
    return { name: baseName + '_' + (k + 1) + '.' + ext, type, dataUrl, label };
  }

  async function save() {
    const sheet = getSheet();
    // koma は文字列。保存もこの文字列のまま(ココフォリア側で iconUrl と faces だけを差し込む)
    const pageId = location.pathname.split('/').filter(Boolean).pop();
    // 駒の externalUrl は、サイト本体と同じく「開いているページのID」を使う(API応答のidに頼らない)
    let built;
    try { built = KomaBuild.buildEx(sheet, { id: pageId }); } catch (e) { throw new Error('キャラのデータを処理できませんでした'); }
    const warnings = built.warnings;
    // 駒のキャラクターメモ: 1行目=「名前 (フリガナ)」(コマの name と同じ。フリガナが空なら名前のみ)、2行目=「APP15 SIZ14」(値が0=未記入の項目は飛ばす。両方未記入なら2行目なし)。
    // APP・SIZ は駒の params(合計値)から読む。コマの name も下で同じ表示名にする。
    const komaObj = JSON.parse(built.koma);
    {   // フリガナが空・空白のみのときは括弧ごと出さない(サイト本体は空白だけだと "( )" を出すため、ここで組み直す)
      const p0 = (((sheet.data || {}).data) || {}).profile || {};
      const nm = p0.name || '新たな探索者', fr = String(p0.furi || '').trim();
      komaObj.data.name = fr ? nm + ' (' + fr + ')' : nm;
    }
    {   // SAN の上限: サイトの画面(例 58/99)と同じ「99−クトゥルフ神話の合計」にする。サイト本体の駒出力は上限を現在値と同じにしてしまうため、ここで直す。現在値(value)は sanCurrent のまま。
      const d0 = ((sheet.data || {}).data) || {};
      const kn = d0.knowledgeSkills || {};
      const st = Array.isArray(kn.static) ? kn.static : [];
      const cm = st.find(s => s && s.name === 'クトゥルフ神話') || (Array.isArray(kn.additional) ? kn.additional : []).find(s => s && s.name === 'クトゥルフ神話') || st[d0.version === '7th' ? 2 : 3] || {};
      const cmSum = ['defaultPoint', 'professionPoint', 'interestPoint', 'growthPoint', 'otherPoint'].reduce((a, k) => a + (Number(cm[k]) || 0), 0);
      const sanEnt = (komaObj.data.status || []).find(s => s && s.label === 'SAN');
      if (sanEnt) sanEnt.max = 99 - cmSum;
    }
    const abil = l => {
      const p = (komaObj.data.params || []).find(x => x && x.label === l);
      const v = p ? Number(p.value) : 0;
      return isFinite(v) && v !== 0 ? l + p.value : '';
    };
    const memoLines = [komaObj.data.name];
    const appSiz = ['APP', 'SIZ'].map(abil).filter(Boolean).join(' ');
    if (appSiz) memoLines.push(appSiz);
    komaObj.data.memo = memoLines.join('\n');
    const koma = JSON.stringify(komaObj);

    const prof = (((sheet.data || {}).data) || {}).profile || {};
    const baseName = (prof.name || 'chara').trim();
    const icons = (prof.icons || []).filter(x => x && x.url);
    // 画像は並行して取得する(順序は icons のまま保つ)。1枚でも失敗したら保存しない(順序・枚数のずれを防ぐ)
    const got = await Promise.all(icons.map((ic, k) =>
      fetchImage(ic.url, baseName, k, String(ic.name || '')).then(v => ({ v }), e => ({ e }))));
    const images = got.filter(g => g.v).map(g => g.v);
    const imgNg = got.length - images.length;
    if (imgNg) {
      return { ok: false, warn: false, msg: baseName + ': アイコン画像を取得できませんでした(保存していません)' };
    }
    const entry = { id: pageId, name: baseName, sys: (((sheet.data || {}).data || {}).version === '7th') ? '7版' : '6版', koma, warnings, images, savedAt: Date.now() };
    const st = await IaStore.saveChar(entry);   // 待機列に追加(同じidは上書き)。お気に入りに同じidがあれば中身も更新
    const msg = baseName + ' を保存しました' + (warnings.length ? ' ※一部の値は推定です' : '');
    return { ok: true, warn: warnings.length > 0, msg };
  }

  chrome.runtime.onMessage.addListener((msg, _s, send) => {
    if (msg.cmd !== 'save') return;
    save().then(send).catch(e => send({ ok: false, msg: e.message }));
    return true;
  });
})();
