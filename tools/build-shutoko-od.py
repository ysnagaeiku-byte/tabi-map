#!/usr/bin/env python3
# 首都高の料金距離の表（shutoko-od.json）を作り直す。
#   1) 首都高ドライバーズサイト「首都高の料金体系」の「首都高料金表」PDF（料金・距離表 ETC普通車）を読み取り、入口×出口の料金距離にする
#      （列＝出口、行＝入口。各マスの上段＝料金、下段＝料金距離。全マスで「料金＝（150＋32.472×距離）×1.10 を10円単位に四捨五入」を確かめる）
#   2) OpenStreetMap（Overpass API）から首都高の出入口の位置（出口の分岐点・料金所・名前の付いたランプ）を集める
#   3) 他の道路との接続部（※東名高速 など）は手で置いた位置と道路名で判定する
# 使い方：python3 tools/build-shutoko-od.py <料金表PDFのURL> [出力先]   （poppler の pdftotext が必要。brew install poppler）
# 料金表の版が変わったら、index-google.html の shuOdLoad の ?v= を上げる（サービスワーカーが古い表を使い続けないように）
import html, json, re, subprocess, sys, tempfile, urllib.parse, urllib.request
from pathlib import Path

PDF_URL = sys.argv[1] if len(sys.argv) > 1 else ''
OUT = Path(sys.argv[2] if len(sys.argv) > 2 else Path(__file__).resolve().parent.parent / 'shutoko-od.json')
BBOX = '35.30,139.40,36.00,140.10'
UA = {'User-Agent': 'tabi-map-shutoko-od/1.0'}
if not PDF_URL:
    sys.exit('使い方: python3 tools/build-shutoko-od.py <首都高料金表PDFのURL> [出力先]')

def get(url, data=None):
    req = urllib.request.Request(url, data=data, headers=UA)
    with urllib.request.urlopen(req, timeout=180) as r:
        return r.read()

def fee(km):   # 普通車・ETC（2026年10月改定後）
    return max(int((150 + 32.472 * min(km, 55)) * 1.1 / 10 + 0.5 + 1e-9) * 10, 300)

# ---------- 1) 料金・距離表 ----------
tmp = Path(tempfile.mkdtemp())
(tmp / 'rates.pdf').write_bytes(get(PDF_URL))
subprocess.run(['pdftotext', '-bbox', str(tmp / 'rates.pdf'), str(tmp / 'rates.html')], check=True)
pages = re.findall(r'<page[^>]*>(.*?)</page>', (tmp / 'rates.html').read_text(encoding='utf-8'), re.S)
SKIP = re.compile(r'^(上|段|下|料|金|（円）|料金距離|入口|出口|km|上段|下段|[\d０-９]*号|.*線|.*線・)$')

