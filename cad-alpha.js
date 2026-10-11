/* たびマップ 本祭支援ツール α版：鳳祭 統括指令（旧 MATSURI-CAD v5 を地図に統合）
   - 本祭支援ツールの地図（Googleベクター地図・実測3D建物）の上に、指令台の機能を重ねる
     左＝人員（局・状態・配置）、右＝出動指令／本日の進行／指令ログ、地図＝配置箇所・指令・人員の位置
   - 配置箇所は実際の緯度経度で持つ（本祭支援ツールの建物・駐車場・G倉庫などから初期配置。地図上でドラッグして調整可）
   - データは端末内（localStorage）に保存。同じ端末の別ウィンドウとは自動で同期（2画面運用）
   - 人員の氏名はダミー（公開リポジトリのため実名・連絡先は入れない。実名は端末内でのみ扱う） */
(function(){
'use strict';
if(window.CAD)return;
const KEY='tabi_fest_cad_v1';

/* ---------- 定義 ---------- */
const DEFAULT_BUREAUS=[
  {code:'幹',name:'執行部',color:'#e8eef6'},{code:'企1',name:'企画局1課',color:'#a06bff'},{code:'企2',name:'企画局2課',color:'#c08bff'},
  {code:'渉',name:'渉外局',color:'#28c8e0'},{code:'庶',name:'庶務局',color:'#37d47f'},{code:'会',name:'会計局',color:'#ffb020'},
  {code:'事',name:'事務局',color:'#4a90ff'},{code:'警',name:'警備局',color:'#ff3b47'}];
// 配置箇所：ref＝本祭支援ツールのデータ（建物B..・駐車場P..・出入口E..・避難場所EV:..）から位置を決める。dx/dyは少しずらす量（m）
const DEFAULT_LOCATIONS=[
  {id:'HQ',name:'統括本部（10号館）',ref:'B10',dy:-14,hq:true,t:'hq'},
  {id:'INFO',name:'守衛場',ref:'B11',t:'small'},{id:'GATE',name:'正門受付',ref:'E5',t:'gate'},
  {id:'G1',name:'1号館',ref:'B01'},{id:'G2',name:'2号館',ref:'B02'},{id:'G3',name:'3号館',ref:'B04'},{id:'G4',name:'4号館',ref:'B05'},
  {id:'G5',name:'5号館',ref:'B06'},{id:'G6',name:'6号館',ref:'B07'},{id:'G7',name:'7号館',ref:'B08'},{id:'G8',name:'8号館',ref:'B09'},
  {id:'G9',name:'9号館',ref:'B51'},{id:'G10',name:'10号館',ref:'B10',dy:14},{id:'G11',name:'11号館',ref:'B58'},
  {id:'GTOP',name:'グリーントップ',ref:'B12'},{id:'YAGAI',name:'野外音楽堂',ref:'B49',t:'stage'},{id:'SHOKUDO',name:'VIEW',ref:'B22'},
  {id:'IKUTA',name:'生田会館',ref:'B15'},{id:'GYM1',name:'第1体育館',ref:'B16',t:'stage'},
  {id:'GREEN',name:'10号館前芝生',ref:'EV:B',t:'stage'},{id:'MOGI',name:'屋外出店エリア（4号館前）',lat:35.60962,lng:139.55612,t:'mogi'},
  {id:'AID',name:'救護（4号館 保健室）',ref:'B05',dx:-16,t:'aid'},{id:'KITA',name:'北グラウンド',ref:'EV:C'},{id:'NISHI',name:'西グラウンド',ref:'EV:D'},
  {id:'P1',name:'10・9号館前の駐車場',ref:'P1',t:'park'},{id:'P2',name:'第一体育館前の駐車スペース',ref:'P2',t:'park'},
  {id:'GSOUKO',name:'G倉庫',ref:'B66',t:'park'},{id:'TENJIN',name:'枡形天神社',ref:'B64',t:'park'}];
const STATUS={active:{label:'活動中',color:'#37d47f',rank:5},moving:{label:'移動中',color:'#28c8e0',rank:4},break:{label:'休憩中',color:'#4a90ff',rank:6},
  busy:{label:'保留中',color:'#ffb020',rank:2},respond:{label:'対応中',color:'#ff7a1a',rank:1}};
const STATUS_ORDER=['active','moving','break','busy','respond'];
const KINDS={aid:{label:'救護要請',color:'#ff3b47'},trouble:{label:'トラブル対応',color:'#ff7a1a'},supply:{label:'物資搬送',color:'#37d47f'},
  claim:{label:'苦情/クレーム',color:'#ffb020'},facility:{label:'設備トラブル',color:'#a06bff'},lost:{label:'迷子/呼出',color:'#28c8e0'},
  patrol:{label:'巡回強化',color:'#4a90ff'},other:{label:'その他',color:'#8ea0b5'}};
const SCALE={small:{label:'小',n:1},mid:{label:'中',n:2},large:{label:'大',n:4}};
const SURNAMES='佐藤 鈴木 高橋 田中 伊藤 渡辺 山本 中村 小林 加藤 吉田 山田 佐々木 山口 松本 井上 木村 林 斎藤 清水 山崎 森 池田 橋本 阿部 石川 前田 藤田 後藤 近藤'.split(' ');
const GIVEN='陽翔 結菜 蓮 葵 大翔 凛 悠人 芽依 湊 陽菜 樹 咲良 悠真 結愛 律 莉子 朝陽 美結 新 心春 颯太 楓 大和 紬 悠 杏 澪 奏太 栞 拓海'.split(' ');
const BUREAU_PLAN={'幹':{n:8,locs:['HQ','HQ','INFO'],roles:['委員長','副委員長','統括','統括']},
  '企1':{n:18,locs:['GYM1','GREEN','MOGI','SHOKUDO','YAGAI'],roles:['班長','主任','局員']},
  '企2':{n:20,locs:['GREEN','YAGAI','G10','MOGI','KITA'],roles:['班長','主任','局員']},
  '渉':{n:21,locs:['INFO','GATE','G2','GTOP','G5'],roles:['班長','主任','局員']},
  '庶':{n:22,locs:['HQ','GSOUKO','P2','G8','MOGI'],roles:['班長','主任','局員']},
  '会':{n:12,locs:['HQ','MOGI','INFO'],roles:['主任','局員']},'事':{n:15,locs:['HQ','INFO','G2'],roles:['主任','局員']},
  '警':{n:30,locs:['GATE','GREEN','GYM1','MOGI','KITA','P1','P2','G10','YAGAI','INFO'],roles:['班長','主任','局員']}};
// 本日の進行（サンプル。実際の企画・時刻は端末内で編集する想定）
const DEFAULT_EVENTS=[
  {t:'開門・受付開始',loc:'GATE',bureau:'渉',sh:9,sm:30,eh:10,em:0},{t:'ステージ企画（サンプル）',loc:'GREEN',bureau:'企2',sh:11,sm:0,eh:12,em:0},
  {t:'ライブ企画（サンプル）',loc:'GYM1',bureau:'企1',sh:13,sm:0,eh:14,em:30},{t:'巡回強化',loc:'INFO',bureau:'警',sh:15,sm:0,eh:15,em:30},
  {t:'物品の搬出（G倉庫→第一体育館前）',loc:'GSOUKO',bureau:'庶',sh:16,sm:0,eh:17,em:0},{t:'撤収準備',loc:'HQ',bureau:'幹',sh:17,sm:30,eh:18,em:0}];
// 発生場所（ボタンで選ぶ階層）。ref＝配置箇所
const ZONES=[
  {id:'z_fac',label:'主要施設（各号館）',container:true,children:[
    {id:'z_g1',label:'1号館',ref:'G1'},{id:'z_g2',label:'2号館',ref:'G2',children:[{id:'z_g2_bf1',label:'BF1'},{id:'z_g2_1f',label:'1F'},{id:'z_g2_2f',label:'2F'}]},
    {id:'z_g3',label:'3号館',ref:'G3'},{id:'z_g4',label:'4号館',ref:'G4',children:[{id:'z_g4_1f',label:'1F'},{id:'z_g4_out',label:'屋外広場',ref:'MOGI'}]},
    {id:'z_g5',label:'5号館',ref:'G5',children:[{id:'z_g5_1f',label:'1F'},{id:'z_g5_2f',label:'2F'},{id:'z_g5_3f',label:'3F'}]},
    {id:'z_g6',label:'6号館',ref:'G6'},{id:'z_g7',label:'7号館',ref:'G7'},{id:'z_g8',label:'8号館',ref:'G8'},{id:'z_g9',label:'9号館',ref:'G9'},
    {id:'z_g10',label:'10号館',ref:'G10',children:[{id:'z_g10_shiba',label:'10号館前芝生',ref:'GREEN'},{id:'z_g10_hq',label:'本部',ref:'HQ'},
      {id:'z_g10_bf1',label:'BF1'},{id:'z_g10_1f',label:'1F'},{id:'z_g10_2f',label:'2F'},{id:'z_g10_3f',label:'3F'},{id:'z_g10_4f',label:'4F'},{id:'z_g10_5f',label:'5F'},{id:'z_g10_ev',label:'エレベーター'}]},
    {id:'z_g11',label:'11号館',ref:'G11'}]},
  {id:'z_ikuta',label:'生田会館',ref:'IKUTA',children:[{id:'z_ik_1f',label:'1F'},{id:'z_ik_2f',label:'2F'},{id:'z_ik_3f',label:'3F'}]},
  {id:'z_gym1',label:'第一体育館',ref:'GYM1',children:[{id:'z_gy_seat',label:'観客席'},{id:'z_gy_back',label:'舞台裏'},{id:'z_gy_recv',label:'受付前（屋外）'}]},
  {id:'z_park',label:'駐車場',container:true,children:[{id:'z_pk_p1',label:'10・9号館前の駐車場',ref:'P1'},{id:'z_pk_p2',label:'第一体育館前の駐車スペース',ref:'P2'}]},
  {id:'z_souko',label:'倉庫・搬送',container:true,children:[{id:'z_sk_g',label:'G倉庫',ref:'GSOUKO'},{id:'z_sk_t',label:'枡形天神社',ref:'TENJIN'}]},
  {id:'z_out',label:'屋外',container:true,children:[{id:'z_o_gate',label:'正門',ref:'GATE'},{id:'z_o_info',label:'守衛場',ref:'INFO'},
    {id:'z_o_gtop',label:'グリーントップ',ref:'GTOP'},{id:'z_o_yagai',label:'野外音楽堂',ref:'YAGAI'},{id:'z_o_kita',label:'北グラウンド',ref:'KITA'},{id:'z_o_nishi',label:'西グラウンド',ref:'NISHI'}]}];
function zoneFind(id,nodes,path){nodes=nodes||ZONES;path=path||[];for(const n of nodes){const p=path.concat([n]);if(n.id===id)return{node:n,path:p};if(n.children){const r=zoneFind(id,n.children,p);if(r)return r;}}return null;}
function zoneRef(id){const f=zoneFind(id);if(!f)return null;for(let i=f.path.length-1;i>=0;i--)if(f.path[i].ref)return f.path[i].ref;return null;}
function zoneLabel(id){const f=zoneFind(id);return f?f.path.filter(n=>!n.container).map(n=>n.label).join(' › '):'';}

/* ---------- 小道具 ---------- */
const $=s=>document.querySelector(s);
const pad=n=>String(n).padStart(2,'0');
const rnd=a=>a[Math.floor(Math.random()*a.length)];
function weighted(p){const t=p.reduce((s,x)=>s+x[1],0);let r=Math.random()*t;for(const[v,w]of p){if((r-=w)<0)return v;}return p[0][0];}
const fmtClock=ts=>{const d=new Date(ts);return pad(d.getHours())+':'+pad(d.getMinutes())+':'+pad(d.getSeconds());};
const fmtHM=ts=>{const d=new Date(ts);return pad(d.getHours())+':'+pad(d.getMinutes());};
const fmtElapsed=ts=>{let s=Math.max(0,Math.floor((Date.now()-ts)/1000));const m=Math.floor(s/60);s%=60;return pad(m)+':'+pad(s);};
const fmtRemain=ms=>{const m=Math.floor(Math.max(0,Math.round(ms/1000))/60);return m>=60?Math.floor(m/60)+'時間'+(m%60)+'分':m+'分';};
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function evStart(e){const d=new Date();d.setHours(e.sh,e.sm,0,0);return d.getTime();}
function evEnd(e){const d=new Date();d.setHours(e.eh,e.em,0,0);return d.getTime();}
function evStatus(e){const n=Date.now();return n<evStart(e)?'plan':(n<evEnd(e)?'live':'done');}
const KY=110940, KX=Math.cos(35.61*Math.PI/180)*111320;
function distM(a,b){return Math.hypot((a.lng-b.lng)*KX,(a.lat-b.lat)*KY);}

/* ---------- 状態 ---------- */
let S=null,BU={},LOC={},on=false,draft=null,tickTimer=null,plotTimer=null,editLoc=false,mobPanel='';
let locMk={},ordMk={},plotMk={},plotOff={};
function refPos(l){
  if(l.lat!=null)return{lat:l.lat,lng:l.lng};
  let p=null;const r=l.ref||'';
  try{
    if(r.startsWith('EV:')){const e=FEST_EVAC.find(x=>x.k===r.slice(3));if(e)p={lat:e.c[0],lng:e.c[1]};}
    else if(r[0]==='B'){const b=FEST_BLD.find(x=>x.id===r);if(b)p={lat:b.c[0],lng:b.c[1]};}
    else if(r[0]==='P'){const k=FEST_PARK.find(x=>x.id===r);if(k)p={lat:k.c[0],lng:k.c[1]};}
    else if(r[0]==='E'){const e=FEST_VENT.find(x=>x.id===r);if(e)p={lat:e.c[0],lng:e.c[1]};}
  }catch(e){}
  p=p||{lat:35.6102,lng:139.5543};
  return{lat:p.lat+(l.dy||0)/KY,lng:p.lng+(l.dx||0)/KX};
}
function rebuild(){BU=Object.fromEntries(S.bureaus.map(b=>[b.code,b]));LOC=Object.fromEntries(S.locations.map(l=>[l.id,l]));}
function genDemo(){
  S={bureaus:DEFAULT_BUREAUS.map(b=>({...b})),locations:DEFAULT_LOCATIONS.map(l=>{const p=refPos(l);return{id:l.id,name:l.name,lat:+p.lat.toFixed(6),lng:+p.lng.toFixed(6),hq:!!l.hq,t:l.t||'bldg'};}),
    members:[],orders:[],log:[],events:DEFAULT_EVENTS.map((e,i)=>({id:'E'+(i+1),...e})),seq:101,filters:{q:'',bureau:'',status:''},schedFilter:'',v:1};
  rebuild();
  let uid=1;
  S.bureaus.forEach(b=>{const plan=BUREAU_PLAN[b.code]||{n:6,locs:['HQ'],roles:['局員']};
    for(let i=0;i<plan.n;i++){
      const role=b.code==='幹'?plan.roles[i%plan.roles.length]:rnd(plan.roles.concat(['局員','局員']));
      const status=b.code==='幹'?weighted([['active',6],['moving',3],['busy',2]]):weighted([['active',58],['moving',13],['break',14],['busy',10],['respond',5]]);
      S.members.push({id:'M'+(uid++),callsign:b.code+'-'+pad(i+1),name:rnd(SURNAMES)+' '+rnd(GIVEN),bureau:b.code,role,loc:rnd(plan.locs),status,note:'',upd:Date.now()-Math.floor(Math.random()*3600e3)});
    }});
  const now=Date.now(),a=S.members.find(m=>m.loc==='INFO')||S.members[0],k=S.members.find(m=>m.bureau==='庶')||S.members[0];
  S.orders=[{id:'D101',seq:101,kind:'lost',prio:'normal',loc:'INFO',locLabel:'守衛場',assignees:[a.id],text:'迷子（サンプル）を保護。保護者を呼び出し中。',status:'respond',created:now-8*60e3},
    {id:'D102',seq:102,kind:'supply',prio:'normal',loc:'GSOUKO',locLabel:'倉庫・搬送 › G倉庫',assignees:[k.id],text:'G倉庫から机・椅子を第一体育館前の駐車スペースへ搬出（サンプル）。',status:'dispatch',created:now-3*60e3}];
  S.orders.forEach(o=>o.assignees.forEach(id=>{const m=mem(id);if(m)m.status='respond';}));
  S.seq=103;
  addLog('sys','α版を起動 — 人員 '+S.members.length+'名（ダミー）を展開',null,now-9*60e3);
  addLog('order','#101 迷子/呼出 を守衛場へ発令',STATUS.respond.color,now-8*60e3);
  addLog('order','#102 物資搬送 をG倉庫へ発令',KINDS.supply.color,now-3*60e3);
  save();
}
function save(){try{localStorage.setItem(KEY,JSON.stringify(S));}catch(e){}}
function load(){try{const r=localStorage.getItem(KEY);if(r){S=JSON.parse(r);return true;}}catch(e){}return false;}
function ensureShape(){S.bureaus=S.bureaus||[];S.locations=S.locations||[];S.members=S.members||[];S.orders=S.orders||[];S.log=S.log||[];
  S.events=S.events&&S.events.length?S.events:DEFAULT_EVENTS.map((e,i)=>({id:'E'+(i+1),...e}));S.seq=S.seq||101;S.filters=S.filters||{q:'',bureau:'',status:''};
  S.orders.forEach(o=>{if(!o.assignees)o.assignees=[];});
  const REN={INFO:['インフォメーション','守衛場'],SHOKUDO:['食堂館','VIEW']};   // 名称変更の引き継ぎ（保存済みデータ）
  S.locations.forEach(l=>{const r=REN[l.id];if(r&&l.name===r[0])l.name=r[1];});}
function addLog(type,text,color,ts){S.log.unshift({t:ts||Date.now(),type,text,color:color||'#5c6c80'});if(S.log.length>300)S.log.pop();}
const mem=id=>S.members.find(m=>m.id===id);
const membersAt=id=>S.members.filter(m=>m.loc===id);
function worstAt(id){const ms=membersAt(id);if(!ms.length)return null;return ms.reduce((w,m)=>STATUS[m.status].rank<STATUS[w].rank?m.status:w,ms[0].status);}
const activeOrders=()=>S.orders.filter(o=>o.status!=='done');
const urgentOrders=()=>S.orders.filter(o=>o.prio==='urgent'&&o.status!=='done');

/* ---------- 画面（パネル） ---------- */
const CSS=`
body.cad-on #cadL,body.cad-on #cadR{display:flex;}
.cad-panel{display:none;position:fixed;z-index:1150;flex-direction:column;background:var(--panel);color:var(--fg);border:1px solid var(--line);border-radius:14px;box-shadow:0 10px 32px var(--shadow);overflow:hidden;font-size:12.5px;}
#cadL{left:12px;top:calc(112px + env(safe-area-inset-top));bottom:12px;width:300px;}
#cadR{right:76px;top:calc(118px + env(safe-area-inset-top));bottom:12px;width:350px;}
.cad-panel.min{bottom:auto;height:auto;}
.cad-panel.min>*:not(.cad-ph){display:none!important;}
.cad-ph{display:flex;align-items:center;gap:7px;padding:9px 10px 8px;border-bottom:1px solid var(--line);flex:none;}
.cad-ph b{font-size:13.5px;font-weight:900;}
.cad-ph .cad-sub{font-size:11px;color:var(--muted);font-weight:700;font-variant-numeric:tabular-nums;}
.cad-ph .sp{flex:1;}
.cad-ib{border:1px solid var(--line);background:var(--surface);color:var(--fg);border-radius:8px;font-size:11.5px;font-weight:800;padding:4px 8px;cursor:pointer;flex:none;}
.cad-ib.pri{background:#e8590c;border-color:#e8590c;color:#fff;}
.cad-ib.on{background:var(--accent);border-color:var(--accent);color:#fff;}
.cad-cnt{display:grid;grid-template-columns:repeat(3,1fr);gap:5px;padding:8px 10px;flex:none;}
.cad-cnt button{border:1px solid var(--line);background:var(--surface);color:var(--fg);border-radius:9px;padding:4px 2px;cursor:pointer;text-align:center;}
.cad-cnt button.on{outline:2px solid var(--accent);}
.cad-cnt b{display:block;font-size:16px;font-weight:900;font-variant-numeric:tabular-nums;line-height:1.2;}
.cad-cnt span{font-size:10.5px;font-weight:800;color:var(--muted);}
.cad-cnt i{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:3px;vertical-align:1px;}
.cad-flt{display:flex;gap:5px;padding:0 10px 8px;flex:none;}
.cad-flt input,.cad-flt select{min-width:0;flex:1;border:1px solid var(--line);background:var(--surface);color:var(--fg);border-radius:8px;padding:6px 8px;font-size:12px;}
.cad-flt select{flex:0 0 106px;}
.cad-list{overflow:auto;flex:1;padding:0 6px 8px;}
.cad-row{display:flex;align-items:center;gap:6px;padding:6px 5px;border-radius:9px;cursor:pointer;border:1px solid transparent;}
.cad-row:hover{background:var(--surface-2);}
.cad-row.sel{border-color:var(--accent);}
.cad-chip{flex:none;min-width:24px;text-align:center;font-size:10px;font-weight:900;color:#0b1220;border-radius:6px;padding:2px 4px;}
.cad-cs{flex:none;font-size:11px;font-weight:800;font-variant-numeric:tabular-nums;color:var(--muted);width:46px;white-space:nowrap;}
.cad-who{flex:1;min-width:0;}
.cad-who .nm{font-weight:800;font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.cad-who .mt{font-size:10.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.cad-q{display:flex;gap:2px;flex:none;opacity:0;transition:opacity .15s;}
.cad-row:hover .cad-q{opacity:1;}
@media (hover:none){.cad-q{opacity:1;}}
.cad-q button{width:22px;height:22px;border-radius:6px;border:1px solid var(--line);background:var(--surface);font-size:10.5px;font-weight:900;cursor:pointer;padding:0;}
.cad-sd{flex:none;width:10px;height:10px;border-radius:50%;}
.cad-scroll{overflow:auto;flex:1;}
.cad-sec{padding:8px 10px;border-bottom:1px solid var(--line);}
.cad-st{display:flex;align-items:center;gap:6px;font-size:11.5px;font-weight:900;margin-bottom:6px;}
.cad-st small{font-size:10.5px;color:var(--muted);font-weight:700;}
.cad-ord{border:1px solid var(--line);border-radius:10px;padding:7px 8px;margin-bottom:6px;background:var(--surface);}
.cad-ord.urg{border-color:#ff3b47;box-shadow:0 0 0 1px #ff3b47 inset;}
.cad-oh{display:flex;align-items:center;gap:6px;flex-wrap:wrap;}
.cad-kind{font-size:10.5px;font-weight:900;border-radius:6px;padding:2px 6px;}
.cad-oid{font-size:11px;font-weight:900;font-variant-numeric:tabular-nums;}
.cad-ost{font-size:11px;font-weight:900;}
.cad-oel{margin-left:auto;font-size:11px;font-weight:800;font-variant-numeric:tabular-nums;color:var(--muted);}
.cad-ob{font-size:12px;margin:4px 0 3px;line-height:1.45;}
.cad-om{font-size:11px;color:var(--muted);line-height:1.45;}
.cad-oa{display:flex;gap:5px;margin-top:6px;}
.cad-oa button{flex:1;border:1px solid var(--line);background:var(--panel);color:var(--fg);border-radius:8px;font-size:11.5px;font-weight:800;padding:5px 4px;cursor:pointer;}
.cad-oa button.go{background:#e8590c;border-color:#e8590c;color:#fff;}
.cad-ev{display:flex;align-items:center;gap:6px;padding:5px 4px;border-radius:8px;cursor:pointer;}
.cad-ev:hover{background:var(--surface-2);}
.cad-ev.done{opacity:.5;}
.cad-ev .tm{flex:none;font-size:11px;font-weight:800;font-variant-numeric:tabular-nums;width:74px;}
.cad-ev .tx{flex:1;min-width:0;font-size:12px;font-weight:700;}
.cad-ev .tx small{display:block;font-size:10.5px;color:var(--muted);font-weight:600;}
.cad-ev .es{flex:none;font-size:10.5px;font-weight:900;}
.cad-prog{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:7px 10px;border-bottom:1px solid var(--line);font-size:11.5px;flex:none;}
.cad-prog .k{font-weight:900;color:var(--muted);}
.cad-prog .seg{cursor:pointer;}
.cad-prog .live{display:inline-block;width:8px;height:8px;border-radius:50%;background:#37d47f;margin-right:3px;animation:cadpulse 1.4s infinite;}
@keyframes cadpulse{0%{box-shadow:0 0 0 0 rgba(55,212,127,.7)}70%{box-shadow:0 0 0 7px rgba(55,212,127,0)}100%{box-shadow:0 0 0 0 rgba(55,212,127,0)}}
.cad-log{display:flex;gap:6px;font-size:11px;line-height:1.45;padding:2px 0;}
.cad-log i{flex:none;width:4px;border-radius:2px;}
.cad-log .lt{flex:none;font-variant-numeric:tabular-nums;color:var(--muted);font-weight:700;}
.cad-empty{font-size:11.5px;color:var(--muted);padding:8px 4px;}
#cadEm{display:none;position:fixed;left:50%;transform:translateX(-50%);top:calc(124px + env(safe-area-inset-top));z-index:1300;background:#c92a2a;color:#fff;font-weight:900;font-size:13px;padding:7px 16px;border-radius:999px;box-shadow:0 6px 20px rgba(201,42,42,.5);cursor:pointer;animation:cadem 1s infinite alternate;max-width:80vw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
#cadEm.show{display:block;}
@keyframes cadem{from{background:#c92a2a}to{background:#fa5252}}
#cadMob{display:none;}
#cadOv{display:none;position:fixed;inset:0;z-index:2400;background:rgba(10,14,22,.55);align-items:center;justify-content:center;padding:14px;}
#cadOv.show{display:flex;}
.cad-modal{width:min(460px,100%);max-height:88vh;display:flex;flex-direction:column;background:var(--panel);color:var(--fg);border:1px solid var(--line);border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.45);overflow:hidden;}
.cad-modal.wide{width:min(640px,100%);}
.cad-mh{display:flex;align-items:center;padding:12px 14px;border-bottom:1px solid var(--line);font-weight:900;font-size:14.5px;}
.cad-mh .sp{flex:1;}
.cad-mh button{border:0;background:none;color:var(--fg);font-size:18px;cursor:pointer;}
.cad-mb{padding:12px 14px;overflow:auto;}
.cad-mf{display:flex;gap:8px;align-items:center;padding:10px 14px;border-top:1px solid var(--line);}
.cad-mf .sp{flex:1;}
.cad-btn{border:1px solid var(--line);background:var(--surface);color:var(--fg);border-radius:10px;font-size:12.5px;font-weight:800;padding:8px 12px;cursor:pointer;}
.cad-btn.pri{background:#e8590c;border-color:#e8590c;color:#fff;}
.cad-btn.dng{color:#e03131;}
.cad-fld{margin-bottom:11px;}
.cad-fld>label{display:block;font-size:11.5px;font-weight:900;color:var(--muted);margin-bottom:5px;}
.cad-chips{display:flex;flex-wrap:wrap;gap:5px;}
.cad-kc{border:1px solid var(--line);background:var(--surface);border-radius:999px;font-size:12px;font-weight:800;padding:5px 10px;cursor:pointer;color:var(--fg);}
.cad-kc.on{background:var(--accent);border-color:var(--accent);color:#fff!important;}
.cad-inp{width:100%;box-sizing:border-box;border:1px solid var(--line);background:var(--surface);color:var(--fg);border-radius:9px;padding:8px 9px;font-size:12.5px;font-family:inherit;}
textarea.cad-inp{min-height:62px;resize:vertical;}
.cad-ul .cad-row{cursor:default;}
.cad-stg{display:grid;grid-template-columns:repeat(3,1fr);gap:5px;}
.cad-stg button{border:1px solid var(--line);background:var(--surface);color:var(--fg);border-radius:9px;padding:7px 4px;font-size:12px;font-weight:800;cursor:pointer;}
.cad-stg button.on{outline:2px solid currentColor;}
.cad-kv{display:flex;justify-content:space-between;font-size:12px;padding:3px 0;}
.cad-kv .k{color:var(--muted);font-weight:700;}
#cadEditPill{display:none;position:fixed;left:50%;transform:translateX(-50%);bottom:calc(84px + env(safe-area-inset-bottom));z-index:1300;background:#1971c2;color:#fff;font-weight:800;font-size:12.5px;padding:8px 14px;border-radius:999px;box-shadow:0 6px 18px rgba(0,0,0,.3);}
#cadEditPill button{margin-left:10px;border:0;border-radius:999px;background:#fff;color:#1971c2;font-weight:900;padding:3px 10px;cursor:pointer;}
body.cad-on #mapLegend{left:324px;}
body.cad-on #mapAttrib{right:438px;}
@media (max-width:1100px){#cadL{width:270px;}#cadR{width:310px;}body.cad-on #mapLegend{left:294px;}body.cad-on #mapAttrib{right:398px;}}
@media (max-width:767px){
  body.cad-on #cadL,body.cad-on #cadR{display:none;}
  body.cad-on.cad-mob-L #cadL,body.cad-on.cad-mob-R #cadR{display:flex;}
  #cadL,#cadR{left:8px;right:8px;width:auto;top:auto;bottom:calc(8px + env(safe-area-inset-bottom));height:64vh;}
  body.cad-on #cadMob{display:flex;position:fixed;left:8px;top:calc(112px + env(safe-area-inset-top));z-index:1160;gap:6px;}
  body.cad-on.cad-mob-L #cadL,body.cad-on.cad-mob-R #cadR{z-index:1260;}
  #cadEm{top:calc(156px + env(safe-area-inset-top));max-width:92vw;}
  #cadMob button{border:1px solid var(--line);background:var(--panel);color:var(--fg);border-radius:999px;font-size:12px;font-weight:900;padding:7px 12px;box-shadow:0 4px 14px var(--shadow);}
  #cadMob button.on{background:#e8590c;border-color:#e8590c;color:#fff;}
  body.cad-on #mapLegend{left:8px;}body.cad-on #mapAttrib{right:8px;}
}
.tab.cad-tab{border-color:#e8590c!important;color:#e8590c!important;font-weight:900;}
.cad-pin{min-width:22px;height:22px;padding:0 4px;box-sizing:border-box;border-radius:11px;border:2px solid #fff;color:#0b1220;font:900 11px/18px sans-serif;text-align:center;box-shadow:0 1px 4px rgba(0,0,0,.35);}
.cad-pin.hq{background:#ffd43b;color:#5c3d00;border-radius:6px;}
.cad-pin.ord{background:none;border:0;box-shadow:none;width:26px;height:24px;position:relative;}
.cad-pin.ord::before{content:"";position:absolute;inset:0;background:var(--c);clip-path:polygon(50% 0,100% 100%,0 100%);}
.cad-pin.ord span{position:relative;display:block;color:#fff;font-size:9px;line-height:30px;}
.cad-dot{width:8px;height:8px;border-radius:50%;border:1px solid #0b1220;}
.cad-blink{animation:cadblink .3s 5 alternate;}
@keyframes cadblink{from{transform:scale(1)}to{transform:scale(1.6)}}
.tab.cad-tab.active{background:#e8590c!important;color:#fff!important;}
`;
function injectDom(){
  if(!document.getElementById('cadCss')){const st=document.createElement('style');st.id='cadCss';st.textContent=CSS;document.head.appendChild(st);}
  if(document.getElementById('cadL'))return;
  const L=document.createElement('div');L.id='cadL';L.className='cad-panel';
  L.innerHTML='<div class="cad-ph"><b>人員</b><span class="cad-sub" id="cadRc"></span><span class="sp"></span><button class="cad-ib" id="cadPlot" title="人員の位置を個別の点で表示（模擬）">位置</button><button class="cad-ib" data-min="cadL" title="たたむ">−</button></div>'
    +'<div class="cad-cnt" id="cadCnt"></div>'
    +'<div class="cad-flt"><input id="cadQ" placeholder="名前・コールサイン・場所（/）"><select id="cadBu"></select></div>'
    +'<div class="cad-list" id="cadRoster"></div>';
  const R=document.createElement('div');R.id='cadR';R.className='cad-panel';
  R.innerHTML='<div class="cad-ph"><b>指令</b><span class="cad-sub" id="cadOc"></span><span class="sp"></span><button class="cad-ib pri" id="cadNew" title="新規の出動指令（N）">＋ 新規指令</button><button class="cad-ib" id="cadMenu" title="設定">設定</button><button class="cad-ib" data-min="cadR" title="たたむ">−</button></div>'
    +'<div class="cad-prog" id="cadProg"></div>'
    +'<div class="cad-scroll"><div class="cad-sec"><div class="cad-st">出動指令<small id="cadOs"></small></div><div id="cadOrders"></div></div>'
    +'<div class="cad-sec" id="cadSchedSec"><div class="cad-st">本日の進行<small>（サンプル。設定で編集）</small></div><div id="cadSched"></div></div>'
    +'<div class="cad-sec"><div class="cad-st">指令ログ<small id="cadLn"></small></div><div id="cadLog"></div></div></div>';
  const E=document.createElement('div');E.id='cadEm';
  const M=document.createElement('div');M.id='cadMob';M.innerHTML='<button data-p="L">人員</button><button data-p="R">指令</button>';
  const O=document.createElement('div');O.id='cadOv';O.innerHTML='<div class="cad-modal" id="cadModal"></div>';
  const P=document.createElement('div');P.id='cadEditPill';P.innerHTML='配置箇所をドラッグして位置を調整<button id="cadEditEnd">完了</button>';
  [L,R,E,M,O,P].forEach(x=>document.body.appendChild(x));
  L.querySelectorAll('[data-min]').forEach(b=>b.onclick=()=>document.getElementById(b.dataset.min).classList.toggle('min'));
  R.querySelectorAll('[data-min]').forEach(b=>b.onclick=()=>document.getElementById(b.dataset.min).classList.toggle('min'));
  $('#cadQ').oninput=e=>{S.filters.q=e.target.value;renderRoster();};
  $('#cadBu').onchange=e=>{S.filters.bureau=e.target.value;save();renderRoster();};
  $('#cadNew').onclick=()=>openDispatch();
  $('#cadMenu').onclick=()=>openSettings();
  $('#cadPlot').onclick=()=>togglePlot();
  E.onclick=()=>{const u=urgentOrders()[0];if(u)focusLoc(u.loc);};
  M.querySelectorAll('button').forEach(b=>b.onclick=()=>{const p=b.dataset.p;mobPanel=(mobPanel===p)?'':p;
    document.body.classList.toggle('cad-mob-L',mobPanel==='L');document.body.classList.toggle('cad-mob-R',mobPanel==='R');
    M.querySelectorAll('button').forEach(x=>x.classList.toggle('on',x.dataset.p===mobPanel));});
  O.addEventListener('click',e=>{if(e.target===O)closeModal();});
  $('#cadEditEnd').onclick=()=>endLocEdit();
}
function removeDom(){['cadL','cadR','cadEm','cadMob','cadOv','cadEditPill'].forEach(id=>{const e=document.getElementById(id);if(e)e.remove();});
  document.body.classList.remove('cad-on','cad-mob-L','cad-mob-R');}

/* ---------- 描画 ---------- */
function renderAll(){renderCounters();renderRoster();renderOrders();renderLog();renderSchedule();renderProg();renderEm();refreshMarkers();}
function renderCounters(){
  const c={};STATUS_ORDER.forEach(k=>c[k]=0);S.members.forEach(m=>c[m.status]=(c[m.status]||0)+1);
  const cfg=[['','総員',S.members.length,'#adb5bd'],['active','活動中',c.active,STATUS.active.color],['break','休憩中',c.break,STATUS.break.color],
    ['moving','移動中',c.moving,STATUS.moving.color],['busy','保留中',c.busy,STATUS.busy.color],['respond','対応中',c.respond,STATUS.respond.color]];
  const box=$('#cadCnt');box.innerHTML='';
  cfg.forEach(([k,l,n,col])=>{const b=document.createElement('button');b.className=(S.filters.status===k&&k)?'on':'';
    b.innerHTML='<b>'+n+'</b><span><i style="background:'+col+'"></i>'+l+'</span>';
    b.onclick=()=>{S.filters.status=(S.filters.status===k)?'':k;save();renderCounters();renderRoster();};box.appendChild(b);});
  const bu=$('#cadBu');if(bu&&bu.options.length!==S.bureaus.length+1){bu.innerHTML='<option value="">全局</option>'+S.bureaus.map(b=>'<option value="'+esc(b.code)+'">'+esc(b.name)+'</option>').join('');}
  if(bu)bu.value=S.filters.bureau||'';
}
function renderRoster(){
  const q=(S.filters.q||'').trim(),bu=S.filters.bureau||'',st=S.filters.status||'';
  const list=S.members.filter(m=>{if(bu&&m.bureau!==bu)return false;if(st&&m.status!==st)return false;
    if(q){const h=m.name+m.callsign+(BU[m.bureau]?BU[m.bureau].name:'')+m.role+(LOC[m.loc]?LOC[m.loc].name:'');if(!h.includes(q))return false;}return true;})
    .sort((a,b)=>STATUS[a.status].rank-STATUS[b.status].rank||a.callsign.localeCompare(b.callsign));
  $('#cadRc').textContent=list.length+' / '+S.members.length+'名';
  const box=$('#cadRoster');
  if(!list.length){box.innerHTML='<div class="cad-empty">該当する人員なし</div>';return;}
  box.innerHTML=list.map(m=>{const b=BU[m.bureau]||{color:'#999',code:'?'},s=STATUS[m.status];
    const qb=['active','break','busy','respond'].map(k=>'<button style="color:'+STATUS[k].color+'" title="'+STATUS[k].label+'にする" data-q="'+m.id+'|'+k+'">'+STATUS[k].label[0]+'</button>').join('');
    return '<div class="cad-row'+(S.selected===m.id?' sel':'')+'" data-m="'+m.id+'"><span class="cad-chip" style="background:'+b.color+'">'+esc(b.code)+'</span><span class="cad-cs">'+esc(m.callsign)+'</span>'
      +'<span class="cad-who"><div class="nm">'+esc(m.name)+'</div><div class="mt">'+esc(m.role)+'・'+(LOC[m.loc]?esc(LOC[m.loc].name):'未配置')+'</div></span>'
      +'<span class="cad-q">'+qb+'</span><span class="cad-sd" style="background:'+s.color+'" title="'+s.label+'"></span></div>';}).join('');
  box.querySelectorAll('.cad-row').forEach(r=>r.onclick=e=>{const qb=e.target.closest('[data-q]');
    if(qb){e.stopPropagation();const[id,k]=qb.dataset.q.split('|');quickStatus(id,k);return;}openMember(r.dataset.m);});
}
const OST={dispatch:{l:'発令',c:'#f59f00'},respond:{l:'対応中',c:'#ff7a1a'},done:{l:'完了',c:'#2f9e44'}};
function renderOrders(){
  const act=activeOrders();$('#cadOc').textContent='稼働 '+act.length+'件';$('#cadOs').textContent=act.length?'（'+act.length+'件 対応中・発令中）':'';
  const shown=act.concat(S.orders.filter(o=>o.status==='done').slice(0,3));
  const box=$('#cadOrders');
  if(!shown.length){box.innerHTML='<div class="cad-empty">出動指令なし（＋ 新規指令 で発令）</div>';return;}
  box.innerHTML=shown.map(o=>{const k=KINDS[o.kind]||KINDS.other,sm=OST[o.status],u=(o.assignees||[]).map(mem).filter(Boolean);
    return '<div class="cad-ord'+(o.prio==='urgent'&&o.status!=='done'?' urg':'')+'" style="'+(o.status==='done'?'opacity:.55':'')+'">'
      +'<div class="cad-oh"><span class="cad-kind" style="background:'+k.color+'26;color:'+k.color+'">'+(o.prio==='urgent'?'緊急・':(o.prio==='high'?'高・':''))+esc(k.label)+'</span>'
      +'<span class="cad-oid">#'+o.seq+'</span><span class="cad-ost" style="color:'+sm.c+'">'+sm.l+'</span>'
      +(o.status!=='done'?'<span class="cad-oel" id="cadEl-'+o.id+'">経過 '+fmtElapsed(o.created)+'</span>':'<span class="cad-oel">発令 '+fmtHM(o.created)+'</span>')+'</div>'
      +'<div class="cad-ob">'+esc(o.text)+'</div>'
      +'<div class="cad-om">場所　'+esc(o.locLabel||(LOC[o.loc]?LOC[o.loc].name:'—'))+'<br>出動隊 '+u.length+'名　'+(u.length?esc(u.map(m=>m.callsign).join(' / ')):'未割当')+'</div>'
      +(o.status!=='done'?'<div class="cad-oa">'+(o.status==='dispatch'?'<button class="go" data-a="'+o.id+'|respond">対応中にする</button>':'')
        +'<button data-a="'+o.id+'|done">完了</button><button data-a="'+o.id+'|map">地図</button></div>':'')+'</div>';}).join('');
  box.querySelectorAll('[data-a]').forEach(b=>b.onclick=()=>{const[id,a]=b.dataset.a.split('|');if(a==='map'){const o=S.orders.find(x=>x.id===id);if(o)focusLoc(o.loc);}else advanceOrder(id,a);});
}
function renderLog(){
  $('#cadLn').textContent=S.log.length?'（'+S.log.length+'件）':'';
  $('#cadLog').innerHTML=S.log.length?S.log.slice(0,60).map(l=>'<div class="cad-log"><i style="background:'+l.color+'"></i><span class="lt">'+fmtClock(l.t)+'</span><span>'+esc(l.text)+'</span></div>').join(''):'<div class="cad-empty">ログなし</div>';
}
const EVS={plan:{l:'予定',c:'#868e96'},live:{l:'進行中',c:'#2f9e44'},done:{l:'終了',c:'#868e96'}};
function renderSchedule(){
  const evs=S.events.slice().sort((a,b)=>evStart(a)-evStart(b));
  const box=$('#cadSched');
  box.innerHTML=evs.length?evs.map(e=>{const st=evStatus(e),b=BU[e.bureau]||{color:'#999',code:'?'},l=LOC[e.loc];
    return '<div class="cad-ev '+st+'" data-l="'+esc(e.loc)+'"><span class="tm">'+pad(e.sh)+':'+pad(e.sm)+'–'+pad(e.eh)+':'+pad(e.em)+'</span><span class="cad-chip" style="background:'+b.color+'">'+esc(b.code)+'</span>'
      +'<span class="tx">'+esc(e.t)+(l?'<small>'+esc(l.name)+'</small>':'')+'</span><span class="es" style="color:'+EVS[st].c+'">'+EVS[st].l+'</span></div>';}).join(''):'<div class="cad-empty">予定なし</div>';
  box.querySelectorAll('.cad-ev').forEach(r=>r.onclick=()=>focusLoc(r.dataset.l));
}
function renderProg(){
  const evs=S.events.slice().sort((a,b)=>evStart(a)-evStart(b)),now=Date.now(),live=evs.filter(e=>evStatus(e)==='live'),next=evs.find(e=>evStatus(e)==='plan');
  let h='<span class="k">本日の進行</span>';
  if(live.length){const e=live[0],l=LOC[e.loc];h+='<span class="seg" data-l="'+esc(e.loc)+'"><span class="live"></span><b>'+esc(e.t)+'</b>'+(l?'＠'+esc(l.name):'')+'　残り'+fmtRemain(evEnd(e)-now)+'</span>';}
  else h+='<span style="color:var(--muted)">進行中の企画なし</span>';
  if(next){const l=LOC[next.loc];h+='<span class="seg" data-l="'+esc(next.loc)+'"><span class="k">次</span> '+pad(next.sh)+':'+pad(next.sm)+' <b>'+esc(next.t)+'</b>　あと'+fmtRemain(evStart(next)-now)+'</span>';}
  const box=$('#cadProg');box.innerHTML=h;box.querySelectorAll('.seg').forEach(s=>s.onclick=()=>focusLoc(s.dataset.l));
}
function renderEm(){const u=urgentOrders(),e=$('#cadEm');if(u.length){const o=u[0];e.textContent='緊急 #'+o.seq+' '+(KINDS[o.kind]||KINDS.other).label+' ＠ '+(o.locLabel||(LOC[o.loc]?LOC[o.loc].name:''))+(u.length>1?'　ほか'+(u.length-1)+'件':'');e.classList.add('show');}else e.classList.remove('show');}
function tick(){activeOrders().forEach(o=>{const s=document.getElementById('cadEl-'+o.id);if(s)s.textContent='経過 '+fmtElapsed(o.created);});
  const n=new Date();if(n.getSeconds()%15===0){renderProg();renderSchedule();}}

/* ---------- 地図（本祭支援ツールのGoogle地図に重ねる） ---------- */
function locIcon(l){
  const w=worstAt(l.id),col=w?STATUS[w].color:'#868e96',hasOrd=activeOrders().some(o=>o.loc===l.id);
  if(l.hq)return{path:'M 0,-12 3,-4 12,-4 5,2 8,11 0,6 -8,11 -5,2 -12,-4 -3,-4 z',scale:1.25,fillColor:'#ffd43b',fillOpacity:1,strokeColor:'#5c3d00',strokeWeight:1.6,labelOrigin:new google.maps.Point(0,0)};
  const n=membersAt(l.id).length;
  return{path:google.maps.SymbolPath.CIRCLE,scale:hasOrd?13:(n?11:6),fillColor:col,fillOpacity:n?.95:.7,strokeColor:hasOrd?'#ff3b47':'#ffffff',strokeWeight:hasOrd?3.5:2};
}
let pinMode=false;
const usePins=()=>!!(window.festPinsActive&&window.festPinsActive());
function pinEl(html,title,onClick){const el=document.createElement('div');el.innerHTML=html;el.title=title||'';el.onclick=e=>{e.stopPropagation();onClick();};return el;}
function refreshPins(){
  const seen={};
  S.locations.forEach(l=>{const n=membersAt(l.id).length,w=worstAt(l.id),col=w?STATUS[w].color:'#868e96',hasOrd=activeOrders().some(o=>o.loc===l.id);seen['L'+l.id]=1;
    const html=l.hq?'<div class="cad-pin hq">本</div>':'<div class="cad-pin" style="background:'+col+';'+(hasOrd?'box-shadow:0 0 0 3px #ff3b47;':'')+(n?'':'width:12px;height:12px;opacity:.75;')+'">'+(n||'')+'</div>';
    let o=locMk[l.id];if(!o||!o.pin){if(o&&o.setMap)o.setMap(null);o=locMk[l.id]={pin:'cadL_'+l.id,el:pinEl('',l.name,()=>{if(!editLoc)openLocation(l.id);})};}
    o.el.innerHTML=html;o.el.title=l.name+'（'+n+'名）';window.festPinSet(o.pin,l.lat,l.lng,o.el);});
  Object.keys(locMk).forEach(id=>{if(!seen['L'+id]){if(locMk[id].pin)window.festPinDel(locMk[id].pin);else locMk[id].setMap(null);delete locMk[id];}});
  const os={};
  activeOrders().forEach(o=>{const l=LOC[o.loc];if(!l)return;os[o.id]=1;const k=KINDS[o.kind]||KINDS.other;
    let m=ordMk[o.id];if(!m||!m.pin){if(m&&m.setMap)m.setMap(null);m=ordMk[o.id]={pin:'cadO_'+o.id,el:pinEl('','',()=>openOrder(o.id))};}
    m.el.innerHTML='<div class="cad-pin ord" style="--c:'+(o.prio==='urgent'?'#ff3b47':k.color)+'"><span>'+(o.seq%100)+'</span></div>';m.el.title='#'+o.seq+' '+k.label;
    window.festPinSet(m.pin,l.lat+11/KY,l.lng,m.el);});
  Object.keys(ordMk).forEach(id=>{if(!os[id]){if(ordMk[id].pin)window.festPinDel(ordMk[id].pin);else ordMk[id].setMap(null);delete ordMk[id];}});
  if(plotTimer)renderPlot();
}
function refreshMarkers(){
  if(typeof map==='undefined'||!map||typeof google==='undefined')return;
  const pm=usePins();if(pm!==pinMode){clearMarkers();pinMode=pm;}
  if(pm){refreshPins();return;}
  const seen={};
  S.locations.forEach(l=>{seen[l.id]=1;const n=membersAt(l.id).length;
    const opt={position:{lat:l.lat,lng:l.lng},icon:locIcon(l),label:(l.hq||n)?{text:l.hq?'本':String(n),color:l.hq?'#5c3d00':'#0b1220',fontSize:'11px',fontWeight:'900'}:null,
      title:l.name+'（'+n+'名）',zIndex:l.hq?60:50,draggable:editLoc,map};
    let mk=locMk[l.id];
    if(!mk){mk=new google.maps.Marker(opt);mk.addListener('click',()=>{if(!editLoc)openLocation(l.id);});
      mk.addListener('dragend',e=>{const L=LOC[l.id];if(!L)return;L.lat=+e.latLng.lat().toFixed(6);L.lng=+e.latLng.lng().toFixed(6);save();});locMk[l.id]=mk;}
    else{mk.setOptions(opt);}
  });
  Object.keys(locMk).forEach(id=>{if(!seen[id]){locMk[id].setMap(null);delete locMk[id];}});
  // 指令（対応中・発令中）＝赤い三角
  const os={};
  activeOrders().forEach(o=>{const l=LOC[o.loc];if(!l)return;os[o.id]=1;const k=KINDS[o.kind]||KINDS.other;
    const opt={position:{lat:l.lat+11/KY,lng:l.lng},map,zIndex:70,title:'#'+o.seq+' '+k.label,
      icon:{path:'M 0,-14 12,8 -12,8 z',fillColor:o.prio==='urgent'?'#ff3b47':k.color,fillOpacity:1,strokeColor:'#ffffff',strokeWeight:2,scale:1,labelOrigin:new google.maps.Point(0,2)},
      label:{text:String(o.seq%100),color:'#ffffff',fontSize:'9px',fontWeight:'900'}};
    if(!ordMk[o.id]){ordMk[o.id]=new google.maps.Marker(opt);ordMk[o.id].addListener('click',()=>openOrder(o.id));}else ordMk[o.id].setOptions(opt);});
  Object.keys(ordMk).forEach(id=>{if(!os[id]){ordMk[id].setMap(null);delete ordMk[id];}});
  if(plotTimer)renderPlot();
}
function clearMarkers(){[locMk,ordMk,plotMk].forEach(o=>Object.keys(o).forEach(k=>{const m=o[k];if(m&&m.pin){if(window.festPinDel)window.festPinDel(m.pin);}else if(m)m.setMap(null);delete o[k];}));}
function focusLoc(id){const l=LOC[id];if(!l||!map)return;map.panTo({lat:l.lat,lng:l.lng});   // アングル（傾き・向き・ズーム）は変えない
  const mk=locMk[id];if(!mk)return;
  if(mk.pin){mk.el.classList.add('cad-blink');setTimeout(()=>mk.el.classList.remove('cad-blink'),1500);}
  else if(google.maps.Animation){mk.setAnimation(google.maps.Animation.BOUNCE);setTimeout(()=>mk.setAnimation(null),1400);}}
// 位置プロット（模擬）：人員を配置箇所のまわりに個別の点で表示し、少しずつ動かす
function renderPlot(){
  S.members.forEach(m=>{const l=LOC[m.loc];if(!l)return;const o=plotOff[m.id]||(plotOff[m.id]={dx:(Math.random()-.5)*30,dy:(Math.random()-.5)*30});
    const pos={lat:l.lat+o.dy/KY,lng:l.lng+o.dx/KX},col=STATUS[m.status].color;
    if(pinMode){let pm=plotMk[m.id];if(!pm||!pm.pin){if(pm&&pm.setMap)pm.setMap(null);pm=plotMk[m.id]={pin:'cadP_'+m.id,el:pinEl('',m.callsign,()=>openMember(m.id))};}
      pm.el.innerHTML='<div class="cad-dot" style="background:'+col+'"></div>';window.festPinSet(pm.pin,pos.lat,pos.lng,pm.el);return;}
    const opt={position:pos,map,clickable:true,zIndex:40,title:m.callsign+' '+m.name,icon:{path:google.maps.SymbolPath.CIRCLE,scale:4,fillColor:col,fillOpacity:1,strokeColor:'#0b1220',strokeWeight:1}};
    if(!plotMk[m.id]){plotMk[m.id]=new google.maps.Marker(opt);plotMk[m.id].addListener('click',()=>openMember(m.id));}else plotMk[m.id].setOptions(opt);});
  Object.keys(plotMk).forEach(id=>{if(!mem(id)){const pm=plotMk[id];if(pm.pin)window.festPinDel(pm.pin);else pm.setMap(null);delete plotMk[id];}});
}
function togglePlot(){
  if(plotTimer){clearInterval(plotTimer);plotTimer=null;Object.keys(plotMk).forEach(k=>{const pm=plotMk[k];if(pm.pin)window.festPinDel(pm.pin);else pm.setMap(null);delete plotMk[k];});$('#cadPlot').classList.remove('on');return;}
  renderPlot();plotTimer=setInterval(()=>{Object.values(plotOff).forEach(o=>{o.dx=Math.max(-22,Math.min(22,o.dx+(Math.random()-.5)*4));o.dy=Math.max(-22,Math.min(22,o.dy+(Math.random()-.5)*4));});renderPlot();},2000);
  $('#cadPlot').classList.add('on');
  try{showStatus('位置プロット（模擬）：人員を個別の点で表示しています。実際のGPS連携は今後の検討事項です',false);hideStatusLater();}catch(e){}
}
function startLocEdit(){if(usePins()){alert('3Dの高低差がONの間は位置を調整できません。レンチ→本祭支援ツール→「3Dの高低差」をOFFにしてから調整してください。');return;}editLoc=true;closeModal();$('#cadEditPill').style.display='block';refreshMarkers();}
function endLocEdit(){editLoc=false;$('#cadEditPill').style.display='none';refreshMarkers();addLog('sys','配置箇所の位置を調整','#1971c2');save();renderLog();}

/* ---------- モーダル ---------- */
function openModal(html,wide){const m=$('#cadModal');m.className='cad-modal'+(wide?' wide':'');m.innerHTML=html;$('#cadOv').classList.add('show');
  m.querySelectorAll('[data-x]').forEach(b=>b.onclick=closeModal);}
function closeModal(){const o=$('#cadOv');if(o)o.classList.remove('show');draft=null;}
const MH=t=>'<div class="cad-mh">'+t+'<span class="sp"></span><button data-x title="閉じる">✕</button></div>';
function openMember(id){
  S.selected=id;renderRoster();const m=mem(id);if(!m)return;const b=BU[m.bureau]||{color:'#999',code:'?',name:'—'};
  openModal(MH('人員の詳細')+'<div class="cad-mb">'
    +'<div style="display:flex;gap:10px;align-items:center;margin-bottom:12px"><span class="cad-chip" style="background:'+b.color+';font-size:13px;padding:6px 8px">'+esc(b.code)+'</span>'
    +'<div><div style="font-size:16px;font-weight:900">'+esc(m.name)+'</div><div style="font-size:12px;color:var(--muted)">'+esc(m.callsign)+'・'+esc(b.name)+'・'+esc(m.role)+'</div></div></div>'
    +'<div class="cad-fld"><label>状態</label><div class="cad-stg">'+STATUS_ORDER.map(k=>'<button class="'+(m.status===k?'on':'')+'" style="color:'+STATUS[k].color+'" data-st="'+k+'">'+STATUS[k].label+'</button>').join('')+'</div></div>'
    +'<div class="cad-fld"><label>配置</label><select class="cad-inp" id="cadMl">'+S.locations.map(l=>'<option value="'+l.id+'"'+(m.loc===l.id?' selected':'')+'>'+esc(l.name)+'</option>').join('')+'</select></div>'
    +'<div class="cad-fld"><label>メモ</label><textarea class="cad-inp" id="cadMn" placeholder="連絡事項など">'+esc(m.note||'')+'</textarea></div>'
    +'<div class="cad-kv"><span class="k">最終更新</span><span>'+fmtClock(m.upd)+'</span></div></div>'
    +'<div class="cad-mf"><button class="cad-btn dng" id="cadMdel">削除</button><span class="sp"></span><button class="cad-btn" id="cadMmap">地図</button><button class="cad-btn pri" id="cadMd">この人員に指令</button></div>');
  document.querySelectorAll('#cadModal [data-st]').forEach(x=>x.onclick=()=>{setStatus(id,x.dataset.st);openMember(id);});
  $('#cadMl').onchange=e=>setLoc(id,e.target.value);
  $('#cadMn').onchange=e=>{m.note=e.target.value;save();};
  $('#cadMdel').onclick=()=>delMember(id);
  $('#cadMmap').onclick=()=>{focusLoc(m.loc);closeModal();};
  $('#cadMd').onclick=()=>openDispatch(m.loc,id);
}
function openLocation(id){
  const l=LOC[id];if(!l)return;const ms=membersAt(id).sort((a,b)=>STATUS[a.status].rank-STATUS[b.status].rank);
  const ord=activeOrders().filter(o=>o.loc===id);
  openModal(MH((l.hq?'本部　':'')+esc(l.name))+'<div class="cad-mb">'
    +(ord.length?'<div class="cad-fld"><label>この場所の指令</label>'+ord.map(o=>'<div class="cad-row" data-o="'+o.id+'"><span class="cad-kind" style="background:'+(KINDS[o.kind]||KINDS.other).color+'26;color:'+(KINDS[o.kind]||KINDS.other).color+'">'+esc((KINDS[o.kind]||KINDS.other).label)+'</span><span class="cad-who"><div class="nm">#'+o.seq+' '+esc(o.text)+'</div></span></div>').join('')+'</div>':'')
    +'<div class="cad-kv"><span class="k">配置人員</span><span>'+ms.length+'名</span></div>'
    +'<div class="cad-fld"><label>人員（タップで詳細）</label>'+(ms.length?ms.map(m=>{const b=BU[m.bureau]||{color:'#999',code:'?'},s=STATUS[m.status];
      return '<div class="cad-row" data-m="'+m.id+'"><span class="cad-chip" style="background:'+b.color+'">'+esc(b.code)+'</span><span class="cad-cs">'+esc(m.callsign)+'</span><span class="cad-who"><div class="nm">'+esc(m.name)+'</div><div class="mt">'+esc(m.role)+'</div></span><span style="font-size:11px;font-weight:900;color:'+s.color+'">'+s.label+'</span></div>';}).join(''):'<div class="cad-empty">配置人員なし</div>')+'</div></div>'
    +'<div class="cad-mf"><span class="sp"></span><button class="cad-btn pri" id="cadLd">この場所へ出動指令</button></div>');
  document.querySelectorAll('#cadModal [data-m]').forEach(r=>r.onclick=()=>openMember(r.dataset.m));
  document.querySelectorAll('#cadModal [data-o]').forEach(r=>r.onclick=()=>openOrder(r.dataset.o));
  $('#cadLd').onclick=()=>openDispatch(id);
}
function openOrder(id){
  const o=S.orders.find(x=>x.id===id);if(!o)return;const k=KINDS[o.kind]||KINDS.other,u=(o.assignees||[]).map(mem).filter(Boolean);
  openModal(MH('指令 #'+o.seq)+'<div class="cad-mb"><div class="cad-oh" style="margin-bottom:8px"><span class="cad-kind" style="background:'+k.color+'26;color:'+k.color+'">'+(o.prio==='urgent'?'緊急・':'')+esc(k.label)+'</span><span class="cad-ost" style="color:'+OST[o.status].c+'">'+OST[o.status].l+'</span><span class="cad-oel">発令 '+fmtHM(o.created)+'</span></div>'
    +'<div class="cad-ob" style="font-size:13px">'+esc(o.text)+'</div><div class="cad-om" style="margin-top:6px">場所　'+esc(o.locLabel||'')+'<br>出動隊　'+(u.length?esc(u.map(m=>m.callsign+' '+m.name).join('、')):'未割当')+'</div></div>'
    +'<div class="cad-mf"><span class="sp"></span>'+(o.status==='dispatch'?'<button class="cad-btn pri" data-oa="respond">対応中にする</button>':'')+(o.status!=='done'?'<button class="cad-btn" data-oa="done">完了</button>':'')+'</div>');
  document.querySelectorAll('#cadModal [data-oa]').forEach(b=>b.onclick=()=>{advanceOrder(id,b.dataset.oa);closeModal();});
}
/* ---- 出動指令（自動編成つき） ---- */
function distRank(m,ref){const a=LOC[m.loc],b=LOC[ref];return(a&&b)?distM(a,b):9999;}
function distLabel(m,ref){const d=distRank(m,ref);if(d>=9999)return'';return d<40?'至近':d<110?'近':d<220?'中':'遠';}
function composeUnit(ref,n,ex){const av={break:100,active:45,moving:25,busy:8};
  return S.members.filter(m=>m.status!=='respond'&&!(ex||[]).includes(m.id)).map(m=>({id:m.id,s:(av[m.status]||0)-Math.min(distRank(m,ref),600)*.35}))
    .sort((a,b)=>b.s-a.s).slice(0,Math.max(0,n)).map(x=>x.id);}
function openDispatch(prefLoc,prefMember){
  draft={kind:'aid',loc:null,locLabel:'未選択',zoneId:null,cursor:null,scale:'mid',unit:[],prio:'normal',text:''};
  if(prefLoc&&LOC[prefLoc]){draft.loc=prefLoc;draft.locLabel=LOC[prefLoc].name;}
  if(prefMember)draft.unit=[prefMember];
  renderDispatch();
  setTimeout(()=>{const t=$('#cadDt');if(t)t.focus();},50);
}
function renderDispatch(){
  const d=draft;if(!d)return;
  const kinds=Object.entries(KINDS).map(([k,v])=>'<button class="cad-kc'+(d.kind===k?' on':'')+'" style="color:'+v.color+'" data-k="'+k+'">'+v.label+'</button>').join('');
  const nodes=d.cursor?((zoneFind(d.cursor)||{node:{}}).node.children||[]):ZONES,cur=d.cursor?(zoneFind(d.cursor)||{}).node:null;
  const crumb=cur?'<button class="cad-kc" data-zu>‹ 戻る</button> <b style="font-size:12px">'+esc(cur.label)+'</b>':'<span style="font-size:11.5px;color:var(--muted)">場所を選ぶ（▸は詳しく選べる）</span>';
  const zones=nodes.map(n=>'<button class="cad-kc'+(d.zoneId===n.id?' on':'')+'" data-z="'+n.id+'">'+esc(n.label)+(n.children&&n.children.length?' ▸':'')+'</button>').join('');
  const unit=d.unit.length?d.unit.map(id=>{const m=mem(id);if(!m)return'';const b=BU[m.bureau]||{color:'#999',code:'?'},s=STATUS[m.status];
    return '<div class="cad-row"><span class="cad-chip" style="background:'+b.color+'">'+esc(b.code)+'</span><span class="cad-cs">'+esc(m.callsign)+'</span><span class="cad-who"><div class="nm">'+esc(m.name)+'</div><div class="mt">'+distLabel(m,d.loc)+'・'+s.label+'</div></span><button class="cad-ib" data-ur="'+id+'">✕</button></div>';}).join(''):'<div class="cad-empty">未編成（自動編成／局から一括／個別追加）</div>';
  const scale=Object.entries(SCALE).map(([k,v])=>'<button class="cad-kc'+(d.scale===k?' on':'')+'" data-s="'+k+'">'+v.label+'（'+v.n+'名）</button>').join('');
  const bus=S.bureaus.map(b=>{const n=S.members.filter(m=>m.bureau===b.code&&m.status!=='respond'&&!d.unit.includes(m.id)).length;
    return '<button class="cad-kc" style="color:'+b.color+(n?'':';opacity:.4')+'" '+(n?'':'disabled')+' data-b="'+esc(b.code)+'">'+esc(b.name)+' ＋'+n+'</button>';}).join('');
  const add='<option value="">＋ 個別に人員を追加…</option>'+S.members.filter(m=>!d.unit.includes(m.id)).sort((a,b)=>a.callsign.localeCompare(b.callsign)).map(m=>'<option value="'+m.id+'">'+esc(m.callsign+' '+m.name)+'（'+STATUS[m.status].label+'）</option>').join('');
  const prio=[['normal','通常','#868e96'],['high','高','#f59f00'],['urgent','緊急','#e03131']].map(([k,l,c])=>'<button class="cad-kc'+(d.prio===k?' on':'')+'" style="color:'+c+'" data-p="'+k+'">'+l+'</button>').join('');
  openModal(MH('出動指令の発令')+'<div class="cad-mb">'
    +'<div class="cad-fld"><label>区分</label><div class="cad-chips">'+kinds+'</div></div>'
    +'<div class="cad-fld"><label>発生場所　<span style="color:#e8590c">'+esc(d.locLabel)+'</span></label><div style="margin-bottom:6px">'+crumb+'</div><div class="cad-chips">'+zones+'</div></div>'
    +'<div class="cad-fld"><label>自動編成（休憩中・近くにいる人を優先）</label><div class="cad-chips">'+scale+'<button class="cad-kc" style="color:#1971c2" data-auto>この規模で自動編成</button></div></div>'
    +'<div class="cad-fld"><label>局から一括で追加</label><div class="cad-chips">'+bus+'</div></div>'
    +'<div class="cad-fld"><label>出動隊　'+d.unit.length+'名'+(d.unit.length?'　<a href="#" data-uc style="color:#e03131;font-size:11px">全解除</a>':'')+'</label><div class="cad-ul">'+unit+'</div><select class="cad-inp" style="margin-top:6px" id="cadDadd">'+add+'</select></div>'
    +'<div class="cad-fld"><label>指令内容（⌘/Ctrl＋Enterで発令）</label><textarea class="cad-inp" id="cadDt" placeholder="状況・指示内容">'+esc(d.text)+'</textarea></div>'
    +'<div class="cad-fld"><label>優先度</label><div class="cad-chips">'+prio+'</div></div></div>'
    +'<div class="cad-mf"><button class="cad-btn" data-x>中止</button><span class="sp"></span><button class="cad-btn pri" id="cadDgo">指令ボタン（発令）</button></div>',true);
  const M=$('#cadModal');
  M.querySelectorAll('[data-k]').forEach(b=>b.onclick=()=>{d.kind=b.dataset.k;renderDispatch();});
  M.querySelectorAll('[data-z]').forEach(b=>b.onclick=()=>{const f=zoneFind(b.dataset.z);if(!f)return;
    if(f.node.children&&f.node.children.length)d.cursor=f.node.id;else{d.zoneId=f.node.id;d.loc=zoneRef(f.node.id);d.locLabel=zoneLabel(f.node.id);}renderDispatch();});
  const zu=M.querySelector('[data-zu]');if(zu)zu.onclick=()=>{const f=zoneFind(d.cursor);d.cursor=(f&&f.path.length>=2)?f.path[f.path.length-2].id:null;renderDispatch();};
  M.querySelectorAll('[data-s]').forEach(b=>b.onclick=()=>{d.scale=b.dataset.s;renderDispatch();});
  M.querySelector('[data-auto]').onclick=()=>{if(!d.loc){alert('先に発生場所を選んでください');return;}d.unit=composeUnit(d.loc,SCALE[d.scale].n,[]);renderDispatch();};
  M.querySelectorAll('[data-b]').forEach(b=>b.onclick=()=>{S.members.filter(m=>m.bureau===b.dataset.b&&m.status!=='respond'&&!d.unit.includes(m.id)).forEach(m=>d.unit.push(m.id));renderDispatch();});
  M.querySelectorAll('[data-ur]').forEach(b=>b.onclick=()=>{d.unit=d.unit.filter(x=>x!==b.dataset.ur);renderDispatch();});
  const uc=M.querySelector('[data-uc]');if(uc)uc.onclick=e=>{e.preventDefault();d.unit=[];renderDispatch();};
  $('#cadDadd').onchange=e=>{if(e.target.value&&!d.unit.includes(e.target.value))d.unit.push(e.target.value);renderDispatch();};
  M.querySelectorAll('[data-p]').forEach(b=>b.onclick=()=>{d.prio=b.dataset.p;renderDispatch();});
  const t=$('#cadDt');t.oninput=e=>{d.text=e.target.value;};t.onkeydown=e=>{if((e.metaKey||e.ctrlKey)&&e.key==='Enter'){e.preventDefault();submitDispatch();}};
  $('#cadDgo').onclick=submitDispatch;
}
function submitDispatch(){
  const d=draft;if(!d)return;
  if(!d.loc){alert('発生場所を選んでください');return;}
  if(!d.unit.length){alert('出動隊を編成してください（自動編成／局から一括／個別追加）');return;}
  const seq=S.seq++,k=KINDS[d.kind]||KINDS.other,text=(d.text||'').trim()||k.label+' の対応';
  S.orders.unshift({id:'D'+seq,seq,kind:d.kind,prio:d.prio,loc:d.loc,locLabel:d.locLabel,assignees:d.unit.slice(),text,status:'dispatch',created:Date.now()});
  d.unit.forEach(id=>{const m=mem(id);if(m){m.status='respond';m.upd=Date.now();}});
  addLog('order','#'+seq+' '+k.label+(d.prio==='urgent'?'【緊急】':'')+' '+d.locLabel+' へ発令 → 出動隊'+d.unit.length+'名（'+d.unit.map(id=>mem(id)?mem(id).callsign:'').filter(Boolean).join(',')+'）',d.prio==='urgent'?'#ff3b47':k.color);
  const loc=d.loc;save();closeModal();renderAll();focusLoc(loc);
}
function advanceOrder(id,to){
  const o=S.orders.find(x=>x.id===id);if(!o)return;o.status=to;const u=(o.assignees||[]).map(mem).filter(Boolean);
  if(to==='respond')addLog('order','#'+o.seq+' '+u.map(m=>m.callsign).join(',')+' 現場対応開始','#ff7a1a');
  if(to==='done'){u.forEach(m=>{m.status='active';m.upd=Date.now();});addLog('done','#'+o.seq+' '+(KINDS[o.kind]||KINDS.other).label+' 完了','#37d47f');}
  save();renderAll();
}
function setStatus(id,st){const m=mem(id);if(!m)return;m.status=st;m.upd=Date.now();addLog('status',m.callsign+' '+m.name+' → '+STATUS[st].label,STATUS[st].color);save();renderCounters();renderRoster();renderLog();refreshMarkers();}
function quickStatus(id,st){setStatus(id,st);}
function setLoc(id,loc){const m=mem(id);if(!m)return;const from=LOC[m.loc]?LOC[m.loc].name:'—';m.loc=loc;m.upd=Date.now();addLog('move',m.callsign+' '+m.name+' 配置変更 '+from+'→'+(LOC[loc]?LOC[loc].name:''),'#28c8e0');save();renderRoster();renderLog();refreshMarkers();}
function delMember(id){const m=mem(id);if(!m)return;if(!confirm(m.callsign+' '+m.name+' を削除しますか？'))return;S.members=S.members.filter(x=>x.id!==id);S.orders.forEach(o=>o.assignees=(o.assignees||[]).filter(a=>a!==id));
  addLog('sys','人員削除：'+m.callsign,'#ff3b47');save();closeModal();renderAll();}
/* ---- 設定（α版） ---- */
function openSettings(){
  openModal(MH('α版の設定')+'<div class="cad-mb">'
    +'<div class="cad-fld"><label>人員の追加（局ごと。氏名は空欄なら「局員」）</label><div style="display:flex;gap:6px;flex-wrap:wrap">'
    +'<select class="cad-inp" id="cadAb" style="flex:1;min-width:120px">'+S.bureaus.map(b=>'<option value="'+esc(b.code)+'">'+esc(b.name)+'</option>').join('')+'</select>'
    +'<select class="cad-inp" id="cadAl" style="flex:1;min-width:120px">'+S.locations.map(l=>'<option value="'+l.id+'">'+esc(l.name)+'</option>').join('')+'</select>'
    +'<input class="cad-inp" id="cadAn" placeholder="氏名（端末内にのみ保存）" style="flex:2;min-width:140px"><button class="cad-btn" id="cadAadd">追加</button></div></div>'
    +'<div class="cad-fld"><label>配置箇所</label><div class="cad-chips"><button class="cad-kc" id="cadLe">地図上で位置を調整</button></div></div>'
    +'<div class="cad-fld"><label>2画面運用</label><div class="cad-chips"><button class="cad-kc" id="cadWin">もう1つのウィンドウで開く</button></div>'
    +'<div style="font-size:11px;color:var(--muted);margin-top:5px">同じ端末で開いたウィンドウ同士は自動で同期します（別の端末とは同期しません）。</div></div>'
    +'<div class="cad-fld"><label>データ</label><div class="cad-chips"><button class="cad-kc" id="cadReset" style="color:#e03131">サンプルデータに戻す</button></div>'
    +'<div style="font-size:11px;color:var(--muted);margin-top:5px">人員・指令・ログはこの端末のブラウザ内にだけ保存されます。氏名はダミーです（公開サイトのため実名は保存しない運用を推奨）。</div></div>'
    +'<div class="cad-fld"><label>ショートカット</label><div style="font-size:12px;line-height:1.7">N＝新規指令　/＝人員を検索　P＝位置プロット　Esc＝閉じる</div></div></div>'
    +'<div class="cad-mf"><span class="sp"></span><button class="cad-btn" data-x>閉じる</button></div>');
  $('#cadAadd').onclick=()=>{const code=$('#cadAb').value,loc=$('#cadAl').value,name=($('#cadAn').value||'').trim()||'局員';
    let mx=0;S.members.filter(m=>m.bureau===code).forEach(m=>{const n=parseInt((m.callsign.split('-')[1]||'0'),10);if(n>mx)mx=n;});
    const id='M'+(Date.now()%1e9);S.members.push({id,callsign:code+'-'+pad(mx+1),name,bureau:code,role:'局員',loc,status:'active',note:'',upd:Date.now()});
    addLog('sys','人員追加：'+code+'-'+pad(mx+1),'#37d47f');save();renderAll();$('#cadAn').value='';};
  $('#cadLe').onclick=startLocEdit;
  $('#cadWin').onclick=()=>window.open(location.href,'_blank','width=1400,height=900');
  $('#cadReset').onclick=()=>{if(!confirm('人員・指令・ログをサンプルデータに戻します。よろしいですか？'))return;genDemo();rebuild();clearMarkers();closeModal();renderAll();};
}

/* ---------- 起動・終了 ---------- */
function onKey(e){
  if(!on)return;
  if(e.key==='Escape'){if($('#cadOv').classList.contains('show'))closeModal();else if(editLoc)endLocEdit();return;}
  const tag=(e.target.tagName||'').toLowerCase();if(tag==='input'||tag==='textarea'||tag==='select'||e.target.isContentEditable)return;
  if(e.metaKey||e.ctrlKey||e.altKey)return;
  const k=e.key.toLowerCase();
  if(k==='n'){e.preventDefault();openDispatch();}else if(k==='/'){e.preventDefault();const q=$('#cadQ');if(q)q.focus();}else if(k==='p'){e.preventDefault();togglePlot();}
}
function onTerrain(){if(on)refreshMarkers();}
function onStorage(e){if(!on||!e.key||e.key.indexOf(KEY)<0)return;if(load()){ensureShape();rebuild();renderAll();}}
function start(){
  if(on)return;on=true;
  if(!load())genDemo();ensureShape();rebuild();
  injectDom();document.body.classList.add('cad-on');
  renderAll();
  tickTimer=setInterval(tick,1000);
  document.addEventListener('keydown',onKey);window.addEventListener('storage',onStorage);window.addEventListener('festterrain',onTerrain);
}
function stop(){
  if(!on)return;on=false;
  clearInterval(tickTimer);tickTimer=null;if(plotTimer){clearInterval(plotTimer);plotTimer=null;}
  document.removeEventListener('keydown',onKey);window.removeEventListener('storage',onStorage);window.removeEventListener('festterrain',onTerrain);
  clearMarkers();removeDom();editLoc=false;
}
window.CAD={start,stop,isOn:()=>on,focusLoc,openDispatch,_state:()=>S};
})();
