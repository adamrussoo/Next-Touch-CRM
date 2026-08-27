import re, json

SRC = '/home/claude/pipeline-pulse.html'

with open(SRC, encoding='utf-8') as f:
    html = f.read()

with open('/home/claude/contacts_data.json', encoding='utf-8') as f:
    contacts = json.load(f)


def normbiz(s):
    if not s:
        return ''
    s = s.lower()
    s = re.sub(r"[.,''\"]", '', s)
    s = re.sub(r'\b(llc|inc|corp|co|ltd|pc|dba)\b', '', s)
    s = re.sub(r'[^a-z0-9]+', ' ', s)
    return s.strip()


by_email = {}
by_biz = {}
for slug, c in contacts.items():
    email = (c.get('email') or '').lower().strip()
    if email:
        by_email[email] = slug
    biz = normbiz(c.get('business'))
    if biz and biz not in by_biz:
        by_biz[biz] = slug

NEXT_TOUCH_URL = "https://claude.ai/code/artifact/c2f940ca-0052-4c5c-8af8-50dda88f49e3"

js_data = (
    "var NEXT_TOUCH_URL = %s;\n"
    "  var NEXT_TOUCH_BY_EMAIL = %s;\n"
    "  var NEXT_TOUCH_BY_BIZ = %s;\n"
    % (json.dumps(NEXT_TOUCH_URL), json.dumps(by_email, ensure_ascii=False), json.dumps(by_biz, ensure_ascii=False))
)

helper_fns = """
  function nextTouchSlug(email, bizRaw) {
    var e = (email || '').toLowerCase().trim();
    if (e && NEXT_TOUCH_BY_EMAIL[e]) return NEXT_TOUCH_BY_EMAIL[e];
    var b = normalizeBiz(bizRaw);
    if (b && NEXT_TOUCH_BY_BIZ[b]) return NEXT_TOUCH_BY_BIZ[b];
    return null;
  }

  function nameWithNextTouchLink(name, email, bizRaw) {
    var slug = nextTouchSlug(email, bizRaw);
    if (!slug) return esc(name);
    return '<a class="nt-name-link" href="' + esc(NEXT_TOUCH_URL) + '#c-' + slug + '" target="_blank" rel="noopener" title="Open Contact Brief in Next Touch">' + esc(name) + ' <span class="nt-link-icon">&#8599;</span></a>';
  }
"""

# ---- Step 1: insert data + helpers right after STATE is parsed ----
anchor = "var STATE = JSON.parse(document.getElementById('pp-state').textContent);\n"
idx = html.find(anchor)
assert idx != -1, "STATE anchor not found"
insert_at = idx + len(anchor)
html = html[:insert_at] + "  " + js_data + helper_fns + html[insert_at:]

# ---- Step 2: wire renderLeadsTable ----
old_lead_td = "'<td class=\"rt-name\">' + esc(l.name) + '</td>' +"
new_lead_td = "'<td class=\"rt-name\">' + nameWithNextTouchLink(l.name, l.email, l.company) + '</td>' +"
n1 = html.count(old_lead_td)
assert n1 == 1, ('lead td match count', n1)
html = html.replace(old_lead_td, new_lead_td)

# ---- Step 3: wire renderOpportunityStageGroups ----
old_opp_td = "'<td class=\"rt-name\">' + esc((o.name || '').replace(/-$/, '') || o.account) + '</td>' +"
new_opp_td = "'<td class=\"rt-name\">' + nameWithNextTouchLink((o.name || '').replace(/-$/, '') || o.account, null, o.account) + '</td>' +"
n2 = html.count(old_opp_td)
assert n2 == 1, ('opp td match count', n2)
html = html.replace(old_opp_td, new_opp_td)

# ---- Step 4: wire renderMeetingCard ----
old_meeting_span = "'<span class=\"meeting-name\">' + esc(m.contactName) + '</span>' +"
new_meeting_span = "'<span class=\"meeting-name\">' + nameWithNextTouchLink(m.contactName, m.email, m.business) + '</span>' +"
n3 = html.count(old_meeting_span)
assert n3 == 1, ('meeting span match count', n3)
html = html.replace(old_meeting_span, new_meeting_span)

# ---- Step 5: add CSS for the new link style, right before the closing </style> of #pp-style ----
css = """
  .nt-name-link { color: var(--accent-strong); text-decoration: none; font-weight: 600; }
  .nt-name-link:hover { text-decoration: underline; }
  .nt-link-icon { font-size: 0.75em; opacity: 0.75; }
"""
style_close = "</style></head><body>"
sidx = html.find(style_close)
assert sidx != -1
html = html[:sidx] + css + html[sidx:]

with open(SRC, 'w', encoding='utf-8') as f:
    f.write(html)

print('lead rows matched:', n1, 'opp rows matched:', n2, 'meeting spans matched:', n3)
print('new length', len(html))
