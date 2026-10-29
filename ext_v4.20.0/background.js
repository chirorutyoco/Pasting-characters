// ツールバーのボタン: 開いているページに応じて「待機列へ保存」(いあきゃら)か「待機列を全員貼り付け」(ココフォリア)を実行する。
// 結果は、バッジ・ツールチップに加え、ページ上部に10秒間表示する。ページ内にボタンは作らない。
// ココフォリア側は画面を一切操作しない。本体の内部処理(アップロード関数・貼り付け処理)を直接呼ぶ(cc_main.js)。
// クリップボード・画像選択画面は使わない。chrome.debugger も使わない。
// 保存先は拡張機能内(store.js)。待機列=今回貼る分(3時間で対象外・貼れたら消える)、お気に入り=右クリックメニューで管理(期限なし)。
importScripts('cc_main.js', 'store.js');   // ccMain(MAIN world で実行する自己完結の関数)/ IaStore
const TITLE = 'いあきゃら⇔ココフォリア';
const IA = /^https:\/\/(iachara\.com\/(view|edit)\/|charash\.jp\/)/, CC = /^https:\/\/ccfolia\.com\/rooms\//;

// kind: 'ok'(緑) / 'warn'(橙。成功したが要確認) / 'ng'(赤)
const BADGE = { ok: ['OK', '#2a8f2a'], warn: ['OK?', '#d9822b'], ng: ['NG', '#c22222'] };

// ページ上部に結果を出す(ページ内で実行される。自己完結にすること)
function toastInPage(text, color) {
  const id = 'iaext-toast';
  const old = document.getElementById(id); if (old) old.remove();
  const d = document.createElement('div');
  d.id = id; d.textContent = text;
  d.style.cssText = 'position:fixed;z-index:2147483647;top:16px;left:50%;transform:translateX(-50%);max-width:80vw;' +
    'padding:10px 16px;border-radius:8px;color:#fff;font:14px/1.5 sans-serif;box-shadow:0 2px 12px rgba(0,0,0,.4);' +
    'white-space:pre-wrap;overflow-wrap:anywhere;box-sizing:border-box;max-height:70vh;overflow:hidden;pointer-events:none;background:' + color;
  document.documentElement.appendChild(d);
  setTimeout(() => d.remove(), 10000);
}

const setBadge = (tabId, kind, msg) => {
  chrome.action.setBadgeText({ tabId, text: kind === 'ok' ? '' : BADGE[kind][0] });   // 成功時はバッジを出さない(結果は上部の表示で足りる)
  chrome.action.setBadgeBackgroundColor({ tabId, color: BADGE[kind][1] });
  chrome.action.setTitle({ tabId, title: msg || '' });
  try {
    const p = chrome.scripting.executeScript({ target: { tabId }, func: toastInPage, args: [(msg || ''), BADGE[kind][1]] });
    if (p && p.catch) p.catch(() => {});
  } catch (e) {}
  clearTimeout(badgeTimers[tabId]);   // 前の表示の消去タイマーが、新しい表示を消さないようにする
  badgeTimers[tabId] = setTimeout(() => {
    chrome.action.setBadgeText({ tabId, text: '' });
    chrome.action.setTitle({ tabId, title: TITLE });
  }, kind === 'ok' ? 8000 : 20000);
};
const badgeTimers = {};

// ココフォリア: 待機列の全員を、保存順に、本体の内部処理でコマにする。作れたキャラは待機列から消し、失敗したキャラは残す。
// onlyId を渡すと、待機列のうちそのidだけを貼る(他の待機中キャラは残す)。
// 実行中にもう一度押されると、同じ待機列を2回貼って同じキャラのコマが重複するため、実行中は受け付けない(1つ前の実行が終わるまで)。
let pasting = false;
async function pasteToCcfolia(tab, onlyId) {
  if (pasting) return { kind: 'warn', msg: '貼り付け中です。完了までお待ちください' };
  pasting = true;
  try { return await pasteRun(tab, onlyId); } finally { pasting = false; }
}
async function pasteRun(tab, onlyId) {
  const all = (await IaStore.getAll()).queue;
  const queue = onlyId ? all.filter(e => e.id === onlyId) : all;
  if (!queue.length) throw new Error('保存済みのキャラがありません。キャラのページでボタンを押して保存してください');
  const notes = [], fails = [];
  let done = 0, failed = 0, warn = false;
  chrome.action.setBadgeText({ tabId: tab.id, text: '…' });
  chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#555555' });
  for (const [qi, e] of queue.entries()) {
    try {
      // 進行表示(結果が出るまで押し直されないようにする)
      chrome.scripting.executeScript({ target: { tabId: tab.id }, func: toastInPage, args: ['作成中 ' + (qi + 1) + '/' + queue.length + ' : ' + (e.name || ''), '#555555'] }).catch(() => {});
      const r = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: ccMain, args: [e.koma, e.images || []] });
      const res = r && r[0] && r[0].result;
      if (!res) throw new Error('ココフォリアのページから結果が返りませんでした。ページを再読み込み(F5)してください');
      if (!res.ok) throw new Error(res.msg);
      await IaStore.dropFromQueue([e.id]);
      done++;
      const w = (e.warnings && e.warnings.length) ? ' ※一部の値は推定です' : '';
      if (res.warn || w) warn = true;
      const tail = String(res.msg || '').split(' を作成しました').slice(1).join(' を作成しました') + w;
      if (tail.trim()) notes.push((e.name || 'コマ') + ':' + tail);
    } catch (err) {
      failed++;
      fails.push((e.name || e.id) + ': ' + ((err && err.message) || '失敗'));
    }
  }
  const msg = (done === 1 && !failed ? (queue[0].name || queue[0].id) + ' を作成しました' : (failed ? done + '/' + queue.length : done) + '体を作成しました') +
    (notes.length ? '\n' + notes.join('\n') : '') + IaStore.ngText(fails) +
    (failed ? '\n※失敗したキャラは待機列に残っています。もう一度押すと、その分だけ再実行します' : '');
  return { kind: !done ? 'ng' : (failed || warn ? 'warn' : 'ok'), msg };
}

