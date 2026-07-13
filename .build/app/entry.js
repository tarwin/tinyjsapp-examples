import { createApp } from './bridge.js';
import * as appMod from './src/main.js';

const FRONTEND = "/Users/tarwin/all/development/play/tiny-test1/src/frontend";

const app = await createApp({
  htmlPath: FRONTEND + '/index.html',
  title: "Tiny Deck",
  size: "1100x720",
  version: "0.1.0",
  id: "com.example.tiny-test1",
  api: appMod.api ?? {},
  onMenu: appMod.onMenu,
  onTray: appMod.onTray,
  onHotkey: appMod.onHotkey,
  onContextMenu: appMod.onContextMenu,
  onSystem: appMod.onSystem,
  update: null,
});
if (appMod.init) appMod.init(app);

let reloadTimer = null;
tjs.watch(FRONTEND, () => {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(async () => {
    try {
      await app.reload();
      console.log('tinyjs: frontend reloaded');
    } catch (e) {
      console.log('tinyjs: frontend reload failed:', String(e));
    }
  }, 150);
});

await app.done;
tjs.exit(0);
