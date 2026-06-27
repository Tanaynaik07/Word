// ==========================================
//  WORDTIDE — GAME LOGIC
//
//  Scoring model (v2):
//    • Green letter pts decay by guess number:
//        Guess 1 → +10/letter, Guess 2 → +8, Guess 3 → +6, Guess 4 → +4, Guess 5+ → +2
//    • Completion bonus on win scales with attempts used:
//        1 guess → +1000, 2 → +800, 3 → +600, 4 → +400, 5 → +200, 6+ → +100
//    • Time bonus on win: +0.5 pt per second remaining (speed reward, not dominant)
//    • No wrong-guess penalty — score only ever climbs during play
//    • Star rank:  ⭐⭐⭐ ≥ 900 pts | ⭐⭐ ≥ 500 | ⭐ ≥ 150
//    • MIN_ATTEMPTS floor of 5 prevents short words from being unwinnable
//    • Word validation: guesses must pass Free Dictionary API (or be in WORD_DB)
//    • GA4 analytics: key events fired throughout gameplay
//    • Game sessions logged to Firestore (wins + losses) via submitGameSession
//    • Player profiles updated in Firestore after every game via updatePlayerProfile
//    • Streak tracked ONLY for the daily special word
// ==========================================

import {
  signInWithGoogle,
  signOutUser,
  onUserChange,
  getCurrentUser,
  submitScore,
  getTopScores,
  getTodayScores,
  submitGameSession,
  updatePlayerProfile,
  getAnnouncement,
  getStreakFromFirestore,
  saveStreakToFirestore,
} from './firebase.js';

// ── GAME CONSTANTS ────────────────────────
const TIMER_DURATION      = 300;                    // 5 minutes in seconds
const TIMER_CIRCUMFERENCE = 2 * Math.PI * 24;       // SVG ring circumference
const FLIP_DELAY          = 300;                    // ms between tile flips
const STARTING_SCORE      = 0;                      // score climbs from zero (positive model)
const MIN_ATTEMPTS        = 5;                      // floor so short words aren't unwinnable

// ── SCORING MODEL ─────────────────────────
// Green letter points decay per guess number (earlier = more rewarding):
//   Guess 1 → 10 pts, Guess 2 → 8 pts, Guess 3 → 6 pts, Guess 4 → 4 pts, Guess 5+ → 2 pts
// Completion bonus scales down per attempt used:
//   Solved in 1 → 1000 pts, 2 → 800, 3 → 600, 4 → 400, 5 → 200, 6+ → 100
// Time bonus: +0.5 pt per second remaining (capped — speed matters but doesn't dominate)
// Star thresholds:   ⭐⭐⭐ ≥ 900 | ⭐⭐ ≥ 500 | ⭐ ≥ 150
const GREEN_PTS_BY_GUESS  = [10, 8, 6, 4, 2];      // index = guess number (0-based), last value repeats
const COMPLETION_BONUS    = [1000, 800, 600, 400, 200, 100]; // index = attempts used (1-based maps to [0])
const TIME_BONUS_RATE     = 0.5;                    // pts per second remaining
const STAR_THRESHOLDS     = { three: 900, two: 500, one: 150 };
// ─────────────────────────────────────────

// ── GAME STATE ────────────────────────────
let state = {
  phase:         'topic',
  word:          '',
  hint:          '',
  topicName:     '',
  topicId:       '',
  isSpecialWord: false,       // true only when playing Word of the Day
  wordLen:       0,
  maxAttempts:   0,
  currentAttempt: 0,
  currentInput:  [],
  guessResults:  [],
  letterMap:     {},          // letter → 'correct'|'present'|'absent' (best seen so far)
  score:         STARTING_SCORE,
  timerLeft:     TIMER_DURATION,
  timerInterval: null,
  gameOver:      false,
  won:           false,
  streak:        0,
  lastPlayedDate: null,
  hasPlayedTodaySpecial: false, // prevents replaying the daily word to farm streak
  isRevealing:   false,       // true while tile flip animation runs (blocks input)
  isValidating:  false,       // true while dictionary API call is in-flight (blocks double-submit)
  hintsUsed:      0,          // number of letters revealed by hint this game (max = word length)
  revealedByHint: [],         // indices revealed by the hint button
  warningPlayed: false,       // one-shot flag for 60-second sound cue
  dangerPlayed:  false,       // one-shot flag for 30-second sound cue
  user:          null,
};
// ─────────────────────────────────────────

// ── DOM ELEMENT CACHE ─────────────────────
const els = {
  topicScreen:       document.getElementById('topicScreen'),
  gameScreen:        document.getElementById('gameScreen'),
  resultScreen:      document.getElementById('resultScreen'),
  topicGrid:         document.getElementById('topicGrid'),
  specialWordBtn:    document.getElementById('specialWordBtn'),
  swHint:            document.getElementById('swHint'),
  dayLabel:          document.getElementById('dayLabel'),
  topicTag:          document.getElementById('topicTag'),
  backBtn:           document.getElementById('backBtn'),
  scoreDisplay:      document.getElementById('scoreDisplay'),
  timerText:         document.getElementById('timerText'),
  timerRing:         document.getElementById('timerRing'),
  attemptsPips:      document.getElementById('attemptsPips'),
  wordHint:          document.getElementById('wordHint'),
  categoryHint:      document.getElementById('categoryHint'),
  guessBoard:        document.getElementById('guessBoard'),
  keyboard:          document.getElementById('keyboard'),
  floatContainer:    document.getElementById('floatContainer'),
  revealHintBtn:     document.getElementById('revealHintBtn'),
  resultEmoji:       document.getElementById('resultEmoji'),
  resultTitle:       document.getElementById('resultTitle'),
  revealWord:        document.getElementById('revealWord'),
  finalScore:        document.getElementById('finalScore'),
  finalTime:         document.getElementById('finalTime'),
  finalStreak:       document.getElementById('finalStreak'),
  resultBoardMini:   document.getElementById('resultBoardMini'),
  shareBtn:          document.getElementById('shareBtn'),
  playAgainBtn:      document.getElementById('playAgainBtn'),
  nextWordNotice:    document.getElementById('nextWordNotice'),
  nextWordCountdown: document.getElementById('nextWordCountdown'),
  toast:             document.getElementById('toast'),
  howToBtn:          document.getElementById('howToBtn'),
  howToModal:        document.getElementById('howToModal'),
  closeModal:        document.getElementById('closeModal'),
  streakCount:       document.getElementById('streakCount'),
  muteBtn:           document.getElementById('muteBtn'),
  // Auth & leaderboard buttons are injected dynamically by buildAuthUI()
  authBtn:           null,
  leaderboardBtn:    null,
  leaderboardModal:  null,
};
// ─────────────────────────────────────────


// ==========================================
//  GA4 ANALYTICS HELPERS
//
//  gtag() is provided by the GA4 snippet in index.html.
//  All calls are guarded so missing gtag never throws.
//
//  Events fired:
//    game_start       → topic selected / word of the day started
//    guess_submitted  → every time a guess row is evaluated
//    game_complete    → game finished (win or loss)
//    share_score      → share button tapped
// ==========================================

/** Fire a GA4 custom event. Silently no-ops if gtag is not loaded. */
function gtagEvent(eventName, params = {}) {
  if (typeof gtag === 'function') {
    gtag('event', eventName, params);
  }
}


