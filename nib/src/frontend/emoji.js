// A small emoji picker for the toolbar. Deliberately curated rather than
// exhaustive — a few hundred of the ones people actually reach for in notes,
// grouped, searchable by keyword, and inserted wherever the caret is (the
// textarea or the editable preview; the caller decides how to insert).
//
// Zero dependencies, no font files: these are plain characters, and the
// system draws them.

(() => {
  // group: [glyph label, [[emoji, keywords], …]]
  const GROUPS = [
    ['🙂', 'Smileys', `
      😀 grin smile happy | 😃 smiley happy | 😄 laugh happy | 😁 beam grin |
      😆 laugh squint | 😅 sweat laugh | 🤣 rofl laugh | 😂 joy tears laugh |
      🙂 slight smile | 🙃 upside down | 😉 wink | 😊 blush smile |
      😇 halo angel | 🥰 love hearts | 😍 heart eyes love | 🤩 star struck |
      😘 kiss | 😋 yum tasty | 😛 tongue | 🤪 zany crazy | 🤨 raised eyebrow |
      🧐 monocle | 🤓 nerd geek | 😎 cool sunglasses | 🥳 party celebrate |
      🙁 frown sad | 😕 confused | 😟 worried | 😢 cry sad | 😭 sob cry |
      😤 huff triumph | 😠 angry | 😡 rage mad | 🤯 mind blown | 😱 scream |
      😳 flushed | 🥺 pleading | 😴 sleep zzz | 🤔 thinking hmm |
      🤫 shush quiet | 🤭 oops giggle | 😬 grimace awkward | 🙄 eye roll |
      😶 no mouth blank | 😐 neutral | 😑 expressionless | 🤐 zipper secret |
      🤢 sick nausea | 🤒 ill thermometer | 🤕 hurt bandage | 🥱 yawn bored |
      😵 dizzy | 🫠 melting | 🫡 salute | 🤝 handshake deal | 👻 ghost |
      💀 skull dead | 🤖 robot bot | 👽 alien | 🎃 pumpkin halloween |
      😺 cat happy | 🙈 see no evil monkey | 🙉 hear no evil | 🙊 speak no evil`],

    ['👍', 'People', `
      👍 thumbs up yes good | 👎 thumbs down no bad | 👏 clap applause |
      🙌 raise hands praise | 👌 ok perfect | 🤌 pinch chef | ✌️ peace victory |
      🤞 fingers crossed luck | 🤟 love you | 🤘 rock horns | 👋 wave hi bye |
      🤙 call shaka | 💪 muscle strong | 🦾 mechanical arm | 🙏 pray thanks please |
      ✍️ writing hand | 👀 eyes look | 🧠 brain mind | 👉 point right |
      👈 point left | 👆 point up | 👇 point down | ☝️ index up |
      ✋ hand stop | 🖐️ hand five | 🤚 raised back hand | 🫶 heart hands |
      🧑‍💻 developer coder | 👩‍💻 woman coder | 👨‍💻 man coder |
      🧑‍🎨 artist | 🧑‍🏫 teacher | 🕵️ detective search | 🦸 hero |
      🧙 wizard magic | 🧑‍🚀 astronaut space | 💁 info desk | 🤷 shrug dunno |
      🤦 facepalm | 🙋 raise hand ask | 🧘 meditate calm | 🏃 run |
      🚶 walk | 💃 dance | 🕺 dance man | 👶 baby | 🧓 old`],

    ['🐈', 'Nature', `
      🐶 dog puppy | 🐱 cat kitten | 🐭 mouse | 🐹 hamster | 🐰 rabbit bunny |
      🦊 fox | 🐻 bear | 🐼 panda | 🐨 koala | 🐯 tiger | 🦁 lion |
      🐮 cow | 🐷 pig | 🐸 frog | 🐵 monkey | 🐔 chicken | 🐧 penguin |
      🐦 bird | 🦆 duck | 🦉 owl | 🦇 bat | 🐺 wolf | 🐗 boar | 🐴 horse |
      🦄 unicorn | 🐝 bee | 🐛 caterpillar | 🦋 butterfly | 🐌 snail |
      🐞 ladybug bug | 🐜 ant | 🕷️ spider | 🦂 scorpion | 🐢 turtle |
      🐍 snake | 🦎 lizard | 🐙 octopus | 🦑 squid | 🦐 shrimp | 🦀 crab |
      🐡 blowfish | 🐠 fish tropical | 🐬 dolphin | 🐳 whale | 🦈 shark |
      🐊 crocodile | 🐘 elephant | 🦒 giraffe | 🦓 zebra | 🐄 cow2 |
      🌵 cactus | 🎄 christmas tree | 🌲 evergreen | 🌳 tree | 🌴 palm |
      🌱 seedling grow | 🌿 herb leaf | ☘️ shamrock | 🍀 four leaf clover luck |
      🍁 maple leaf | 🍂 fallen leaves autumn | 🌷 tulip | 🌹 rose |
      🌺 hibiscus | 🌻 sunflower | 🌼 blossom | 🌸 cherry blossom |
      🌞 sun face | ☀️ sun sunny | 🌤️ partly sunny | ☁️ cloud | 🌧️ rain |
      ⛈️ storm | ❄️ snow cold | ⛄ snowman | 🔥 fire hot lit | 💧 drop water |
      🌊 wave ocean | 🌈 rainbow | ⭐ star | 🌙 moon night | 🪐 planet saturn`],

    ['🍎', 'Food', `
      🍏 green apple | 🍎 apple | 🍐 pear | 🍊 orange | 🍋 lemon |
      🍌 banana | 🍉 watermelon | 🍇 grapes | 🍓 strawberry | 🫐 blueberries |
      🍒 cherries | 🍑 peach | 🥭 mango | 🍍 pineapple | 🥥 coconut |
      🥝 kiwi | 🍅 tomato | 🥑 avocado | 🥦 broccoli | 🥕 carrot |
      🌽 corn | 🌶️ chilli spicy | 🥔 potato | 🍞 bread | 🥐 croissant |
      🥖 baguette | 🧀 cheese | 🥚 egg | 🍳 cooking fry | 🥞 pancakes |
      🧇 waffle | 🥓 bacon | 🍔 burger | 🍟 fries | 🍕 pizza | 🌭 hotdog |
      🥪 sandwich | 🌮 taco | 🌯 burrito | 🥗 salad | 🍝 pasta spaghetti |
      🍜 ramen noodles | 🍣 sushi | 🍤 tempura prawn | 🍚 rice | 🍛 curry |
      🍦 ice cream | 🍩 doughnut | 🍪 cookie biscuit | 🎂 birthday cake |
      🍰 cake slice | 🧁 cupcake | 🍫 chocolate | 🍬 sweet candy |
      🍿 popcorn | 🧂 salt | ☕ coffee tea | 🍵 green tea | 🧉 mate |
      🥤 soft drink | 🍺 beer | 🍻 cheers beers | 🥂 champagne toast |
      🍷 wine | 🥃 whisky | 🍸 cocktail | 🍾 bottle pop`],

    ['⚽', 'Activity', `
      ⚽ football soccer | 🏀 basketball | 🏈 american football | ⚾ baseball |
      🎾 tennis | 🏐 volleyball | 🏉 rugby | 🥏 frisbee | 🎱 pool 8ball |
      🏓 table tennis | 🏸 badminton | 🥊 boxing | 🥋 martial arts |
      ⛳ golf | 🏹 archery | 🎣 fishing | 🤿 diving | 🏊 swim | 🏄 surf |
      🚴 cycling | 🧗 climbing | ⛷️ ski | 🏂 snowboard | 🏆 trophy win |
      🥇 gold medal first | 🥈 silver second | 🥉 bronze third | 🎯 target dart |
      🎮 game controller | 🕹️ joystick arcade | 🎲 dice | ♟️ chess |
      🧩 puzzle piece | 🎨 art palette | 🎭 theatre | 🎤 mic sing |
      🎧 headphones | 🎵 music note | 🎸 guitar | 🎹 piano keys | 🥁 drum |
      🎺 trumpet | 🎻 violin | 🎬 film clapper | 📷 camera photo |
      🎉 party popper celebrate | 🎊 confetti | 🎈 balloon | 🎁 gift present`],

    ['✈️', 'Places', `
      🚗 car | 🚕 taxi | 🚌 bus | 🚑 ambulance | 🚒 fire engine |
      🚚 truck | 🚜 tractor | 🏍️ motorbike | 🚲 bicycle | 🛴 scooter |
      🚂 train steam | 🚆 train | 🚇 metro subway | 🚁 helicopter |
      ✈️ plane flight | 🚀 rocket launch ship | 🛸 ufo | ⛵ sailboat |
      🚤 speedboat | 🛳️ ship cruise | ⚓ anchor | 🗺️ map | 🧭 compass |
      🏔️ mountain | 🌋 volcano | 🏕️ camping tent | 🏖️ beach | 🏝️ island |
      🏗️ construction | 🏠 house home | 🏢 office building | 🏥 hospital |
      🏦 bank | 🏨 hotel | 🏫 school | 🏭 factory | 🗼 tower |
      🗽 statue liberty | 🗿 moai | 🎡 ferris wheel | 🎢 rollercoaster |
      🌍 earth europe globe | 🌎 earth americas | 🌏 earth asia | 🗾 japan map`],

    ['💡', 'Objects', `
      💡 idea lightbulb | 🔦 torch flashlight | 🕯️ candle | 🔥 flame |
      💻 laptop computer | 🖥️ desktop monitor | ⌨️ keyboard | 🖱️ mouse |
      🖨️ printer | 💾 floppy save | 💿 disc | 📀 dvd | 🧮 abacus |
      📱 phone mobile | ☎️ telephone | 📞 receiver call | 📟 pager |
      📠 fax | 📺 tv | 📻 radio | ⏰ alarm clock | ⌚ watch | ⏳ hourglass |
      ⏱️ stopwatch timer | 📅 calendar date | 📆 calendar | 🗓️ spiral calendar |
      📇 card index | 📈 chart up growth | 📉 chart down | 📊 bar chart |
      📋 clipboard | 📌 pushpin | 📍 round pin location | 📎 paperclip |
      🖇️ links | 📏 ruler | 📐 triangle ruler | ✂️ scissors cut |
      🗃️ file box | 🗄️ filing cabinet | 🗑️ bin trash delete | 🔒 lock secure |
      🔓 unlock | 🔑 key | 🗝️ old key | 🔨 hammer | 🪓 axe | ⛏️ pick |
      🛠️ tools | 🔧 wrench fix | 🔩 nut bolt | ⚙️ gear settings cog |
      🧰 toolbox | 🧲 magnet | 🧪 test tube experiment | 🧫 petri dish |
      🧬 dna | 🔬 microscope | 🔭 telescope | 📡 satellite antenna |
      💊 pill | 🩹 plaster bandage | 🚪 door | 🪟 window | 🛏️ bed |
      🧹 broom clean | 🧺 basket | 🧻 toilet paper | 🪣 bucket |
      📦 package box | 📫 mailbox | 📮 postbox | ✉️ envelope mail |
      📤 outbox send | 📥 inbox | 📜 scroll | 📃 page | 📄 document file |
      📑 bookmark tabs | 📒 ledger | 📕 closed book | 📖 open book read |
      📗 green book | 📘 blue book | 📙 orange book | 📚 books library |
      📓 notebook | 📔 notebook decorated | 📰 newspaper news | 🗞️ rolled news |
      ✏️ pencil | ✒️ nib pen | 🖊️ pen | 🖋️ fountain pen nib | 🖌️ paintbrush |
      🖍️ crayon | 📝 memo note write | 💼 briefcase work | 💰 money bag |
      💵 dollar cash | 💳 credit card | 🧾 receipt | 💎 gem diamond`],

    ['❤️', 'Symbols', `
      ❤️ red heart love | 🧡 orange heart | 💛 yellow heart | 💚 green heart |
      💙 blue heart | 💜 purple heart | 🖤 black heart | 🤍 white heart |
      💔 broken heart | 💕 two hearts | 💖 sparkling heart | 💗 growing heart |
      💘 heart arrow | 💝 heart ribbon | ❣️ heart exclamation | 💯 hundred perfect |
      ✅ check tick done yes | ☑️ ballot check | ✔️ heavy check |
      ❌ cross no wrong | ❎ cross mark | ⛔ no entry stop | 🚫 prohibited |
      ⚠️ warning caution | ❗ exclamation important | ❓ question |
      💤 sleep zzz | 💥 boom collision | ✨ sparkles magic | 🌟 glowing star |
      ⚡ zap lightning fast | 💫 dizzy | 🔔 bell notify | 🔕 bell off mute |
      🔊 speaker loud | 🔇 mute | 📢 loudspeaker announce | 📣 megaphone |
      ➕ plus add | ➖ minus | ✖️ multiply | ➗ divide | ♾️ infinity |
      🔁 repeat loop | 🔄 refresh sync | ▶️ play | ⏸️ pause | ⏹️ stop |
      ⏭️ next | ⏮️ previous | 🔀 shuffle | ⤴️ up right | ⤵️ down right |
      🔺 red triangle up | 🔻 red triangle down | 🔴 red circle | 🟠 orange circle |
      🟡 yellow circle | 🟢 green circle | 🔵 blue circle | 🟣 purple circle |
      ⚫ black circle | ⚪ white circle | 🟥 red square | 🟩 green square |
      🟦 blue square | ⬛ black square | ⬜ white square | 🔶 orange diamond |
      🔷 blue diamond | 🔑 key2 | ™️ trademark | ©️ copyright | ®️ registered |
      🆕 new | 🆗 ok | 🆙 up | 🆒 cool | 🆓 free | 🔝 top | 🔜 soon |
      #️⃣ hash | 1️⃣ one | 2️⃣ two | 3️⃣ three | 🕐 clock one`],
  ];

  const parsed = GROUPS.map(([icon, name, blob]) => ({
    icon, name,
    items: blob.split('|').map((chunk) => {
      const words = chunk.trim().split(/\s+/);
      return { ch: words[0], keys: words.slice(1).join(' ') };
    }).filter((e) => e.ch),
  }));

  // :shortcode: lookup for the renderer (md.js reads window.emojiByCode when
  // View ▸ Markdown Flavor ▸ Emoji Shortcodes is on). Every keyword names its
  // glyph — the full phrase with underscores, then each word, first claim
  // wins — topped up with the GitHub spellings people actually type.
  const byCode = {};
  const claim = (code, ch) => {
    code = String(code).toLowerCase();
    if (code && !(code in byCode)) byCode[code] = ch;
  };
  for (const g of parsed) {
    for (const { ch, keys } of g.items) {
      claim(keys.replace(/\s+/g, '_'), ch);
      for (const k of keys.split(/\s+/)) claim(k, ch);
    }
  }
  Object.assign(byCode, {
    '+1': '👍', '-1': '👎', thumbsup: '👍', thumbsdown: '👎',
    tada: '🎉', rocket: '🚀', sparkles: '✨', fire: '🔥', bug: '🐛',
    heart: '❤️', 100: '💯', joy: '😂', sob: '😭', smile: '😄',
    grin: '😁', wink: '😉', sweat_smile: '😅', thinking: '🤔',
    eyes: '👀', wave: '👋', pray: '🙏', clap: '👏', muscle: '💪',
    shrug: '🤷', facepalm: '🤦', warning: '⚠️', check: '✅',
    white_check_mark: '✅', x: '❌', star: '⭐', zap: '⚡',
    bulb: '💡', memo: '📝', book: '📖', lock: '🔒', key: '🔑',
    gear: '⚙️', wrench: '🔧', hammer: '🔨', package: '📦',
    bell: '🔔', mag: '🔍', link: '🔗', pencil: '✏️',
    question: '❓', exclamation: '❗', arrow_right: '➡️', arrow_left: '⬅️',
    heavy_check_mark: '✔️', red_circle: '🔴', green_circle: '🟢',
    construction: '🚧', boom: '💥', ship: '🚢', shipit: '🐿️',
    crossed_fingers: '🤞', partying_face: '🥳', skull: '💀',
  });
  window.emojiByCode = byCode;

  // The picker owns its own popover; the caller supplies `insert` and
  // decides where the character lands.
  function setupEmoji({ button, pop, search, tabs, grid, insert, recentKey }) {
    let group = 0;
    let recents = [];
    try { recents = JSON.parse(localStorage.getItem(recentKey) || '[]'); } catch { recents = []; }

    const all = parsed.flatMap((g) => g.items);
    const paint = () => {
      const q = search.value.trim().toLowerCase();
      let list;
      if (q) list = all.filter((e) => e.keys.includes(q) || e.ch === q);
      else if (group === -1) list = recents.map((ch) => ({ ch, keys: '' }));
      else list = parsed[group].items;

      grid.textContent = '';
      if (!list.length) {
        const none = document.createElement('div');
        none.id = 'emojiNone';
        none.textContent = q ? 'Nothing matches “' + q + '”' : 'Emoji you use turn up here.';
        grid.appendChild(none);
        return;
      }
      for (const e of list.slice(0, 400)) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = e.ch;
        b.title = e.keys;
        b.onclick = () => pick(e.ch);
        grid.appendChild(b);
      }
    };

    const paintTabs = () => {
      tabs.textContent = '';
      const add = (label, idx, title) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = label;
        b.title = title;
        b.className = group === idx && !search.value ? 'on' : '';
        b.onclick = () => { group = idx; search.value = ''; paintTabs(); paint(); };
        tabs.appendChild(b);
      };
      add('🕘', -1, 'Recent');
      parsed.forEach((g, i) => add(g.icon, i, g.name));
    };

    function pick(ch) {
      recents = [ch, ...recents.filter((r) => r !== ch)].slice(0, 24);
      try { localStorage.setItem(recentKey, JSON.stringify(recents)); } catch { /* private mode */ }
      insert(ch);
      close();
    }

    function open() {
      pop.hidden = false;
      const r = button.getBoundingClientRect();
      const w = pop.offsetWidth;
      pop.style.left = Math.round(Math.min(Math.max(8, r.left), innerWidth - w - 8)) + 'px';
      pop.style.top = Math.round(r.bottom + 6) + 'px';
      search.value = '';
      if (!recents.length && group === -1) group = 0;
      paintTabs();
      paint();
      search.focus();
    }
    const close = () => { pop.hidden = true; };
    const toggle = () => (pop.hidden ? open() : close());

    button.onclick = toggle;
    search.addEventListener('input', () => { paintTabs(); paint(); });
    search.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      if (e.key === 'Enter') {
        e.preventDefault();
        const first = grid.querySelector('button');
        if (first) first.click();
      }
    });
    document.addEventListener('mousedown', (e) => {
      if (!pop.hidden && !pop.contains(e.target) && e.target !== button) close();
    });
    window.addEventListener('blur', close);

    return { open, close, toggle };
  }

  window.setupEmoji = setupEmoji;
})();
