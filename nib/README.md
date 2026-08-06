# Nib 🖋

<img src="icon.png" alt="nib icon" height="64" style="float: left; margin-right: 24px;">

<img src="../_images/nib.webp" alt="nib screenshot" width="640">

**⬇ Download:** [nib-0.1.10.dmg](https://github.com/tarwin/tinyjsapp-examples/releases/download/nib-v0.1.10/nib-0.1.10.dmg) **(5.5 MB)** — prebuilt, signed & notarized; open and drag to Applications.

A tiny Markdown editor — one native window per document. Plain JavaScript,
zero dependencies, including the Markdown renderer.

The main window is a little Welcome screen (recent files and folders, a
dropzone, a draft-recovery card) that steps aside the moment you have a
document open and comes back when the last one closes — everything on it is
in the File menu too, **Open Recent** included. Bring it up any time with
**⌘0**; it resizes, and keeps the size you leave it at. Every `.md` you open gets a window with an
editor/preview split (**⌘1 / ⌘2 / ⌘3**, draggable divider, synced scrolling)
and a slide-in **outline** of the document's headings (**⌘⇧O**) that scrolls
the preview and moves the editor's caret together. Open files however you
like: **⌘O**, drop them on any Nib window, double-click them in Finder, drop
them on the Dock icon, or type `nib notes.md` — one handler answers all five
(see the bottom of this file). Markdown under any of its names opens
(`.markdown`, `.mdown`, `.mkdn`, `.mkd`, `.mdwn`, `.mdtxt`, `.mdtext`), and so
do the markdown-with-extras formats — `.mdx`, `.qmd`, `.Rmd`, `.mdc` — whose
extra syntax simply shows as text. `.adoc` / `.asciidoc` opens too: the
everyday AsciiDoc constructs are mapped line-for-line onto Markdown for the
preview (`adoc.js`), read-only — the Editable toggle stays off there, because
serializing the preview back would write Markdown into an AsciiDoc file.

**Preview ▸ Markdown Flavor** holds the extras over CommonMark, each with its own
toggle and GitHub / CommonMark presets (kept with the folder's settings when a
project owns them): GitHub alerts (`> [!NOTE]`), math — `$x$`, `$$…$$` and
` ```math `, compiled to **native MathML** by a vendored [Temml](https://temml.org),
so exported HTML and print carry real markup with no script — ` ```mermaid `
diagrams drawn by a vendored [Mermaid](https://mermaid.js.org) and **themed from
the active preview theme** (Paper gets ink-on-paper diagrams, Night gets night
ones), emoji shortcodes (`:tada:` → 🎉, the emojibase GitHub set, generated into
`vendor/emoji-github.js` one file per preset), and footnotes (`[^1]`). Math,
diagrams and the shortcode table lazy-load on first use, so a plain document
never pays for them; in the editable preview, formulas and diagrams are atomic
islands that round-trip through `unmd.js` untouched. Preview themes (**Preview ▸ Theme**: Paper, Ink,
Typewriter, Night) follow the document everywhere it goes: the live preview,
**Print** (**⌘⇧P**), **Save as PDF** and **Export as HTML**, which writes a
standalone themed file. So do the rest of the reading options — **Page
Width** (Narrow to Full), **Image Captions** (each picture's alt text printed
underneath), **Center Images** and **Click Image to Zoom** — because each one
is a class or a custom property on the article the exporter clones. With
Editable on, clicking a picture (or its caption) opens a small bar whose alt
field is live: type in it and the caption changes under your cursor. The app's own chrome is a
separate axis — **View ▸ Appearance**: Light, Dark, or Match System. Task-list checkboxes are clickable in the preview and edit the source
line.

Images can be pasted (**⌘V**), dropped, or picked (**⌘⇧I**), and
**Format ▸ Image & Path Settings…** decides what happens to them: *where* they land
(beside the document, in an `images/` folder next to it, or one at the project
root), *what a pasted one is called* — the document plus **the heading your
caret is under**, so a screenshot pasted under “Installing on macOS” becomes
`guide-installing-on-macos-1.png` — and whether they're **optimized** on the
way in. That last one is a canvas: decode, redraw at a capped width, re-encode.
No native tool is involved, because none exists on all three platforms (`sips`
is macOS-only) — and the format is probed rather than assumed, since WebKit
still has no WebP *encoder* on macOS even though it renders them happily, so
“Convert” honestly says JPEG there. SVG and animated GIF are never touched, and
a re-encode that comes out bigger than the original is thrown away (a 1.8 MB
screenshot became 133 KB; a four-pixel PNG kept its own bytes). The sheet shows
the exact path the next paste will write, and shows itself once — the first
time you paste into a folder — because a preference nobody discovers is not a
preference. **A picture dropped on a document is a paste**, at the point you
dropped it: the webview never sees the file (a native drop carries only paths)
but it does see the drag go past, so the last `dragover` is what moves the
caret. Only **Insert Image…** keeps the file's own name, because there you
picked it.

Naming has a fourth answer beyond the built-in three: a **custom template**.
`{doc}-{heading}` is the default shape, and the variables reach everything the
editor knows about where a picture is going: `{name}` (the file's own stem, for
drops and Insert), `{date}` / `{time}`, `{dir}` `{dir2}`… (folders counted up
from the document, stopping at the project root), `{path}` (the whole relative
run, dashed), and the **pins** — `{pin}` is the closest pinned folder above the
document, `{pintop}` the outermost, `{pin2}`… counted down from the top, and
`{pinpath}` the way from the pin to the document. Every variable slugs itself,
unknown ones vanish, and the doubled dashes they leave collapse — the sheet's
sample line shows exactly what the next paste becomes. With a template set it
renames *all* three ways in (that's what it's for); `{name}` is how an inserted
file's own name survives.

Pictures already **in** the folder get the same treatment by right-click:
**Optimize Picture…** on an image in the file list (or *Optimize N Pictures
Here…* on a directory) opens a squoosh-style bench — the preview *is* the
re-encode, split against the original under a draggable divider, with format /
quality / max-width controls and the honest byte count underneath. Tune the
first one, then **This + the Rest** runs the same settings over the remainder
without stopping again (Skip and per-picture Optimize stay available; a
re-encode that comes out bigger is skipped automatically). Files are replaced
where they sit; converting the format renames them (`shot.png` → `shot.webp`),
open tabs follow, and one summed question at the end offers to update every
link in the folder that still points at the old names — the same machinery as
a rename in the tree.

A target with a space or a parenthesis in it — `![](</assets/image (14).png>)` —
is written in **angle brackets**, which is the only spelling that parses,
here or anywhere else. Nib reads that form now (it previously rendered the
whole thing as literal text), colours it, follows it, re-aims it on a rename
keeping the brackets, and *writes* it: a picture called `Screen Shot 2026.png`
dropped into a document comes out bracketed rather than broken, and the
editable preview serializes it back the same way.

The same sheet answers the other question a folder full of Markdown has:
**what a leading `/` means** — and it is two questions, not one. A site with
its sources in `src/` writes `[home](/index.md)` meaning `src/index.md`, and
`![](/images/logo.png)` meaning `src/assets/images/logo.png`. So there are two
roots, one for pictures and one for links, and they are used everywhere a path
is resolved: the preview's images, a followed link, and the rename rewriter —
which puts a root-relative link back **as** a root-relative link, re-derived,
rather than flattening it to `../../`. Both readings are always tried, mapped
first and the literal filesystem path second, so the mapping adds a meaning
instead of taking one away. And because these belong to the folder, the sheet
is also where you tick **Keep these in the folder** — the same switch as
File ▸ Save Settings in Folder, met where it makes sense: untick it and Nib
never reads or writes anything inside your folder.

Links are places to go. With Editable off a click in the preview follows one;
with the caret live in the preview — or over in the raw source, where every
click is a caret — **⌥-click** does it. Holding ⌥ marks the links in both panes
and gives the pointer a browser's hand over them, which in the source pane
takes some doing: a textarea has nothing to hover. The coloured backdrop
underneath does, though — `hl.js` wraps every link in a span carrying the
target it already parsed — so the pointer is hit-tested against those boxes
(the row found by binary search, because this runs on `mousemove`), and the
same span tells the click what it landed on. A `.md` or a picture opens as a
tab here, a `#heading` scrolls, `https:` goes to your browser, and a PDF or a
folder goes to whatever the system opens it with; a link pointing at nothing
says so rather than doing nothing.

**Find** (**⌘F**) is a bar over the document rather than a dialog, with
**⌘G / ⇧⌘G** to step, a live match count, **Aa**, whole-word and **`.*`** —
a real regular expression, groups and all, with `$1` usable in the
replacement. Replace unfolds underneath it (**⌥⌘F**), and both Replace and
Replace All land in Nib's own undo history, so **⌘Z** takes a whole
Replace All back in one step.

**Undo** (**⌘Z / ⌘⇧Z**) is Nib's own, because the textarea's native history
can't survive this app: a tab switch, a Live-mode serialize, or a rename
rewriting links each assign `ed.value` and wipe it, and the editable
preview's edits never enter it at all. `undo.js` keeps one history **per
tab**, built from diffs — the buffer against its last recorded state, common
prefix and suffix trimmed, only the changed span kept — so a keystroke costs
its characters, not a copy of the document. The recorder watches the buffer
once a second rather than hooking every mutation site, which is what makes
typing in either pane, Replace All, a ticked checkbox and a rename's rewrite
all equally undoable; close-together records merge so undo takes back a
burst, not a character, and each tab's history is capped (~1 MB, oldest
steps out). Every match is highlighted in the source at
once and the current one is picked out, which is the Custom Highlight API
again — the textarea can't hold a highlight, but the coloured backdrop under
it can.

**⌘⇧F** asks the same question of the whole folder. The file tree's panel
turns into the results: grouped by file, a line number and the matched line
for each hit, one click to preview a hit in place and a double-click to keep
it — and either way the editor lands **on** the match. **Replace All** there
writes to the files on disk after asking, skipping (and naming) any file with
unsaved changes rather than writing under your buffer; a file you have open
catches up on screen. There's no index and there doesn't need to be one — VS
Code doesn't keep one either, it shells out to ripgrep — so this reads the
folder's text files in a small pool of concurrent reads and scans them, which
for a folder of documents is milliseconds.

**File ▸ Open Folder…** (**⌥⌘O** — ⌘⇧F belongs to Find in Folder) turns a
folder into a project: its files get
a tree down the left of every document window (**⌘⇧B**, and with no folder
open that panel is where you choose one), and opening one puts
it in **that window as a tab** — a strip appears along the top once a window
holds two, with a dot for unsaved work, drag to reorder, ⌘W to close the tab
(the last one closes the window) and **⌘⇧N** for a window of its own. Windows
open at whatever size you left the last one.

A folder belongs to the **windows that asked for it**, not to the app: a
window opened for one file — from Finder, the Dock, the CLI, the Welcome
screen, Help ▸ Open Example Document — says *No folder is open*, and so does a
brand-new **⌘N** document, because a window that arrives wearing a folder you
didn't ask it to open is the folder following you around. **File ▸ New Window
(Same Folder)** is the one that brings the tree, which is what that item is
for, and ⌘N *inside* a project window is a tab in the project as always. What
follows from that: the folder's own **Actions** and its `.nib/actions.json`
are offered only while a window that has the folder holds the keyboard — the
menu bar is app-wide, so it re-reads itself as focus moves between the two
kinds of window.

The tree works like an editor's, without becoming one. A single click **previews**
a file — it opens in a tab you haven't committed to, and the next preview
takes the same slot, so reading through a folder leaves one tab behind
instead of thirty; the moment you change something, double-click it, or hit
**⌘⏎**, that tab is yours to keep (a preview tab is in italics). The whole
tree is keyboard-driven: **↑↓** move and show as they go, **←→** close and
open folders, **⏎** renames the file in place (with the extension left out of
the selection), and **esc** hands the keyboard back to the editor. Right-click
gives you rename, Reveal in Finder, copy the path or the relative path, and —
because this is a Markdown editor — **Insert Link Here**, which writes the
link into the document you're in. Renaming moves the open tab, its draft and
its place in your recents with it — and then asks the second question:
*“Update 4 links to `new.md`?”*, listing the documents that still point at the
old name. Say yes and they're re-aimed, pictures (`![shot](old.png)`) as much
as documents, reference definitions (`[id]: old.md`) as much as inline links,
`#fragments` kept, and a renamed *folder* carrying its whole subtree. Links are
matched by where they RESOLVE, not by how they read, so `../notes/todo.md` is
found and an unrelated `todo.md` two folders away is not; code fences are left
alone; and a document you have open with unsaved changes is edited in its
buffer rather than written under you.

**Pictures open too.** A `.png` in the tree gets a tab like anything else, with
a viewer in place of the two panes (fit or actual size, its dimensions and file
size underneath) — and it renames from the same **⏎**, which is the part that
matters when the picture is one your document links to.

**⌘P** is Open Quickly over everything in the project — matched against each
file's path from the folder root, so folders narrow the list the way names do,
and a space starts another term that can land anywhere in it (`deep note` finds
`docs/deep/nested-note.md`; so does `dn`). Typing **`@`** in
either pane — source
or editable preview — brings the same picker up at the caret, inserting a
relative link, or the picture itself if you picked an image (Escape keeps the
`@` and carries on typing).

For a link to somewhere *outside* the folder there is no picker to open:
**paste a URL over selected text and the text becomes the link's label** —
`[the docs](https://…)`, in either pane, with the whitespace your
double-click swept up left outside the brackets and a target that needs
`<angle brackets>` given them. It is deliberately hard to trigger by
accident, because a paste that replaces the selection is what every other
editor does and guessing wrong is worse than not helping: the clipboard has
to hold one whitespace-free URL *with a scheme* (`www.example.com` written
into a link target would resolve as a relative path, so it isn't one), and
the selection has to look like a label — one line, not a URL itself, and not
already sitting in the `(target)` half of a link, where a paste is plainly
meant to replace the address. An `.adoc` document gets AsciiDoc's own
spelling, `https://…[the docs]`.

Both pickers know what's **inside** the documents, too. A heading index —
frontmatter `title:` plus every `#` heading, built in the background when the
folder opens and kept fresh on save (the same milliseconds-fast pooled read as
Find in Folder; no index on disk) — gives a picked file its real name as the
link text: the title if it has one, else its first largest heading, else the
filename as before. **⇥** on a file steps *into* its headings (esc steps back
out) to link a section — `[Second steps](notes/a.md#second-steps)` — and once
there's a query, matching headings ride along in the main list under a `##`
chip, so `@instal` finds the *Installing* section wherever it lives.
**Format ▸ Link Options** decides what a heading link is called: *Heading
Links Carry Their Path* labels it with the trail above it — `Setup › Alerts ›
SMS` — and the separator (`›`, `>`, `/`, `—`, `:`) is yours to pick there
too. The same menu decides how the **path** is written: relative to the
document (the default), `/from` the folder's configured root, or `/from` the
closest **pinned** folder above the document — the language-site pattern,
where everything inside a pinned `en/` writes `/sms/index.md` for
`en/sms/index.md` instead of `../../sms/index.md`. Either `/` mode falls back
to relative when the document or the target sits outside its base, so a link
is never written that couldn't resolve — and resolution learned the same
trick: a `/x` link in a document under a pin is read against that pin first,
then against the configured root, then literally, so pin-rooted links open,
preview and get re-aimed by renames like any other (pins count here even
while the search master-switch has them parked). Like the other reading
options these save app-wide, or with the folder's `.nib` settings when the
folder keeps its own. In ⌘P a
heading pick opens the file **on** that heading, like a search hit; and a
followed `file.md#heading` link now scrolls to the heading after opening the
file, instead of dropping the fragment. Folders you've opened are listed on the Welcome
screen beside the recent files, with the current one badged. A project keeps
its own theme, view mode, reading options, image handling and path roots in
`.nib/settings.json`, written only when you actually change
one, and **File ▸ Save Settings in Folder** turns that off entirely — with it
unticked Nib never reads or writes anything inside your folder. That switch is
also a tickbox at the bottom of **Image & Path Settings…**, which is where you
are actually standing when the question comes up. Printing moved
to **⌘⇧P** to make room.

**Pin a folder for search** (right-click it in the tree) and every file search
— ⌘P, the `@` picker, Find in Folder — is scoped to it instead of the whole
project. The 📌 badge on the row is the control: each click narrows what it
covers — everything, Markdown only, pictures only — and the last click takes it
off. Docs and pictures resolve separately, so `assets/` pinned for pictures and
`notes/` pinned for Markdown means `@` offers Markdown from `notes/` and images
from `assets/`. With several pins, the closest one **above the document you're
in** answers for it (pin two projects in one big folder and each searches only
itself); a document under no pin sees all the pinned folders of the right kind
together; and the palettes and the results panel always name the scope they
searched, so a short list says why it is short. Two switches sit at the top of
the folder view: a 📌 that turns the pins off and on **as a set** — they keep
their places, they just stop scoping, so you can park an arrangement without
unpinning it (pinning anything new switches them back on) — and a 👁 that is
View ▸ Show All Files in Folder within reach. The pins live in
`.nib/settings.json` (root-relative, so they travel with the folder) — unless
**Save Settings in Folder** is off, in which case they fall back to this
machine's local state with the open tabs and sidebar widths. The 📌 master
switch is *always* local: parking a shared arrangement on your machine
shouldn't unpin it for everyone.

**File ▸ Edit Folder Settings…** opens `.nib/settings.json` itself as a tab —
`.json` opens as plain source anywhere, with the preview showing it as one
highlighted code block. Saving that tab **applies it**: pins, theme, prefs take
effect the moment the file lands, exactly as if you'd used the menus — and it
works the other way too, so pinning a folder from the tree updates a clean open
settings tab in place (a tab with unsaved changes is left alone; its save
wins). The item is disabled while Save Settings in Folder is off, since that
promise — Nib touches nothing inside your folder — covers the settings file
too.

**Actions** are the buttons for everything a folder of Markdown actually needs
doing — the build, the deploy, the formatter, the three shell one-liners
living in somebody's terminal history. They come from two files, and the
difference between them is the whole design: `actions.json` in the app's data
folder is **yours**, on this machine, in every folder; `.nib/actions.json` is
the **folder's**, and it travels — clone a repo and its buttons come with it,
written by somebody else. So a folder's action is inert until you approve it,
one at a time, in a sheet that shows the real command with the variables
already filled in and where it will run. "Always Allow" is pinned to a hash of
what that action *does*: rename the button and nothing asks again, change the
command and the prompt comes back saying so. The grants live in a small SQLite
table next to the settings, and **Save Settings in Folder** governs the folder
file too — off, Nib doesn't read it at all.

They hang off the **⚡** in the toolbar (⌘⇧R), the **Actions** menu, and the
file tree's right-click, which offers the ones that are about a file and runs
them on the row you clicked. Nothing is hidden for being unavailable: a greyed
row says *needs a saved file*, *not for this file*, or *pandoc — not found*,
because the binary is resolved before the button is drawn — and it is looked
for in the places things actually live (`/opt/homebrew/bin`, `~/.local/bin`,
`~/.cargo/bin` and friends), since a GUI app inherits none of your shell's
PATH and that is otherwise the first thing everyone hits.

An action is a small JSON object. `run` is an **argv array** — `["pandoc",
"{file}", "-o", "{stem}.pdf"]` — so a path with a space in it is one argument
rather than a quoting bug; a plain string is taken as a shell line instead,
because that is what everyone types first. `type` is `"cli"` today or `"js"`,
which runs a script inside Nib's own backend with a `ctx` of the things a
script wants (`ctx.file`, `ctx.sel`, `ctx.read/write/list`, `ctx.run` to shell
out, `ctx.log`) and hands text back by returning it — the honest caveat being
that an endless loop in one of those freezes the app, which is a good reason
the approval sheet exists. `needs` (`folder` / `file` / `selection`) and
`match` (`*.md`, `docs/**`) decide when it is live; `os` and a per-OS block
(`"windows": { "run": [...] }`) let one file serve three machines. `stdin`
pipes the document or the selection in, and `output` says what to do with what
came back: show it in the drawer under the document, **replace** the document
with it (a formatter), **insert** it at the caret, open it as a new
**document**, or just a **notification**. Variables are the ones the image
templates already use — `{file} {dir} {root} {rel} {name} {stem} {ext} {doc}
{pin} {sel} {line} {heading} {date}`, `{dir1} {dir2}…` — with two deliberate
differences: nothing is slugged, and `{dir}` is a path rather than a name,
because that is what a command means by a directory. A command runs in the
pinned folder above the document by default, then the folder, then — with no
folder at all — the document's own directory, since a loose file is still a
place.

Output streams into a drawer under the document with a Stop button and the
exit code, and a run that fails opens it whatever the output mode said.

**Actions ▸ Manage Actions…** (**⌥⌘A**) is the front door: the list down the
left, one action's settings on the right, and a switcher at the top between
your file and the folder's — only the ones that exist, so a window with no
folder open is never shown a door that doesn't open. **Nothing is written
until you press Save** — a half-typed command has no business being what your
folder's actions file says — but nothing is lost either: what you have typed
stays with its action while the sheet is open, so clicking another one and
coming back finds your edit where you left it, with a dot on its row for the
unsaved change. Revert puts a row back the way the file has it; a brand-new
action is *Discard*, since it never got there. Closing, or switching to the
other file, asks once and defaults to saving. The command is one field you type naturally into, with
the argv split shown underneath as chips as you go (`echo · hello there ·
{stem}`), so the difference between one argument and three is something you
can see rather than something you have to know; ticking *run through a shell*
stores it as a shell line instead. Everything else is a labelled control —
what it needs, which files it's for, which systems, what goes in, what happens
to what comes out — and there's a **Run it now** to try it without leaving.
The `id` an action is known by (and whose approval is pinned to it) follows
the name while it is still called *New Action*, then settles and stays: rename
the button afterwards and nobody is asked to approve it again.

And because this is a text editor, the file is never far away: **Edit as
JSON…**, in the sheet, beside the file it would open, opens it as an ordinary
tab — and Nib's own `.nib/` folder is now in the file tree, so the settings
and the actions that travel with a folder are where you'd look for them
instead of hidden behind a dot. It wears a **⚙ rather than a folder**, in
quieter italics: it's Nib's corner of your folder, not something you put
there, so the eye skips it until it's what you came for. Editing either way is safe in both
directions: the sheet edits the *file*, parsing it and writing it back through
the same JSONC engine, so the comments you left in it survive being edited
through a form.

**A JSON file is source, so Nib stops pretending otherwise.** Opening one
locks the window to Editor Only — the Editor/Split/Preview buttons and the
View menu's other two modes grey out, and the mode you actually chose comes
back with the next Markdown tab — because that "preview" was only ever the
same text again inside a code block. In exchange the editor colours it
properly: keys, strings, numbers, `true`/`false`/`null`, comments, and a red
wavy underline under anything that isn't any of those, while you type.
**Format ▸ Format JSON** lays out any JSON file, and **Nib's own** files
(`.nib/settings.json` and both actions files) are laid out on every save.
Comments survive that — this is JSONC, the comments are half the point of a
config you edit by hand — and so do your blank lines; an object short enough
to fit on one line is left on one line. The formatter re-reads its own output
before it hands it over and keeps your text untouched if the data or a single
comment came out different, because rewriting a file nobody asked to have
rewritten has to be free.

Saving one of Nib's config files **parses it first, and refuses if it is
broken** — no more discovering at the next launch that a stray comma emptied
your settings. The problem shows in a bar at the bottom with the line and
column (`Expected “,” or “}” (line 12, column 5)`), and clicking it puts the
caret there; WebKit's own JSON error says only "Expected '}'" with no idea
where, so Nib parses the file itself to be able to point. Any *other* `.json`
gets the same reading with a way past it — "Save Anyway", because a
half-written file you meant to keep is your business. And when an actions
file is valid JSON but the wrong shape, the save goes through and the bar
turns into warnings naming what was dropped and why: *“Broken”: “run” must be
an argv array*.

**⌘+ and ⌘−** make the whole interface bigger or smaller — every window at
once, the help window included, remembered between launches, **⌥⌘0** back to
normal (⌘0 is the Welcome screen, and muscle memory beats consistency). It is
the **webview's own page zoom** (`tiny.win.setZoom`) rather than a bigger
font: it renders crisp at any factor, and the page simply gets a smaller
viewport, so a zoomed window reflows — wrapping its prose and its panels
honestly instead of pushing them off the edge.

**Help ▸ Introduction to Nib** (**⌘⇧H**) opens the help window: an
introduction to what Nib is for (documentation folders, linking, pinning,
the editable preview, `.nib` settings), the workflow sections — working in a
folder, find & replace, how it reads, the editable preview, the keyboard —
and the About credits, which is also where the app menu's About lands. The
formatting reference alone lives where it belongs now: **Help ▸ Open Example
Document** writes a full tour into the app's data folder and opens it as an
ordinary, editable file — every construct real instead of a static sample —
and the help window links straight to it. First launches get a one-time
banner at the top of the Welcome screen pointing at the Introduction;
reading it or dismissing it retires the banner for good, with a goodbye line
saying where it lives on.

Turn on **✎ Editable** (**⌘⇧L**) and the rendered preview takes a caret. Type
`## `, `- `, `> `, `` `code` `` or `**bold**` and it becomes the real thing as
you finish it; select anything for a floating format bubble. Every pause
serializes the DOM back to Markdown into the editor pane — so in Split you can
work from either side of the divider at once.

Keeping those two views in step is the hard part of the app, and `sync.js` is
where it lives. Every rendered block knows the source line it came from; on
top of that, each block builds a lazy character map — the rendered text is
almost a subsequence of its Markdown, so a two-pointer walk gives a monotone
rendered→source index. That's enough to mirror a **selection to the
character**: select `**a phrase**` in the source and exactly that phrase
highlights in the preview, minus its asterisks — and it works in both
directions with or without Editable on, since selecting in a plain preview
doesn't move focus off the textarea and the mirror has to notice that. Source
that renders to nothing at all — an image's whole `![…](…)` run, a link's
`](url)` tail — is blanked out before that walk, or a rendered letter would
happily match one inside an alt text or a url and drag the rest of the
paragraph a character out of step; and both ends of a selection resolve
outwards, so picking the word inside `*word*` never comes back with a star
attached.
Selections paint through the
CSS Custom Highlight API rather than wrapper spans, because the preview may be
contenteditable and a stray marker would end up in your document; carets are
measured with a collapsed Range and drawn as an overlay. Scrolling is anchored
block-to-block, never by ratio — and tabs are what make that necessary, since
a closed panel has source lines but no box at all, so anything geometric has
to climb to the nearest ancestor that's actually laid out.

Fenced code is coloured in the preview too (`code.js`: js/ts, json, python,
shell, css, html, sql, yaml, and a shared C-family lexer for go/rust/c/java/
swift) — classes only, so it survives export and print. The source pane is
syntax-coloured, which a `<textarea>` can't do by itself —
it's a transparent textarea over a rendered backdrop that has to wrap
identically, one `<div>` per line. That backdrop is also what the cursor bands
hang off. Put the cursor in the source of a hidden tab panel or a folded
`::: details` and the preview opens it to show you. With **✎ Editable** on,
clicking a picture gets you replace / alt text / remove. There's an emoji
picker in the toolbar (**⌘⇧J**), and beyond
callouts Nib renders `::: tabs` (split by `== Title` lines, switched by CSS
alone so exported HTML keeps working), `==highlight==`, YAML front-matter
as its own quiet block instead of a rule and a paragraph, and page breaks —
`\newpage` or `<!-- pagebreak -->` alone on a line (a faint dotted line on
screen, a new page under ⌘P and in exported HTML — Save as PDF stays the one
continuous page it's always been), with **Preview ▸ "---" as Page Break** to make
every dash rule one too (`***` and `___` stay rules). **Preview ▸
Page View** shows the document Google-Docs-style — sheets of paper on a desk,
each break starting a new sheet, the desk colour derived from the theme's own
page — and **Page Width** gains **A4** and **US Letter** so the sheet is real
paper. All CSS: the preview's DOM never changes, so editing and sync ride
along untouched, and print styles switch it back off (paper is paper).

The interesting part is **closing**. macOS gives an app no veto over the red
✗ — tinyjs's `onWindowClosed` fires *after* the window is gone — so instead
of pleading, Nib makes closing lossless: every edit is debounce-synced to the
backend, and a window that dies dirty leaves a draft in `tiny.store`. Reopen
the file and your changes are restored, banner and all. **⌘W** gets the
civilised three-button sheet (Save / Don't Save / Cancel), and an untitled
window that closes dirty comes back via the Welcome screen's draft card.

The techniques on show:

1. **One window per document** — the backend opens `doc.html` per file with
   `app.openWindow`, tells windows apart in api handlers via `meta.window`,
   and routes per-window control through `app.window(id)`. Menu events
   broadcast to every page; only the one with `document.hasFocus()` acts, and
   it re-asserts the View menu's checkmarks on focus so the radios follow the
   active window. The Welcome window never dies — `setHideOnClose` — it
   orders itself out while documents are up (`win.hide({ app: false })`, which
   is the one hide that doesn't take the whole app with it) and re-shows when
   the last one closes. Its two lists are also the File ▸ Open Recent submenu,
   which is why the menu bar is rebuilt with `setMenu` rather than patched —
   and why every checkmark it declares is mirrored in a `menuState` object.
2. **The dirty-state dance** — `api.sync` + `onWindowClosed` + `tiny.store`
   drafts, as above. `Save` is a two-step with the page (dialogs are
   page-side: `tiny.win.saveFile()` picks the path, the backend writes it).
3. **A safe hand-rolled renderer** — `md.js` covers the everyday Markdown set
   in ~300 lines, escapes *everything* (raw HTML is shown, never executed —
   the page holds an RPC channel with full system access), and vets URL
   schemes. Images with relative paths are served by the backend as `data:`
   URIs (`api.imageData`), so WebKit never touches `file://`; a followed link
   is resolved against the document's own folder and handed to `api.openLink`,
   which opens what Nib can show and lets the system have the rest. One
   extension rides along: `::: warning Title` … `:::` callouts, nestable,
   with `::: details` folding into a real `<details>`.
4. **Two panes, one position** — `sync.js`, as above: a block index, a lazy
   per-block character map, Custom Highlights and overlay carets for painting,
   and block-anchored scrolling. The rule throughout is that anything
   geometric must survive a subtree with no geometry.
5. **Two layers pretending to be one editor** — `hl.js` paints the coloured
   backdrop and `doc.css` keeps its metrics identical to the textarea's; every
   rendered block carries the source line it came from, which is what lets the
   outline jump and the two panes point at each other.
6. **A renderer that runs backwards** — `unmd.js` walks the preview DOM back
   into Markdown, which is what makes the editable preview possible: the
   textarea stays the document of record, written to from the other end.
   `live.js` adds the input rules and the selection bubble on top, doing its
   own DOM surgery rather than trusting `execCommand('formatBlock')` — that
   one loses the caret exactly when you need it, on an empty line.

**Nib is a command, too.** **File ▸ Install ‘nib’ Shell Command…** (also a
link at the foot of the Welcome window, since Windows and Linux run without a
menu bar) writes a shim named `nib` onto your PATH — the `code .` gesture.
Each platform gets the shim that behaves: macOS `exec open -a <the bundle>`,
because LaunchServices hands the paths to the running copy where exec'ing the
binary would boot a second Nib; Windows a `nib.cmd` onto the exe (it's
GUI-subsystem, so the prompt comes straight back) in a dir appended — raw
registry, not setx, which truncates and flattens `%VAR%` entries — to the user
PATH; Linux a `nohup … &` script in `~/.local/bin`, so a cold-started app
outlives its terminal. On macOS it tries Homebrew's bin, then `/usr/local/bin`,
then asks for an administrator once, VS Code style; running the item again is
the repair for a moved app. (`tinyjs build --cli nib` writes the same idea to
`dist/bin/nib` at build time.) Once it's on your PATH:

```sh
nib notes.md            # opens it, in the copy that's already running
nib .                   # the folder becomes the project
nib . README.md         # both: the tree comes up with the file in it
```

That works because tinyjs 0.30 hands **argv to `onOpenFiles`** on all three
platforms, so the same handler answers the terminal, Finder, the Dock icon and
a drop on the window. Nib had one thing to add: a path that arrives from a
shell is not the shape the rest of the app compares against — `nib .` resolves
to `/work/notes/.`, and a project root with a dot on the end matches none of
its own files — so every incoming path is tidied first (`.` and `..` resolved,
separators normalised, which is also what makes Windows' backslashes land in a
codebase that cuts paths on `/`). Arguments that aren't paths are dropped
before they get here, so `nib --verbose` doesn't open a document called
`--verbose`.

A **folder** is a different verb from a file — "make this the project", not
"open this document" — and it now arrives by every route, because
`"openFolders": true` puts `public.folder` in the bundle's document types
(`inode/directory` in the `.desktop` on Linux). So dropping a folder on the
Dock icon, "Open With ▸ Nib" on a folder, and `nib .` all mean the same thing.

Double-clicking a `.md` file has always worked once Nib is built —
`"fileExtensions": ["md", "markdown"]` claims the type — but being *in* the
Open With list is not the same as being the *default*, and that switch is the
user's to throw. **File ▸ Open .md Files with Nib…** does what each platform
allows: Linux has a command (`app.setAsDefaultHandler`), macOS and Windows
answer `'unsupported'` on purpose, so Nib says plainly where the switch is
instead of pretending to have thrown it. It's a menu item and not a question on
first launch, for the same reason tinyjs won't do it automatically — an app
that claims `.md` the moment you open it is an app you uninstall.

```sh
tinyjs dev             # run with hot reload — then Help ▸ Open Example Document
tinyjs build           # package dist/Nib.app
tinyjs build --cli nib # …and dist/bin/nib, for the terminal
ln -sf "$(pwd)/dist/bin/nib" /usr/local/bin/nib
```