// ==========================================
//  INIT
// ==========================================
function init() {
  loadPersistence();
  renderDayLabel();
  renderTopicGrid();
  updateDailyWordHint();
  buildKeyboard();
  buildAuthUI();
  buildLeaderboardModal();
  bindEvents();
  showScreen('topic');
  loadAnnouncement(); // fetch banner from Firestore

  // Keep state.user in sync with Firebase Auth changes
  onUserChange(async user => {
    state.user = user;
    updateAuthButton();
    // When a user signs in, pull their authoritative streak from Firestore
    // and override whatever was loaded from localStorage.
    if (user) {
      const remote = await getStreakFromFirestore();
      if (remote !== null) {
        state.streak         = remote.streak;
        state.lastPlayedDate = remote.lastPlayedDate;
        // Auto-reset if they haven't played in more than one day
        const today     = getDateString();
        const yesterday = getDateString(-1);
        if (
          state.lastPlayedDate &&
          state.lastPlayedDate !== today &&
          state.lastPlayedDate !== yesterday
        ) {
          state.streak = 0;
          await saveStreakToFirestore({ streak: 0, lastPlayedDate: state.lastPlayedDate });
        }
        els.streakCount.textContent = state.streak;
        updateSpecialWordButton();
      }
    }
  });
}


// ==========================================
//  AUTH UI
//  Google sign-in button and leaderboard
//  button are injected into the header at
//  runtime so the HTML stays auth-agnostic.
// ==========================================

function buildAuthUI() {
  const headerStats = document.querySelector('.header-stats');
  if (!headerStats) return;

  // ── Sign-in / avatar button ──
  const authBtn = document.createElement('button');
  authBtn.className = 'btn-icon auth-btn';
  authBtn.id        = 'authBtn';
  authBtn.title     = 'Sign in with Google';
  authBtn.setAttribute('aria-label', 'Sign in');
  authBtn.textContent = '👤';
  headerStats.insertBefore(authBtn, headerStats.firstChild);
  els.authBtn = authBtn;

  // ── Leaderboard button ──
  const lbBtn = document.createElement('button');
  lbBtn.className = 'btn-icon';
  lbBtn.id        = 'leaderboardBtn';
  lbBtn.title     = 'Leaderboard';
  lbBtn.setAttribute('aria-label', 'Leaderboard');
  lbBtn.textContent = '🏆';
  headerStats.insertBefore(lbBtn, headerStats.firstChild);
  els.leaderboardBtn = lbBtn;

  authBtn.addEventListener('click', handleAuthClick);
  lbBtn.addEventListener('click', openLeaderboard);
}

/** Reflect signed-in state on the auth button (avatar photo vs generic icon). */
function updateAuthButton() {
  if (!els.authBtn) return;
  if (state.user) {
    // Sanitise display name against XSS (title attribute, not innerHTML, but be safe)
    const safeName = escHtml(state.user.displayName || 'User');
    els.authBtn.title = `Signed in as ${safeName} — click to sign out`;
    els.authBtn.textContent = state.user.photoURL ? '' : '✅';
    if (state.user.photoURL) {
      // Guard: only allow https:// URLs for the avatar to prevent CSS injection
      const url = state.user.photoURL;
      if (/^https:\/\//.test(url)) {
        els.authBtn.style.backgroundImage = `url(${JSON.stringify(url)})`;
        els.authBtn.style.backgroundSize  = 'cover';
        els.authBtn.style.borderRadius    = '50%';
      }
    }
  } else {
    els.authBtn.title          = 'Sign in with Google';
    els.authBtn.textContent    = '👤';
    els.authBtn.style.backgroundImage = '';
  }
}

async function handleAuthClick() {
  if (state.user) {
    await signOutUser();
    showToast('Signed out');
  } else {
    showToast('Opening Google sign-in…');
    const user = await signInWithGoogle();
    if (user) showToast(`Welcome, ${user.displayName}! 🌊`);
    else       showToast('Sign-in cancelled');
  }
}


// ==========================================
//  LEADERBOARD MODAL
//  Injected at runtime so it can be shown
//  from any screen without changing index.html.
// ==========================================

function buildLeaderboardModal() {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id        = 'leaderboardModal';
  modal.setAttribute('role',       'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', 'Leaderboard');
  modal.innerHTML = `
    <div class="modal leaderboard-modal">
      <button class="modal-close" id="closeLbModal" aria-label="Close">✕</button>
      <h2 class="modal-title">🏆 Leaderboard</h2>
      <div class="lb-tabs">
        <button class="lb-tab active" data-tab="today">Today</button>
        <button class="lb-tab"        data-tab="alltime">All-Time</button>
      </div>
      <div class="lb-body" id="lbBody">
        <div class="lb-loading">Loading scores…</div>
      </div>
      <p class="lb-note">Only winning games are recorded. Sign in to appear on the board.</p>
    </div>
  `;
  document.body.appendChild(modal);
  els.leaderboardModal = modal;

  document.getElementById('closeLbModal').addEventListener('click', () => {
    modal.classList.remove('open');
  });
  // Clicking the dark overlay also closes the modal
  modal.addEventListener('click', e => {
    if (e.target === modal) modal.classList.remove('open');
  });
  // Tab switching
  modal.querySelectorAll('.lb-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      modal.querySelectorAll('.lb-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      loadLeaderboard(tab.dataset.tab);
    });
  });
}

async function openLeaderboard() {
  Audio.sfx.keyClick();
  els.leaderboardModal.classList.add('open');
  loadLeaderboard('today');
}

