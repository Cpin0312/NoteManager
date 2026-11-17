// Shift_JIS・文字コードと改行コードの表示・行番号・置き換えで改行（ヘッドレス Chrome、OPFS）。実行：node test/test3.mjs
import { launch, sleep } from './cdp.mjs';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const srv = spawn('python3', ['-m', 'http.server', '8766', '--bind', '127.0.0.1', '-d', ROOT], { stdio: 'ignore' });
await sleep(800);
process.on('exit', () => srv.kill());
const c = await launch({ profile: mkdtempSync(tmpdir() + '/nm-test3-'), port: 9338 });
c.on(m => { if (m.method === 'Page.javascriptDialogOpening') c.send('Page.handleJavaScriptDialog', { accept: true }); });
await c.send('Page.enable');
await c.send('Page.navigate', { url: 'http://127.0.0.1:8766/index.html' }); await sleep(1000);
const J = c.evalJs; let fails = 0;
const ok = (name, cond, extra = '') => { console.log((cond ? 'OK  ' : 'NG  ') + name + (extra ? '  ' + extra : '')); if (!cond) fails++; };
const msg = () => J(`document.getElementById('msg').className + ':' + document.getElementById('msg').textContent`);
const open = async p => { await J(`document.querySelector('.item[data-path="${p}"]').click(); 1`); await sleep(400); };
const edv = () => J(`document.getElementById('editor').value`);
const fmt = () => J(`document.getElementById('fmt').textContent`);
const setVal = (id, v) => J(`(()=>{const e=document.getElementById('${id}'); if (e.type==='checkbox') e.checked=${JSON.stringify(v)}; else e.value=${JSON.stringify(v)}; e.dispatchEvent(new Event('input')); return 1})()`);
const typeEnd = async t => { await J(`(()=>{const e=document.getElementById('editor');e.focus();e.setSelectionRange(e.value.length,e.value.length);return 1})()`); await c.send('Input.insertText', { text: t }); await sleep(100); };
const save = async () => { await J(`save().then(()=>1)`); await sleep(200); };
const readOpfs = p => J(`(async()=>{const r=await navigator.storage.getDirectory();return [...new Uint8Array(await (await (await r.getFileHandle(${JSON.stringify(p)})).getFile()).arrayBuffer())].join(',')})()`);
const gutter = () => J(`[...document.querySelectorAll('#gutter div')].map(d=>d.textContent+':'+Math.round(d.getBoundingClientRect().height))`);

const SJIS = [0x82, 0xA0, 0x82, 0xA2, 13, 10, 0xB1, 0x87, 0x40, 0xFB, 0xFC, 0x81, 0x60];   // あい CRLF ｱ①髙～
await J(`(async()=>{const r=await navigator.storage.getDirectory();for await (const k of r.keys()) await r.removeEntry(k,{recursive:true});
 const put=async(n,b)=>{const w=await (await r.getFileHandle(n,{create:true})).createWritable();await w.write(new Uint8Array(b));await w.close()};
 await put('sjis.txt',${JSON.stringify(SJIS)}); await put('mixed.txt',[97,13,10,98,10,99]); await put('bom.md',[0xEF,0xBB,0xBF,0x61,0x0A]);
 await put('utf16.txt',[0xFF,0xFE,0x61,0,0x62,0]); await put('bin.png',[137,80,78,71,0,0,1]);
 await put('lines.txt',[...new TextEncoder().encode('a\\n'+'x'.repeat(600)+'\\nb\\n'+Array.from({length:200},(_, i)=>'L'+i).join('\\n'))]);
 await put('repl.txt',[...new TextEncoder().encode('りんご、みかん、ぶどう\\nA\\nB')]);
 await openRoot(r); return 1})()`);
await sleep(600);
const tree = await J(`[...document.querySelectorAll('.item')].map(e=>e.dataset.path+(e.classList.contains('binary')?'(灰)':'')).join(' ')`);
ok('Shift_JIS は灰色でない。UTF-16・画像は灰色', tree.includes('sjis.txt ') && tree.includes('utf16.txt(灰)') && tree.includes('bin.png(灰)'), tree);
ok('ファイルを開く前は文字コードを出さない', (await fmt()) === '');

// ===== Shift_JIS =====
await open('sjis.txt');
ok('Shift_JIS を読める', (await edv()) === 'あい\nｱ①髙～', JSON.stringify(await edv()));
ok('Shift_JIS ・ CRLF と出る', (await fmt()) === 'Shift_JIS ・ CRLF', await fmt());
await typeEnd('う'); await save();
ok('Shift_JIS のまま保存（元のバイトはそのまま、足した文字だけ増える）', (await readOpfs('sjis.txt')) === [...SJIS, 0x82, 0xA4].join(','), await readOpfs('sjis.txt'));
await typeEnd('\n😀'); await save();
const m1 = await msg();
ok('表せない文字は保存せず、文字と行を知らせる', m1.startsWith('err') && m1.includes('😀') && m1.includes('3 行目'), m1);
ok('そのときファイルは元のまま・画面の文も残る', (await readOpfs('sjis.txt')) === [...SJIS, 0x82, 0xA4].join(',') && (await edv()).endsWith('😀') && (await J(`dirty`)), await readOpfs('sjis.txt'));
await J(`(()=>{const e=document.getElementById('editor');e.value=e.value.replace('\\n😀','');e.dispatchEvent(new Event('input'));return 1})()`);
await setVal('fQuery', 'ｱ①'); await sleep(900);
ok('ファイル検索で Shift_JIS の中身も探す', (await J(`[...document.querySelectorAll('#fResults .hit')].map(e=>e.textContent).join()`)).includes('sjis.txt'), await J(`document.getElementById('fResults').textContent`));
await setVal('fQuery', ''); await sleep(400);
await save();