// 保存ボタン: 中継役(content script)が無い・データ未取得のとき、/view/ ページだけは自動でリロードして、読み込み完了後に再試行する(F5を求めない)。
// /edit/ は入力中の内容を失うおそれがあるので自動リロードしない(従来どおり案内を出す)。
const reloadTab = tabId => new Promise((res, rej) => {
  const on = (id, info) => { if (id === tabId && info.status === 'complete') { clearTimeout(to); chrome.tabs.onUpdated.removeListener(on); res(); } };
  const to = setTimeout(() => { chrome.tabs.onUpdated.removeListener(on); rej(new Error('ページの再読み込みが終わりませんでした')); }, 20000);
  chrome.tabs.onUpdated.addListener(on);
  chrome.tabs.reload(tabId).catch(e => { clearTimeout(to); chrome.tabs.onUpdated.removeListener(on); rej(e); });
});
const sendSave = async tab => {
  const isView = /^https:\/\/(iachara\.com|charash\.jp)\/view\//.test((tab && tab.url) || '');
  const isCharash = /^https:\/\/charash\.jp\//.test((tab && tab.url) || '');
  const noRecv = e => /Receiving end|Could not establish/i.test((e && e.message) || '');
  const noData = r => !!r && r.ok === false && /^データ未取得/.test(r.msg || '');
  let r = null;
  try { r = await chrome.tabs.sendMessage(tab.id, { cmd: 'save' }); }
  catch (e) {
    if (!noRecv(e)) throw e;
    if (isCharash) {   // キャラッシュ: リロードせず、中継役(manifest の content_scripts と同じファイル)をその場で差し込んで再試行。/edit/ でも入力を失わない
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['charash_build.js', 'charash_coc.js', 'store.js', 'charash_content.js'] });
      return await chrome.tabs.sendMessage(tab.id, { cmd: 'save' });
    }
    if (!isView) throw e;
  }
  if (isView && (r === null || noData(r))) {
    chrome.scripting.executeScript({ target: { tabId: tab.id }, func: toastInPage, args: ['初回のため、ページを自動で再読み込みして保存します', '#555555'] }).catch(() => {});
    await reloadTab(tab.id);
    for (let i = 0; i < 10; i++) {
      await new Promise(s => setTimeout(s, 700));
      try { r = await chrome.tabs.sendMessage(tab.id, { cmd: 'save' }); if (!noData(r)) break; }
      catch (e) { if (i === 9 || !noRecv(e)) throw e; }
    }
  }
  return r;
};

const run = async tab => {
  const url = (tab && tab.url) || '';
  try {
    if (IA.test(url)) {
      const r = await sendSave(tab);
      setBadge(tab.id, !(r && r.ok) ? 'ng' : (r.warn ? 'warn' : 'ok'), (r && r.msg) || '');
    } else if (CC.test(url)) {
      // コマを左クリックで選択中 → そのコマを待機列に保存。選択なし → 待機列を貼り付け(従来どおり)
      const g = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: ccGrab });
      const sel = g && g[0] && g[0].result;
      if (sel && sel.ok) {
        let q = [];
        for (const it of sel.items) q = (await IaStore.saveChar({ id: 'cf-' + it.id, name: it.name, sys: 'ココフォリア', koma: it.koma, warnings: [], images: [], savedAt: Date.now() })).queue;
        setBadge(tab.id, 'ok', (sel.items.length === 1 ? (sel.items[0].name || 'コマ') + ' を' : sel.items.length + '体を') + '保存しました');
      } else {
        const r = await pasteToCcfolia(tab);
        setBadge(tab.id, r.kind, r.msg);
      }
    } else {
      setBadge(tab.id, 'ng', 'このページでは使えません');
    }
  } catch (e) {
    const noReceiver = /Receiving end|Could not establish/i.test(e.message || '');
    setBadge(tab.id, 'ng', noReceiver ? 'ページを再読み込み(F5)してから、もう一度押してください' : (e.message || '失敗'));
  }
};
chrome.action.onClicked.addListener(tab => run(tab));