async function loadLeaderboard(tab) {
  const body = document.getElementById('lbBody');
  body.innerHTML = '<div class="lb-loading">Loading…</div>';
  try {
    const scores = tab === 'today'
      ? await getTodayScores(10)
      : await getTopScores(10);

    if (!scores.length) {
      body.innerHTML = '<div class="lb-empty">No scores yet today. Be the first! 🌊</div>';
      return;
    }

    const currentUid = state.user?.uid;
    body.innerHTML = scores.map((s, i) => {
      // Only allow https:// photo URLs from Firestore to prevent injection
      const safePhoto = (s.photoURL && /^https:\/\//.test(s.photoURL))
        ? escHtml(s.photoURL) : null;
      return `
      <div class="lb-row ${s.uid === currentUid ? 'lb-me' : ''}">
        <span class="lb-rank">${i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}</span>
        ${safePhoto
          ? `<img class="lb-avatar" src="${safePhoto}" alt="" />`
          : '<div class="lb-avatar-placeholder">👤</div>'
        }
        <span class="lb-name">${escHtml(s.name)}</span>
        <span class="lb-topic">${escHtml(s.topicName || '')}</span>
        <span class="lb-score">${Number.isFinite(s.score) ? Math.floor(s.score) : 0} pts</span>
        ${(s.streak > 0 && Number.isFinite(s.streak)) ? `<span class="lb-streak">${Math.floor(s.streak)}🔥</span>` : ''}
      </div>`;
    }).join('');
  } catch (err) {
    body.innerHTML = '<div class="lb-empty">Could not load scores. Check your Firebase config.</div>';
    console.error(err);
  }
}

/** Minimal HTML-escape to prevent XSS in leaderboard names. */
function escHtml(str) {
  return String(str).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}


// ==========================================
//  PERSISTENCE  (localStorage)
//  Only streak data is stored locally.
//  Everything else lives in Firestore.
// ==========================================

function loadPersistence() {
  try {
    const saved = JSON.parse(localStorage.getItem('wordtide_data') || '{}');
    state.streak         = saved.streak         || 0;
    state.lastPlayedDate = saved.lastPlayedDate || null;

    // Restore the "already played daily word today" gate —
    // only valid if the saved date matches today.
    const today     = getDateString();
    const yesterday = getDateString(-1);
    state.hasPlayedTodaySpecial =
      saved.hasPlayedTodaySpecial === true && saved.lastPlayedDate === today;

    // Auto-reset streak if the player missed more than one day without a daily win
    if (
      state.lastPlayedDate &&
      state.lastPlayedDate !== today &&
      state.lastPlayedDate !== yesterday
    ) {
      state.streak = 0;
      savePersistence();
    }
  } catch (e) { /* ignore corrupt storage */ }

  els.streakCount.textContent = state.streak;
  updateSpecialWordButton();
}

function savePersistence() {
  // Always keep localStorage as a fallback for anonymous users
  try {
    localStorage.setItem('wordtide_data', JSON.stringify({
      streak:               state.streak,
      lastPlayedDate:       state.lastPlayedDate,
      hasPlayedTodaySpecial: state.hasPlayedTodaySpecial,
    }));
  } catch (e) { /* ignore storage errors (private browsing etc.) */ }

  // For signed-in users, streak is authoritative in Firestore
  if (state.user) {
    saveStreakToFirestore({
      streak:         state.streak,
      lastPlayedDate: state.lastPlayedDate,
    }).catch(err => console.error('Streak save to Firestore failed:', err));
  }
}

/** Returns a YYYY-MM-DD string, optionally offset by `offset` days. */
function getDateString(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().split('T')[0];
}


// ==========================================
//  RENDER HELPERS — TOPIC SCREEN
// ==========================================

function renderDayLabel() {
  const d = new Date();
  els.dayLabel.textContent = `— ${d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })} —`;
}

function renderTopicGrid() {
  els.topicGrid.innerHTML = '';
  WORD_DB.topics.forEach(topic => {
    const card = document.createElement('div');
    card.className = 'topic-card';
    card.innerHTML = `
      <div class="topic-emoji">${topic.emoji}</div>
      <div class="topic-info">
        <span class="topic-name">${topic.name}</span>
        <span class="topic-count">${topic.words.length} words</span>
      </div>`;
    card.addEventListener('click', () => {
      Audio.sfx.transition();
      startGame(getWordFromTopic(topic.id), false);
    });
    els.topicGrid.appendChild(card);
  });
}

/** Show today's Word of the Day hint on the topic screen. */
function updateDailyWordHint() {
  els.swHint.textContent = `"${getDailyWord().hint}"`;
}

/**
 * Grey-out the "Play the Special Word" button if the player has already
 * completed (won or lost) the daily word today. This is the single gate
 * that prevents streak farming by replaying the same daily word.
 */
function updateSpecialWordButton() {
  if (!els.specialWordBtn) return;
  if (state.hasPlayedTodaySpecial) {
    els.specialWordBtn.textContent  = '✅ Played today';
    els.specialWordBtn.disabled     = true;
    els.specialWordBtn.title        = 'You have already played the Word of the Day today. Come back tomorrow!';
  } else {
    els.specialWordBtn.textContent  = 'Play the Special Word';
    els.specialWordBtn.disabled     = false;
    els.specialWordBtn.title        = '';
  }
}


// ==========================================
//  KEYBOARD BUILDER
// ==========================================

function buildKeyboard() {
  const rows = ['QWERTYUIOP', 'ASDFGHJKL', '⌫ZXCVBNM↵'];
  els.keyboard.innerHTML = '';
  rows.forEach(row => {
    const rowEl = document.createElement('div');
    rowEl.className = 'kb-row';
    [...row].forEach(char => {
      const btn = document.createElement('button');
      btn.className  = 'kb-key' + (char === '⌫' || char === '↵' ? ' wide' : '');
      btn.textContent = char;
      btn.dataset.key = char;
      btn.addEventListener('click', () => handleKey(char));
      rowEl.appendChild(btn);
    });
    els.keyboard.appendChild(rowEl);
  });
}


// ==========================================
//  EVENT BINDINGS
// ==========================================

function bindEvents() {
  // Word of the Day button
  els.specialWordBtn.addEventListener('click', () => {
    Audio.sfx.transition();
    startGame(getDailyWord(), true); // isSpecialWord = true
  });

  // Back to topic selection (abandons current game)
  els.backBtn.addEventListener('click', () => {
    clearTimer();
    Audio.sfx.transition();
    showScreen('topic');
  });

  // Share result — Wordle-style score card. Critical zero-cost marketing mechanic.
  els.shareBtn.addEventListener('click', () => {
    Audio.sfx.share();
    gtagEvent('share_score', { topic: state.topicName, score: Math.floor(state.score) });
    shareScore();
  });

  // Play another topic (returns to topic screen)
  els.playAgainBtn.addEventListener('click', () => {
    Audio.sfx.transition();
    showScreen('topic');
  });

  // How to play modal
  els.howToBtn.addEventListener('click', () => {
    Audio.sfx.keyClick();
    els.howToModal.classList.add('open');
  });
  els.closeModal.addEventListener('click', () => {
    els.howToModal.classList.remove('open');
  });
  els.howToModal.addEventListener('click', e => {
    if (e.target === els.howToModal) els.howToModal.classList.remove('open');
  });

  // Mute toggle
  if (els.muteBtn) {
    els.muteBtn.addEventListener('click', () => {
      const muted = Audio.toggleMute();
      els.muteBtn.textContent = muted ? '🔇' : '🔊';
      els.muteBtn.title       = muted ? 'Unmute' : 'Mute';
    });
  }

  // Reveal hint button
  if (els.revealHintBtn) {
    els.revealHintBtn.addEventListener('click', useRevealHint);
  }

  // Physical keyboard support
  document.addEventListener('keydown', onPhysicalKey);

  // BGM starts on first user interaction (browser autoplay policy)
  document.addEventListener('click',   () => Audio.startBGM(), { once: true });
  document.addEventListener('keydown', () => Audio.startBGM(), { once: true });
}

// ==========================================
//  ANNOUNCEMENT BANNER
//  Fetches config/announcement from Firestore.
//  If a message exists, shows the sticky bar.
//  Dismiss button hides it for the session.
// ==========================================

async function loadAnnouncement() {
  try {
    const msg = await getAnnouncement();
    if (!msg) return;
    // Clamp to 300 characters so a rogue Firestore write can't flood the UI
    const safeMsg = String(msg).slice(0, 300);
    const bar   = document.getElementById('announcementBar');
    const text  = document.getElementById('announcementText');
    const close = document.getElementById('announcementClose');
    if (!bar || !text) return;
    text.textContent = safeMsg; // textContent is already XSS-safe
    bar.removeAttribute('hidden');
    close.addEventListener('click', () => bar.setAttribute('hidden', ''), { once: true });
  } catch (e) {
    // Non-critical — silently ignore
    console.warn('Announcement fetch failed:', e);
  }
}


// ==========================================
//  REVEAL HINT
//  Reveals one random unrevealed letter per press.
//  Each press costs one scoring tier for all remaining guesses.
//  Stacks: 1 reveal = tier−1, 2 reveals = tier−2, etc.
//  Button stays active until all letters are revealed.
//  Max tiers = GREEN_PTS_BY_GUESS.length − 1 (4 drops, then floor)
// ==========================================

const MAX_HINTS = 3;

function useRevealHint() {
  if (state.gameOver || state.phase !== 'game' || state.hintsUsed >= MAX_HINTS) return;

  const { word, guessResults, revealedByHint } = state;

  // Build set of already-revealed positions
  const alreadyRevealed = new Set(revealedByHint);
  guessResults.forEach(row => {
    row.forEach((g, i) => { if (g.result === 'correct') alreadyRevealed.add(i); });
  });

  // Collect unrevealed positions
  const unrevealed = [];
  for (let i = 0; i < word.length; i++) {
    if (!alreadyRevealed.has(i)) unrevealed.push(i);
  }

  if (unrevealed.length === 0) {
    showToast('All letters already revealed!');
    if (els.revealHintBtn) {
      els.revealHintBtn.disabled = true;
      els.revealHintBtn.classList.add('used');
    }
    return;
  }

  // Pick one random unrevealed position
  const pick = unrevealed[Math.floor(Math.random() * unrevealed.length)];
  state.hintsUsed++;
  state.revealedByHint.push(pick);

  // Update word display
  updateWordHintDisplay();
  Audio.sfx.present();

  // Figure out current tier for messaging
  const currentTierPts = GREEN_PTS_BY_GUESS[Math.min(state.hintsUsed, GREEN_PTS_BY_GUESS.length - 1)];
  const remaining = unrevealed.length - 1; // after this reveal

  showToast(`Letter revealed! Greens now worth ${currentTierPts} pts/letter`);

  // Update button label — show what the NEXT reveal will cost
  if (els.revealHintBtn) {
    if (remaining === 0 || state.hintsUsed >= MAX_HINTS) {
      // No more reveals allowed
      els.revealHintBtn.disabled = true;
      els.revealHintBtn.classList.add('used');
      els.revealHintBtn.innerHTML = remaining === 0 ? '💡 All revealed' : '💡 Max reveals used';
    } else {
      const nextTierPts = GREEN_PTS_BY_GUESS[Math.min(state.hintsUsed + 1, GREEN_PTS_BY_GUESS.length - 1)];
      const left = MAX_HINTS - state.hintsUsed;
      els.revealHintBtn.innerHTML = `💡 Reveal a Letter <span class="hint-cost">greens → ${nextTierPts} pts · ${left} left</span>`;
    }
  }

  // GA4
  gtagEvent('hint_used', {
    topic:       state.topicId,
    hint_number: state.hintsUsed,
    tier_after:  currentTierPts,
  });
}

function onPhysicalKey(e) {
  if (state.phase !== 'game' || state.gameOver || state.isRevealing) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'Backspace') return handleKey('⌫');
  if (e.key === 'Enter')     return handleKey('↵');
  if (/^[a-zA-Z]$/.test(e.key)) handleKey(e.key.toUpperCase());
}


