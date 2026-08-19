// Dictation — talking into the document.
//
// This knows nothing about AI, on purpose. It puts words at the caret; making
// them tidy is an ordinary AI action ("Clean up dictation", stdin: selection,
// output: insert) which you can edit, replace, or not use at all. Two features
// that can be understood separately are worth more than one that can't.
//
// The recognizer is the engine's own — `webkitSpeechRecognition`, which WebKit
// and WebView2 both have and WebKitGTK does not, so on Linux the button never
// appears rather than appearing broken. A packaged app must declare BOTH
// "microphone" and "speechRecognition" in tinyjs.json's permissions or the OS
// refuses the service outright, with no prompt and no explanation — which is
// what the `service-not-allowed` case below is really saying.

(() => {
  const Recognizer = window.SpeechRecognition || window.webkitSpeechRecognition;

  function setupSpeech({ button, insertText, toast, textBefore }) {
    if (!Recognizer) return { available: false, setEnabled() {}, toggle() {} };

    let rec = null;
    let on = false;
    let pill = null;
    let wanted = false;               // the setting, not the state

    // What the interim text looks like while it is still being decided. It is
    // NOT inserted — a document that fills with guesses and un-fills again is
    // unusable, and undo would carry every revision.
    function showPill(text) {
      if (!pill) {
        pill = document.createElement('div');
        pill.id = 'micPill';
        document.body.appendChild(pill);
      }
      pill.textContent = text || 'Listening…';
      pill.hidden = false;
    }
    const hidePill = () => { if (pill) pill.hidden = true; };

    // Spoken text arrives without the spacing a document wants: no leading
    // space after a word, a capital after a full stop. Both are decided from
    // what is already to the left of the caret, which is the only thing that
    // can know.
    function fit(text) {
      const before = (textBefore ? textBefore() : '') || '';
      let s = text.trim();
      if (!s) return '';
      const prev = before.slice(-2);
      const needsSpace = before && !/\s$/.test(before) && !/^[,.;:!?]/.test(s);
      if (/[.!?]\s*$/.test(prev) || !before.trim()) s = s[0].toUpperCase() + s.slice(1);
      return (needsSpace ? ' ' : '') + s;
    }

    function start() {
      if (on) return;
      let wantsMore = true;
      rec = new Recognizer();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = navigator.language || 'en-US';

      rec.onstart = () => {
        on = true;
        button.classList.add('live');
        showPill('');
      };
      rec.onresult = (e) => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) {
            const s = fit(r[0].transcript);
            if (s) insertText(s);
          } else {
            interim += r[0].transcript;
          }
        }
        showPill(interim);
      };
      rec.onerror = (e) => {
        // The two that mean something specific. Everything else is a network
        // or audio hiccup and stopping quietly is the right answer.
        if (e.error === 'service-not-allowed') {
          toast('Dictation was refused by the system — Nib needs microphone and '
            + 'speech-recognition permission');
        } else if (e.error === 'not-allowed') {
          toast('Dictation needs the microphone — allow it in System Settings ▸ Privacy');
        } else if (e.error === 'no-speech') {
          return;                       // it just went quiet; onend restarts
        }
        stop();
      };
      // Recognizers stop themselves after a pause. Continuous means continuous
      // to the person holding the button, so it goes again until they say no.
      rec.onend = () => {
        if (on && wantsMore) { try { rec.start(); return; } catch { /* fall through */ } }
        stop();
      };

      rec.stopWanted = () => { wantsMore = false; };
      try { rec.start(); } catch (e) { toast('Dictation didn’t start: ' + e.message); }
    }

    function stop() {
      if (rec) {
        if (rec.stopWanted) rec.stopWanted();
        try { rec.stop(); } catch { /* already stopped */ }
      }
      rec = null;
      on = false;
      button.classList.remove('live');
      hidePill();
    }

    const toggle = () => (on ? stop() : start());
    button.onclick = toggle;

    addEventListener('keydown', (e) => {
      // ⌃⌘D on a Mac, ⌃⇧D elsewhere. Both modifiers are required: bare ⌃D is
      // delete-forward in every macOS text field and taking it would be rude.
      const combo = navigator.platform.startsWith('Mac')
        ? (e.ctrlKey && e.metaKey) : (e.ctrlKey && e.shiftKey);
      if (combo && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault();
        if (wanted) toggle();
      }
      if (e.key === 'Escape' && on) stop();
    }, true);

    return {
      available: true,
      setEnabled(v) {
        wanted = !!v;
        button.hidden = !wanted;
        if (!wanted && on) stop();
      },
      toggle,
      get listening() { return on; },
    };
  }

  window.setupSpeech = setupSpeech;
})();
