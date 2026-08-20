# Welcome to amp

amp is a music player built as a rack of hi-fi separates. Each window is a
component. The deck, the playlist, the equalizer, the radio tuner, the podcast
shelf, the visualizer. Drag one near another and they snap together and move as
one stack. Pull one away and it goes its own way again.

Everything it plays comes off your own disk or a stream you chose. There is no
account, no library service, and nothing phones home.

## The windows

| | |
|---|---|
| Deck | transport, volume, the LCD. Right-click anywhere on it for the full menu. |
| Playlist | what's queued. Drag files or folders onto it. |
| Equalizer | ten bands plus a preamp, with per-track auto-EQ. |
| Radio | thousands of stations, browsable by place on a globe. |
| Podcasts | subscribe, download for offline, resume where you left off. |
| Track info | tags, cover art, and what amp could find out about the recording. |
| Visualizer | Milkdrop, Geiss HDR, amp's own engines, and any you write. |
| Big screen | the whole rig, fullscreen. |

Windows scattered across the desktop? Right-click the deck, then Arrange, then
Open All & Arrange. That puts the classic docked rig back together.

## Formats

MP3, M4A/AAC, FLAC, WAV, AIFF, CAF, Ogg and Opus. Also tracker modules, meaning
MOD, S3M, XM and IT, and MIDI, which amp renders itself using a SoundFont it
downloads the first time you play one. amp reads `.cue` sheets too, so a
single-file album rip splits into its real tracks.

## Making it your own

The visualizer takes plugins. One folder, one JS file, and it turns up in the
picker beside the built-in engines. A plugin runs sandboxed with no access to
your files, so installing one is a question of taste rather than trust. See
[Writing a visualizer](doc:20-visualizers).