// ==========================================
//  GAME START
// ==========================================

function startGame(wordData, isSpecialWord = false) {
  const word = wordData.word.toUpperCase();

  // attempts = word.length − 1, but never below MIN_ATTEMPTS
  // e.g. a 4-letter word gets max(3, 5) = 5 attempts
  const rawAttempts = word.length - 1;

  state.word           = word;
  state.hint           = wordData.hint;
  state.topicName      = wordData.topicName;
  state.topicId        = wordData.topic;
  state.isSpecialWord  = isSpecialWord;
  state.wordLen        = word.length;
  state.maxAttempts    = Math.max(rawAttempts, MIN_ATTEMPTS);
  state.currentAttempt = 0;
  state.currentInput   = [];
  state.guessResults   = [];
  state.letterMap      = {};
  state.score          = STARTING_SCORE; // starts at 0; only goes up on correct guesses + win bonus
  state.timerLeft      = TIMER_DURATION;
  state.gameOver       = false;
  state.won            = false;
  state.isRevealing    = false;
  state.isValidating   = false;
  state.warningPlayed  = false;
  state.dangerPlayed   = false;
  state.hintUsed       = false; // kept for backward compat, unused
  state.hintsUsed      = 0;
  state.revealedByHint = [];

  renderGameUI();
  showScreen('game');
  startTimer();

  // GA4: log which topic / word type was started
  gtagEvent('game_start', {
    topic:          state.topicId,
    topic_name:     state.topicName,
    is_special_word: isSpecialWord,
    word_length:    word.length,
  });
}

function renderGameUI() {
  const { word, maxAttempts, topicName, hint } = state;

  els.topicTag.textContent     = topicName;
  els.categoryHint.textContent = hint;
  updateScoreDisplay();
  updateTimerDisplay();
  updateTimerRing();

  // Attempt pip indicators
  els.attemptsPips.innerHTML = '';
  for (let i = 0; i < maxAttempts; i++) {
    const pip = document.createElement('div');
    pip.className = 'pip';
    pip.id        = `pip-${i}`;
    els.attemptsPips.appendChild(pip);
  }

  // Show blank letter placeholders
  updateWordHintDisplay();

  // Reset hint button for this game — show what first reveal will cost (tier 2 = 8 pts)
  if (els.revealHintBtn) {
    const firstPenaltyPts = GREEN_PTS_BY_GUESS[Math.min(1, GREEN_PTS_BY_GUESS.length - 1)];
    els.revealHintBtn.disabled = false;
    els.revealHintBtn.classList.remove('used');
    els.revealHintBtn.innerHTML = `💡 Reveal a Letter <span class="hint-cost">greens → ${firstPenaltyPts} pts · 3 left</span>`;
  }

  // Build empty guess rows
  els.guessBoard.innerHTML = '';
  for (let r = 0; r < maxAttempts; r++) {
    const row = document.createElement('div');
    row.className = 'guess-row' + (r === 0 ? ' active-row' : '');
    row.id        = `row-${r}`;
    for (let c = 0; c < word.length; c++) {
      const tile = document.createElement('div');
      tile.className = 'tile';
      tile.id        = `tile-${r}-${c}`;
      row.appendChild(tile);
    }
    els.guessBoard.appendChild(row);
  }

  // Clear keyboard colour state from previous game
  document.querySelectorAll('.kb-key').forEach(k => {
    k.classList.remove('correct', 'present', 'absent');
  });
}

/** Render the "_ _ _ _" hint, filling in confirmed correct positions + hint-revealed letters. */
function updateWordHintDisplay() {
  const { word, guessResults, revealedByHint } = state;
  const revealed = new Array(word.length).fill(false);
  guessResults.forEach(row => {
    row.forEach((g, i) => { if (g.result === 'correct') revealed[i] = true; });
  });
  // Also mark positions revealed by the hint button
  revealedByHint.forEach(i => { revealed[i] = true; });
  els.wordHint.textContent = word.split('').map((ch, i) => revealed[i] ? ch : '_').join(' ');
}


// ==========================================
//  TIMER
//  The timer is purely cosmetic pressure —
//  it no longer drains the score.
//  Instead, time remaining is converted to
//  a bonus on win: +1 pt per second left.
// ==========================================

