#!/usr/bin/env python3
# 温泉郷の紹介文・写真と、47都道府県の観光特集（guide/）を作り直す。
#   入力：引き継ぎ素材集（japan_travel_handoff_*.zip）を展開したフォルダ。素材集そのもの（調査用の資料・未使用の写真）はリポジトリに入れない
#         --extra <フォルダ>：素材集で未取得だった写真を後から取得したもの（<画像ID>.jpg 等。download_queue.json の imageUrl から取得）
#   出力：guide/onsen-guide.json（温泉郷110件の紹介文と写真）・guide/tour-guide.json（観光特集）・guide/photos/*.webp（表示用に縮小した写真）
# 使い方：python3 -I tools/build-travel-guide.py <展開したフォルダ> [--extra <追加取得した写真のフォルダ>] [出力先=guide]   （cwebp が必要。brew install webp）
# 公開する写真は「取得済み」かつ「被写体の目視確認済み」のものだけ。目視の記録は tools/travel-guide-review.json（ok＝確認済み・rejected＝載せない理由）
# 未取得・要許諾（公式サイト等の写真）・目視未了・不採用の写真は載せず、無地の代替表示にする
# 写真のファイル名は中身のハッシュ。差し替えると名前が変わるので、端末に古い写真が残り続けない（Service Worker は写真を件数上限付きで保存）
# データを作り直したら index-google.html の GUIDE_V を上げる（サービスワーカーが古いデータを使い続けないように）
import hashlib, json, re, subprocess, sys
from pathlib import Path

args = sys.argv[1:]; EXTRA = None
if '--extra' in args:
    k = args.index('--extra'); EXTRA = Path(args[k + 1]); del args[k:k + 2]
SRC = Path(args[0]) if args else None
OUT = Path(args[1]) if len(args) > 1 else Path(__file__).resolve().parent.parent / 'guide'
if not SRC or not (SRC / 'data' / 'tourism.json').exists():
    sys.exit('使い方: python3 -I tools/build-travel-guide.py <引き継ぎ素材集を展開したフォルダ> [--extra <追加取得した写真のフォルダ>] [出力先]')
APP = Path(__file__).resolve().parent.parent / 'index-google.html'
LONG = 640   # 写真の長辺（px）。カード・吹き出しの表示幅（〜360px）の約2倍
Q = 72       # WebP の画質
MOD = '表示用に縮小・WebP形式に変換（内容の加工なし）'   # 写真に行った変更（全点共通）

# 実装時の目視の記録（素材集では「目視未了」だった写真のうち、一覧シートで被写体と名称の対応を確かめたもの／載せないもの）
REVIEW = json.loads((Path(__file__).resolve().parent / 'travel-guide-review.json').read_text(encoding='utf-8'))
REVIEW_OK, REJECTED = set(REVIEW['ok']), REVIEW.get('rejected', {})
REJECT_USE = REVIEW.get('rejectedUse', {})   # 写真そのものは良いが、この項目に使うのは誤り（同名の別の場所など）：項目ID → 理由

def load(n): return json.loads((SRC / 'data' / n).read_text(encoding='utf-8'))
O, T = load('onsen.json'), load('tourism.json')
err = []
def check(ok, msg):
    if not ok: err.append(msg)

# ---------- 写真 ----------
# 素材集の撮影者名が不十分だったもの：2026-10-28 に Wikimedia Commons のファイル説明ページで撮影者を確認して補う
CREATOR_FIX = {'File:TsukimiBashi2004-12.jpg': 'Kinori',          # 「撮影者 - Kinori」（PD-user|Kinori）
               'File:Awa-dance memorial hall01s3200.jpg': '663highland',   # 作者欄に場所が入っていた。投稿者 663highland の自作（Own work）
               'File:住吉大社にて 住吉鳥居 2012.10.13 - panoramio.jpg': 'Nankou Oronain（Panoramio）',   # Commons の表記自体が「Nankou Oronain (as36…」で途切れている
               'File:馬見丘陵公園 公園館 2012.6.07 - panoramio.jpg': 'Nankou Oronain（Panoramio）',
               }
def creator_text(i):
    """クレジットに出す撮影者名。求められた表記があればそれを使い、Commons の定型文・署名の残り・URL は読める形に整える"""
    if i.get('fileTitle') in CREATOR_FIX: return CREATOR_FIX[i['fileTitle']]
    c = (i.get('requestedAttribution') or '').strip() or (i.get('creator') or '').strip()
    c = re.sub(r'\s*\(\s*talk\s*\)', '', c)                                  # 署名の「( talk )」
    c = re.sub(r'\s*(?:This photo was taken with|Taken with)\b.*$', '', c)   # 撮影機材の書き込み
    c = re.sub(r'^photo:\s*', '', c)
    m = re.fullmatch(r'flickr ID;\s*(\S+)\s*\(\s*URL\s*\)', c)
    if m: c = m.group(1) + '（Flickr）'
    c = re.sub(r'\s*\d{1,2}:\d{2}, \d{1,2} [A-Za-z]+ \d{4} \(UTC\)', '', c)  # 署名の日時
    m = re.fullmatch(r'(?:日|ja):\s*(\S+)\s*,\s*\1', c)                      # 「日:Muramasa , Muramasa」
    if m: c = m.group(1)
    c = re.sub(r'^日\s*:\s*', '', c)                                             # 「日: Jnn」（日本語版の利用者）
    m = re.match(r'No machine-readable author provided\.\s*(.+?) assumed', c)
    if m: c = m.group(1)
    c = re.sub(r'~commonswiki$', '', c)
    c = re.sub(r'\s*https?://\S+', '', c)
    c = re.sub(r'\s*\((フォト蔵)\)', r'（\1）', c).strip()
    return c

