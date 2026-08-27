import json, re

with open('/home/claude/next-touch.html', encoding='utf-8') as f:
    html = f.read()

with open('/home/claude/contacts_data.json', encoding='utf-8') as f:
    contacts = json.load(f)

contacts_json = json.dumps(contacts, ensure_ascii=False)
# Safe to embed in a <script type="application/json"> block; escape closing script tags defensively.
contacts_json_safe = contacts_json.replace('</script', '<\\/script')

VERBIAGE_URL = "https://claude.ai/code/artifact/19d06ea7-3178-46ff-bf4d-13f1dca37906"

new_script = """<script type="application/json" id="contacts-data">%s</script>
<script>
var CONTACTS = JSON.parse(document.getElementById('contacts-data').textContent);
var VERBIAGE_URL = %s;
var lastFocusedEl = null;

function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function priorityLabel(tier) {
  var map = { high: 'High priority', med: 'Medium priority', low: 'Low priority', none: 'No action needed', unmatched: 'Not yet matched to a profile' };
  return map[tier] || '';
}

function metaField(k, v) {
  return '<div class="mf"><div class="k">' + esc(k) + '</div><div class="v">' + esc(v) + '</div></div>';
}

function section(title, bodyHtml, openDefault) {
  return '<details class="modal-section"' + (openDefault ? ' open' : '') + '><summary>' + esc(title) + '</summary><div class="modal-section-body">' + bodyHtml + '</div></details>';
}

function coachHtml(c) {
  if (!c.coach) {
    return '<p class="dim-note">' + esc(c.coachSkipNote || 'No call coaching available for this contact yet.') + '</p>';
  }
  var h = '<div class="coach-situation">' + esc(c.coach.situation) + '</div>';
  c.coach.lines.forEach(function (pair) {
    h += '<div class="coach-line"><div class="cl-label">' + esc(pair[0]) + '</div><div class="cl-verbiage">' + esc(pair[1]) + '</div></div>';
  });
  return h;
}

function openBrief(slug) {
  var c = CONTACTS[slug];
  if (!c) return;
  lastFocusedEl = document.activeElement;

  document.getElementById('briefPriority').innerHTML = c.tier ? ('<span class="modal-priority-badge mpb-' + c.tier + '">' + esc(priorityLabel(c.tier)) + '</span>') : '';
  document.getElementById('briefName').textContent = c.name || '';
  document.getElementById('briefBiz').textContent = c.business || 'No data';
  document.getElementById('briefEmail').textContent = c.email || 'No data';

  var meta = '';
  meta += metaField('Last contact', c.lastContact || 'No data');
  meta += metaField('Upcoming meeting', c.upcoming || 'None scheduled');
  meta += metaField('Follow-up signal', c.signal || 'Unsequenced');
  document.getElementById('briefMetaGrid').innerHTML = meta;

  var body = '';
  body += section('Conversation history &amp; notes', c.notes ? ('<p>' + esc(c.notes) + '</p>') : '<p class="dim-note">No data on file yet for this contact.</p>', true);
  body += section('Recommended next action', '<p>' + esc(c.action || 'No recommendation yet.') + '</p>', true);
  body += section('Call Coach', coachHtml(c), true);
  document.getElementById('briefBody').innerHTML = body;

  var res = '';
  if (c.briefUrl) res += '<a class="resbtn resbtn-brief" href="' + esc(c.briefUrl) + '" target="_blank" rel="noopener">\\uD83D\\uDCCB Full Contact Brief</a>';
  if (c.readingTapeUrl) res += '<a class="resbtn resbtn-coach" href="' + esc(c.readingTapeUrl) + '" target="_blank" rel="noopener">\\uD83C\\uDFA7 Reading the Tape</a>';
  res += '<a class="resbtn resbtn-verbiage" href="' + esc(VERBIAGE_URL) + '" target="_blank" rel="noopener">\\uD83D\\uDCAC Call Verbiage Field Guide</a>';
  document.getElementById('briefResources').innerHTML = res;

  document.getElementById('briefOverlay').hidden = false;
  document.body.style.overflow = 'hidden';
  document.getElementById('briefClose').focus();
}

function closeBrief() {
  var ov = document.getElementById('briefOverlay');
  if (ov.hidden) return;
  ov.hidden = true;
  document.body.style.overflow = '';
  if (lastFocusedEl && typeof lastFocusedEl.focus === 'function') lastFocusedEl.focus();
}

document.getElementById('briefClose').addEventListener('click', closeBrief);
document.getElementById('briefOverlay').addEventListener('click', function (e) {
  if (e.target === this) closeBrief();
});
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') closeBrief();
});

// Deep-link support: arriving with #c-<slug> in the URL (e.g. from Pipeline Pulse or
// Daily Priorities) auto-opens that contact's brief.
(function () {
  try {
    var h = location.hash;
    if (h && h.indexOf('#c-') === 0) {
      var slug = h.slice(3);
      if (CONTACTS[slug]) {
        setTimeout(function () { openBrief(slug); }, 60);
      }
    }
  } catch (e) {}
})();
</script>""" % (contacts_json_safe, json.dumps(VERBIAGE_URL))

old_script_pattern = re.compile(
    r"<script>\nfunction toggleRes\(id, btn\) \{\n(?:.*\n)*?</script>",
)
m = old_script_pattern.search(html)
assert m is not None, "old toggleRes script block not found"
new_html = html[:m.start()] + new_script + html[m.end():]
print('old script block replaced at', m.start())

with open('/home/claude/next-touch.html', 'w', encoding='utf-8') as f:
    f.write(new_html)

print('done, new length', len(new_html))