function startTimer() {
  clearTimer();
  state.timerInterval = setInterval(() => {
    if (state.gameOver) { clearTimer(); return; }

    state.timerLeft--;
    // NOTE: We do NOT deduct from state.score here any more.
    // Score only changes on: correct letter (+2), wrong guess (−1), win bonus (+seconds left).
    updateTimerDisplay();
    updateTimerRing();

    // Sound cues for urgency
    if (state.timerLeft === 60 && !state.warningPlayed) {
      state.warningPlayed = true;
      Audio.sfx.timerWarning();
    }
    if (state.timerLeft <= 30 && state.timerLeft % 5 === 0) {
      Audio.sfx.timerDanger();
    }

    if (state.timerLeft <= 0) endGame(false, 'time');
  }, 1000);
}

function clearTimer() {
  clearInterval(state.timerInterval);
  state.timerInterval = null;
}

function updateTimerDisplay() {
  const m = Math.floor(state.timerLeft / 60);
  const s = state.timerLeft % 60;
  els.timerText.textContent = `${m}:${s.toString().padStart(2, '0')}`;
  const ring = els.timerRing;
  ring.classList.remove('warning', 'danger');
  if      (state.timerLeft <= 30) ring.classList.add('danger');
  else if (state.timerLeft <= 60) ring.classList.add('warning');
}

function updateTimerRing() {
  const frac = state.timerLeft / TIMER_DURATION;
  els.timerRing.style.strokeDashoffset = TIMER_CIRCUMFERENCE * (1 - frac);
}


// ==========================================
//  WORD VALIDATION — Free Dictionary API
//  Accepts any real English word so players
//  aren't limited to our internal word list.
//  Falls back to allowing the guess if the
//  API is unreachable (no false rejections).
// ==========================================

/** Simple in-memory cache so the same word isn't re-fetched mid-game.
 *  Capped at 200 entries to prevent unbounded memory growth in long sessions. */
const _wordCache = new Map();
const _WORD_CACHE_MAX = 200;

async function isRealWord(word) {
  const key = word.toUpperCase();

  // Hard length guard — reject anything longer than 15 letters (no such game word exists)
  if (key.length < 2 || key.length > 15) return false;

  // Always accept the target word itself (safety net)
  if (key === state.word) return true;

  // Also accept any word already in our own DB (fast path, no network needed)
  if (getValidWordSet().has(key)) return true;

  // Check cache
  if (_wordCache.has(key)) return _wordCache.get(key);

  try {
    const res = await fetch(
      `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word.toLowerCase())}`,
      { signal: AbortSignal.timeout(4000) } // 4-second timeout
    );
    const valid = res.ok; // 200 = found, 404 = not a word
    // Evict oldest entry if cap reached
    if (_wordCache.size >= _WORD_CACHE_MAX) {
      _wordCache.delete(_wordCache.keys().next().value);
    }
    _wordCache.set(key, valid);
    return valid;
  } catch {
    // Network error or timeout — fail open so players aren't blocked
    _wordCache.set(key, true);
    return true;
  }
}


// ==========================================
//  KEY INPUT
// ==========================================

async function handleKey(char) {
  if (state.phase !== 'game' || state.gameOver || state.isRevealing || state.isValidating) return;

  if (char === '⌫') {
    if (state.currentInput.length > 0) {
      state.currentInput.pop();
      Audio.sfx.backspace();
      renderCurrentRow();
    }
    return;
  }

  if (char === '↵') {
    if (state.currentInput.length < state.wordLen) {
      // Not enough letters typed yet
      Audio.sfx.invalid();
      shakeRow(state.currentAttempt);
      showToast(`Need ${state.wordLen} letters`);
    } else {
      // ── Word validation via Free Dictionary API ──────────────────────
      // Accepts any real English word, not just our internal list.
      const guess = state.currentInput.join('');
      state.isValidating = true;
      showToast('Checking word…');
      const isValid = await isRealWord(guess);
      state.isValidating = false;
      if (!isValid) {
        Audio.sfx.invalid();
        shakeRow(state.currentAttempt);
        showToast('Not a valid word');
        return;
      }
      // ─────────────────────────────────────────
      Audio.sfx.submit();
      submitGuess();
    }
    return;
  }

  if (/^[A-Z]$/.test(char)) {
    if (state.currentInput.length < state.wordLen) {
      state.currentInput.push(char);
      Audio.sfx.keyClick();
      renderCurrentRow();
    }
  }
}

function renderCurrentRow() {
  const row = document.getElementById(`row-${state.currentAttempt}`);
  if (!row) return;
  const tiles = row.querySelectorAll('.tile');
  tiles.forEach((tile, i) => {
    const letter = state.currentInput[i] || '';
    tile.textContent = letter;
    tile.classList.toggle('filled-input', !!letter);
    tile.classList.remove('correct', 'present', 'absent');
  });
}

function shakeRow(rowIdx) {
  const row = document.getElementById(`row-${rowIdx}`);
  if (!row) return;
  row.classList.remove('shake');
  void row.offsetWidth; // force reflow to restart animation
  row.classList.add('shake');
  row.addEventListener('animationend', () => row.classList.remove('shake'), { once: true });
}


// ==========================================
//  GUESS EVALUATION
// ==========================================

function submitGuess() {
  const guess  = state.currentInput.join('');
  const word   = state.word;
  const rowIdx = state.currentAttempt;

  const result = evaluateGuess(guess, word);
  state.guessResults.push(result);
  state.isRevealing = true;

  revealRow(rowIdx, result, () => {
    updateKeyboard(result);
    updateWordHintDisplay();

    const won = result.every(g => g.result === 'correct');

    // ── Score: green letters earn decay-based points per guess number ──
    // Earlier guesses are worth more (guess 1 = 10 pts/green, guess 2 = 8, …)
    // Each letter revealed via hint drops scoring one tier (stacks per reveal used).
    const guessIdx     = rowIdx + state.hintsUsed;
    const ptsPerGreen  = GREEN_PTS_BY_GUESS[Math.min(guessIdx, GREEN_PTS_BY_GUESS.length - 1)];
    let pointsThisGuess = 0;
    result.forEach(g => {
      if (g.result === 'correct') pointsThisGuess += ptsPerGreen;
    });
    if (pointsThisGuess > 0) {
      state.score += pointsThisGuess;
      updateScoreDisplay(true);
    }
    // No wrong-guess penalty — score only ever goes up during play.

    // GA4: log every guess with its outcome breakdown
    gtagEvent('guess_submitted', {
      topic:        state.topicId,
      attempt:      rowIdx + 1,
      greens:       result.filter(g => g.result === 'correct').length,
      yellows:      result.filter(g => g.result === 'present').length,
      greys:        result.filter(g => g.result === 'absent').length,
      won,
    });

    // Mark pip as used
    const pip = document.getElementById(`pip-${rowIdx}`);
    if (pip) pip.classList.add('used');

    state.currentAttempt++;
    state.currentInput = [];
    state.isRevealing  = false;

    if (won) {
      endGame(true);
    } else if (state.currentAttempt >= state.maxAttempts) {
      endGame(false, 'attempts');
    } else {
      // Advance to the next row
      const nextRow = document.getElementById(`row-${state.currentAttempt}`);
      if (nextRow) nextRow.classList.add('active-row');
    }
  });
}

/**
 * Standard Wordle evaluation algorithm.
 * Handles duplicate letters correctly:
 *   1. First pass marks exact matches (correct).
 *   2. Second pass marks misplaced letters (present),
 *      consuming word letters that weren't already matched.
 */
