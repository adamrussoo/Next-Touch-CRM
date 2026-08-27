import re

path = '/home/claude/next-touch.html'
with open(path, encoding='utf-8') as f:
    content = f.read()

VERBIAGE_URL = "https://claude.ai/code/artifact/19d06ea7-3178-46ff-bf4d-13f1dca37906"
COACHING_URL = "https://claude.ai/code/artifact/7e63e020-1d8f-40d2-b06a-293983c5c04c"

def slugify(name):
    s = name.lower()
    s = re.sub(r'[^a-z0-9]+', '-', s).strip('-')
    return s

card_re = re.compile(r'    <div class="card (high|med|low)">\n(.*?)\n    </div>\n', re.DOTALL)

count = 0
def repl(m):
    global count
    tier, body = m.group(1), m.group(2)
    name_m = re.search(r'<div class="name">(.*?)</div>', body)
    name = name_m.group(1)
    slug = slugify(name)
    count += 1

    brief_m = re.search(r'href="([^"]+)"><strong>Full contact brief', body)
    brief_url = brief_m.group(1) if brief_m else None

    # swap the plain name div for a clickable toggle button
    new_body = body.replace(
        f'<div class="name">{name}</div>',
        f'<button type="button" class="name-btn" onclick="toggleRes(\'res-{slug}\', this)">{name}<span class="chev">&#9656;</span></button>',
        1
    )

    buttons = []
    if brief_url:
        buttons.append(f'<a class="resbtn resbtn-brief" href="{brief_url}" target="_blank" rel="noopener">&#128203; Full Contact Brief</a>')
    if name == 'Nathan Moser':
        buttons.append(f'<a class="resbtn resbtn-coach" href="{COACHING_URL}" target="_blank" rel="noopener">&#127908; Call Coaching &mdash; Reading the Tape</a>')
    buttons.append(f'<a class="resbtn resbtn-verbiage" href="{VERBIAGE_URL}" target="_blank" rel="noopener">&#128172; Call Verbiage Field Guide</a>')

    brief_note = '' if brief_url else '<p class="res-note">No dedicated contact brief yet &mdash; built automatically the next time ' + name.split()[0] + ' has further activity. Full context is in the notes above.</p>'

    resources = (
        f'    <div class="resources" id="res-{slug}" hidden>\n'
        f'      <div class="resources-label">Profile &amp; training resources</div>\n'
        f'      <div class="resources-row">{"".join(buttons)}</div>\n'
        f'      {brief_note}\n'
        f'    </div>\n'
    )

    return f'    <div class="card {tier}" id="c-{slug}">\n{new_body}\n{resources}    </div>\n'

content2 = card_re.sub(repl, content)
print("cards transformed:", count)

with open(path, 'w', encoding='utf-8') as f:
    f.write(content2)