// ===== 文字コードと改行コードの表示 =====
await open('bom.md');
ok('UTF-8（BOM付き） ・ LF', (await fmt()) === 'UTF-8（BOM付き） ・ LF', await fmt());
await open('mixed.txt');
ok('改行がまざっていたら知らせる', (await fmt()).startsWith('UTF-8 ・ CRLF（改行がまざっています'), await fmt());
await save();
ok('保存するとそろい、知らせが消える', (await readOpfs('mixed.txt')) === '97,13,10,98,13,10,99' && (await fmt()) === 'UTF-8 ・ CRLF', (await readOpfs('mixed.txt')) + ' ' + (await fmt()));

// ===== 行番号 =====
await open('lines.txt'); await sleep(300);
const g = await gutter();
ok('行の数だけ番号が出る', g.length === 203 && g[0].startsWith('1:') && g[202].startsWith('203:'), g.length + ' ' + g.slice(0, 3));
const lh = +g[0].split(':')[1];
ok('折り返した長い行は、番号の高さも合わせる', +g[1].split(':')[1] > lh * 2 && +g[2].split(':')[1] === lh, g.slice(0, 3).join(' '));
const tops = await J(`(()=>{const e=document.getElementById('editor');e.scrollTop=1500;e.dispatchEvent(new Event('scroll'));const gd=document.getElementById('gutter');return [e.scrollTop,gd.scrollTop]})()`);
ok('スクロールすると番号も一緒に動く', tops[0] > 0 && tops[0] === tops[1], JSON.stringify(tops));
// 打つと番号が増える
await typeEnd('\nZ'); await sleep(200);
ok('行を足すと番号が増える', (await gutter()).length === 204);
await J(`(()=>{const e=document.getElementById('editor');e.value=savedText;e.dispatchEvent(new Event('input'));return 1})()`);
// 幅を変えると折り返しが変わり、番号の高さも変わる
const before = +(await gutter())[1].split(':')[1];
await J(`setSideWidth(180); 1`); await sleep(300);
const after = +(await gutter())[1].split(':')[1];
ok('幅を変えると高さも合わせ直す', after < before, before + ' → ' + after);
await J(`setSideWidth(300); 1`); await sleep(300);
// 番号の行の位置が、文の行と合っている（最後の行の下端がそろう）
const align = await J(`(()=>{const e=document.getElementById('editor'),gd=document.getElementById('gutter');e.scrollTop=e.scrollHeight;e.dispatchEvent(new Event('scroll'));return [e.scrollHeight - e.clientHeight, gd.scrollHeight - gd.clientHeight]})()`);
ok('番号と文の全体の高さがそろう', Math.abs(align[0] - align[1]) <= 2, JSON.stringify(align));
await J(`mdMode = true; refreshState(); 1`); await sleep(200);
ok('MD表示のときは番号を隠す', await J(`document.getElementById('edRow').classList.contains('hidden')`));
await J(`mdMode = false; refreshState(); 1`); await sleep(200);
ok('編集に戻ると番号が出る', await J(`!document.getElementById('edRow').classList.contains('hidden') && document.querySelectorAll('#gutter div').length === 203`));

// ===== 置き換えで改行を入れる・消す =====
await open('repl.txt');
await J(`openFind(true); 1`);
const run = async (q, r, regex = true) => { await setVal('sRegex', regex); await setVal('sOp', 'replace'); await setVal('sQuery', q); await setVal('sReplace', r); await J(`document.getElementById('btnRun').click(); 1`); await sleep(250); };
await run('、', '、¥n');
ok('¥n で改行を入れる', (await edv()) === 'りんご、\nみかん、\nぶどう\nA\nB', JSON.stringify(await edv()));
ok('改行を入れると番号も増える', (await gutter()).length === 5);
await run('、¥n', '・');
ok('探す欄の ¥n で、改行をまたいで探す', (await edv()) === 'りんご・みかん・ぶどう\nA\nB', JSON.stringify(await edv()));
await run('\\n', '');
ok('\\n を空にして行をつなげる', (await edv()) === 'りんご・みかん・ぶどうAB', JSON.stringify(await edv()));
await run('・', '\\t');
ok('\\t でタブ', (await edv()) === 'りんご\tみかん\tぶどうAB', JSON.stringify(await edv()));
await run('\\t', '¥¥');
ok('¥¥ で \\ そのもの', (await edv()) === 'りんご\\みかん\\ぶどうAB', JSON.stringify(await edv()));
await run('(みかん)', '[$1]¥n');
ok('$1 と ¥n をいっしょに使える', (await edv()) === 'りんご\\[みかん]\n\\ぶどうAB', JSON.stringify(await edv()));
await run('ご', 'ご¥n', false);
ok('ふつうの検索では ¥n は文字のまま', (await edv()).startsWith('りんご¥n\\'), JSON.stringify(await edv()));

console.log(fails ? `NG ${fails} 件` : 'ALL OK');
c.close(); srv.kill(); process.exit(fails ? 1 : 0);