function evaluateGuess(guess, word) {
  const result   = Array(word.length).fill(null).map((_, i) => ({ letter: guess[i], result: 'absent' }));
  const wordArr  = word.split('');
  const guessArr = guess.split('');
  const used     = new Array(word.length).fill(false);

  // Pass 1: exact matches
  guessArr.forEach((ch, i) => {
    if (ch === wordArr[i]) {
      result[i].result = 'correct';
      used[i] = true;
    }
  });

  // Pass 2: misplaced letters (not already matched)
  guessArr.forEach((ch, i) => {
    if (result[i].result === 'correct') return;
    const matchIdx = wordArr.findIndex((wch, wi) => wch === ch && !used[wi]);
    if (matchIdx !== -1) {
      result[i].result   = 'present';
      used[matchIdx]     = true;
    }
  });

  return result;
}


// ==========================================
//  TILE REVEAL ANIMATION
//  Tiles flip one by one with staggered delay.
//  onComplete fires after the last tile settles.
// ==========================================

function revealRow(rowIdx, result, onComplete) {
  const wordLen = state.wordLen;
  let done = 0;

  // Kick off all tile flip sounds up front (staggered by index)
  result.forEach((g, i) => { Audio.sfx.tileFlip(i); });

  result.forEach((g, i) => {
    const tile = document.getElementById(`tile-${rowIdx}-${i}`);
    if (!tile) { if (++done === wordLen) onComplete(); return; }

    setTimeout(() => {
      tile.classList.add('flipping');
      setTimeout(() => {
        tile.textContent = g.letter;
        tile.classList.remove('filled-input', 'flipping');
        tile.classList.add(g.result, 'revealed');

        // Per-tile sound based on result type
        if      (g.result === 'correct') Audio.sfx.correct();
        else if (g.result === 'present') Audio.sfx.present();
        else                             Audio.sfx.absent();

        // Floating score label for green tiles — shows actual pts earned this guess
        if (g.result === 'correct') {
          const gIdx = rowIdx + state.hintsUsed;
          const pts  = GREEN_PTS_BY_GUESS[Math.min(gIdx, GREEN_PTS_BY_GUESS.length - 1)];
          spawnScoreFloat(tile, `+${pts}`);
        }

        if (++done === wordLen) setTimeout(onComplete, 100);
      }, 200); // halfway through the flip
    }, i * FLIP_DELAY);
  });
}


// ==========================================
//  KEYBOARD COLOUR STATE
//  Each key tracks the best result seen for
//  that letter (correct > present > absent).
// ==========================================

function updateKeyboard(result) {
  const priority = { correct: 3, present: 2, absent: 1 };
  result.forEach(({ letter, result: res }) => {
    const existing = state.letterMap[letter];
    if (!existing || priority[res] > priority[existing]) {
      state.letterMap[letter] = res;
    }
    document.querySelectorAll(`.kb-key[data-key="${letter}"]`).forEach(k => {
      k.classList.remove('correct', 'present', 'absent');
      k.classList.add(state.letterMap[letter]);
    });
  });
}


// ==========================================
//  SCORE DISPLAY
// ==========================================

function updateScoreDisplay(bump = false) {
  els.scoreDisplay.textContent = Math.max(0, Math.floor(state.score));
  if (bump) {
    // CSS bump animation triggered by removing and re-adding the class
    els.scoreDisplay.classList.remove('bump');
    void els.scoreDisplay.offsetWidth;
    els.scoreDisplay.classList.add('bump');
  }
}

/** Floating "+2" label that rises from a correct tile. */
function spawnScoreFloat(anchorEl, text) {
  const rect = anchorEl.getBoundingClientRect();
  const el   = document.createElement('div');
  el.className    = 'score-float positive';
  el.textContent  = text;
  el.style.left   = (rect.left + rect.width / 2) + 'px';
  el.style.top    = (rect.top - 8) + 'px';
  els.floatContainer.appendChild(el);
  setTimeout(() => el.remove(), 1300);
}




// ==========================================
//  GAME OVER
// ==========================================

async function endGame(won, reason = '') {
  if (state.gameOver) return;
  state.gameOver = true;
  state.won      = won;
  clearTimer();

  if (won) {
    // ── Completion bonus: scales down with each attempt used ──
    // Solving in 1 guess = 1000 pts, 2 = 800, … 6+ = 100 pts
    const attemptsUsed    = state.currentAttempt; // already incremented after last guess
    const completionBonus = COMPLETION_BONUS[Math.min(attemptsUsed - 1, COMPLETION_BONUS.length - 1)];
    state.score += completionBonus;
    spawnScoreFloat(els.scoreDisplay, `+${completionBonus}`);
    updateScoreDisplay(true);

    // ── Time bonus: +0.5 pt per second remaining (speed reward, not the main event) ──
    const timeBonus = Math.round(state.timerLeft * TIME_BONUS_RATE);
    if (timeBonus > 0) {
      state.score += timeBonus;
      // Stagger the time bonus float so it doesn't overlap the completion bonus
      setTimeout(() => {
        spawnScoreFloat(els.scoreDisplay, `+${timeBonus}s`);
        updateScoreDisplay(true);
      }, 400);
    }
    Audio.sfx.win();
  } else {
    Audio.sfx.lose();
  }

  const timeUsed = TIMER_DURATION - state.timerLeft;

  // ── Streak tracking (daily special word only) ──
  if (state.isSpecialWord) {
    const today     = getDateString();
    const yesterday = getDateString(-1);
    if (won) {
      if (!state.lastPlayedDate || state.lastPlayedDate === yesterday) {
        state.streak++;
        if (state.streak > 1 && state.streak % 5 === 0) {
          setTimeout(() => Audio.sfx.streak(), 1200); // celebratory sound at streak milestones
        }
      } else if (state.lastPlayedDate !== today) {
        // Gap of more than one day — streak resets
        state.streak = 1;
      }
      state.lastPlayedDate = today;
    } else if (state.lastPlayedDate !== today) {
      // Lost and hadn't already played today — streak breaks
      state.streak = 0;
    }
    // Mark as played today regardless of win/loss —
    // this is the key gate that prevents replaying for streak farming.
    state.hasPlayedTodaySpecial = true;
    savePersistence();
    els.streakCount.textContent = state.streak;
    updateSpecialWordButton();
  }

  // ── Firestore: log this game session (wins AND losses, signed in AND anonymous) ──
  await submitGameSession({
    word:         state.word,
    topic:        state.topicId,
    topicName:    state.topicName,
    won,
    score:        Math.max(0, Math.floor(state.score)),
    timeUsed,
    attemptsUsed: state.currentAttempt,
    maxAttempts:  state.maxAttempts,
    streak:       state.isSpecialWord ? state.streak : 0,
    isSpecialWord: state.isSpecialWord,
  });

  // ── Firestore: update signed-in player's cumulative profile ──
  if (state.user) {
    await updatePlayerProfile({
      won,
      score:        Math.max(0, Math.floor(state.score)),
      topic:        state.topicId,
      topicName:    state.topicName,
      streak:       state.isSpecialWord ? state.streak : 0,
      timeUsed,
      isSpecialWord: state.isSpecialWord,
    });
  }

  // ── Firestore: submit to leaderboard (signed-in winners only) ──
  if (state.user && won) {
    try {
      await submitScore({
        score:     Math.max(0, Math.floor(state.score)),
        streak:    state.isSpecialWord ? state.streak : 0,
        topic:     state.topicId,
        topicName: state.topicName,
        won,
      });
    } catch (e) {
      console.error('Leaderboard submit failed:', e);
    }
  }

  // GA4: log the completed game
  gtagEvent('game_complete', {
    topic:          state.topicId,
    topic_name:     state.topicName,
    is_special_word: state.isSpecialWord,
    won,
    score:          Math.max(0, Math.floor(state.score)),
    time_used:      timeUsed,
    attempts_used:  state.currentAttempt,
    max_attempts:   state.maxAttempts,
    streak:         state.isSpecialWord ? state.streak : 0,
    reason,
  });

  // Short delay before showing result screen (lets win/lose sound play)
  setTimeout(() => showResult(won, timeUsed), won ? 800 : 600);
}