// ---- ツールバーのボタンの右クリックメニュー(お気に入り・待機列の管理)----
//  お気に入りから追加 ▸ 名前… / お気に入りに登録 ▸ 待機中の名前… / お気に入りから削除 ▸ 名前… / 待機列を空にする(N人)
const names = list => IaStore.listText(IaStore.labelsOf(list));
const addMenu = (props) => chrome.contextMenus.create(Object.assign({ contexts: ['action'] }, props), () => void chrome.runtime.lastError);

async function doRebuildMenus() {
  const { queue, favs } = await IaStore.getAll();
  await new Promise(res => chrome.contextMenus.removeAll(res));
  const group = (key, title, items) => {
    addMenu({ id: key, title });
    if (!items.length) addMenu({ id: key + ':none', parentId: key, title: '(なし)', enabled: false });
    const labels = IaStore.labelsOf(items);
    items.forEach((e, i) => addMenu({ id: key + ':' + e.id, parentId: key, title: labels[i] }));
  };
  group('add', 'お気に入りから追加', favs);
  group('reg', 'お気に入りに登録(待機中のキャラ)', queue);
  group('del', 'お気に入りから削除', favs);
  addMenu({ id: 'clear', title: '待機列を空にする(' + queue.length + '人)', enabled: queue.length > 0 });
}
let menuChain = Promise.resolve();
const rebuildMenus = () => (menuChain = menuChain.then(doRebuildMenus).catch(() => {}));

// メニューが選ばれたとき(グローバル関数にしてある)
async function handleMenu(menuId, tab) {
  const say = (kind, msg) => { if (tab && tab.id != null) setBadge(tab.id, kind, msg); };
  const s = String(menuId), i = s.indexOf(':');
  const op = i < 0 ? s : s.slice(0, i), id = i < 0 ? '' : s.slice(i + 1);
  try {
    if (op === 'add') {
      const r = await IaStore.addFavToQueue(id);
      if (!r) return say('ng', 'お気に入りが見つかりません');
      if (tab && tab.id != null && CC.test(tab.url || '')) {   // ココフォリアのルームで選んだ場合は、そのキャラをそのまま貼る
        const p = await pasteToCcfolia(tab, r.entry.id);
        return say(p.kind, p.msg);
      }
      say('ok', (r.entry.name || r.entry.id) + ' を保存しました');
    } else if (op === 'reg') {
      const r = await IaStore.register(id);
      if (!r) return say('ng', '待機列にありません(3時間を過ぎたか、貼り付け済みです)。いあきゃらでもう一度保存してください');
      say('ok', (r.entry.name || r.entry.id) + ' をお気に入りに登録しました');
    } else if (op === 'del') {
      const e = await IaStore.unfav(id);
      say(e ? 'ok' : 'ng', e ? (e.name || e.id) + ' をお気に入りから削除しました' : 'お気に入りが見つかりません');
    } else if (op === 'clear') {
      const n = await IaStore.clearQueue();
      say('ok', '待機列を空にしました');
    }
  } catch (e) { say('ng', e.message || '失敗'); }
}
chrome.contextMenus.onClicked.addListener((info, tab) => { handleMenu(info.menuItemId, tab); });

chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && (ch.iaQueue || ch.iaFavs)) rebuildMenus(); });
chrome.runtime.onInstalled.addListener(() => { chrome.storage.local.remove('iaChar'); rebuildMenus(); });   // 旧版の1件保存は使わない
chrome.runtime.onStartup.addListener(rebuildMenus);
rebuildMenus();

// 画像の取得(いあきゃら側から依頼される)。背景はホスト権限のあるサイトならCORSの影響を受けない。
chrome.runtime.onMessage.addListener((msg, sender, send) => {
  if (!msg || msg.cmd !== 'fetchImage' || sender.id !== chrome.runtime.id) return;
  (async () => {
    if (!/^https:\/\//.test(String(msg.url))) throw new Error('https 以外は取得しない');
    const r = await fetch(msg.url);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const buf = new Uint8Array(await r.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    const type = r.headers.get('content-type') || '';
    return { ok: true, type, dataUrl: 'data:' + (type || 'application/octet-stream') + ';base64,' + btoa(bin) };
  })().then(send).catch(e => send({ ok: false, msg: e.message }));
  return true;
});
