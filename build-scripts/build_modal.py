import re, json

SRC = '/home/claude/next-touch.html'
OUT = '/home/claude/next-touch.html'

with open(SRC, encoding='utf-8') as f:
    html = f.read()

orig_len = len(html)

# ---- Step 1: repoint name-btn onclick from toggleRes(...) to openBrief(slug) ----
def repl_namebtn(m):
    slug = m.group(1)
    return "onclick=\"openBrief('%s')\"" % slug

new_html, n1 = re.subn(r"onclick=\"toggleRes\('res-([a-z0-9-]+)', this\)\"", repl_namebtn, html)
print('name-btn onclick rewrites:', n1)
html = new_html

# ---- Step 2: remove the old per-card <div class="resources" ...>...</div> blocks ----
pattern_res = re.compile(r'    <div class="resources" id="res-[a-z0-9-]+" hidden>\n(?:.*\n)*?    </div>\n')
new_html, n2 = pattern_res.subn('', html)
print('resources panels removed:', n2)
html = new_html

# ---- Step 3: wire up "This Week" section names ----
tw_map = {
    '<span class="tw-name">Bernadette Anderson</span>': "<button type=\"button\" class=\"tw-name-btn\" onclick=\"openBrief('bernadette-anderson')\">Bernadette Anderson</button>",
    '<span class="tw-name">Todd Neider</span>': "<button type=\"button\" class=\"tw-name-btn\" onclick=\"openBrief('todd-neider')\">Todd Neider</button>",
    '<span class="tw-name">Patty Banach</span>': "<button type=\"button\" class=\"tw-name-btn\" onclick=\"openBrief('patty-banach')\">Patty Banach</button>",
    '<span class="tw-name">Daniel Simunek</span>': "<button type=\"button\" class=\"tw-name-btn\" onclick=\"openBrief('daniel-simunek')\">Daniel Simunek</button>",
    '<span class="tw-name">Geoffrey Aquino</span>': "<button type=\"button\" class=\"tw-name-btn\" onclick=\"openBrief('geoffrey-aquino')\">Geoffrey Aquino</button>",
    '<span class="tw-name">Tyler Chartier</span>': "<button type=\"button\" class=\"tw-name-btn\" onclick=\"openBrief('tyler-chartier')\">Tyler Chartier</button>",
    '<span class="tw-name">Beverly Lwenya</span>': "<button type=\"button\" class=\"tw-name-btn\" onclick=\"openBrief('beverly-lwenya')\">Beverly Lwenya</button>",
    '<span class="tw-name">Christian Rothchild</span>': "<button type=\"button\" class=\"tw-name-btn\" onclick=\"openBrief('christian-rothchild')\">Christian Rothchild</button>",
}
n3 = 0
for old, new in tw_map.items():
    if old not in html:
        print('MISSING tw-name span:', old)
    else:
        html = html.replace(old, new)
        n3 += 1
print('this-week names wired:', n3)

# ---- Step 4: also make the "Jump to his/her full card" anchors into brief-openers is NOT required; leave as-is (they scroll to card, which is fine as a secondary path) ----