// ==========================================
//  RESULT SCREEN
// ==========================================

function showResult(won, timeUsed) {
  const m = Math.floor(timeUsed / 60);
  const s = timeUsed % 60;

  if (won) {
    els.resultEmoji.textContent = getWinEmoji(state.score);
    els.resultTitle.textContent = getWinMessage(state.score);
  } else {
    els.resultEmoji.textContent = '🌊';
    els.resultTitle.textContent = 'Swept away…';
  }

  els.revealWord.textContent = state.word;
  els.finalScore.textContent = Math.max(0, Math.floor(state.score));
  els.finalTime.textContent  = `${m}:${s.toString().padStart(2, '0')}`;

  // Streak stat card: only relevant for daily word
  if (state.isSpecialWord) {
    els.finalStreak.textContent = `${state.streak} 🔥`;
    document.querySelector('.streak-stat')?.style.removeProperty('display');
  } else {
    document.querySelector('.streak-stat')?.style.setProperty('display', 'none');
  }

  // Prompt anonymous winners to sign in so their score is saved
  if (!state.user && won) {
    showToast('Sign in to save your score to the leaderboard! 👤');
  }

  renderMiniBoardResult();
  updateNextWordCountdown();
  showScreen('result');
}

function getStarRank(score) {
  if (score >= STAR_THRESHOLDS.three) return 3;
  if (score >= STAR_THRESHOLDS.two)   return 2;
  if (score >= STAR_THRESHOLDS.one)   return 1;
  return 0;
}

function getWinEmoji(score) {
  const stars = getStarRank(score);
  if (stars === 3) return '🏆';
  if (stars === 2) return '⭐⭐';
  if (stars === 1) return '⭐';
  return '✅';
}

function getWinMessage(score) {
  const stars = getStarRank(score);
  if (stars === 3) return 'Legendary tide! ⭐⭐⭐';
  if (stars === 2) return 'Riding the wave! ⭐⭐';
  if (stars === 1) return 'You cracked it! ⭐';
  return 'Scraped through!';
}

/** Render the mini emoji grid shown on the result screen. */
function renderMiniBoardResult() {
  els.resultBoardMini.innerHTML = '';
  state.guessResults.forEach(row => {
    const rowEl = document.createElement('div');
    rowEl.className = 'mini-row';
    row.forEach(g => {
      const tile = document.createElement('div');
      tile.className   = `mini-tile ${g.result}`;
      tile.textContent = g.letter;
      rowEl.appendChild(tile);
    });
    els.resultBoardMini.appendChild(rowEl);
  });
}

/** Calculate and display time until the next Word of the Day. */
function updateNextWordCountdown() {
  const now      = new Date();
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const diff     = Math.floor((tomorrow - now) / 1000);
  const h        = Math.floor(diff / 3600);
  const mn       = Math.floor((diff % 3600) / 60);
  els.nextWordCountdown.textContent = `${h}h ${mn}m`;
}


// ==========================================
//  SHARE — IMAGE CARD
//
//  Draws a 600×340 PNG card on an offscreen
//  Canvas, then:
//    Mobile  → navigator.share({ files })  (native sheet)
//    Desktop → <a download> click          (save PNG)
//
//  Text fallback fires only if Canvas or Blob
//  APIs are completely unavailable.
// ==========================================

function shareScore() {
  try {
    const canvas = buildShareCanvas();
    canvas.toBlob(blob => {
      if (!blob) { shareScoreText(); return; }
      const today    = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const filename = `wordtide-${state.topicId}-${today.replace(' ', '')}.png`;
      showShareModal(canvas, blob, filename);
    }, 'image/png');
  } catch (err) {
    console.warn('Canvas share failed, falling back to text:', err);
    shareScoreText();
  }
}