def https(u): return isinstance(u, str) and u.startswith('https://')
def iri(u):   # 日本語の部分の %XX をそのまま読める文字に戻す（データを小さくする。ASCII の %XX は残すのでリンク先は変わらない）
    def dec(m):
        try: return bytes.fromhex(m.group(0).replace('%', '')).decode('utf-8')
        except UnicodeDecodeError: return m.group(0)
    return re.sub(r'(?:%[89A-Fa-f][0-9A-Fa-f])+', dec, u or '')
def lic_url(u):   # 素材集の一部は http:// の CC のURL（同じページ）。外部リンクは https に統一する
    return re.sub(r'^http://(creativecommons\.org/)', r'https://\1', u or '')

def photo_file(i):   # 写真のファイル（素材集に同梱 → 追加取得の順）
    if i.get('downloadStatus') == 'downloaded' and i.get('localPath'): return SRC / i['localPath']
    if EXTRA:
        for p in sorted(EXTRA.glob(i['id'] + '.*')): return p
    return None

def publishable(i):
    if not i or i['id'] in REJECTED or i.get('licenseStatus') != 'metadata_checked' or not photo_file(i): return False
    return (i.get('visualReview') == 'contact_sheet_reviewed' and i.get('downloadStatus') == 'downloaded') or i['id'] in REVIEW_OK

def shot_date(v):   # 撮影日（「2008-05-06 …」→ 2008-05-06、「8 October 2006 …」→ 2006）
    v = str(v or ''); m = re.match(r'(\d{4}-\d\d-\d\d)', v)
    if m: return m.group(1)
    m = re.search(r'\b(1[89]\d\d|20\d\d)\b', v)
    return m.group(1) if m else ''

def size_of(p):
    r = subprocess.run(['sips', '-g', 'pixelWidth', '-g', 'pixelHeight', str(p)], capture_output=True, text=True, check=True).stdout
    return int(re.search(r'pixelWidth: (\d+)', r).group(1)), int(re.search(r'pixelHeight: (\d+)', r).group(1))

need = {i['id'] for i in [o.get('image') for o in O + T] if i and i['id'] in REVIEW_OK and not photo_file(i)}
if need: sys.exit('確認済みの写真 %d 点のファイルがありません。追加取得した写真のフォルダを --extra で指定してください（何も書き換えていません）' % len(need))
(OUT / 'photos').mkdir(parents=True, exist_ok=True)
media, mid, used = [], {}, set()
def media_index(i):
    if i['id'] in mid: return mid[i['id']]
    src = photo_file(i)
    check(src.exists(), '写真ファイルがありません: ' + str(src))
    w, h = size_of(src)
    rs = ['-resize', str(LONG), '0'] if w >= h else ['-resize', '0', str(LONG)]
    if max(w, h) <= LONG: rs = []
    tmp = OUT / 'photos' / '_tmp.webp'
    subprocess.run(['cwebp', '-quiet', '-q', str(Q), '-metadata', 'none', *rs, str(src), '-o', str(tmp)], check=True)
    data = tmp.read_bytes(); name = hashlib.sha1(data).hexdigest()[:16] + '.webp'
    (OUT / 'photos' / name).write_bytes(data); tmp.unlink(); used.add(name)
    ow, oh = size_of(OUT / 'photos' / name)
    by = creator_text(i)
    check(bool(by) and not re.search(r'own work|unknown|不明|参照|talk|https?://', by, re.I), '撮影者名が不十分です: %s %r' % (i['fileTitle'], i.get('creator')))
    check(bool(i.get('license')) and https(lic_url(i.get('licenseUrl'))), 'ライセンス（URL）がありません: ' + i['fileTitle'])
    check(https(i.get('filePageUrl')), 'ファイル説明ページのURLがありません: ' + i['fileTitle'])
    check(i.get('modified') is False, '加工済みの写真です（変更内容の記録が必要）: ' + i['fileTitle'])
    e = {'f': 'photos/' + name, 'w': ow, 'h': oh, 'by': by, 'lic': i['license'], 'licUrl': lic_url(i['licenseUrl']),
         'page': iri(i['filePageUrl']), 'title': re.sub(r'^File:', '', i['fileTitle']), 'src': i.get('source') or 'Wikimedia Commons',
         'cap': i.get('caption') or '', 'at': shot_date(i.get('capturedAt'))}
    if (i.get('creator') or '') != by: e['byRaw'] = i.get('creator') or ''   # 元の撮影者表記（整えた場合だけ。クレジット一覧に出す）
    media.append(e)
    mid[i['id']] = len(media) - 1
    return mid[i['id']]

