# ドライブ版の見た目の層（design.src.css）を index-google.html の <style> の末尾に入れる。
#   §  → html:not(.fest)   ／ 太すぎる文字の指定（700/800/900）を下げる上書きを、今のCSSから自動で作って先頭に置く
import re, sys
from pathlib import Path
HTML = Path(__file__).resolve().parent.parent / 'index-google.html'; SRC = Path(__file__).with_name('drive-ui.src.css')
A, B = '  /* <<< DRIVE-UI */\n', '  /* DRIVE-UI >>> */\n'
s = HTML.read_text(encoding='utf-8')
if A in s: s = s[:s.index(A)] + s[s.index(B) + len(B):]
i0 = s.index('<style>'); i1 = s.index('</style>', i0)
css = s[i0 + 7:i1]
css_nc = re.sub(r'/\*.*?\*/', '', css, flags=re.S)
# 葉の規則（中に { を含まない）を拾う
rules = re.findall(r'([^{}]+)\{([^{}]*)\}', css_nc)
P = 'html:not(.fest)'
def scope(sel):
    out = []
    for part in sel.split(','):
        part = part.strip()
        if not part or 'fest' in part or re.match(r'^(\d+%|from|to)$', part) or part.startswith('@'): return None
        if part.startswith(':root'): part = P + part[5:]
        elif part.startswith('html'): part = P + part[4:]
        elif part.startswith('body'): part = P + ' ' + part
        else: part = P + ' ' + part
        out.append(part)
    return out
MAP = {'900': '700', '800': '700', '700': '600'}
grp = {'700': [], '600': []}
for sel, body in rules:
    m = re.search(r'font-weight:\s*(900|800|700)\b', body)
    if not m: continue
    sc = scope(sel.strip().split('}')[-1].strip())
    if sc:
        for x in sc:
            if x not in grp[MAP[m.group(1)]]: grp[MAP[m.group(1)]].append(x)
gen = '  /* 文字の太さ（自動生成）：800・900 → 700、700 → 600 */\n'
for w in ('700', '600'):
    L = grp[w]
    for k in range(0, len(L), 12): gen += '  ' + ','.join(L[k:k + 12]) + '{font-weight:%s;}\n' % w
gen += '  %s [style*="font-weight:800"],%s [style*="font-weight:900"],%s [style*="font-weight: 800"]{font-weight:700 !important;}\n' % (P, P, P)
gen += '  %s [style*="font-weight:700"]{font-weight:600 !important;}\n' % P
src = SRC.read_text(encoding='utf-8')
k = src.index('  /* --- 文字 --- */')
block = A + src[:k] + gen + src[k:] + B
block = block.replace('§[', P + '[').replace('§ ', P + ' ')
assert '§' not in block
s = s[:i1] + block + s[i1:]
HTML.write_text(s, encoding='utf-8')
print('weights: 700 x%d, 600 x%d; block %d bytes' % (len(grp['700']), len(grp['600']), len(block.encode())))