def words(p):
    return [(float(a), float(b), float(c), float(d), html.unescape(t).replace('\x07', '')) for a, b, c, d, t in
            re.findall(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(.*?)</word>', p)]

def clus(vals, tol):
    g = []
    for v in sorted(vals):
        if g and v - g[-1][-1] <= tol: g[-1].append(v)
        else: g.append([v])
    return [sum(x) / len(x) for x in g]

cells = []
for p in pages:
    ws = words(p)
    T = [w for w in ws if re.fullmatch(r'\d{1,3}(,\d{3})?', w[4]) and 200 <= int(w[4].replace(',', '')) <= 6000 and w[0] > 60 and w[1] < 800]
    D = [w for w in ws if re.fullmatch(r'\d{1,3}\.\d', w[4])]
    out = [w for w in ws if w[4] == '出口' and w[0] < 260 and 80 < w[1] < 220]
    if len(T) < 5 or not out: continue   # 表のないページ（表紙・見方・早見表）
    yOut = min(w[1] for w in out)
    cx = clus([(w[0] + w[2]) / 2 for w in T], 6); ry = clus([(w[1] + w[3]) / 2 for w in T], 3)
    xL = min(w[0] for w in T); y1 = min(w[1] for w in T)
    hdr = [w for w in ws if w[1] >= yOut - 2 and w[3] <= y1 + 1 and w[2] > xL - 6 and not SKIP.match(w[4]) and not re.fullmatch(r'[\d,.]+', w[4])]
    col = {c: ''.join(w[4] for w in sorted([w for w in hdr if abs((w[0] + w[2]) / 2 - c) <= 10.5], key=lambda w: (round(w[1]), w[0]))) for c in cx}
    row = {r: ''.join(w[4] for w in sorted([w for w in ws if w[2] < xL - 1 and w[0] > xL - 60 and r - 6 <= (w[1] + w[3]) / 2 <= r + 11
                                            and not SKIP.match(w[4]) and not re.fullmatch(r'[\d,.]+|[\dA-Z]{1,2}|[０-９]', w[4])], key=lambda w: (round(w[1]), w[0]))) for r in ry}
    for t in T:
        xc = (t[0] + t[2]) / 2; yc = (t[1] + t[3]) / 2
        c = min(cx, key=lambda c: abs(c - xc)); r = min(ry, key=lambda r: abs(r - yc))
        dd = [d for d in D if abs((d[0] + d[2]) / 2 - xc) < 9 and 2 < (d[1] + d[3]) / 2 - yc < 12]
        if not dd: sys.exit('料金距離が読めないマスがあります: ' + row[r] + '→' + col[c])
        km = float(dd[0][4]); toll = int(t[4].replace(',', ''))
        if toll != fee(km): sys.exit('料金と距離が合いません（読み取りのずれ）: %s→%s %d円 %.1fkm' % (row[r], col[c], toll, km))
        cells.append((row[r], col[c], km))
E = sorted({c[0] for c in cells}); X = sorted({c[1] for c in cells})
ei = {n: i for i, n in enumerate(E)}; xi = {n: i for i, n in enumerate(X)}
km = [[0] * len(X) for _ in E]
for e, x, k in cells: km[ei[e]][xi[x]] = int(round(k * 10))
print('入口', len(E), '出口', len(X), 'マス', len(cells))

# ---------- 2) 出入口の位置（OpenStreetMap） ----------
def overpass(q):   # 混んでいて断られることがあるので、間をあけて数回試す
    import time
    for i in range(5):
        try: return json.loads(get('https://overpass-api.de/api/interpreter', urllib.parse.urlencode({'data': q}).encode()))['elements']
        except Exception as e:
            if i == 4: raise
            print('Overpass に断られたので待って再試行:', e); time.sleep(30 * (i + 1))
ALIAS = {'箱崎浜町清洲橋': ['箱崎', '浜町', '清洲橋'], '箱崎・浜町': ['箱崎', '浜町'], '王子南・王子北': ['王子南', '王子北'], '東銀座（東京高速）': ['東銀座']}
def bases(n):
    if n in ALIAS: return ALIAS[n]
    if n.startswith('※'): return []
    return [x for x in re.sub(r'[（(].*?[)）]', '', n).split('・') if x]
def norm(n): return re.sub(r'(本線料金所|料金所|出入口|出口|入口|ランプ|IC|ＩＣ)$', '', re.sub(r'[（(].*?[)）]', '', n or '')).strip()
B = {n: bases(n) for n in E + X if not n.startswith('※')}
pos = {b: set() for v in B.values() for b in v}
els = overpass('[out:json][timeout:170];(node[highway=motorway_junction](%s);node[barrier=toll_booth](%s);node[highway=toll_gantry](%s););out body;' % (BBOX, BBOX, BBOX))
els += overpass('[out:json][timeout:170];way[highway=motorway_link][name~"(入口|出口|出入口)$"](%s);out tags geom;' % BBOX)
for e in els:
    n = norm(e['tags'].get('name'))
    if n not in pos: continue
    if e['type'] == 'way':
        g = e.get('geometry') or []
        for p in g[::3] + g[-1:]: pos[n].add((round(p['lat'], 5), round(p['lon'], 5)))
    else: pos[n].add((round(e['lat'], 5), round(e['lon'], 5)))
# OpenStreetMap に見当たらない出入口（おおよその位置。案内文の「〇〇 出口」で特定できることが多い）
MAN = {'三溪園': [[35.4128, 139.6640]], '丸の内': [[35.6782, 139.7677]], '八重洲': [[35.6798, 139.7687], [35.6805, 139.7692]], '勝島': [[35.5953, 139.7449]], '大黒ふ頭': [[35.4600, 139.6805]],
       '戸田': [[35.8062, 139.6740]], '浅田': [[35.5069, 139.7024]], '生麦': [[35.4922, 139.6643]], '舞浜': [[35.6335, 139.8830]], '鈴ヶ森': [[35.5926, 139.7356]]}
for b, v in MAN.items():
    if b in pos and not pos[b]: pos[b] = {tuple(p) for p in v}
miss = [b for b, v in pos.items() if not v]
if miss: print('位置が見つからない出入口（MAN に足す）:', miss)

# ---------- 3) 他の道路との接続部：隣の有料道路の名前（正規表現）とおおよその位置 ----------
CN = {'※東名高速': ['東名', 35.6262, 139.6338], '※横浜青葉・横浜青葉JCT（東名高速）': ['東名|横浜北西線', 35.5567, 139.5300], '※中央道': ['中央自動車道|中央道', 35.6830, 139.6120],
      '※京葉道路': ['京葉道路', 35.6905, 139.8890], '※川口JCT（東北道・外環道）': ['東北自動車道|東北道|外環', 35.8180, 139.7290], '※美女木JCT（外環道）': ['外環', 35.8270, 139.6465],
      '※三郷・三郷JCT（常磐道・外環道）': ['常磐|外環', 35.8430, 139.8700], '※高谷JCT（東関東道・外環道）': ['東関東|外環', 35.7060, 139.9580], '※川崎浮島JCT（東京湾アクアライン）': ['アクアライン', 35.5175, 139.7960],
      '※横浜港北・横浜港北JCT（第三京浜）': ['第三京浜', 35.5235, 139.6040], '※第三京浜・横浜新道': ['第三京浜|横浜新道', 35.4640, 139.5950], '※保土ヶ谷バイパス': ['保土ヶ谷バイパス|保土ケ谷バイパス', 35.4260, 139.5720],
      '※横浜横須賀道路': ['横浜横須賀道路|横横', 35.4230, 139.5730], '※横浜横須賀道路（金沢支線）': ['横浜横須賀道路|金沢支線|横横', 35.3770, 139.6330]}
nc = [n for n in E + X if n.startswith('※') and n not in CN]
if nc: sys.exit('接続部の設定がありません（CN に足す）: ' + ', '.join(nc))

A = '0123456789abcdefghijklmnopqrstuvwxyz'
data = {'v': PDF_URL.rsplit('/', 1)[-1], 'src': '首都高料金表（料金・距離表 ETC普通車）／出入口の位置：© OpenStreetMap contributors',
        'ent': E, 'ex': X, 'km': [''.join(A[v // 36] + A[v % 36] for v in r) for r in km], 'base': B,
        'pos': {b: sorted(v) for b, v in sorted(pos.items())}, 'cn': CN}
OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
print('書き出し:', OUT, OUT.stat().st_size, 'bytes')