/** Show the share modal with a preview of the card and action buttons. */
function showShareModal(canvas, blob, filename) {
  document.getElementById('shareModal')?.remove();

  const dataUrl = canvas.toDataURL('image/png');

  const overlay = document.createElement('div');
  overlay.id        = 'shareModal';
  overlay.className = 'modal-overlay open';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Share your score');

  const canShare = !!(navigator.canShare &&
    navigator.canShare({ files: [new File([blob], filename, { type: 'image/png' })] }));

  overlay.innerHTML = `
    <div class="modal share-modal">
      <button class="modal-close" id="closeShareModal" aria-label="Close">✕</button>
      <h2 class="modal-title">Share your score</h2>
      <div class="share-preview-wrap">
        <img class="share-preview-img" src="${dataUrl}" alt="Your WordTide score card" />
      </div>
      <div class="share-actions">
        ${canShare ? `<button class="btn-share-action btn-share-native" id="shareNativeBtn">
          <span class="share-action-icon">⬆</span><span>Share</span>
        </button>` : ''}
        <button class="btn-share-action btn-share-download" id="shareDownloadBtn">
          <span class="share-action-icon">⬇</span><span>Download</span>
        </button>
        <button class="btn-share-action btn-share-copy" id="shareCopyBtn">
          <span class="share-action-icon">📋</span><span>Copy text</span>
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  document.getElementById('closeShareModal').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  document.getElementById('shareNativeBtn')?.addEventListener('click', () => {
    const file = new File([blob], filename, { type: 'image/png' });
    navigator.share({
      title: 'WordTide',
      text:  `I scored ${Math.max(0, Math.floor(state.score))} pts ${ ['','⭐','⭐⭐','⭐⭐⭐'][getStarRank(state.score)] } on WordTide! 🌊`.trim(),
      files: [file],
    }).then(() => overlay.remove()).catch(() => {});
  });

  document.getElementById('shareDownloadBtn').addEventListener('click', () => {
    const url = URL.createObjectURL(blob);
    const a   = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    showToast('Card saved! 🌊');
  });

  document.getElementById('shareCopyBtn').addEventListener('click', () => {
    shareScoreText();
    overlay.remove();
  });
}

/**
 * Draw the share card on an offscreen 600×340 canvas.
 * Returns the canvas element (caller calls .toBlob()).
 */
function buildShareCanvas() {
  const W = 600, H = 340;
  const canvas = document.createElement('canvas');
  canvas.width  = W * 2; // 2× for retina sharpness
  canvas.height = H * 2;
  canvas.style.width  = W + 'px';
  canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(2, 2);         // draw at 2× then the blob is full-res

  // ── Background ────────────────────────────────────────────────
  ctx.fillStyle = '#080f1f';
  rrect(ctx, 0, 0, W, H, 16); ctx.fill();

  // Subtle teal shimmer strip at top
  const shimmer = ctx.createLinearGradient(0, 0, W, 0);
  shimmer.addColorStop(0,   'rgba(0,212,170,0.00)');
  shimmer.addColorStop(0.5, 'rgba(0,212,170,0.07)');
  shimmer.addColorStop(1,   'rgba(0,212,170,0.00)');
  ctx.fillStyle = shimmer;
  rrect(ctx, 0, 0, W, 68, 16); ctx.fill();

  // ── Logo (top-left) ───────────────────────────────────────────
  ctx.fillStyle    = '#00d4aa';
  ctx.font         = '600 21px "Space Grotesk", "Helvetica Neue", Arial, sans-serif';
  ctx.textBaseline = 'top';
  ctx.fillText('≋ WordTide', 28, 22);

  // Topic + date pill (top-right)
  const today      = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const pillLabel  = `${state.topicName} · ${today}`;
  ctx.font         = '500 12px "Inter", Arial, sans-serif';
  const pillW      = ctx.measureText(pillLabel).width + 24;
  ctx.fillStyle    = 'rgba(0,212,170,0.12)';
  rrect(ctx, W - pillW - 20, 19, pillW, 26, 13); ctx.fill();
  ctx.fillStyle    = '#00d4aa';
  ctx.fillText(pillLabel, W - pillW - 20 + 12, 27);

  // Divider
  ctx.strokeStyle = 'rgba(0,212,170,0.12)';
  ctx.lineWidth   = 1;
  ctx.beginPath(); ctx.moveTo(28, 58); ctx.lineTo(W - 28, 58); ctx.stroke();

  // ── Guess grid (left column) ──────────────────────────────────
  const TILE_COLORS = {
    correct: { fill: '#1a6b50', stroke: '#00d4aa' },
    present: { fill: '#4a3a0a', stroke: '#ffd166' },
    absent:  { fill: '#0d1e30', stroke: '#1e3a50' },
  };

  const tileSize = 32, tileGap = 5;
  const wordLen  = state.word.length;
  const gridX    = 28, gridY = 72;

  state.guessResults.forEach((row, r) => {
    row.forEach((g, c) => {
      const col = TILE_COLORS[g.result];
      const x   = gridX + c * (tileSize + tileGap);
      const y   = gridY + r * (tileSize + tileGap);
      ctx.fillStyle   = col.fill;
      ctx.strokeStyle = col.stroke;
      ctx.lineWidth   = 1.5;
      rrect(ctx, x, y, tileSize, tileSize, 6);
      ctx.fill(); ctx.stroke();
    });
  });

  // ── Right column: result + stats ──────────────────────────────
  const gridTotalW = wordLen * (tileSize + tileGap) - tileGap;
  const sx = gridX + gridTotalW + 32;
  const sy = 70;

  // Win / loss headline
  if (state.won) {
    ctx.fillStyle = '#00d4aa';
    ctx.font      = '700 28px "Space Grotesk", sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillText('You got it!', sx, sy);
  } else {
    ctx.fillStyle = '#ff6b6b';
    ctx.font      = '700 28px "Space Grotesk", sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillText('Swept away', sx, sy);
  }

  // "The word was XXXXX"
  ctx.fillStyle = 'rgba(232,244,242,0.5)';
  ctx.font      = '400 12px "Inter", sans-serif';
  ctx.fillText('The word was', sx, sy + 40);
  ctx.fillStyle = '#e8f4f2';
  ctx.font      = '700 18px "Space Grotesk", sans-serif';
  // Letter-spaced word
  const wordChars = state.word.split('');
  let wx = sx;
  wordChars.forEach(ch => {
    ctx.fillText(ch, wx, sy + 58);
    wx += ctx.measureText(ch).width + 3;
  });

  // Stat mini-cards
  const statItems = [
    { label: 'score', value: state.won ? `${Math.max(0, Math.floor(state.score))} pts` : '—' },
    { label: 'guesses', value: `${state.guessResults.length}/${state.maxAttempts}` },
  ];
  if (state.isSpecialWord && state.streak > 0) {
    statItems.push({ label: 'streak', value: `${state.streak} day` });
  }

  const cardW = 96, cardH = 50, cardGap = 8;
  statItems.forEach((s, i) => {
    const cx = sx + i * (cardW + cardGap);
    const cy = sy + 102;
    ctx.fillStyle   = 'rgba(0,212,170,0.08)';
    ctx.strokeStyle = 'rgba(0,212,170,0.18)';
    ctx.lineWidth   = 1;
    rrect(ctx, cx, cy, cardW, cardH, 8);
    ctx.fill(); ctx.stroke();

    ctx.fillStyle    = '#e8f4f2';
    ctx.font         = '700 16px "Space Grotesk", sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillText(s.value, cx + 10, cy + 9);

    ctx.fillStyle = 'rgba(232,244,242,0.4)';
    ctx.font      = '400 11px "Inter", sans-serif';
    ctx.fillText(s.label, cx + 10, cy + 31);
  });

  // ── Footer ────────────────────────────────────────────────────
  ctx.strokeStyle = 'rgba(0,212,170,0.10)';
  ctx.lineWidth   = 1;
  ctx.beginPath(); ctx.moveTo(28, H - 42); ctx.lineTo(W - 28, H - 42); ctx.stroke();

  ctx.fillStyle    = 'rgba(0,212,170,0.6)';
  ctx.font         = '500 12px "Inter", sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText('🌊  wordtide.in', 28, H - 21);

  ctx.fillStyle = 'rgba(232,244,242,0.25)';
  const cta  = 'Play free →';
  const ctaW = ctx.measureText(cta).width;
  ctx.fillText(cta, W - 28 - ctaW, H - 21);

  return canvas;
}

/** Rounded-rect path helper (no fill/stroke — caller decides). */
function rrect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/** Plain-text fallback for very old browsers that lack Canvas/Blob. */
function shareScoreText() {
  const emojiMap = { correct: '🟢', present: '🟡', absent: '⬛' };
  const grid = state.guessResults
    .map(row => row.map(g => emojiMap[g.result]).join(''))
    .join('\n');
  const today      = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const starLine    = state.won ? ['', '⭐', '⭐⭐', '⭐⭐⭐'][getStarRank(state.score)] : '';
  const resultLine  = state.won
    ? `✅ ${state.guessResults.length}/${state.maxAttempts} · ${Math.max(0, Math.floor(state.score))} pts ${starLine}`.trim()
    : '❌ Swept away';
  const streakLine = (state.isSpecialWord && state.streak > 0) ? `🔥 ${state.streak} day streak` : '';
  const lines = [
    `≋ WordTide · ${state.topicName} · ${today}`,
    resultLine,
    streakLine,
    '',
    grid,
    '',
    '🌊 wordtide.in',
  ].filter(Boolean).join('\n');

  if (navigator.share) {
    navigator.share({ title: 'WordTide', text: lines }).catch(() => copyToClipboard(lines));
  } else {
    copyToClipboard(lines);
  }
}

function copyToClipboard(text) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => showToast('Copied to clipboard! 📋'));
  } else {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast('Copied to clipboard! 📋');
  }
}


// ==========================================
//  SCREEN MANAGEMENT
// ==========================================

function showScreen(name) {
  state.phase = name;
  ['topic', 'game', 'result'].forEach(n => {
    document.getElementById(`${n}Screen`).classList.toggle('active', n === name);
  });
  window.scrollTo(0, 0);
}


// ==========================================
//  TOAST NOTIFICATION
// ==========================================

let toastTimeout;
function showToast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.add('show');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => els.toast.classList.remove('show'), 2200);
}


// ==========================================
//  BOOT
// ==========================================
init();