# ---------- 温泉郷（アプリの ONSEN_GO と「名前＋都道府県」で照合する。配列の位置では結合しない） ----------
s = APP.read_text(encoding='utf-8'); blk = s[s.index('const ONSEN_GO=['):]; blk = blk[:blk.index('];')]
app = re.findall(r"\{name:'([^']+)',lat:[\d.]+,lng:[\d.]+,area:'([^']+)'", blk)
def short_pref(p): return p if p == '北海道' else re.sub(r'(都|府|県)$', '', p)
onsen, keys = {}, set()
for o in O:
    k = o['name'] + '|' + short_pref(o['prefecture'])
    check(k not in keys, '温泉の重複キー: ' + k); keys.add(k)
    d = o['description']
    check(0 < len(d) <= 50, '紹介文が50字を超えています: %s（%d字）' % (o['name'], len(d)))
    i = o.get('image')
    onsen[k] = {'d': d, 'm': media_index(i) if publishable(i) else -1}
appk = {n + '|' + a for n, a in app}
check(len(app) == len(O), 'アプリの温泉郷（%d件）と素材集（%d件）の件数が違います' % (len(app), len(O)))
for k in appk - keys: check(False, '紹介文のない温泉郷: ' + k)
for k in keys - appk: check(False, 'アプリにない温泉郷: ' + k)
onsen_out = {'v': '2026-10-28', 'mod': MOD, 'media': media, 'onsen': onsen}
n_onsen_media = len(media)

# ---------- 観光特集 ----------
media, mid = [], {}
CATS = [('scenic', '絶景・景勝地'), ('onsen', '温泉'), ('history', '歴史・文化'), ('leisure', 'レジャー・体験'), ('food', 'グルメ')]
prefs = sorted({(t['prefCode'], t['prefecture']) for t in T})
check(len(prefs) == 47, '都道府県が47ではありません: %d' % len(prefs))
ids, items, pend = set(), [], []
for t in sorted(T, key=lambda t: (t['prefCode'], t['displayOrder'])):
    check(t['id'] not in ids, '観光のIDが重複: ' + t['id']); ids.add(t['id'])
    check(t['category'] in dict(CATS), '不明なカテゴリ: ' + t['category'])
    check(https(t['officialUrl']), '公式URLがhttpsではありません: ' + t['name'])
    i = t.get('image')
    m = media_index(i) if publishable(i) and t['id'] not in REJECT_USE else -1
    if m < 0: pend.append(t['id'])
    r = t.get('referenceCoordinates')
    items.append({'id': t['id'], 'p': t['prefCode'], 'n': t['name'], 'c': t['city'], 'k': t['category'], 'd': t['description'], 'h': t['highlights'],
                  's': t['seasonNote'], 'u': t['officialUrl'], 'sc': 1 if t['officialSourceScope'] == 'spot' else 0,
                  'r': [round(r['lat'], 6), round(r['lng'], 6)] if r else None, 'm': m,
                  'x': t['verificationNote'] if t.get('operationalStatus') else None})
for code, name in prefs:
    cs = {k: sum(1 for x in items if x['p'] == code and x['k'] == k) for k, _ in CATS}
    check(sum(cs.values()) >= 20 and all(cs.values()), '%s の件数・カテゴリが足りません: %s' % (name, cs))
tour_out = {'v': '2026-10-28', 'mod': MOD, 'cats': CATS, 'prefs': prefs, 'media': media, 'items': items, 'idMap': {}}

for k in REJECT_USE: check(k in ids, '目視の記録にあるが素材集にない項目: ' + k)
for k in REVIEW_OK | set(REJECTED):
    check(k in {(o.get('image') or {}).get('id') for o in O + T}, '目視の記録にあるが素材集にない写真: ' + k)
if err:   # 問題があれば JSON を書き換えず、写真も消さない
    print('\n'.join(err)); sys.exit('検証で %d 件の問題がありました（JSON は書き換えていません）' % len(err))
for name, d in (('onsen-guide.json', onsen_out), ('tour-guide.json', tour_out)):
    (OUT / name).write_text(json.dumps(d, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
# 使っていない古い写真を消す（ファイル名＝中身のハッシュ）
for p in (OUT / 'photos').glob('*.webp'):
    if p.name not in used: p.unlink()
tot = sum(p.stat().st_size for p in (OUT / 'photos').glob('*.webp'))
print('温泉郷 %d件（写真 %d）／観光特集 %d件（写真 %d・写真なし %d）／写真ファイル %d点 %.1fMB' % (len(onsen), n_onsen_media, len(items), len(items) - len(pend), len(pend), len(used), tot / 1e6))
