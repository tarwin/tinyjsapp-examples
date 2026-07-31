// radio-list.js — the LIST tab's directory. Main sections generated from
// github.com/deroverda/recommended-radio-streams (CC0-1.0 / public domain,
// fetched 2026-07-31) — 'internet radio I actually listen to'. The final
// 'Lossless' section is hand-curated from hiresaudio.online's CD-quality
// directory, every stream verified live AND played in the webview (WebKit
// decodes FLAC-in-Ogg — measured; it's Vorbis it can't do). Fields:
// n/u/d/h = name, stream url, description, homepage; f:1 = the deroverda
// curator's own favourites (data only, not shown); q:1 = lossless/HQ, worn
// as a FLAC chip and matched by filtering for 'flac'. Dead streams are
// pruned by tools/check-streams.mjs --prune. a:1 = hand-added stations
// (listener tips + best-of lists, each stream verified live) — re-add
// these after any regeneration from the deroverda README.
window.RADIO_LIST = [
 {
  "g": "Ambient, Lo-Fi & Chill",
  "s": [
   {
    "n": "9128",
    "u": "https://streams.radio.co/s0aa1e6f4a/listen",
    "d": "Ambient and drone from the A Strangely Isolated Place label.",
    "h": "https://9128.live",
    "f": 1
   },
   {
    "n": "a.m. Ambient",
    "u": "http://radio.stereoscenic.com/ama-h",
    "d": "Bright, positive daytime ambient - the sister station to Ambient Sleeping Pill.",
    "h": "https://amambient.com/"
   },
   {
    "n": "Ambient Sleeping Pill",
    "u": "http://radio.stereoscenic.com/asp-h",
    "d": "Beat-free stream for sleep or focus.",
    "h": "https://stereoscenic.com/"
   },
   {
    "n": "Ambient.FM",
    "u": "https://phoebe.streamerr.co:4140/ambient.mp3",
    "d": "One person's slowed-down electronica, stretched to 19-minute tracks, entirely human-made.",
    "h": "https://ambient.fm/"
   },
   {
    "n": "Ambinature Radio",
    "u": "https://nature-rex.radioca.st/stream",
    "d": "Listener-supported nature sounds with no music, no beats, no ads, since 2015.",
    "h": "https://www.ambinature.xyz/"
   },
   {
    "n": "Birdsong FM",
    "u": "https://a1.radio.co/s5c5da6a36/listen",
    "d": "A short birdsong recording, played on a continuous loop.",
    "h": "https://www.birdsong.fm/"
   },
   {
    "n": "ChillTraxx",
    "u": "https://streamssleu.chilltrax.com/stream",
    "d": "Listener-supported downtempo and chillout, broadcast from Oakland, California.",
    "h": "https://www.chilltrax.com/"
   },
   {
    "n": "CodeRadio",
    "u": "https://coderadio-admin-v2.freecodecamp.org/listen/coderadio/radio.mp3",
    "d": "Jazzy beats to code to, from freeCodeCamp.",
    "h": "https://www.freecodecamp.org/news/code-radio/"
   },
   {
    "n": "Dark Ambient Radio",
    "u": "http://s3.viastreaming.net:8835/,",
    "d": "Dark ambient only, founded 2006, track info comes via forum comments instead of a DJ voice.",
    "h": "https://www.darkambientradio.de/news.php"
   },
   {
    "n": "Dinamo.FM - Sleep",
    "u": "http://channels.dinamo.fm/sleep-mp3",
    "d": "Ambient and downtempo from an independent broadcaster based in Istanbul.",
    "h": "https://dinamo.fm/content/4/channels"
   },
   {
    "n": "Echoes of Bluemars — Bluemars",
    "u": "http://streams.echoesofbluemars.org:8000/bluemars",
    "d": "Archived tribute to Bluemars, the ambient stream that went dark in 2013.",
    "h": "http://echoesofbluemars.org/",
    "f": 1
   },
   {
    "n": "Echoes of Bluemars — Cryosleep",
    "u": "http://streams.echoesofbluemars.org:8000/cryosleep",
    "d": "Archived tribute to Bluemars, the ambient stream that went dark in 2013.",
    "h": "http://echoesofbluemars.org/",
    "f": 1
   },
   {
    "n": "Echoes of Bluemars — Voices From Within",
    "u": "http://streams.echoesofbluemars.org:8000/voicesfromwithin",
    "d": "Archived tribute to Bluemars, the ambient stream that went dark in 2013.",
    "h": "http://echoesofbluemars.org/",
    "f": 1
   },
   {
    "n": "Fluid Radio",
    "u": "http://uk4-vn.webcast-server.net:9270/,",
    "d": "Experimental ambient and modern classical from Daniel Crossley's Bristol label, since 2010.",
    "h": "https://www.fluid-radio.co.uk/"
   },
   {
    "n": "The Kyoto Connection",
    "u": "https://server.laradio.online:59009/live",
    "d": "Japanese-inspired ambient from an Argentine band that waited 20 years to visit Japan.",
    "h": "https://www.thekyotoconnection.com/"
   },
   {
    "n": "Lofi Radio",
    "u": "https://boxradio-edge-00.streamafrica.net/lofi",
    "d": "Lo-fi beats overlapping with tracks also heard on Lofi Girl's streams.",
    "h": "https://boxradio.net/en/radio/lofi-radio"
   },
   {
    "n": "Moon Phase Radio - Ambient",
    "u": "https://cp12.serverse.com/proxy/moonphase/stream",
    "d": "Ambient, broadcasting since 2010, themed around the stillness of the moon.",
    "h": "https://www.moonphaseradio.com/"
   },
   {
    "n": "Moss Garden",
    "u": "https://radio.moss.garden/listen/moss_garden/radio.mp3",
    "d": "Ambient stream layered with listener-submitted field recordings from around the world.",
    "h": "https://moss.garden"
   },
   {
    "n": "Nordic Lodge",
    "u": "http://radio.streemlion.com:1160/stream",
    "d": "Copenhagen-based downtempo and lounge.",
    "h": "https://www.nordiclodgeradio.com/"
   },
   {
    "n": "NTS - Slow Focus",
    "u": "https://stream-mixtape-geo.ntslive.net/mixtape",
    "d": "Drone, ambient, and ragas.",
    "h": "https://www.nts.live/infinite-mixtapes/slow-focus"
   },
   {
    "n": "Psyndora - Chillout",
    "u": "https://cast.magicstreams.gr:9125/;",
    "d": "Ambient and psybient channel from a Patras, Greece psytrance station.",
    "h": "https://www.psyndora.com/chill.html"
   },
   {
    "n": "Radio Isla Negra - Slowbeat",
    "u": "https://radioislanegra.org/radio/8000/basic.aac",
    "d": "Listener-supported downtempo and ambient from Isla Negra, Chile, since 1999.",
    "h": "https://www.radioislanegra.com/"
   },
   {
    "n": "Rain & Thunderstorms Sounds",
    "u": "https://boxradio-edge-01.streamafrica.net/rain",
    "d": "Continuous rain and thunderstorm sounds for sleep and relaxation, part of the Box Radio network.",
    "h": "https://boxradio.net/en/radio/rain-thunderstorms-sounds"
   },
   {
    "n": "Sleepscapes — Rain",
    "u": "https://stream.willstare.com:8850/,",
    "d": "Rain and ocean wave sounds for sleep, from the creator of The Ultimate Art Bell archive.",
    "h": "https://www.willstare.com/sleep/"
   },
   {
    "n": "Sleepscapes — Waves",
    "u": "https://stream.willstare.com:8860/,",
    "d": "Rain and ocean wave sounds for sleep, from the creator of The Ultimate Art Bell archive.",
    "h": "https://www.willstare.com/sleep/"
   },
   {
    "n": "SomaFM - Drone Zone",
    "u": "https://somafm.com/dronezone256.pls",
    "d": "Atmospheric textures with minimal beats.",
    "h": "https://somafm.com/listen/"
   },
   {
    "n": "SomaFM - Groove Salad",
    "u": "https://somafm.com/groovesalad256.pls",
    "d": "Ambient and downtempo beats and grooves.",
    "h": "https://somafm.com/groovesalad/",
    "f": 1
   }
  ]
 },
 {
  "g": "Classical & Opera",
  "s": [
   {
    "n": "Ancient FM",
    "u": "https://mediaserv73.live-streams.nl:18058/stream",
    "d": "Medieval and Renaissance music on period instruments.",
    "h": "https://ancientfm.com/"
   },
   {
    "n": "BBC Radio 3",
    "u": "http://as-hls-ww-live.akamaized.net/pool_23461179/live/ww/bbc_radio_three/bbc_radio_three.isml/bbc_radio_three-audio%3d128000.norewind.m3u8",
    "d": "Classical, jazz, and world music from the BBC. Live concerts and the Proms.",
    "h": "https://www.bbc.co.uk/sounds/play/live/bbc_radio_three",
    "f": 1
   },
   {
    "n": "Classical California",
    "u": "https://playerservices.streamtheworld.com/api/livestream-redirect/KDFCFMAAC.aac",
    "d": "Classical from LA and San Francisco, home of SF Symphony and SF Opera broadcasts.",
    "h": "https://www.classicalcalifornia.org/"
   },
   {
    "n": "Concertzender - Baroque",
    "u": "http://streams.greenhost.nl:8080/barok",
    "d": "Independent Dutch station's baroque channel, focused on lesser-known works and period performance.",
    "h": "https://www.concertzender.nl/"
   },
   {
    "n": "CRB Classical 99.5",
    "u": "https://wgbh-live.streamguys1.com/classical-hi",
    "d": "Home of the Boston Symphony Orchestra.",
    "h": "https://www.classicalwcrb.org/"
   },
   {
    "n": "France Musique",
    "u": "http://icecast.radiofrance.fr/francemusique-hifi.aac",
    "d": "French public classical, jazz, and contemporary, with live concerts.",
    "h": "https://www.radiofrance.fr/francemusique"
   },
   {
    "n": "France Musique - La Contemporaine",
    "u": "http://icecast.radiofrance.fr/francemusiquelacontemporaine-hifi.aac",
    "d": "Contemporary classical focusing on living composers and world premieres.",
    "h": "https://www.radiofrance.fr/francemusique/radio-contemporaine"
   },
   {
    "n": "Linn Classical",
    "u": "http://radio.linn.co.uk:8004/stream",
    "d": "High fidelity classical from Linn's audiophile catalog.",
    "h": "https://www.linn.co.uk/linn-radio"
   },
   {
    "n": "MRG.fm - OperaRadio",
    "u": "http://listen.mrg.fm:8110/,",
    "d": "Opera recordings and performances.",
    "h": "https://www.w.mrg.fm/"
   },
   {
    "n": "Radio Suisse Classique",
    "u": "http://stream.srg-ssr.ch/m/rsc_fr/mp3_128",
    "d": "Swiss public radio for classical and opera.",
    "h": "https://www.radioswissclassic.ch/en"
   },
   {
    "n": "WBJC 91.5",
    "u": "https://ice64.securenetsystems.net/WBJC",
    "d": "Non-commercial classical from Baltimore, on air since 1951 with live local hosts.",
    "h": "https://www.wbjc.com/"
   },
   {
    "n": "WFMT",
    "u": "https://wfmt.streamguys1.com/main-source",
    "d": "Classical and opera from Chicago, home of Lyric Opera of Chicago broadcasts.",
    "h": "https://www.wfmt.com/"
   },
   {
    "n": "Whisperings: Solo Piano Radio",
    "u": "https://pianosolo.streamguys1.com/live",
    "d": "Started 2003 because no radio format existed for solo piano music.",
    "h": "https://www.solopianoradio.com/"
   },
   {
    "n": "WMNR",
    "u": "https://wmnr.streamguys1.com/live",
    "d": "Independent classical from Monroe, Connecticut, with live Tanglewood and BSO concert broadcasts.",
    "h": "https://www.wmnr.org/"
   },
   {
    "n": "WQXR 105.9",
    "u": "http://stream.wqxr.org/wqxr",
    "d": "New York Public Radio's classical station, live concerts from major NYC venues.",
    "h": "https://www.wqxr.org/"
   },
   {
    "n": "WQXR Q2",
    "u": "http://q2stream.wqxr.org/q2",
    "d": "Contemporary classical and experimental works.",
    "h": "https://www.wqxr.org/series/q2",
    "f": 1
   }
  ]
 },
 {
  "g": "College, Freeform & Community",
  "s": [
   {
    "n": "BFF.fm",
    "u": "http://stream.bff.fm/1/BFF.fm.mp3",
    "d": "San Francisco's Mission District, 115 volunteer DJs, short for Best Frequencies Forever.",
    "h": "https://bff.fm/"
   },
   {
    "n": "CIUT 89.5",
    "u": "https://ice23.securenetsystems.net/CIUT",
    "d": "Freeform from University of Toronto - underground electronic, jazz, and indie rock.",
    "h": "https://www.ciut.fm/"
   },
   {
    "n": "CKUT 90.3",
    "u": "https://ckut.out.airtime.pro/ckut_a",
    "d": "Volunteer-run from McGill University, aiming to be \"a mic for the mic-less.\"",
    "h": "https://ckut.ca"
   },
   {
    "n": "KALX 90.7",
    "u": "https://stream.kalx.berkeley.edu:8443/kalx-320.aac",
    "d": "Student and volunteer-run from UC Berkeley, broadcasting since 1962.",
    "h": "https://kalx.berkeley.edu/"
   },
   {
    "n": "KCRW - Eclectic24",
    "u": "https://streams.kcrw.com/e24_mp3",
    "d": "KCRW's continuous music stream from Santa Monica - the public station's DJs, no talk breaks.",
    "h": "https://www.kcrw.com/",
    "f": 1
   },
   {
    "n": "KFJC 89.7",
    "u": "http://netcast.kfjc.org/kfjc-320k-aac",
    "d": "Foothill College teaching lab, experimental audio art, 8 station hours weekly to earn airtime.",
    "h": "https://kfjc.org",
    "f": 1
   },
   {
    "n": "KSPC 88.7",
    "u": "https://kspc.radioca.st/stream",
    "d": "Claremont student-run featuring underground music and non-commercial culture.",
    "h": "https://kspc.org/"
   },
   {
    "n": "KUSF",
    "u": "https://listen.kusf.org/stream",
    "d": "Student-run freeform from USF. Internet-only since losing its FM signal in 2011.",
    "h": "https://www.kusf.org"
   },
   {
    "n": "KUTX 98.9",
    "u": "https://streams.kut.org/4428_192.mp3",
    "d": "Austin public radio. Indie rock, Americana, and Texas music.",
    "h": "https://kutx.org"
   },
   {
    "n": "KVRX 91.7",
    "u": "https://kvrx.org/now_playing/stream",
    "d": "Student-run freeform from UT Austin.",
    "h": "https://kvrx.org/"
   },
   {
    "n": "KXLU 88.9",
    "u": "https://kxlu.streamguys1.com/kxlu-hi",
    "d": "Los Angeles student-run, focused on underground rock and independent sets.",
    "h": "https://kxlu.com/"
   },
   {
    "n": "KZSC 88.1",
    "u": "https://kzscfms1-geckohost.radioca.st/kzschigh",
    "d": "Community and student radio from Santa Cruz.",
    "h": "https://kzsc.org"
   },
   {
    "n": "Prun'",
    "u": "https://www.prun.net/stream",
    "d": "Ad-free student radio from Nantes, covering emerging artists across groove, hip-hop, funk, and electronic, since 1999.",
    "h": "https://www.prun.net/"
   },
   {
    "n": "KZSU Stanford 90.1",
    "u": "http://kzsu-streams.stanford.edu/kzsu-1-256.mp3",
    "d": "Student-run from Stanford, with a 80,000-disc library and an annual Day of Noise.",
    "h": "https://kzsu.stanford.edu"
   },
   {
    "n": "Radio KRŠ",
    "u": "https://stream.radiokrs.me:8443/lq.mp3",
    "d": "Montenegro's first student station, since 2014, slogan translates to 'We break the silence.'",
    "h": "https://radiokrs.com/"
   },
   {
    "n": "Subcity Radio",
    "u": "https://stream.subcity.org/listen",
    "d": "No-playlist student collective from the University of Glasgow, 200+ contributors since 1995.",
    "h": "https://subcity.org/"
   },
   {
    "n": "UCT Radio",
    "u": "https://edge.iono.fm/xice/uctradio_live_high.aac",
    "d": "Student-run from the University of Cape Town since 1976, with a strict South African music quota.",
    "h": "https://www.uct.ac.za/radio"
   },
   {
    "n": "WFMU - Rock 'n' Soul",
    "u": "http://wfmu.org/wfmu_rock.pls",
    "d": "Rock, R&B, and soul.",
    "h": "https://wfmu.org/"
   },
   {
    "n": "WFMU - Sheena's Jungle Room",
    "u": "http://stream0.wfmu.org/sheena",
    "d": "Garage, surf, and rockabilly.",
    "h": "https://wfmu.org/"
   },
   {
    "n": "WFMU 91.1",
    "u": "https://wfmu.org/wfmu.pls",
    "d": "The longest-running freeform station in the US, Jersey City since 1958.",
    "h": "https://wfmu.org"
   },
   {
    "n": "WMSE 91.7",
    "u": "https://wmse.streamguys1.com/wmselivemp3",
    "d": "From Milwaukee School of Engineering, anti-established since 1981.",
    "h": "https://wmse.org/"
   },
   {
    "n": "WNCW 88.7",
    "u": "https://wncw-live-a.edge.audiocdn.com/6286_56k.aac",
    "d": "Americana, roots, and folk from Isothermal Community College in the North Carolina foothills, since 1989.",
    "h": "https://www.wncw.org/"
   },
   {
    "n": "WRIR 97.3",
    "u": "https://live.wrir.org/",
    "d": "All-volunteer low-power FM from Richmond, playing what other stations won't, since 2005.",
    "h": "https://wrir.org"
   },
   {
    "n": "WSUM 91.7",
    "u": "https://ice23.securenetsystems.net/WSUMFM",
    "d": "Student-run from UW-Madison, named Best College Station in the Nation by IBS.",
    "h": "https://wsum.org/"
   },
   {
    "n": "WTJU 91.1",
    "u": "https://streams.wtju.net/wtju-live.mp3",
    "d": "Classical to jazz to folk from the University of Virginia.",
    "h": "https://wtju.net"
   },
   {
    "n": "WXTJ 100.1",
    "u": "https://streams.wtju.net/wxtj-live.mp3",
    "d": "Student-run freeform sister station to WTJU.",
    "h": "https://www.wxtj.fm/"
   },
   {
    "n": "WXYC 89.3",
    "u": "https://audio-mp3.ibiblio.org/wxyc.mp3",
    "d": "From UNC Chapel Hill, first to stream online, in 1994.",
    "h": "https://wxyc.org/",
    "f": 1
   },
   {
    "n": "WZRD 88.3",
    "u": "https://wzrd.streamguys1.com/live",
    "d": "Freeform from Northeastern Illinois University, students and alumni on air since 1974.",
    "h": "https://wzrdchicago.org/"
   },
   {
    "n": "313.FM",
    "u": "http://icecast.ofdoom.com:8000/burst.mp3",
    "d": "Electronic music born in the depths of a Detroit warehouse.",
    "h": "https://www.313.fm/"
   },
   {
    "n": "8 Ball Radio",
    "u": "https://eightball.out.airtime.pro/eightball_a",
    "d": "NYC artist collective running radio, zines, and public-access TV from Chinatown since 2014.",
    "h": "https://8ballradio.nyc"
   },
   {
    "n": "8Radio.com",
    "u": "https://edge4.audioxi.com/8RADIO",
    "d": "Independent alternative from Dublin, founded in 2013 by ex-Phantom FM's Simon Maher.",
    "h": "https://8radio.com/"
   },
   {
    "n": "Aaja Music — Channel 1",
    "u": "https://aaja.radiocult.fm/stream",
    "d": "Electronic and DJ sets from a bar in a Deptford railway arch, London.",
    "h": "https://aajamusic.com/"
   },
   {
    "n": "Aaja Music — Channel 2",
    "u": "https://aaja-2.radiocult.fm/stream",
    "d": "Electronic and DJ sets from a bar in a Deptford railway arch, London.",
    "h": "https://aajamusic.com/"
   },
   {
    "n": "Amplitudes Radio",
    "u": "https://listen.radioking.com/radio/591304/stream/654688",
    "d": "DJ sets and regional culture from a Bordeaux-area collective.",
    "h": "https://amplitudesradio.com/"
   },
   {
    "n": "Bangkok Community Radio (BCR)",
    "u": "https://bcr.radiocult.fm/stream",
    "d": "Underground electronic from a studio above a Bangkok record shop, since 2021.",
    "h": "https://www.bangkokcommunityradio.com/"
   },
   {
    "n": "Behind Loud Tracks",
    "u": "https://play.radioking.io/blt-radio",
    "d": "French friends' collective for music discovery, sharing, and sound creation, launched 2025.",
    "h": "https://blt-radio.com/"
   },
   {
    "n": "Black Rhino Radio",
    "u": "https://blackrhinoradio.out.airtime.pro/blackrhinoradio_a",
    "d": "Music and arts collective from Bucharest, broadcasting dub, bass, jazz, and hip-hop.",
    "h": "https://blackrhinoradio.com/"
   },
   {
    "n": "Cashmere Radio",
    "u": "https://cashmereradio.out.airtime.pro/cashmereradio_a",
    "d": "Experimental not-for-profit from Berlin, treating radio itself as the art form.",
    "h": "https://cashmereradio.com"
   },
   {
    "n": "Clyde Built Radio",
    "u": "https://clydebuiltradio.out.airtime.pro/clydebuiltradio_a",
    "d": "Glasgow music from a tiny studio in the Barras Market, since 2020.",
    "h": "https://www.clydebuiltradio.com/"
   },
   {
    "n": "Dandelion Radio",
    "u": "https://www.dandelionradio.com/DandelionRadio.pls",
    "d": "Inspired by John Peel, home of the Festive 50 since 2006.",
    "h": "https://dandelionradio.com/",
    "f": 1
   },
   {
    "n": "Datafruits",
    "u": "https://streampusher-relay.club/datafruits.mp3",
    "d": "Cooperative freeform net radio with minimal curation, listener-supported since 2012.",
    "h": "https://datafruits.fm/"
   },
   {
    "n": "Depa Radio",
    "u": "https://servidor15-2.brlogic.com:7006/live",
    "d": "Broadcasts 24/7 live from the booth at Departamento, a bar in Roma, Mexico City, documenting the venue's DJ sets and live sessions in real time.",
    "h": "https://www.depa.radio/"
   },
   {
    "n": "DIA!",
    "u": "https://livestream.diaradio.live/main",
    "d": "Basque-language music and culture from Saint-Jean-de-Luz, launched at a festival in 2019.",
    "h": "https://www.diaradio.live/"
   },
   {
    "n": "Dial Radio",
    "u": "https://cast.dialradio.live/stream.aac",
    "d": "No accounts, no DJs, anyone contributes a playlist for one of four daily time slots.",
    "h": "https://dialradio.live/"
   },
   {
    "n": "Do!! You!!! Radio",
    "u": "https://doyouworld.out.airtime.pro/doyouworld_a",
    "d": "Started by ex-NTS breakfast host Charlie Bones in 2021.",
    "h": "https://doyou.world/"
   },
   {
    "n": "dublab",
    "u": "http://dublab.out.airtime.pro:8000/dublab_a",
    "d": "Future roots music from a Los Angeles non-profit, since 1999.",
    "h": "https://dublab.com",
    "f": 1
   },
   {
    "n": "Dublin Digital Radio",
    "u": "https://dublin-digital-radio.radiocult.fm/stream",
    "d": "Award-winning volunteer community radio from Dublin, covering music, art, and politics since 2016.",
    "h": "https://listen.dublindigitalradio.com/",
    "f": 1
   },
   {
    "n": "The Dump",
    "u": "https://radio.turbo.net.au/stream-hq",
    "d": "Obscure music across genres, intentionally unpolished.",
    "h": "https://www.thedumpradio.com/"
   },
   {
    "n": "East Village Radio",
    "u": "https://east-village-radio.radiocult.fm/stream",
    "d": "Freeform NYC station that began in 2003 as a low-power FM signal out of a 1st Avenue shopfront studio, with past hosts including Andy Rourke of The Smiths and Mark Ronson.",
    "h": "https://eastvillageradio.com/"
   },
   {
    "n": "Fade Radio",
    "u": "https://stream.radiojar.com/072mdmpbfq8uv",
    "d": "DJ sets, live performances, podcasts, and art projects from an independent Athens outlet.",
    "h": "https://fade.radio/"
   },
   {
    "n": "Fango Radio",
    "u": "https://pantano.ovh:8444/pantano",
    "d": "Unusual and rarely-heard music, words, and sounds from Pistoia, Tuscany.",
    "h": "https://www.fangoradio.com/"
   },
   {
    "n": "fbi.radio",
    "u": "https://streamer.fbiradio.com/stream",
    "d": "Sydney's independent non-profit, half Australian music, half of that from Sydney, since 2003.",
    "h": "https://www.fbi.radio/"
   },
   {
    "n": "Foundation FM",
    "u": "https://streamer.radio.co/s0628bdd53/listen",
    "d": "House, garage, and bass from a women and queer-led London collective.",
    "h": "https://foundation.fm/"
   },
   {
    "n": "Fritto FM",
    "u": "https://frittofm2020.out.airtime.pro/frittofm2020_a",
    "d": "Community-built from Milan, hosting live shows and mixes from emerging local artists, since 2015.",
    "h": "https://fritto.fm/"
   },
   {
    "n": "Gatekeeper Radio",
    "u": "https://azuracast.gatekeeperradio.com/listen/gatekeeper_radio/radio.mp3",
    "d": "Non-profit experimental station from Berlin that turns urban spaces into temporary physical radio stations alongside its online platform.",
    "h": "https://gatekeeperradio.com/"
   },
   {
    "n": "Great Circles",
    "u": "https://audio-edge-ey5nr.ams.s.radiomast.io/799da8fd-389e-4923-9068-77c725c6e82f",
    "d": "Record shop, label, and live broadcasts from a Frankford Avenue studio in Philadelphia.",
    "h": "https://greatcircles.net/"
   },
   {
    "n": "HKCR",
    "u": "https://stream-test.hkcr.live/hls/main.m3u8",
    "d": "Artist and musician-run outlet in Wan Chai, Hong Kong, since 2016.",
    "h": "https://hkcr.live/"
   },
   {
    "n": "Hollow Earth Radio",
    "u": "http://centova.rockhost.com:8001/stream",
    "d": "Freeform from Seattle, one of The Wire's 100 essential stations, with found sound and local music.",
    "h": "https://khuh.fm/"
   },
   {
    "n": "IDA",
    "u": "https://broadcast.idaidaida.net:8000/stream",
    "d": "Non-profit station and bar/studio split across Tallinn and Helsinki, with a physical listening room open Thursday to Saturday nights.",
    "h": "https://www.idaidaida.net/"
   },
   {
    "n": "Internet Public Radio",
    "u": "https://stream-relay-geo.internetpublicradio.live/stream/main",
    "d": "Independent outlet in Guadalajara, with local and international DJs, musicians, and artists.",
    "h": "https://www.internetpublicradio.live/"
   },
   {
    "n": "KCHUNG Radio",
    "u": "https://kchung-radio-01e54a81.radiocult.fm/stream",
    "d": "Artist co-operative from above a phở restaurant in Chinatown, Los Angeles, since 2011.",
    "h": "https://www.kchungradio.org/"
   },
   {
    "n": "Kindred",
    "u": "https://kindred.radiocult.fm/stream",
    "d": "Record shop and weekly live broadcasts from a Mount Pleasant storefront in London.",
    "h": "https://kindredeverything.com/"
   },
   {
    "n": "Kiosk Radio",
    "u": "https://kioskradiobxl.out.airtime.pro/kioskradiobxl_b",
    "d": "Electronic and jazz from a wooden shack in a park in Brussels.",
    "h": "https://kioskradio.com/",
    "f": 1
   },
   {
    "n": "KPISS",
    "u": "https://das-edge14-live365-dal02.cdnstream.com/a18444",
    "d": "DJ-run freeform from Brooklyn - 'The Golden Stream'.",
    "h": "https://kpiss.fm/"
   },
   {
    "n": "KWSX Radio",
    "u": "https://stream.kwsx.online/listen/kwsx/radio-med.mp3",
    "d": "Live DJ shows alongside a rotating library that shifts mood through the day.",
    "h": "https://radio.kwsx.online/"
   },
   {
    "n": "Lahmacun Radio",
    "u": "https://streaming.lahmacun.hu/radio/8000/radio.mp3",
    "d": "Subculture and underground music from a former factory in Budapest's 8th district, since 2018.",
    "h": "https://www.lahmacun.hu/"
   },
   {
    "n": "The Lake Radio",
    "u": "http://hyades.shoutca.st:8627/stream",
    "d": "Copenhagen art radio with a fully randomized stream - nobody knows what plays next.",
    "h": "https://thelakeradio.com"
   },
   {
    "n": "Le Grigri",
    "u": "https://www.radioking.com/play/legrigri/273715",
    "d": "Associative Paris outlet mixing jazz, hip-hop, soul, and world sounds.",
    "h": "https://www.le-grigri.com/"
   },
   {
    "n": "Le Mellotron",
    "u": "https://listen.radioking.com/radio/477719/stream/534044",
    "d": "Independent from a Paris bar - soul, funk, hip-hop, jazz, and Brazilian beats.",
    "h": "https://lemellotron.com",
    "f": 1
   },
   {
    "n": "Loose Antenna",
    "u": "https://stream.looseantenna.fm/radio/8000/default.mp3",
    "d": "Rooted in Lausanne's pirate and community radio tradition, with DJ sets and voices from the margins.",
    "h": "https://looseantenna.fm/"
   },
   {
    "n": "Loose FM",
    "u": "https://loosefm.radiocult.fm/stream",
    "d": "Experimental, ecstatic broadcasts from a Hoxton basement, now in a shipping container with giant illuminated eyes.",
    "h": "https://loose.fm/"
   },
   {
    "n": "The Lot Radio",
    "u": "https://livepeercdn.studio/hls/85c28sa2o8wppm58/index.m3u8",
    "d": "DJ sets from a Brooklyn shipping container.",
    "h": "https://www.thelotradio.com",
    "f": 1
   },
   {
    "n": "LYL Radio",
    "u": "https://icecast.lyl.live/live",
    "d": "Auto-financed DIY broadcast from Lyon, hosting local and international shows since 2015.",
    "h": "https://lyl.live/"
   },
   {
    "n": "Mondo Bongo Radio",
    "u": "https://cast.mndbng.com/hls/mondobongo/aac_hifi.m3u8",
    "d": "Genre-hopping, timeless music from around the world. Non-profit, Greece-based since 2011.",
    "h": "https://mondobongoradio.com"
   },
   {
    "n": "Montez Press Radio",
    "u": "https://stream.montezpress.com/icecast/music",
    "d": "Publisher-run art broadcasts from a Canal Street storefront in Manhattan's Chinatown.",
    "h": "https://radio.montezpress.com/"
   },
   {
    "n": "Mouthfull",
    "u": "https://mouthfull-radio.radiocult.fm/stream",
    "d": "Non-profit from Aotearoa New Zealand since 2017, with a live listener chatroom alongside every show.",
    "h": "https://mouthfull.live/"
   },
   {
    "n": "Muito Radio",
    "u": "https://muitoradio.out.airtime.pro/muitoradio_a",
    "d": "Independent community radio from Buenos Aires built on the syncretic spirit of 1960s Brazilian tropicalismo.",
    "h": "https://www.muitoradio.com/"
   },
   {
    "n": "Mutant Radio",
    "u": "https://listen.radioking.com/radio/282820/stream/328621",
    "d": "Experimental electronic from a former power station in Tbilisi.",
    "h": "https://www.mutantradio.net"
   },
   {
    "n": "n10.as",
    "u": "https://n10as.radiocult.fm/stream",
    "d": "Volunteer-run Montreal freeform - death metal to dub to medieval music. Pronounced \"antennas.\"",
    "h": "https://n10.as/"
   },
   {
    "n": "Nebulah Radio",
    "u": "https://listen.radioking.com/radio/314507/stream/361754",
    "d": "World music and electronic from Brest, run by Mascarade Records since 2019.",
    "h": "https://www.nebulah-radio.com/"
   },
   {
    "n": "Ness Radio",
    "u": "https://radio.nessradio.net:8212/nessradio-hd",
    "d": "House, electro, jazz, soul, and hip-hop from Marrakech, filling a gap in Morocco's scene since 2008.",
    "h": "https://nessradio.com/"
   },
   {
    "n": "Netil Radio",
    "u": "https://netilradio.out.airtime.pro/netilradio_a",
    "d": "Broadcasting from a converted shipping container atop Netil Market in Hackney.",
    "h": "https://netilradio.com/"
   },
   {
    "n": "NEU Radio",
    "u": "https://radio.eduneu.eu:8020/radio.mp3",
    "d": "Independent radio broadcasting from a park studio and Bologna's MAMbo museum, indie, electronic, jazz, and more.",
    "h": "https://www.neuradio.it/"
   },
   {
    "n": "Newtown Radio",
    "u": "https://streaming.radio.co/s0d090ee43/listen",
    "d": "Freeform from a former brewery in Bushwick, Brooklyn, hosting DJs and live sessions since 2009.",
    "h": "https://newtownradio.com/"
   },
   {
    "n": "Noods Radio",
    "u": "https://noods-radio.radiocult.fm/stream",
    "d": "Rare and deep cuts for record collectors, from Bristol.",
    "h": "https://noodsradio.com/",
    "f": 1
   },
   {
    "n": "Norrm",
    "u": "https://listen.norrm.com/default",
    "d": "Weekly shows from local and international DJs, broadcasting above their bar in Bandung since 2017.",
    "h": "https://www.norrm.com/"
   },
   {
    "n": "NTS — 1",
    "u": "http://stream-relay-geo.ntslive.net/stream",
    "d": "Founded in Hackney in 2011, DJs from 80+ countries, two channels, and a vast mixtape archive. (",
    "h": "https://www.nts.live/",
    "f": 1
   },
   {
    "n": "NTS — 2",
    "u": "http://stream-relay-geo.ntslive.net/stream2",
    "d": "Founded in Hackney in 2011, DJs from 80+ countries, two channels, and a vast mixtape archive. (",
    "h": "https://www.nts.live/",
    "f": 1
   },
   {
    "n": "Ola Radio",
    "u": "https://ola-radio.radiocult.fm/stream",
    "d": "Electronic and avant-garde music from a Marseille collective, since 2019.",
    "h": "https://www.olaradio.fr/"
   },
   {
    "n": "Palanga Street Radio",
    "u": "https://stream.palanga.live:8443/palanga128.mp3",
    "d": "DIY community radio started in a Vilnius flat on Palanga Street, since 2017.",
    "h": "https://palanga.live/"
   },
   {
    "n": "Paranoise Radio",
    "u": "https://paranoisewebcast.radioca.st/stream",
    "d": "Pirate radio turned international collective, started by students in Thessaloniki in 2008.",
    "h": "https://www.paranoiseradio.com/"
   },
   {
    "n": "Parea Radio",
    "u": "https://parea-radio-b7474105.radiocult.fm/stream",
    "d": "Community-oriented station from Athens named for \"parea,\" a circle of friends gathered around sound, prioritizing presence over scale.",
    "h": "https://parearadio.com/"
   },
   {
    "n": "Particle FM",
    "u": "https://azuracast.particle.fm/radio/8000/radio.mp3",
    "d": "DIY community station from San Diego, founded in 2021 to build a platform for women, LGBTQ, Black, Latino, Asian, Indigenous, and immigrant creators.",
    "h": "https://www.particle.fm/"
   },
   {
    "n": "Piñata Radio",
    "u": "https://listen.radioking.com/radio/96031/stream/134656",
    "d": "Bar in Montpellier with live broadcasts from emerging local and international artists.",
    "h": "https://www.pinataradio.com/"
   },
   {
    "n": "Radio 80000",
    "u": "https://radio80k.out.airtime.pro/radio80k_a",
    "d": "Munich's electronic underground from a converted shipping container, since 2015.",
    "h": "https://www.radio80k.de/"
   },
   {
    "n": "Radio Banda Larga",
    "u": "https://rblmedia-a4a44e62.radiocult.fm/stream",
    "d": "Started with a live broadcast from a terrace in Turin's Parco del Valentino, 2011.",
    "h": "https://rbl.media/"
   },
   {
    "n": "Radio Buena Vida",
    "u": "https://s4.radio.co/s69b281ac0/listen",
    "d": "Community radio and café-bar from Govanhill, Glasgow, covering every genre from punk to jungle.",
    "h": "https://buenavida.co.uk/"
   },
   {
    "n": "Radio Centraal",
    "u": "http://streams.movemedia.eu:8530/",
    "d": "Independent and non-commercial from Antwerp since 1980 - brain and rhythm.",
    "h": "https://www.radiocentraal.be/"
   },
   {
    "n": "Radio Dopo",
    "u": "https://streaming.radio.co/s807721f02/listen",
    "d": "Community radio from Palermo, launched in 2025 through an EU-funded partnership with Kiosk Radio and Refuge Worldwide.",
    "h": "https://radiodopo.it/"
   },
   {
    "n": "Radio Kapitał",
    "u": "https://radiokapitalpl.out.airtime.pro/radiokapitalpl_a",
    "d": "Artist and activist broadcasts from Warsaw's Old Town, since 2019.",
    "h": "https://radiokapital.pl/"
   },
   {
    "n": "Radio Meuh",
    "u": "http://radiomeuh.ice.infomaniak.ch/radiomeuh-128.mp3",
    "d": "Electronic, soul, and funk from the French Alps.",
    "h": "https://www.radiomeuh.com/",
    "f": 1
   },
   {
    "n": "Radio Nopal",
    "u": "https://radio.mensajito.mx/nopalA",
    "d": "Live from a storefront in San Rafael, Mexico City, using open-source hardware.",
    "h": "https://radionopal.com/"
   },
   {
    "n": "Radio Nova",
    "u": "https://novazz.ice.infomaniak.ch/novazz-128.mp3",
    "d": "Paris station founded in 1981, pioneering hip-hop, world music, and electronic in France.",
    "h": "https://www.nova.fr/radios/radio-nova/"
   },
   {
    "n": "Radio Pinpon",
    "u": "https://listen.radioking.com/radio/142627/stream/182797",
    "d": "Community radio from a psychiatric hospital in Niort, France, run by patients and staff.",
    "h": "https://www.facebook.com/radiopinpon/"
   },
   {
    "n": "Radio Quantica",
    "u": "https://libretime.radioquantica.com/main.mp3",
    "d": "Underground shows from a Lisbon community collective, since 2015.",
    "h": "https://www.radioquantica.com/"
   },
   {
    "n": "Radio Raheem",
    "u": "https://radioraheem.out.airtime.pro/radioraheem_a",
    "d": "Independent digital media from Milan, starting from music, now in residence at the Triennale, since 2017.",
    "h": "https://radioraheem.it/"
   },
   {
    "n": "Radio Relativa",
    "u": "https://streamer.radio.co/sd6131729c/listen",
    "d": "Experimental sounds and young artists from a Madrid community collective.",
    "h": "https://radiorelativa.eu/"
   },
   {
    "n": "Radio Reverb 97.2",
    "u": "http://edge-audio-03-gos2.sharp-stream.com/radioreverb.mp3",
    "d": "Brighton's licensed community station, started during the 2004 Brighton Festival.",
    "h": "https://radioreverb.com"
   },
   {
    "n": "Radio Sam Sam",
    "u": "https://listen.radioking.com/radio/742276/stream/808768",
    "d": "World grooves, jazz beats, and psych-folk from the SAM SAM Festival in the Fontainebleau Forest.",
    "h": "https://samsam.world/"
   },
   {
    "n": "Radio Santana Breda",
    "u": "https://server7.radio-streams.net/proxy/santana/stream",
    "d": "From a 1980s FM DX hobbyist, now playing Philadelphia soul, Motown, and synth-pop.",
    "h": "https://radiosantana.blogspot.com/?m=0"
   },
   {
    "n": "Radio Sofa",
    "u": "https://radio.radio-sofa.com/listen/radio_sofa/radio.mp3",
    "d": "Electronic music collective, founded in April 2020 to keep Paris venues alive during COVID closures.",
    "h": "https://www.radio-sofa.com/"
   },
   {
    "n": "Radio Tsonami",
    "u": "https://radio-tsonami-b24c40dc.radiocult.fm/stream",
    "d": "Experimental broadcasting from Valparaíso, treating radio as social communication.",
    "h": "https://radiotsonami.org/"
   },
   {
    "n": "radio.syg.ma",
    "u": "https://radio.syg.ma/audio.ogg",
    "d": "Independent music and sound art from syg.ma, a Russian arts-publishing outlet since 2014.",
    "h": "https://radio.syg.ma/"
   },
   {
    "n": "Reform Radio",
    "u": "https://testform.out.airtime.pro/testform_a",
    "d": "Started in a South Manchester basement in 2013, now at Old Granada Studios.",
    "h": "https://www.reformradio.co.uk/"
   },
   {
    "n": "Refuge Worldwide",
    "u": "https://streaming.radio.co/s3699c5e49/listen",
    "d": "Berlin community radio born from refugee-aid fundraisers in Neukölln.",
    "h": "https://refugeworldwide.com/"
   },
   {
    "n": "Resonance 104.4 FM",
    "u": "http://stream.resonance.fm:8000/resonance",
    "d": "London's radio art station, run by the London Musicians' Collective since 2002.",
    "h": "https://www.resonancefm.com/"
   },
   {
    "n": "Retreat Radio",
    "u": "https://retreatradio.out.airtime.pro/retreatradio_b",
    "d": "Independent non-commercial broadcasts and events from Malmö, Scandinavia and beyond.",
    "h": "https://www.retreatradio.net/"
   },
   {
    "n": "Rinse FM",
    "u": "https://admin.stream.rinse.fm/proxy/rinse_uk/stream",
    "d": "London pirate-turned-legal, pioneering grime and dubstep from Tower Hamlets since 1994.",
    "h": "https://www.rinse.fm/channels/uk",
    "f": 1
   },
   {
    "n": "ROVR",
    "u": "https://hls-prod.rovr.live/prod/stream_plus02/llhls.m3u8",
    "d": "Anti-algorithm mix, no talk or ads, from a record shop and café in Soho, London.",
    "h": "https://www.rovr.live/"
   },
   {
    "n": "Rukh Radio",
    "u": "https://a1.asurahosting.com/listen/rukh/radio.mp3",
    "d": "Non-commercial DIY community station from Odesa, Ukraine, focused on experimental and alternative music and countercultures.",
    "h": "https://rukh.live/"
   },
   {
    "n": "Rytmabad Radio",
    "u": "https://radio.filmtastic.uz/listen/rytmabad/radio.mp3",
    "d": "Tashkent's community station for Central Asia's underground electronic DJs and producers.",
    "h": "https://rytmabad.com/"
   },
   {
    "n": "Sauna Radio",
    "u": "https://stream.saunaradio.com/live",
    "d": "DJ sets and performances broadcast from a sauna cabin in Stockholm, Saturdays.",
    "h": "https://www.saunaradio.com/"
   },
   {
    "n": "Seyðisfjörður Community Radio",
    "u": "https://seyisfjorur-community-radio.radiocult.fm/stream",
    "d": "Experimental community station founded in 2016 in a small East Iceland fishing town, broadcasting on 107.1FM.",
    "h": "https://www.seydisfjordurcommunityradio.net/"
   },
   {
    "n": "Slack Radio",
    "u": "https://s4.radio.co/s62c60f538/listen",
    "d": "Artist-run, listener-funded SubGenius station from a 1979 parody religion.",
    "h": "https://www.slackradio.org/"
   },
   {
    "n": "Soho Radio",
    "u": "https://sohoradiomusic.doughunt.co.uk:8010/320mp3",
    "d": "Independent from a street-level Soho studio, every genre from rockabilly to jazz, since 2014.",
    "h": "https://sohoradio.com/"
   },
   {
    "n": "Station Station",
    "u": "https://libretime.stationstation.fr/main",
    "d": "Music, literary mixtapes, and sound creations from Paris's Station Gare des Mines.",
    "h": "https://stationstation.fr/"
   },
   {
    "n": "stayfm",
    "u": "https://stayfm.com:8443/archive",
    "d": "Independent, member-run community radio from Augsburg, founded in 2018 and run as a non-profit association since 2019.",
    "h": "https://stayfm.com/"
   },
   {
    "n": "STEGI.RADIO",
    "u": "https://movementathens.out.airtime.pro/movementathens_a",
    "d": "Art radio from the Onassis Stegi cultural centre in Athens, with Mediterranean and global sounds.",
    "h": "https://stegi.radio/"
   },
   {
    "n": "Studio Néau",
    "u": "https://studioneau.out.airtime.pro/studioneau_a",
    "d": "Free community radio in a converted shipping container in Eupen, East Belgium, since 2021.",
    "h": "https://www.studioneau.be/"
   },
   {
    "n": "Subtle Radio",
    "u": "https://subtle.out.airtime.pro/subtle_a",
    "d": "Community-led station based in Hackney, London, broadcasting 24/7 since 2018 to support grassroots electronic music.",
    "h": "https://www.subtleradio.com/"
   },
   {
    "n": "THF Radio",
    "u": "https://thf-radio-7ec0e6ee.radiocult.fm/stream",
    "d": "Experimental broadcasts from the former gatehouse at Tempelhof Airport, Berlin.",
    "h": "https://www.thfradio.de/"
   },
   {
    "n": "Three D Radio 93.7 FM",
    "u": "https://sounds.threedradio.com/stream",
    "d": "Volunteer-run alternative FM from Adelaide, no playlists, 120+ announcers, since 1979.",
    "h": "https://www.threedradio.com/"
   },
   {
    "n": "Tīrkultūra",
    "u": "https://s3.radio.co/s216811754/listen",
    "d": "Experimental radio art from Riga, founded in 2015 by a fashion designer and two artists.",
    "h": "https://www.tirkultura.lv/"
   },
   {
    "n": "TSUBAKI fm",
    "u": "https://edge.mixlr.com/channel/vgmet",
    "d": "Independent music broadcast from Tokyo, Kyoto, Nagoya, Hiroshima, and Okinawa.",
    "h": "https://tsubakifm.com/"
   },
   {
    "n": "Veneno",
    "u": "https://radio.veneno.live/stream/main",
    "d": "Cultural broadcasts from downtown São Paulo, connecting artists and collectives, since 2018.",
    "h": "https://veneno.live/"
   },
   {
    "n": "We Are Various",
    "u": "https://azuracast.wearevarious.com/listen/we_are_various/live.mp3",
    "d": "Nomadic community station from Antwerp, broadcasting from a rotating set of venues including Coming Soon Space, Trix, and Het Bos.",
    "h": "https://www.wearevarious.com/"
   },
   {
    "n": "WGXC 90.7-FM",
    "u": "https://audio.wavefarm.org/wgxc.mp3",
    "d": "Wave Farm's FM from the Upper Hudson Valley, \"Radio for Open Ears\".",
    "h": "https://wavefarm.org/radio/wgxc/schedule"
   },
   {
    "n": "Worldwide FM",
    "u": "https://worldwide-fm.radiocult.fm/stream",
    "d": "Founded by Gilles Peterson, jazz, soul, and global sounds from London.",
    "h": "https://www.worldwidefm.net/",
    "f": 1
   },
   {
    "n": "XRAY.fm",
    "u": "https://listen.xray.fm/stream",
    "d": "Portland non-profit putting local DJs and the city's underground music scene on air.",
    "h": "https://xray.fm/"
   },
   {
    "n": "Zabrij Radio",
    "u": "https://zabrij-radio.radiocult.fm/stream",
    "d": "Zagreb station founded in 2025 that pivoted from broad global sound exploration to a focus on underrepresented Balkan music.",
    "h": "https://www.zabrijradio.org/"
   },
   {
    "n": "Soho Radio",
    "u": "https://sohoradiomusic.doughunt.co.uk:8010/320mp3",
    "d": "Soho’s own storefront station — psych to Japanese grime, 320k.",
    "h": "https://sohoradiolondon.com/",
    "a": 1
   },
   {
    "n": "dublab",
    "u": "http://dublab.out.airtime.pro:8000/dublab_a",
    "d": "LA’s future-roots pioneer — experimental, beats, eclectic, since 1999.",
    "h": "https://www.dublab.com/",
    "a": 1
   },
   {
    "n": "WXYC 89.3 Chapel Hill",
    "u": "http://audio-mp3.ibiblio.org:8000/wxyc.mp3",
    "d": "UNC’s freeform station — the first radio station ever to stream on the internet (1994).",
    "h": "https://wxyc.org/",
    "a": 1
   },
   {
    "n": "Reprezent 107.3",
    "u": "https://radio.canstream.co.uk:8022/live.mp3",
    "d": "London youth radio — grime, rap, and new UK talent.",
    "h": "https://www.reprezent.org.uk/",
    "a": 1
   },
   {
    "n": "Dublin Digital Radio",
    "u": "https://dublin-digital-radio.radiocult.fm/stream",
    "d": "Dublin’s experimental community station.",
    "h": "https://listen.dublindigitalradio.com/",
    "a": 1
   },
   {
    "n": "Radio Rakel",
    "u": "https://stream.radiorakel.no/fm993.mp3",
    "d": "Oslo student radio since 1982, run mostly by women and non-binary volunteers.",
    "h": "https://radiorakel.no/",
    "a": 1
   },
   {
    "n": "Boogaloo Radio",
    "u": "https://streams.radio.co/sb88c742f0/listen",
    "d": "From the Boogaloo pub in Highgate, London — musicians and DJs at the bar.",
    "h": "https://boogalooradio.com/",
    "a": 1
   },
   {
    "n": "The Lot Radio",
    "u": "https://livepeercdn.studio/hls/85c28sa2o8wppm58/index.m3u8",
    "d": "From a shipping container on a Brooklyn lot — NYC’s independent DJ stream (HLS).",
    "h": "https://www.thelotradio.com/",
    "a": 1
   },
   {
    "n": "Oroko Radio",
    "u": "https://oroko-radio.radiocult.fm/stream",
    "d": "Accra, Ghana — pan-African community radio connecting the diaspora.",
    "h": "https://oroko.live/",
    "a": 1
   },
   {
    "n": "Kiosk Radio",
    "u": "https://kioskradiobxl.out.airtime.pro/kioskradiobxl_b",
    "d": "All-day DJ sets from a wooden kiosk in Brussels’ Parc Royal.",
    "h": "https://www.kioskradio.com/",
    "a": 1
   },
   {
    "n": "Radio Alhara",
    "u": "https://stream.radiojar.com/78cxy6wkxtzuv",
    "d": "Bethlehem’s community station — Palestine’s sonic public square.",
    "h": "https://radioalhara.net/",
    "a": 1
   },
   {
    "n": "Hanoi Community Radio",
    "u": "https://ha-noi-community-radio.radiocult.fm/stream",
    "d": "Vietnam’s community station — Hanoi’s underground, day and night.",
    "h": "https://www.hanoicommunityradio.com/",
    "a": 1
   }
  ]
 },
 {
  "g": "Decades, Oldies & Nostalgia",
  "s": [
   {
    "n": "Beatles Radio",
    "u": "http://stream.zeno.fm/e4auhdgm6cquv",
    "d": "Nothing but the Beatles and solo projects.",
    "h": "https://you.radio/station/exclusiveradio-beatles"
   },
   {
    "n": "Flower Power Radio",
    "u": "http://uk1.streamingpulse.com:7000/,",
    "d": "Hits from the 1950s, 60s and 70s, rock, pop, soul, Motown and disco.",
    "h": "https://www.flowerpowerradio.com/"
   },
   {
    "n": "J-Club Bandstand",
    "u": "https://cast1.torontocast.com:2060/stream",
    "d": "Jazz music from the 1930s and 1940s.",
    "h": "https://jclubbandstand.torontocast.stream/stations/index.html"
   },
   {
    "n": "LuxuriaMusic",
    "u": "http://ice10.securenetsystems.net/LUXOMP3",
    "d": "Surf, bossa nova, exotica, and space-age lounge.",
    "h": "https://luxuriamusic.com",
    "f": 1
   },
   {
    "n": "Mad Music Radio - Oldies Radio",
    "u": "http://janus.shoutca.st:8259/,",
    "d": "Oldies and soft rock hits through the 70s.",
    "h": "https://wgdr.rocks/"
   },
   {
    "n": "Majestic Jukebox",
    "u": "https://uk3.internet-radio.com/proxy/majesticjukebox/live",
    "d": "40s-80s oldies, jazz, swing, rock'n'roll and big band.",
    "h": "https://www.majesticjukeboxradio.com"
   },
   {
    "n": "Old Time Radio",
    "u": "https://kea.cdnstream.com/1893_128",
    "d": "1930s-50s radio shows (comedy, westerns, mystery).",
    "h": "https://oldtime.radio/"
   },
   {
    "n": "Psychedelicized",
    "u": "https://cast1.asurahosting.com/proxy/psychedelicized/stream",
    "d": "60s-70s psychedelic and garage rock.",
    "h": "https://psychedelicized.com/",
    "f": 1
   },
   {
    "n": "Pumpkin FM - 1940s",
    "u": "https://cast2.asurahosting.com/proxy/1940sradio/stream",
    "d": "Hits and shows from the 1940s.",
    "h": "https://pumpkinfm.com/"
   },
   {
    "n": "The Quiet Village",
    "u": "http://broadcast.shoutcheap.com:8424/stream",
    "d": "Exotica, Hawaiian, and lounge music.",
    "h": "https://www.digitiki.com/radio.html"
   },
   {
    "n": "Radio Caroline",
    "u": "http://78.129.202.200:8040/,",
    "d": "Album rock from the original 1964 pirate ship station, now licensed.",
    "h": "https://radiocaroline.co.uk",
    "f": 1
   },
   {
    "n": "Radio Dismuke",
    "u": "http://stream2.early1900s.org:8000/,",
    "d": "Popular music and jazz from 1925-1935.",
    "h": "http://dismuke.org"
   },
   {
    "n": "The Retro Attic",
    "u": "http://103.226.246.212:8159/stream",
    "d": "50s-70s oldies and forgotten tracks.",
    "h": "https://www.retroatticrareoldiesradio.com/",
    "f": 1
   },
   {
    "n": "SMRN5001",
    "u": "https://cast1.sql2.smrn.com/5001",
    "d": "60s and 70s music from a personal archive in Emerald Hills, California.",
    "h": "https://smrn5001.com/"
   },
   {
    "n": "Technicolor Web of Sound",
    "u": "http://streaming.live365.com/a01650",
    "d": "1960s psychedelic and hippie-era pop.",
    "h": "https://www.techwebsound.com/"
   },
   {
    "n": "Ultimate Oldies Radio",
    "u": "https://puma.streemlion.com:1785/stream",
    "d": "50s-80s hits and music history.",
    "h": "https://ultimateoldiesradio.com"
   },
   {
    "n": "Van Morrison Radio",
    "u": "https://streaming.exclusive.radio/er/vanmorrison/icecast.audio",
    "d": "Van Morrison's catalogue, all day.",
    "h": "https://you.radio/station/exclusiveradio-van-morrison"
   },
   {
    "n": "Vintage Obscura Radio",
    "u": "https://radio.vintageobscura.net/stream",
    "d": "Reddit-sourced rarities, pre-2000 tracks with under 30,000 YouTube views at discovery.",
    "h": "https://vintageobscura.net/"
   },
   {
    "n": "WALM - Classic Vinyl",
    "u": "https://icecast.walmradio.com:8443/classic",
    "d": "Classic rock and vinyl-based hits.",
    "h": "https://walmradio.com/classic/"
   },
   {
    "n": "WALM - Old Time Radio",
    "u": "https://icecast.walmradio.com:8443/otr",
    "d": "1930s-50s radio dramas, comedies, and westerns, played from original 78-rpm discs.",
    "h": "https://walmradio.com/otr"
   },
   {
    "n": "Wayback Radio",
    "u": "https://s5.citrus3.com:8244/stream",
    "d": "Hosted trip back to the golden age of Top 40, from Des Moines.",
    "h": "https://www.waybackradio.org/"
   }
  ]
 },
 {
  "g": "Electronic",
  "s": [
   {
    "n": "54house.fm",
    "u": "https://54house.fm:9013/stream",
    "d": "House via weekly label shows from Defected, Toolroom, Circoloco, and more.",
    "h": "https://www.54house.fm/"
   },
   {
    "n": "After Hours FM",
    "u": "http://fr.ah.fm:8000/,",
    "d": "Trance and progressive live sets since 2006, home of the End of Year Countdown.",
    "h": "https://ah.fm"
   },
   {
    "n": "Bad Radio",
    "u": "http://server.badradio.biz:8000/stream",
    "d": "Phonk and dark trap from New Zealand.",
    "h": "https://badradio.nz/"
   },
   {
    "n": "Bassdrive",
    "u": "https://www.bassdrive.com/bassdrive.m3u",
    "d": "Drum and bass since 2001, with live sets from DJs worldwide.",
    "h": "https://www.bassdrive.com"
   },
   {
    "n": "Blue Marlin Ibiza",
    "u": "https://ibizasonica.streaming-pro.com:8001/bluemarlin",
    "d": "House and lounge from Ibiza.",
    "h": "http://www.bluemarlinibiza.com/radio/live"
   },
   {
    "n": "Bondi Radio",
    "u": "https://streaming.radio.co/sfd68ddd77/listen",
    "d": "Sydney house and deep grooves, relaunched by DJ Hodgie in the 2020 lockdown.",
    "h": "https://bondiradio.com.au/"
   },
   {
    "n": "Deeper Shades of House",
    "u": "https://andromeda.housejunkie.ca/radio/8000/radio.mp3",
    "d": "Weekly deep house show hosted by Lars Behrenroth since 2002 on JAM FM Berlin.",
    "h": "https://radio.deepershades.net"
   },
   {
    "n": "Deepvibes Radio",
    "u": "http://88.208.218.19:9106/stream",
    "d": "Deep house mixes from DJs worldwide, featuring live sessions and guest mixes.",
    "h": "http://www.deepvibes.co.uk/"
   },
   {
    "n": "Dogglounge",
    "u": "http://dogglounge.com:8000/,",
    "d": "Deep house and live DJ sets from around the world.",
    "h": "https://dogglounge.com/"
   },
   {
    "n": "Dub Ninja",
    "u": "https://dub.ninja/live",
    "d": "Dub techno and ambient for focus.",
    "h": "https://dub.ninja/"
   },
   {
    "n": "EBM Radio",
    "u": "http://www.ebm-radio.org:7000/hq",
    "d": "EBM, dark electro, industrial, synthpop and related electronic sounds from Germany.",
    "h": "https://www.ebm-radio.de/index.php"
   },
   {
    "n": "Eurodance Radio",
    "u": "http://daydeeeurodance.stream.laut.fm/daydeeeurodance",
    "d": "90s Eurodance from a private maxi-CD collection, remastered by the owner.",
    "h": "https://www.eurodance-radio.com/"
   },
   {
    "n": "Freak Beats Tekno Radio",
    "u": "http://fr1.nexuscast.com:8042/;stream.mp3",
    "d": "Tribe, hardtek and acid techno from the underground European free-party scene.",
    "h": "https://freakbeats.nexuscast.com"
   },
   {
    "n": "Frisky Radio",
    "u": "http://stream2.friskyradio.com/frisky_mp3_hi",
    "d": "Underground electronic DJ mixes since 2008.",
    "h": "https://frisky.fm/"
   },
   {
    "n": "GROOVE RADIO",
    "u": "https://streams.radio.co/s14193ab17/listen",
    "d": "Founded 1992 by LA DJ Swedish Egil, first US DJ culture format.",
    "h": "https://www.grooveradio.com/"
   },
   {
    "n": "Intergalactic FM - Cybernetic Broadcasting System",
    "u": "http://radio.intergalactic.fm:80/1",
    "d": "Pirate-born cult station from The Hague, electro, disco, and deep cuts.",
    "h": "https://intergalactic.fm/",
    "f": 1
   },
   {
    "n": "ISEKOI Radio - Main Channel",
    "u": "https://public.isekoi-radio.com/listen/isekoi/radio.mp3",
    "d": "Electronic music framed as transmissions from an exoplanet 63 light-years away, since 2023.",
    "h": "https://isekoi-radio.com/",
    "f": 1
   },
   {
    "n": "Italoradio.fm",
    "u": "http://cc6.beheerstream.com:8102/stream",
    "d": "Classic and new Italo-disco.",
    "h": "https://italoradio.fm/"
   },
   {
    "n": "Kool FM",
    "u": "https://admin.stream.rinse.fm/proxy/kool/stream",
    "d": "Jungle and drum and bass pioneer from 1991, now broadcasting from Rinse FM's studio.",
    "h": "https://www.rinse.fm/channels/kool"
   },
   {
    "n": "KSOL - From the Valleys of Kasol",
    "u": "https://ksol.live/hls/from_the_valleys_of_kasol/aac_hifi.m3u8",
    "d": "Psytrance and goa trance for following the bass into the forest.",
    "h": "https://ksol.live/valleys-of-kasol"
   },
   {
    "n": "KSOL - Suno Toh Sahi",
    "u": "https://ksol.live/hls/suno_toh_sahi/aac_hifi.m3u8",
    "d": "Desi electronica, funk, and disco house, where a grandmother's playlist meets a DJ set.",
    "h": "https://ksol.live/suno-toh-sahi"
   },
   {
    "n": "Limbik Frequencies",
    "u": "https://limbikfreq.com/listen/limbik_frequencies/320.mp3",
    "d": "Bass-heavy experimental electronic.",
    "h": "https://limbikfreq.com/public/limbik_frequencies"
   },
   {
    "n": "Minimal Mix Radio",
    "u": "http://orion.shoutca.st:8750/stream",
    "d": "Deep tech house and dub techno mixes from a Polish DJ trio.",
    "h": "https://minimalmix.com/"
   },
   {
    "n": "Nightride FM",
    "u": "https://stream.nightride.fm/nightride.mp3",
    "d": "Synthwave, darksynth, chillsynth, and EBSM from a sister station to Rekt Network.",
    "h": "https://nightride.fm/",
    "f": 1
   },
   {
    "n": "Nightwave Plaza",
    "u": "https://radio.plaza.one/ogg",
    "d": "Vaporwave, future funk, and city pop.",
    "h": "https://plaza.one/"
   },
   {
    "n": "NTS - Poolside",
    "u": "https://stream-mixtape-geo.ntslive.net/mixtape4",
    "d": "Balearic, boogie, and sophisti-pop.",
    "h": "https://www.nts.live/infinite-mixtapes/poolside"
   },
   {
    "n": "OpenLab FM",
    "u": "https://ice09.fluidstream.net/openlab.aac",
    "d": "Live DJ sets from Ibiza, broadcasting the island's club and beach scene.",
    "h": "https://openlab.fm"
   },
   {
    "n": "Poolsuite FM",
    "u": "https://s5.radio.co/sc9cb59935/listen",
    "d": "Poolside soundtrack of disco, yacht rock, Balearic, and summer classics.",
    "h": "https://poolsuite.net/"
   },
   {
    "n": "Radio BipTunia",
    "u": "https://ecast.myautodj.com:1380/listen.mp3",
    "d": "One artist's experimental electronic catalog.",
    "h": "https://biptunia.com/"
   },
   {
    "n": "Radio DY10",
    "u": "https://flux.radiody10.com/live",
    "d": "Dance and trippy electronic from Nantes.",
    "h": "https://www.radiody10.com/"
   },
   {
    "n": "Radio Isla Negra - Upbeat",
    "u": "https://radioislanegra.org/listen/up/stream",
    "d": "High-energy electronica from the same Chilean station as Slowbeat, since 1999.",
    "h": "https://www.radioislanegra.com/"
   },
   {
    "n": "Radio ItaloPower!",
    "u": "https://stream.deevaradio.net:10443/italopower",
    "d": "Italo disco, Hi-NRG and spacesynth from the golden synth-pop years.",
    "h": "https://italopower.com"
   },
   {
    "n": "Rekt Network",
    "u": "https://stream.rekt.network/hls/rekt/aac_hifi.m3u8",
    "d": "Drum and bass, dubstep, and dark techno, the main channel of Rekt Network.",
    "h": "https://rekt.network/"
   },
   {
    "n": "SerrebiRadio",
    "u": "https://radio.serrebiradio.com/listen/serrebiradio/SerrebiRadio",
    "d": "House, trance, and hard dance, programmed by a blind DJ in Vancouver.",
    "h": "https://serrebiradio.com"
   },
   {
    "n": "Skylab Radio",
    "u": "http://stream.skylab-radio.com:8000/live",
    "d": "Experimental electronic and avant-garde from Melbourne.",
    "h": "https://skylabradio.com"
   },
   {
    "n": "Sub.FM",
    "u": "http://subfm.radioca.st/Sub.FM",
    "d": "Community-run bass music since 2004, dubstep, garage, and grime.",
    "h": "https://www.sub.fm/"
   },
   {
    "n": "Synthetic FM",
    "u": "https://mediaserv38.live-streams.nl:18040/live",
    "d": "Synth, darkwave, and EBM from three hobbyists building playlists by hand, no algorithms.",
    "h": "https://syntheticfm.com/about",
    "f": 1
   },
   {
    "n": "Synthetic FM - New Italo Generation",
    "u": "https://mediaserv38.live-streams.nl:18030/stream",
    "d": "Italo disco and synth pop from three hobbyists building playlists by hand, no algorithms.",
    "h": "https://syntheticfm.com/about"
   },
   {
    "n": "TEKnival Radio",
    "u": "https://listen.teknivalradio.com/listen/teknivalradio/radio.mp3",
    "d": "Hard techno and rave.",
    "h": "https://teknivalradio.com/"
   },
   {
    "n": "TM Radio",
    "u": "https://stream.tm-radio.com/tribalmixes",
    "d": "Underground DJ mixes since 2006, progressive house, tech house, and deep techno.",
    "h": "https://tm-radio.com/"
   },
   {
    "n": "Rinse FM",
    "u": "https://admin.stream.rinse.fm/proxy/rinse_uk/stream",
    "d": "London’s pirate-born institution — grime, garage, and bass since 1994.",
    "h": "https://www.rinse.fm/",
    "a": 1
   },
   {
    "n": "Tsugi Radio",
    "u": "https://listen.radioking.com/radio/1906/stream/6029",
    "d": "The French electronic-culture magazine’s own station.",
    "h": "https://www.tsugi.fr/tsugiradio",
    "a": 1
   }
  ]
 },
 {
  "g": "Funk, Soul, Hip-Hop & Disco",
  "s": [
   {
    "n": "Comala Radio",
    "u": "https://listen.radioking.com/radio/38120/stream/74519",
    "d": "Soul, funk, house, Brazilian, and African groove from the SupaGroovalistic collective in Lille, since 2017.",
    "h": "https://www.comalaradio.com/"
   },
   {
    "n": "dinamo.fm - DiSCOTHEQUE",
    "u": "http://channels.dinamo.fm/discotheque-mp3",
    "d": "70s New York disco selected by Istanbul-based DJs.",
    "h": "https://dinamo.fm/content/4/channels"
   },
   {
    "n": "Disco Factory FM",
    "u": "https://s5.radio.co/s253044a7a/listen",
    "d": "Volunteer friends spinning vinyl-only 12-inch disco, funk, and soul from the 70s-80s.",
    "h": "https://www.discofactory.fm"
   },
   {
    "n": "The Face Radio",
    "u": "https://the-face-radio.radiocult.fm/stream",
    "d": "Soul, funk, disco and mod from a Brooklyn collective, since 2016.",
    "h": "https://thefaceradio.com/"
   },
   {
    "n": "Funk the Planet",
    "u": "https://streaming.live365.com/a01484",
    "d": "Programmed by Santa Barbara DJ Vince Leo, classic and modern funk.",
    "h": "https://funkthepla.net/"
   },
   {
    "n": "Funky Ass Tunes",
    "u": "https://ams1.reliastream.com/proxy/john12/stream",
    "d": "Funk, soul, rare groove, and lounge from Dublin.",
    "h": "https://www.funkyasstunes.com/"
   },
   {
    "n": "The Funky Channel",
    "u": "http://cast3.my-control-panel.com:8170/stream",
    "d": "Driven by a couple of old-school funk and disco addicts.",
    "h": "https://thefunkychannel.com/"
   },
   {
    "n": "Funky Radio",
    "u": "https://funkyradio.streamingmedia.it/play.mp3",
    "d": "Italian-run funk from 1963-1982, vinyl-era selections and deep cuts.",
    "h": "https://funky.radio/"
   },
   {
    "n": "Groove Cabane",
    "u": "https://listen.radioking.com/radio/314264/stream/361499",
    "d": "Festive funk, soul, and disco DJ sets from a French collective.",
    "h": "https://www.groovecabane.com/"
   },
   {
    "n": "International Rare Groove",
    "u": "https://s131.radiolize.com/radio/8110/radio.mp3",
    "d": "Soul, funk, and jazz from London.",
    "h": "https://www.irgradio.net/"
   },
   {
    "n": "La Patate Douce",
    "u": "https://listen.radioking.com/radio/285742/stream/472984",
    "d": "Disco-funk, Afro-soul, and house from France.",
    "h": "https://www.lapatatedouceradio.com/",
    "f": 1
   },
   {
    "n": "Le Bon Mix",
    "u": "https://stream10.xdevel.com/audio13s976748-2017/stream/icecast.audio",
    "d": "Funk, disco, jazz, and soul from the Basque coast, also on FM and DAB+.",
    "h": "https://www.lebonmix.radio/en/"
   },
   {
    "n": "Mad Radio - Bogotá",
    "u": "https://c25.radioboss.fm/stream/171",
    "d": "Funk, disco, hip-hop, and indie from a Bogotá vinyl bar, since 2017.",
    "h": "https://madradio.co/"
   },
   {
    "n": "Mojo Radio",
    "u": "https://stream.laut.fm/mojo",
    "d": "Deep funk and dancefloor jazz from the Mojo Club on Hamburg's Reeperbahn.",
    "h": "https://www.mojo.de/mojo-radio/"
   },
   {
    "n": "MRG.fm - Planet Hip Hop",
    "u": "http://listen.mrg.fm:8100/stream",
    "d": "Old-school rap and hip-hop from The Mondello Radio Group.",
    "h": "https://www.w.mrg.fm/"
   },
   {
    "n": "NTS - Low Key",
    "u": "https://stream-mixtape-geo.ntslive.net/mixtape2",
    "d": "Lo-fi hip-hop and smooth R&B.",
    "h": "https://www.nts.live/infinite-mixtapes/100-percent-hip-hop"
   },
   {
    "n": "Nuance Radio",
    "u": "http://admin.nuance.radio/hls/nuance_radio/aac_hifi.m3u8",
    "d": "Jazz, funk, electronic, and hip-hop, from a French collective.",
    "h": "https://nuance.radio/"
   },
   {
    "n": "Panacea Radio",
    "u": "https://stream-15.aiir.com/kqwcuxfxcwhtv",
    "d": "Named from Latin for all-healing, playing jazz funk and soul with live UK presenters.",
    "h": "https://www.panacearadio.net/"
   },
   {
    "n": "Pool FM",
    "u": "https://radios.poolwebwork.com.br/8010/stream",
    "d": "São Paulo dance station since 1985, credited with starting Brazil's remix scene.",
    "h": "https://www.poolfm.com.br/"
   },
   {
    "n": "Radio Bar Sardine",
    "u": "https://listen.radioking.com/radio/552908/stream/612230",
    "d": "Jazz, folk, soul, and disco from Bordeaux.",
    "h": "https://radiobarsardine.wixsite.com/radio-bar-sardine"
   },
   {
    "n": "Radio Krimi",
    "u": "https://radio13.pro-fhi.net/flux-nwsimjda2/stream",
    "d": "Hip-hop, funk, and jazz with a noir aesthetic.",
    "h": "http://radiokrimi.com",
    "f": 1
   },
   {
    "n": "Radio Nova - Hip-Hop",
    "u": "https://nova-odn.ice.infomaniak.ch/nova-odn-256.aac",
    "d": "Nova's dedicated hip-hop channel, French and international.",
    "h": "https://www.nova.fr/radios/"
   },
   {
    "n": "Radio Nula - Classic",
    "u": "https://strm.radionula.com/channel4",
    "d": "Soul, funk, disco, and hip-hop from a Ljubljana DJ collective, since 2008.",
    "h": "https://radionula.com"
   },
   {
    "n": "Retro Soul Radio UK",
    "u": "https://streaming.galaxywebsolutions.com/stream/retrosoul",
    "d": "Soul, funk, and disco-funk from a London DJ team, since 2010.",
    "h": "https://www.retrosoulradio.co.uk"
   },
   {
    "n": "Sensimedia Hip Hop",
    "u": "https://sensihiphop.radioca.st/stream",
    "d": "LA reggae and hip-hop network since 1999, among the first broadcasting online.",
    "h": "https://sensimedia.net/radio/stations/hiphop"
   },
   {
    "n": "Street Sounds Radio",
    "u": "https://streaming.broadcastradio.com:10525/streetsd",
    "d": "Soul, boogie, jazz-funk, and electro from the Street Sounds label, since 1982.",
    "h": "https://www.streetsoundsradio.com/"
   },
   {
    "n": "Swiss Groove",
    "u": "https://relay1.swissgroove.ch/;",
    "d": "Non-profit jazz and funk founded 2003 by Zurich music collectors.",
    "h": "https://www.swissgroove.ch"
   },
   {
    "n": "Totally Wired Radio",
    "u": "https://totallywired.out.airtime.pro/totallywired_a",
    "d": "Soul, mod, and rare groove from the Acid Jazz Records label, London.",
    "h": "https://totallywiredradio.com"
   },
   {
    "n": "WEFUNK",
    "u": "http://www.wefunkradio.com/play/radio.pls",
    "d": "Montreal hip-hop, funk, and soul mix-show since 1996.",
    "h": "https://wefunkradio.com/"
   },
   {
    "n": "WWOZ 90.7",
    "u": "https://www.wwoz.org/listen/hi",
    "d": "New Orleans jazz, funk, and soul.",
    "h": "https://www.wwoz.org/",
    "f": 1
   },
   {
    "n": "Yumi Co. Radio",
    "u": "https://yumicoradio.net:8443/stream",
    "d": "Future funk, city pop and anime groove, running since 2019.",
    "h": "https://yumicoradio.net/"
   }
  ]
 },
 {
  "g": "Jazz & Blues",
  "s": [
   {
    "n": "Aardvark Blues FM",
    "u": "http://edge4.peta.live365.net/b77280_128mp3",
    "d": "Texas blues station since 2013, Delta to Chicago and modern blues.",
    "h": "https://aardvarkbluesfm.com/"
   },
   {
    "n": "Ábaco Libros y Café",
    "u": "http://radio30.virtualtronics.com:8638/,",
    "d": "Jazz and bossa nova from a Cartagena bookstore.",
    "h": "https://abacolibrosycaferadio.blogspot.com/",
    "f": 1
   },
   {
    "n": "AshiyaRadio",
    "u": "https://s3.radio.co/sc8d895604/listen",
    "d": "Jazz and bossa nova from Kobe, Japan.",
    "h": "https://ashiya.radio/"
   },
   {
    "n": "Concertzender - World of Jazz",
    "u": "https://streams.greenhost.nl:8006/jazz",
    "d": "Jazz and world fusion from the Netherlands.",
    "h": "https://www.concertzender.nl/en"
   },
   {
    "n": "Fine Music Radio",
    "u": "http://edge.iono.fm/xhls/fmr_live_medium.m3u8",
    "d": "Classical and jazz from inside Cape Town's Artscape Theatre, since 1995.",
    "h": "https://www.fmr.co.za/"
   },
   {
    "n": "FIP Jazz",
    "u": "http://icecast.radiofrance.fr/fipjazz-hifi.aac",
    "d": "Jazz classics and contemporary selections from Radio France's dedicated channel.",
    "h": "https://www.radiofrance.fr/musique/jazz",
    "f": 1
   },
   {
    "n": "Giants of Jazz",
    "u": "http://streaming.radio.co/s297e618a7/listen",
    "d": "Classic jazz from the 40s-70s, broadcast from the UK since 2012.",
    "h": "http://www.giantsofjazzradio.co.uk/"
   },
   {
    "n": "Head Wax Radio",
    "u": "https://headwaxradio.radioca.st/stream",
    "d": "Future jazz and funk from Dublin.",
    "h": "https://www.headwaxradio.ie/"
   },
   {
    "n": "iFusion Radio",
    "u": "https://listen.radioking.com/radio/523747/stream/582004",
    "d": "Jazz fusion, jazz, and progressive rock.",
    "h": "https://www.ifusionradio.com/"
   },
   {
    "n": "J-Club Bandstand - Jazz Sakura",
    "u": "https://kathy.torontocast.com:3330/,",
    "d": "Japanese jazz artists across the Showa and Heisei eras.",
    "h": "https://jclubbandstand.torontocast.stream/stations/index.html"
   },
   {
    "n": "Jazz Con Class",
    "u": "http://streaming.live365.com/a73229",
    "d": "Traditional jazz from the late 1940s to early 1970s, with themed streams.",
    "h": "https://jazzconclass.com"
   },
   {
    "n": "The Jazz Groove",
    "u": "http://east-mp3-128.streamthejazzgroove.com/stream",
    "d": "Two channels of laid-back and vocal jazz.",
    "h": "https://jazzgroove.org",
    "f": 1
   },
   {
    "n": "Jazz Radio - Afro Jazz",
    "u": "https://jazz-radio-afro.ice.infomaniak.ch/jazz-radio-afro.mp3",
    "d": "African rhythms and jazz fusion, a sub-channel of France's Jazz Radio network.",
    "h": "https://www.jazzradio.fr/radio/webradio"
   },
   {
    "n": "Jazz Radio - Blue",
    "u": "http://jazzblues.ice.infomaniak.ch/jazzblues-high.mp3",
    "d": "Mix of jazz and blues.",
    "h": "https://www.jazzradio.fr/radio/webradio"
   },
   {
    "n": "Jazz24",
    "u": "https://knkx-live-a.edge.audiocdn.com/6285_256k",
    "d": "Jazz from Seattle and Tacoma with blues, funk, and Latin jazz.",
    "h": "https://www.jazz24.org/",
    "f": 1
   },
   {
    "n": "KCSM Jazz 91.1",
    "u": "http://ice7.securenetsystems.net/KCSM2",
    "d": "Listener-supported jazz station from the College of San Mateo.",
    "h": "https://kcsm.org/"
   },
   {
    "n": "KEWU 89.5",
    "u": "https://streamer.radio.co/s3ba633066/listen",
    "d": "Straight-ahead jazz from Washington state.",
    "h": "https://www.ewu.edu/kewu/"
   },
   {
    "n": "KJazz 88.1",
    "u": "https://streaming.live365.com/a49833",
    "d": "Jazz and blues from Long Beach, CA.",
    "h": "https://kkjz.org/"
   },
   {
    "n": "KSDS Jazz 88.3",
    "u": "https://ksds-ice.streamguys1.com/ksds.mp3",
    "d": "Classic and contemporary jazz from San Diego.",
    "h": "https://www.jazz88.org/"
   },
   {
    "n": "Linn Jazz",
    "u": "http://radio.linn.co.uk:8000/autodj",
    "d": "Audiophile jazz streams from the Linn Records catalogue.",
    "h": "https://www.linn.co.uk/linn-radio"
   },
   {
    "n": "Octave Radio",
    "u": "https://octaverecords.out.airtime.pro/octaverecords_a",
    "d": "Audiophile DSD recordings from Paul McGowan's Octave Records studio in Colorado.",
    "h": "https://www.psaudio.com/blogs/pauls-posts/octave-radio"
   },
   {
    "n": "The Penthouse",
    "u": "http://sc1.mystreamserver.com:8052/,",
    "d": "Crooner and vocal jazz including Sinatra and Ella alongside modern vocalists.",
    "h": "https://thepenthouse.fm/"
   },
   {
    "n": "Radio Suisse Jazz",
    "u": "https://stream.srg-ssr.ch/m/rsj/aacp_96",
    "d": "Jazz, soul, and blues from Swiss public radio.",
    "h": "https://www.radioswissjazz.ch/en"
   },
   {
    "n": "Shonan Beach FM",
    "u": "http://shonanbeachfm.out.airtime.pro:8000/shonanbeachfm_a",
    "d": "Jazz and pop from the Japanese coast.",
    "h": "https://www.beachfm.co.jp/"
   },
   {
    "n": "The Jazz Groove - Mix 1",
    "u": "http://west-mp3-128.streamthejazzgroove.com/stream",
    "d": "Laid-back jazz spanning the 1950s to today, from a nonprofit funded entirely by listeners.",
    "h": "https://jazzgroove.org/?channel=mix1"
   },
   {
    "n": "SomaFM - Sonic Universe",
    "u": "https://somafm.com/sonicuniverse256.pls",
    "d": "Avant-garde jazz that bends tradition.",
    "h": "https://somafm.com/sonicuniverse/"
   },
   {
    "n": "TSF Jazz",
    "u": "http://tsfjazz.ice.infomaniak.ch/tsfjazz-high.mp3",
    "d": "Jazz and talk from Paris.",
    "h": "https://www.tsfjazz.com/"
   },
   {
    "n": "WBGO 88.3",
    "u": "https://ais-sa8.cdnstream1.com/3629_128.mp3",
    "d": "Public jazz station from Newark, NJ, NPR member station.",
    "h": "https://www.wbgo.org/",
    "f": 1
   },
   {
    "n": "WDNA 88.9",
    "u": "http://us9.streamingpulse.com:7033/stream",
    "d": "Jazz and Latin jazz from Miami.",
    "h": "https://wdnaradio.org"
   },
   {
    "n": "WKCR 89.9",
    "u": "https://wkcr.streamguys1.com:80/live",
    "d": "Columbia's deep jazz since 1941, including the Charlie Parker show Bird Flight.",
    "h": "https://www.cc-seas.columbia.edu/wkcr/"
   },
   {
    "n": "WUCF 89.9",
    "u": "http://peridot.streamguys.com:7830/WUCF",
    "d": "Jazz from the University of Central Florida in Orlando, since 1991.",
    "h": "https://www.wucf.org"
   },
   {
    "n": "WVPE - Blues3",
    "u": "https://wvpe-live.streamguys1.com/live",
    "d": "Dedicated blues output from WVPE in Elkhart, Indiana.",
    "h": "https://www.wvpe.org/show/blues-revue"
   }
  ]
 },
 {
  "g": "Metal & Heavy",
  "s": [
   {
    "n": "Core Radio",
    "u": "http://serv.coreradio.online:8000/coreradio",
    "d": "Deathcore, metalcore, post-hardcore, and hardcore.",
    "h": "https://coreradio.online/"
   },
   {
    "n": "Doomnation Radio",
    "u": "https://s2.voscast.com:11123/stream",
    "d": "Doom, sludge, stoner, and funeral doom from a metal webzine running since 2013.",
    "h": "https://www.doomnationradio.com/"
   },
   {
    "n": "Hard Rock Hell Radio",
    "u": "http://167.114.174.197:9254/stream",
    "d": "Rock and metal from the UK-based HRH Magazine, with named DJs and weekly shows.",
    "h": "https://hardrockhellradio.com/"
   },
   {
    "n": "ISKC - Extreme Metal",
    "u": "http://mediaserv68.live-streams.nl:8012/ExtremeMetal",
    "d": "Extreme metal sub-channel from the Netherlands-based ISKC Radio Group.",
    "h": "https://iskcrocks.com/"
   },
   {
    "n": "Metal Devastation",
    "u": "https://c13.radioboss.fm:18099/stream",
    "d": "All-genre extreme metal with live DJs and chat, from Jackson, Tennessee, since 2013.",
    "h": "https://metaldevastationradio.com/"
   },
   {
    "n": "Prog Palace Radio",
    "u": "https://cheetah.streemlion.com/progpalace64",
    "d": "Progressive and power metal since 1999, for fans of Dream Theater and Kamelot.",
    "h": "https://www.progpalaceradio.com/"
   },
   {
    "n": "SomaFM - Metal Detector",
    "u": "https://ice1.somafm.com/metal-128-aac",
    "d": "Black, doom, thrash, sludge, and industrial metal.",
    "h": "https://somafm.com/metal/"
   },
   {
    "n": "Terra Relicta Radio",
    "u": "https://a3.asurahosting.com/listen/terra/radio.mp3",
    "d": "Dark metal, doom, gothic, and black metal from a Slovenian dark-music webzine, since 2020.",
    "h": "https://www.terrarelicta.com/"
   },
   {
    "n": "TotalRock",
    "u": "https://s3.citrus3.com:8056/stream",
    "d": "Classic and modern rock and metal, founded 1997 by BBC's \"Voice of Metal\" Tommy Vance.",
    "h": "https://www.totalrock.com/"
   },
   {
    "n": "Violent Forces Radio - General Thrash",
    "u": "https://www.tuneintoradio1.com/listen/violent_forces_radio/radio.mp3",
    "d": "Thrash metal from the 1980s to today, dedicated to underground and established bands.",
    "h": "https://www.violentforcesradio.com"
   }
  ]
 },
 {
  "g": "News & Spoken Word",
  "s": [
   {
    "n": "AudioBookRadio",
    "u": "https://audiobookradio.out.airtime.pro/audiobookradio_a",
    "d": "Spoken word with Laurence Olivier in classic plays, audiobooks, and poetry readings.",
    "h": "http://www.audiobookradio.net/"
   },
   {
    "n": "BBC Radio 4",
    "u": "http://as-hls-ww-live.akamaized.net/pool_55057080/live/ww/bbc_radio_fourfm/bbc_radio_fourfm.isml/bbc_radio_fourfm-audio%3d128000.norewind.m3u8",
    "d": "News, drama, comedy, and spoken word from UK public service broadcaster.",
    "h": "https://www.bbc.co.uk/sounds/play/live/bbc_radio_fourfm"
   },
   {
    "n": "BBC World Service",
    "u": "http://stream.live.vc.bbcmedia.co.uk/bbc_world_service",
    "d": "International news and culture.",
    "h": "https://www.bbc.co.uk/sounds/play/live/bbc_world_service"
   },
   {
    "n": "Historyradio.org",
    "u": "http://stream.radiojar.com/6bmecgg3wd5tv",
    "d": "Literature, speeches, and audiobooks.",
    "h": "https://historyradio.org"
   },
   {
    "n": "Horror Radio",
    "u": "https://eu1.fastcast4u.com/proxy/stevende1?mp=/,",
    "d": "Vintage horror radio plays and eerie soundscapes.",
    "h": "https://darkentertainments.com/"
   },
   {
    "n": "The Ultimate Art Bell",
    "u": "http://stream.willstare.com:8450/,",
    "d": "Archive of classic Art Bell paranormal talk episodes.",
    "h": "https://www.willstare.com/art-bell-repository/"
   },
   {
    "n": "Vintage ROKiT - Crime and Suspense",
    "u": "http://streaming04.liveboxstream.uk:8168/stream",
    "d": "Restored crime and mystery dramas from vintage radio broadcasts.",
    "h": "https://rokitradio.com/"
   },
   {
    "n": "Monocle Radio",
    "u": "https://playerservices.streamtheworld.com/api/livestream-redirect/MONOCLE_24.mp3",
    "d": "Global affairs, urbanism and culture from the magazine’s studios.",
    "h": "https://monocle.com/radio/",
    "a": 1
   }
  ]
 },
 {
  "g": "Reggae & Dub",
  "s": [
   {
    "n": "Alpha Boys School Radio",
    "u": "http://alphaboys-live.streamguys1.com/alphaboys.mp3",
    "d": "Ska and rocksteady from the Kingston school that produced the Skatalites.",
    "h": "https://alphaboysschoolradio.com/",
    "f": 1
   },
   {
    "n": "Badam Radio",
    "u": "https://listen.radioking.com/radio/105610/stream/144949",
    "d": "Dub and reggae with African-influenced roots, based in France since 2017.",
    "h": "https://badam-radio.radioweb.co/"
   },
   {
    "n": "Dr. Dick's Dub Shack",
    "u": "https://streamer.radio.co/s0635c8b0d/listen",
    "d": "Dub, reggae, and bass-heavy electronic from Bermuda.",
    "h": "https://drdicksdubshack.com/",
    "f": 1
   },
   {
    "n": "FIP Reggae",
    "u": "http://icecast.radiofrance.fr/fipreggae-hifi.aac",
    "d": "Roots, dub, and rocksteady from the French public broadcaster in Paris.",
    "h": "https://www.radiofrance.fr/fip/radio-reggae"
   },
   {
    "n": "Irie FM",
    "u": "https://usa19.fastcast4u.com:7430/,",
    "d": "Jamaica's first all-reggae broadcaster, from Ocho Rios since 1990.",
    "h": "https://iriefm.net/"
   },
   {
    "n": "King Dub Radio",
    "u": "http://london-dedicated.myautodj.com:8862/stream",
    "d": "Roots and digital dub from France's King Dub Records label.",
    "h": "http://www.kingdubfamily.com/"
   },
   {
    "n": "UK Roots FM",
    "u": "http://138.201.198.218:8043/,",
    "d": "London's self-styled 'foundation station' - roots and revival since 1999.",
    "h": "https://ukrootsfm.net/"
   },
   {
    "n": "Kool 97 FM",
    "u": "https://stream.zeno.fm/we0agoxeeojvv",
    "d": "Kingston, Jamaica — reggae, oldies and dancehall.",
    "h": "https://kool97fm.com/",
    "a": 1
   }
  ]
 },
 {
  "g": "Rock, Indie, Alternative, Country & Folk",
  "s": [
   {
    "n": "Ace Cafe Radio",
    "u": "https://listen.radioking.com/radio/69079/stream/106852",
    "d": "Rock 'n' roll from London's Ace Cafe.",
    "h": "https://acecafe.com/ace-cafe-radio/"
   },
   {
    "n": "BAGeL Radio",
    "u": "http://ais-sa3.cdnstream1.com/2606_128.aac",
    "d": "Post-punk, psych rock, and indie from DJ Ted Leibowitz, live-hosted every Friday since 2003.",
    "h": "https://www.bagelradio.com/"
   },
   {
    "n": "BBC Radio 6 Music",
    "u": "http://as-hls-ww-live.akamaized.net/pool_81827798/live/ww/bbc_6music/bbc_6music.isml/bbc_6music-audio%3d320000.norewind.m3u8",
    "d": "Alternative music, new releases, and deep cuts.",
    "h": "https://www.bbc.co.uk/sounds/play/live/bbc_6music"
   },
   {
    "n": "Birch Street Radio",
    "u": "https://streaming.live365.com/a97155",
    "d": "Non-commercial mix of new music, classic rock, and indie, 60s to today.",
    "h": "https://birchstreetradio.com/"
   },
   {
    "n": "Boogaloo Radio",
    "u": "https://streams.radio.co/sb88c742f0/listen",
    "d": "Live from The Boogaloo pub in Highgate, London - rock, soul, and chat.",
    "h": "https://www.boogalooradio.com/"
   },
   {
    "n": "The Current",
    "u": "https://current.stream.publicradio.org/current.mp3",
    "d": "Indie rock and pop from Minnesota Public Radio.",
    "h": "https://thecurrent.org",
    "f": 1
   },
   {
    "n": "DARE FM",
    "u": "http://hydra.cdnstream.com/1552_128",
    "d": "New York's first alternative rock outlet, formerly WLIR, broadcasting since 1980.",
    "h": "https://wdarefm.com/"
   },
   {
    "n": "Delicious Agony",
    "u": "http://deliciousagony.streamguys1.com/",
    "d": "Rarities and full albums from progressive rock.",
    "h": "http://www.deliciousagony.com/"
   },
   {
    "n": "Folk Alley",
    "u": "https://freshgrass.streamguys1.com/folkalley-128mp3",
    "d": "Folk, roots, and Americana since 2003, now run by the FreshGrass Foundation.",
    "h": "https://folkalley.com/"
   },
   {
    "n": "Grateful Dead Radio",
    "u": "http://cassini.shoutca.st:8574/stream",
    "d": "Grateful Dead, Jerry Garcia Band, Ratdog, and other Dead-family projects.",
    "h": "https://www.gdradio.net/"
   },
   {
    "n": "Ignore Radio Shoegaze",
    "u": "https://sp1.autopo.st/8026/stream",
    "d": "Shoegaze and dream pop.",
    "h": "https://ignoreradio.com/"
   },
   {
    "n": "KEXP 90.3",
    "u": "https://kexp.streamguys1.com/kexp160.aac",
    "d": "Indie rock from Seattle, famous for live in-studio sessions.",
    "h": "https://www.kexp.org/listen/"
   },
   {
    "n": "Krautrock-World",
    "u": "https://krautrockworld.stream.laut.fm/krautrockworld",
    "d": "Dedicated krautrock, psychedelic, space rock, and progressive rock, run for an active listener community.",
    "h": "https://krautrockworld.com/"
   },
   {
    "n": "Live Jam Radio",
    "u": "https://stations.radio-host.com/proxy/livejam/stream",
    "d": "Exclusively live versions - every track, every artist, no studio recordings.",
    "h": "https://livejamradio.com/"
   },
   {
    "n": "Morow",
    "u": "https://www.morow.com/morow.pls",
    "d": "Progressive rock from Paris.",
    "h": "https://www.morow.com/"
   },
   {
    "n": "Nugs Radio",
    "u": "https://radio.nugs.net/nugsnet",
    "d": "Live rock and jam band recordings.",
    "h": "https://www.nugs.net/"
   },
   {
    "n": "Radio Paradise",
    "u": "http://stream-dc1.radioparadise.com/rp_192m.ogg",
    "d": "Mixed by a couple in Paradise, California, rock, world, and electronic.",
    "h": "https://radioparadise.com/"
   },
   {
    "n": "Radio Woodstock",
    "u": "https://stream.revma.ihrhls.com/zc7332",
    "d": "AAA rock, indie, folk, and live Hudson Valley music.",
    "h": "https://radiowoodstock.com/"
   },
   {
    "n": "Real Punk Radio",
    "u": "http://149.56.155.73:8080/stream",
    "d": "100% DIY station spanning punk, ska, rockabilly, psychobilly, and old-school country under one punk ethos.",
    "h": "https://realpunkradio.com/"
   },
   {
    "n": "The SoCal Sound",
    "u": "https://stream.thesocalsound.org/1",
    "d": "Album-alternative and Americana from Cal State Northridge public radio.",
    "h": "https://thesocalsound.org/"
   },
   {
    "n": "Yacht Rock Miami",
    "u": "https://usa20.fastcast4u.com:4100/1753014835",
    "d": "Yacht rock from Miami.",
    "h": "https://yachtrockmiami.com/"
   }
  ]
 },
 {
  "g": "Video Game, Chiptune & Soundtracks",
  "s": [
   {
    "n": "Arcade Radio",
    "u": "https://server10.reliastream.com/proxy/arcaderadio?mp=/stream2",
    "d": "CD-era console soundtracks - PC Engine, Sega CD, Neo Geo - plus anime.",
    "h": "https://arcaderadio.com/index.html"
   },
   {
    "n": "Cinemix",
    "u": "https://kathy.torontocast.com:1825/stream",
    "d": "Orchestral movie soundtracks, regularly updated, broadcasting from France since 2003.",
    "h": "https://www.cinemix.us/"
   },
   {
    "n": "Classic FM - Video Game Music",
    "u": "https://icecast.thisisdax.com/ClassicFM-M-Gaming",
    "d": "Hand-picked orchestral video game soundtracks from the UK's Classic FM, a dedicated stream since 2018.",
    "h": "https://www.classicfm.com/discover-music/periods-genres/video-game/"
   },
   {
    "n": "Classic Videogames",
    "u": "http://195.201.9.210:1541/stream/2/",
    "d": "Original game music and remixes from classic computers, consoles, and the demoscene.",
    "h": "https://www.classic-videogames.de/radio/"
   },
   {
    "n": "COMMODEXPLORER",
    "u": "https://manager8.streamradio.fr:2295/stream",
    "d": "Demo and retro game music from Amiga, Commodore, and Amstrad, run since 2013 by Stef.",
    "h": "https://commodexplorer.c-prod.net/"
   },
   {
    "n": "CVGM",
    "u": "https://slacker.cvgm.net/cvgm192",
    "d": "Video game, demoscene, and computer music from thousands of original composers.",
    "h": "https://www.cvgm.net/"
   },
   {
    "n": "Ericade Radio",
    "u": "https://radio.ericade.net/sc/stream/1/",
    "d": "Tracked music and chiptunes from Stockholm's DJ Daemon, relaunched in 2020 after a decade off.",
    "h": "https://radio.ericade.net/"
   },
   {
    "n": "FunkyUncleFM",
    "u": "https://funkyunclefm.net/stream_vorbis192",
    "d": "Fan-made community radio for the Bomb Rush Cyberfunk game.",
    "h": "https://funkyunclefm.net"
   },
   {
    "n": "Gensokyo Radio",
    "u": "https://stream.gensokyoradio.net/3",
    "d": "Fan-made Touhou Project music supporting independent artists and original album releases since 2011.",
    "h": "https://gensokyoradio.net"
   },
   {
    "n": "GTA Radio",
    "u": "https://stream.laut.fm/gta-classics",
    "d": "Soundtracks from the Grand Theft Auto series.",
    "h": "https://laut.fm/gta-classics"
   },
   {
    "n": "Gyusyabu",
    "u": "http://gyusyabu.ddo.jp:8000/;stream.mp3",
    "d": "Retro Japanese PC game music from the 1980s-90s, PSG and FM synthesis only.",
    "h": "http://gyusyabu.ddo.jp/"
   },
   {
    "n": "Kaaosradio",
    "u": "https://kaaosradio.fi:8001/chip",
    "d": "Finnish chiptunes, bitpop, and tracker music from the Chipstream channel.",
    "h": "https://kaaosradio.fi/"
   },
   {
    "n": "Kohina",
    "u": "https://kohina.duckdns.org/icecast/stream.ogg",
    "d": "8-bit and 16-bit computer music (C64, Amiga).",
    "h": "https://kohina.com"
   },
   {
    "n": "LapFox Radio",
    "u": "https://radio.lapfoxradio.com/radio/8000/stream-ogg-320.ogg",
    "d": "Entire Halley Labs catalog spanning breakcore, chiptune, gabber, ambient, and more.",
    "h": "https://lapfoxradio.com"
   },
   {
    "n": "Liquid DooM Radio",
    "u": "http://83.240.65.106:8000/doom",
    "d": "Soundtracks from the DOOM franchise.",
    "h": "https://liquiddoom.net/"
   },
   {
    "n": "Nectarine",
    "u": "http://necta.burn.net:8000/nectarine",
    "d": "Demoscene music, tracker modules, and scene productions, broadcasting since 2001.",
    "h": "https://www.scenestream.net/"
   },
   {
    "n": "No Life Radio",
    "u": "https://listen.nolife-radio.com/stream",
    "d": "Fan-made and independent game music alongside official soundtracks, from 8-bit to modern.",
    "h": "https://nolife-radio.com/"
   },
   {
    "n": "Radio Rivendell",
    "u": "https://play.radiorivendell.com/radio/8000/radio.mp3",
    "d": "Fantasy soundtracks and Celtic folk for roleplaying and writing, non-commercial and online since 2001.",
    "h": "https://radiorivendell.com/"
   },
   {
    "n": "RadioSEGA",
    "u": "http://content.radiosega.net:8006/live",
    "d": "SEGA game music and remixes, broadcasting fan shows since 2006.",
    "h": "https://www.radiosega.net/"
   },
   {
    "n": "Rainwave - Game",
    "u": "http://allrelays.rainwave.cc/game.mp3",
    "d": "Interactive game music with listener voting.",
    "h": "https://rainwave.cc/",
    "f": 1
   },
   {
    "n": "RPGamers Radio",
    "u": "https://listen.rpgamers.net/rpgn",
    "d": "Listener-driven game music from 8-bit NES to modern releases, with a request system.",
    "h": "https://www.rpgamers.net/radio/"
   },
   {
    "n": "SceneSat",
    "u": "http://oscar.scenesat.com:8000/scenesatmax",
    "d": "Demoscene and tracker module music.",
    "h": "https://scenesat.com/"
   },
   {
    "n": "Shmup Radio",
    "u": "https://stream.shmupradio.com/320",
    "d": "Shoot-'em-up game soundtracks spanning 8-bit chiptune to orchestral arrangements, collecting scores since 2019.",
    "h": "https://shmupradio.com/en/"
   },
   {
    "n": "Slay Radio",
    "u": "http://relay4.slayradio.org:8300/",
    "d": "Swedish station since 1999, Commodore 64 remixes with live community shows.",
    "h": "https://slayradio.org/"
   },
   {
    "n": "SpriteLayer",
    "u": "http://www.spritelayerradio.com:8010/all",
    "d": "Classic chiptunes and modern video game soundtracks.",
    "h": "https://www.spritelayerradio.com/"
   }
  ]
 },
 {
  "g": "World & Regional",
  "s": [
   {
    "n": "Alefa Music",
    "u": "http://www.radioking.com/play/alefamusic",
    "d": "Malagasy salegy and tsapiky from a Paris-based diaspora project.",
    "h": "https://alefamusic.net/"
   },
   {
    "n": "CeltCast",
    "u": "http://caster04.streampakket.com:8982/1_mp3_192",
    "d": "Volunteer-run Viking, Pagan and Celtic folk station since 2014, with its own Fantasy Awards.",
    "h": "https://celtcast.com/"
   },
   {
    "n": "Celtic Music Radio",
    "u": "https://streaming.broadcastradio.com:11135/celtic",
    "d": "Glasgow's volunteer community broadcaster for Celtic, folk, and traditional music, with ties to Celtic Connections.",
    "h": "https://www.celticmusicradio.net/"
   },
   {
    "n": "CeolFM",
    "u": "https://listen.ceol.fm/auto",
    "d": "Musician-led Irish traditional music with dedicated fiddle, pipes, songs, and reel streams.",
    "h": "https://ceol.fm/"
   },
   {
    "n": "Daybreak Star Radio",
    "u": "http://ice9.securenetsystems.net/DSR",
    "d": "Indigenous music network from Seattle's Daybreak Star Cultural Center, since 2021.",
    "h": "https://daybreakstarradio.com"
   },
   {
    "n": "Gladys Palmera Colección",
    "u": "http://streams.radio.co/s496c4d2e8/listen",
    "d": "Archive of vintage Latin and Afro-Caribbean music.",
    "h": "https://gladyspalmera.com/coleccion",
    "f": 1
   },
   {
    "n": "J1 Radio - Gold",
    "u": "http://gold.j1fm.tokyo/",
    "d": "Japanese pop and enka, 1950s to 1989.",
    "h": "https://www.j1fm.tokyo"
   },
   {
    "n": "KBON 101.1",
    "u": "http://ice64.securenetsystems.net/KBON",
    "d": "South Louisiana station since 1997, Cajun, zydeco, and swamp pop.",
    "h": "https://www.kbon.com/"
   },
   {
    "n": "listen.moe",
    "u": "https://listen.moe/stream",
    "d": "Anime and J-Pop, run by a small team of volunteers.",
    "h": "https://listen.moe/"
   },
   {
    "n": "Oroko Radio",
    "u": "https://oroko-radio.radiocult.fm/stream",
    "d": "Afro indie, folk, and soul from Accra, Ghana.",
    "h": "https://oroko.live/"
   },
   {
    "n": "Pan African Space Station",
    "u": "https://pass.out.airtime.pro/pass_a",
    "d": "Live music, performance, and experimental pan-African sounds from Cape Town.",
    "h": "https://panafricanspacestation.org.za/",
    "f": 1
   },
   {
    "n": "Pyongyang Radio FM",
    "u": "https://listen7.myradio24.com/69366",
    "d": "North Korean state radio via online relays.",
    "h": "https://kfaspain.es/emisora-central-de-corea-pyongyang-fm/"
   },
   {
    "n": "Radio Al-Hara",
    "u": "https://stream.radiojar.com/78cxy6wkxtzuv",
    "d": "Experimental beats, talk, and underground Palestinian culture, broadcasting since 2020.",
    "h": "https://www.radioalhara.net/"
   },
   {
    "n": "Seribatu",
    "u": "http://radioseribatu.out.airtime.pro:8000/radioseribatu_a",
    "d": "Javanese and Balinese gamelan recordings.",
    "h": "https://www.radioseribatu.com/radioseribatu",
    "f": 1
   },
   {
    "n": "Svensk Folkmusik AkkA",
    "u": "https://mediaserv38.live-streams.nl:8107/stream",
    "d": "33,000+ tracks of Swedish folk music, run by two enthusiasts in the Netherlands.",
    "h": "https://www.svenskfolkmusik.nu/"
   }
  ]
 },
 {
  "g": "Christmas & Holiday",
  "s": [
   {
    "n": "Christmas FM Ireland",
    "u": "https://christmasfm.cdnstream1.com/2547_128.mp3",
    "d": "Irish seasonal broadcasts supporting children's charities nationwide.",
    "h": "https://christmasfm.com/"
   },
   {
    "n": "WALM - Christmas Vinyl",
    "u": "https://icecast.walmradio.com:8443/christmas",
    "d": "Vintage Christmas music.",
    "h": "https://walmradio.com/station.php?station=christmas"
   }
  ]
 },
 {
  "g": "Lossless (CD-quality FLAC)",
  "s": [
   {
    "n": "Radio Paradise — Main Mix (FLAC)",
    "u": "https://stream.radioparadise.com/flac",
    "d": "The hand-curated eclectic rock mix, lossless.",
    "h": "https://radioparadise.com/",
    "q": 1
   },
   {
    "n": "Radio Paradise — Mellow Mix (FLAC)",
    "u": "https://stream.radioparadise.com/mellow-flac",
    "d": "Radio Paradise’s gentler channel, lossless.",
    "h": "https://radioparadise.com/",
    "q": 1
   },
   {
    "n": "Radio Paradise — Rock Mix (FLAC)",
    "u": "https://stream.radioparadise.com/rock-flac",
    "d": "Radio Paradise’s harder channel, lossless.",
    "h": "https://radioparadise.com/",
    "q": 1
   },
   {
    "n": "Radio Paradise — World/Eclectic Mix (FLAC)",
    "u": "https://stream.radioparadise.com/eclectic-flac",
    "d": "Radio Paradise’s world and eclectic channel, lossless.",
    "h": "https://radioparadise.com/",
    "q": 1
   },
   {
    "n": "Naim Radio",
    "u": "https://mscp3.live-streams.nl:8362/flac.flac",
    "d": "The hi-fi maker’s eclectic house channel — an audiophile institution.",
    "h": "https://www.naimaudio.com/",
    "q": 1
   },
   {
    "n": "Naim Jazz",
    "u": "https://mscp3.live-streams.nl:8342/jazz-flac.flac",
    "d": "Naim’s jazz channel, lossless.",
    "h": "https://www.naimaudio.com/",
    "q": 1
   },
   {
    "n": "Naim Classical",
    "u": "https://mscp3.live-streams.nl:8252/class-flac.flac",
    "d": "Naim’s classical channel, lossless.",
    "h": "https://www.naimaudio.com/",
    "q": 1
   },
   {
    "n": "ČRo Vltava",
    "u": "https://amp.cesnet.cz:8443/cro3.flac",
    "d": "Czech Radio’s culture channel — classical, drama, arts.",
    "h": "https://vltava.rozhlas.cz/",
    "q": 1
   },
   {
    "n": "ČRo D-dur",
    "u": "https://amp.cesnet.cz:8443/cro-d-dur.flac",
    "d": "Czech Radio’s all-classical channel, lossless.",
    "h": "https://d-dur.rozhlas.cz/",
    "q": 1
   },
   {
    "n": "ČRo Jazz",
    "u": "https://amp.cesnet.cz:8443/cro-jazz.flac",
    "d": "Czech Radio’s jazz channel, lossless.",
    "h": "https://jazz.rozhlas.cz/",
    "q": 1
   },
   {
    "n": "ČRo Radio Wave",
    "u": "https://amp.cesnet.cz:8443/cro-radio-wave.flac",
    "d": "Czech Radio’s young-audience channel, lossless.",
    "h": "https://wave.rozhlas.cz/",
    "q": 1
   },
   {
    "n": "KALX 90.7 Berkeley",
    "u": "https://stream.kalx.berkeley.edu:8443/kalx.flac",
    "d": "UC Berkeley student/community freeform, lossless.",
    "h": "https://kalx.berkeley.edu/",
    "q": 1
   },
   {
    "n": "ISEKOI Ambient (FLAC)",
    "u": "https://isekoi-radio.com/listen/ambient/ambientradio.flac",
    "d": "Ambient transmissions from an exoplanet 63 light-years away, lossless.",
    "h": "https://isekoi-radio.com/public/isekoi",
    "q": 1
   },
   {
    "n": "Le Son Parisien",
    "u": "http://stream.lesonparisien.com/live.flac",
    "d": "Electronic, indie and lounge from Paris, lossless.",
    "h": "https://www.lesonparisien.com/en/",
    "q": 1
   }
  ]
 }
];