# ---- Step 5: inject modal CSS just before closing </style> ----
modal_css = """
  /* --- Contact Brief modal --- */
  .modal-overlay {
    position: fixed; inset: 0; background: rgba(20, 22, 19, 0.5);
    display: flex; align-items: flex-start; justify-content: center;
    padding: 48px 20px; z-index: 1000; overflow-y: auto;
  }
  .modal-overlay[hidden] { display: none; }
  .modal {
    background: var(--surface); border: 1px solid var(--border); border-radius: 16px;
    box-shadow: var(--shadow); max-width: 640px; width: 100%;
    padding: 30px 32px 28px; position: relative; margin-bottom: 40px;
  }
  .modal-close {
    position: absolute; top: 18px; right: 18px;
    background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px;
    padding: 7px 14px; font-family: 'Public Sans', sans-serif; font-size: 0.8rem; font-weight: 600;
    color: var(--ink-soft); cursor: pointer;
  }
  .modal-close:hover { color: var(--ink); background: var(--border); }
  .modal-close:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .modal-priority-badge {
    display: inline-block; font-family: 'IBM Plex Mono', monospace; font-size: 0.7rem;
    text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600;
    padding: 3px 11px; border-radius: 999px; margin-bottom: 12px;
  }
  .mpb-high { background: var(--high-soft); color: var(--high); }
  .mpb-med { background: var(--med-soft); color: var(--med); }
  .mpb-low { background: var(--low-soft); color: var(--low); }
  .mpb-none { background: var(--none-soft); color: var(--none); }
  .mpb-unmatched { background: var(--surface-2); color: var(--ink-faint); }
  .modal-name { font-family: 'Newsreader', Georgia, serif; font-weight: 600; font-size: 1.65rem; margin: 0 0 4px; padding-right: 84px; line-height: 1.2; }
  .modal-biz { color: var(--ink-soft); font-size: 0.92rem; margin-bottom: 2px; }
  .modal-email { font-family: 'IBM Plex Mono', monospace; font-size: 0.78rem; color: var(--ink-faint); margin-bottom: 18px; }
  .modal-metagrid {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px;
    background: var(--surface-2); border-radius: 10px; padding: 14px 16px; margin-bottom: 6px;
  }
  .modal-metagrid .mf .k { font-family: 'IBM Plex Mono', monospace; font-size: 0.64rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--ink-faint); margin-bottom: 3px; }
  .modal-metagrid .mf .v { font-size: 0.85rem; color: var(--ink); line-height: 1.4; }
  .modal-section { border-top: 1px solid var(--border); padding-top: 14px; margin-top: 14px; }
  .modal-section summary { cursor: pointer; font-weight: 600; font-size: 0.92rem; list-style: none; display: flex; align-items: center; gap: 8px; color: var(--ink); }
  .modal-section summary::-webkit-details-marker { display: none; }
  .modal-section summary::before { content: '\\25B8'; font-size: 0.68rem; color: var(--ink-faint); display: inline-block; transition: transform 0.15s ease; }
  .modal-section[open] summary::before { transform: rotate(90deg); }
  .modal-section summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; border-radius: 4px; }
  .modal-section-body { font-size: 0.86rem; color: var(--ink-soft); line-height: 1.6; margin-top: 10px; }
  .modal-section-body p { margin: 0 0 8px; }
  .modal-section-body p:last-child { margin-bottom: 0; }
  .dim-note { color: var(--ink-faint); font-style: italic; }
  .coach-situation { background: var(--accent-soft); border-radius: 8px; padding: 11px 14px; font-size: 0.85rem; color: var(--ink); margin-bottom: 14px; line-height: 1.55; }
  .coach-line { margin-bottom: 13px; }
  .coach-line:last-child { margin-bottom: 0; }
  .coach-line .cl-label { font-weight: 600; font-size: 0.83rem; color: var(--accent-strong); margin-bottom: 3px; }
  .coach-line .cl-verbiage { font-size: 0.86rem; color: var(--ink); line-height: 1.55; }
  .modal-resources { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 18px; border-top: 1px solid var(--border); padding-top: 16px; }
  .tw-name-btn, .modal-jump-btn {
    font-family: 'Public Sans', sans-serif; font-weight: 600; font-size: 0.95rem;
    background: none; border: none; padding: 0; margin: 0; color: var(--ink);
    cursor: pointer; text-align: left;
  }
  .tw-name-btn:hover { color: var(--accent-strong); text-decoration: underline; }
  .tw-name-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; border-radius: 4px; }
"""

marker = "</style>"
idx = html.find(marker)
assert idx != -1, "style close tag not found"
html = html[:idx] + modal_css + html[idx:]

# ---- Step 6: insert modal HTML markup right after opening <div class="wrap"> content ends, i.e. right before </script> at file's very end area. We'll insert it right after the closing </footer> and before the final </div> of .wrap. ----
modal_markup = """
  <div class="modal-overlay" id="briefOverlay" hidden>
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="briefName">
      <button type="button" class="modal-close" id="briefClose">&times; Close</button>
      <div id="briefPriority"></div>
      <h2 class="modal-name" id="briefName"></h2>
      <div class="modal-biz" id="briefBiz"></div>
      <div class="modal-email" id="briefEmail"></div>
      <div class="modal-metagrid" id="briefMetaGrid"></div>
      <div id="briefBody"></div>
      <div class="modal-resources" id="briefResources"></div>
    </div>
  </div>
"""

footer_close = "</footer>"
fidx = html.find(footer_close)
assert fidx != -1
insert_at = fidx + len(footer_close)
html = html[:insert_at] + "\n" + modal_markup + html[insert_at:]

with open(OUT, 'w', encoding='utf-8') as f:
    f.write(html)

print('done, new length', len(html), 'was', orig_len)
