# TinySlaq 💬

A Slack-style chat clone — a UI demo of how far one tinyjs window and a
SQLite file can go. (Not affiliated with Slack.)

<img src="../_images/tinyslaq.webp" alt="TinySlaq screenshot" width="640">

Multiple colored **workspaces** and accounts, **channels and DMs**, messages
persisted in SQLite (`tjs:sqlite`), and a "post as" switcher so you can hold
both sides of a conversation. DMs get **canned auto-replies** pushed live over
the bridge a beat after you send — and if a reply lands in a channel you're
not looking at, a **desktop notification** tells you about it.

```sh
tinyjs dev      # run with hot reload
tinyjs build    # package dist/TinySlaq.app
```

Or skip the toolchain: **[tinyslaq-0.1.0.dmg](https://github.com/tarwin/tinyjsapp-examples/raw/main/_builds/tinyslaq-0.1.0.dmg)** (4.6 MB)
is a prebuilt, signed & notarized copy — open and drag to Applications.
