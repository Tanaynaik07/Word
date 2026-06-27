// ==========================================
//  WORDTIDE — FIREBASE MODULE
//  Auth (Google) + Firestore (All game data)
//
//  Collections used:
//    leaderboard/{uid}              → all-time best score per user
//    leaderboard_daily/{date_uid}   → daily scores for the daily board
//    game_sessions/{auto-id}        → every completed game (win or loss)
//    player_profiles/{uid}          → cumulative player stats across all games
//
//  SETUP: Replace firebaseConfig below with your own
//  Firebase Console → Project Settings → Your apps
// ==========================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  increment,
  query,
  orderBy,
  limit,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ── YOUR FIREBASE CONFIG ──────────────────
// Replace this with your project's config.
// Found at: Firebase Console → Project Settings → SDK setup and configuration
const firebaseConfig = {
  apiKey:            "AIzaSyD3Kv8j8KUwrKrCxk3gG_qH6Du9biWXGfo",
  authDomain:        "word-467f4.firebaseapp.com",
  projectId:         "word-467f4",
  storageBucket:     "word-467f4.firebasestorage.app",
  messagingSenderId: "562934599602",
  appId:             "1:562934599602:web:45cce5de4c20cbe30cdeab",
  measurementId:     "G-BQLZDJRT01",
};
// ─────────────────────────────────────────

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);


// ==========================================
//  AUTH
// ==========================================

const provider = new GoogleAuthProvider();

export async function signInWithGoogle() {
  try {
    const result = await signInWithPopup(auth, provider);
    return result.user;
  } catch (err) {
    console.error('Google sign-in failed:', err);
    return null;
  }
}

export async function signOutUser() {
  await signOut(auth);
}

/** Subscribe to auth state changes. Returns the unsubscribe function. */
export function onUserChange(callback) {
  return onAuthStateChanged(auth, callback);
}

export function getCurrentUser() {
  return auth.currentUser;
}


// ==========================================
//  LEADERBOARD
//
//  leaderboard/{uid}
//    → one doc per user, tracks their personal all-time best score
//
//  leaderboard_daily/{date}_{uid}
//    → one doc per user per day, powers the "Today" board
//    → only winning games are written here
// ==========================================

/**
 * Submit a winning score to both the all-time and daily leaderboards.
 * Only signed-in users who won are recorded.
 */
export async function submitScore({ score, streak, topic, topicName, won }) {
  const user = getCurrentUser();
  if (!user || !won) return; // only logged-in winners get on the board

  // ── Input guards ──
  const safeScore     = Math.max(0, Math.min(Math.floor(Number(score)  || 0), 99999));
  const safeStreak    = Math.max(0, Math.min(Math.floor(Number(streak) || 0), 9999));
  const safeTopic     = String(topic     || '').slice(0, 40);
  const safeTopicName = String(topicName || '').slice(0, 60);

  // ── All-time board: keep personal best only ──
  const userRef  = doc(db, 'leaderboard', user.uid);
  const existing = await getDoc(userRef);

  const entry = {
    name:      (user.displayName || 'Anonymous').slice(0, 100),
    photoURL:  user.photoURL   || '',
    score:     safeScore,
    streak:    safeStreak,
    topic:     safeTopic,
    topicName: safeTopicName,
    uid:       user.uid,
    updatedAt: serverTimestamp(),
  };

  if (!existing.exists() || existing.data().score < safeScore) {
    await setDoc(userRef, entry);
  }

  // ── Daily board: write today's win regardless of score ──
  const dateStr  = new Date().toISOString().split('T')[0];
  const dailyRef = doc(db, 'leaderboard_daily', `${dateStr}_${user.uid}`);
  await setDoc(dailyRef, { ...entry, date: dateStr }, { merge: true });
}

/** Fetch top N all-time scores, ordered by score descending. */
export async function getTopScores(n = 10) {
  const q    = query(collection(db, 'leaderboard'), orderBy('score', 'desc'), limit(n));
  const snap = await getDocs(q);
  return snap.docs.map(d => d.data());
}

/** Fetch today's top N scores. */
export async function getTodayScores(n = 10) {
  const dateStr = new Date().toISOString().split('T')[0];
  const q = query(
    collection(db, 'leaderboard_daily'),
    orderBy('score', 'desc'),
    limit(n)
  );
  const snap = await getDocs(q);
  return snap.docs
    .map(d => d.data())
    .filter(d => d.date === dateStr)
    .slice(0, n);
}


// ==========================================
//  GAME SESSIONS
//
//  game_sessions/{auto-id}
//    Stores every completed game — wins and losses.
//    This is the raw event log for analytics.
//
//  Fields written per session:
//    uid, name, photoURL     → who played (null for anon)
//    word, topic, topicName  → what they played
//    won                     → boolean
//    score                   → final score (0 if lost)
//    timeUsed                → seconds elapsed
//    attemptsUsed            → number of guesses made
//    maxAttempts             → attempts available
//    guessCount              → same as attemptsUsed (convenience)
//    streak                  → player streak at end of game
//    isSpecialWord           → true if Word of the Day
//    date                    → ISO date string (YYYY-MM-DD)
//    createdAt               → server timestamp
// ==========================================

/**
 * Log a completed game session (win or loss) to Firestore.
 * Works for both signed-in and anonymous users.
 * Anonymous sessions store uid: null and name: 'Anonymous'.
 */
export async function submitGameSession({
  word,
  topic,
  topicName,
  won,
  score,
  timeUsed,
  attemptsUsed,
  maxAttempts,
  streak,
  isSpecialWord,
}) {
  const user = getCurrentUser();

  // ── Input guards: clamp strings to prevent oversized Firestore writes ──
  const safeWord      = String(word      || '').slice(0, 30).toUpperCase();
  const safeTopic     = String(topic     || '').slice(0, 40);
  const safeTopicName = String(topicName || '').slice(0, 60);
  const safeScore     = Math.max(0, Math.min(Math.floor(Number(score)     || 0), 99999));
  const safeTime      = Math.max(0, Math.min(Math.floor(Number(timeUsed)  || 0), 3600));
  const safeAttempts  = Math.max(0, Math.min(Math.floor(Number(attemptsUsed) || 0), 50));
  const safeMax       = Math.max(0, Math.min(Math.floor(Number(maxAttempts)  || 0), 50));
  const safeStreak    = Math.max(0, Math.min(Math.floor(Number(streak)    || 0), 9999));

  try {
    await addDoc(collection(db, 'game_sessions'), {
      // Player identity (null for anonymous)
      uid:          user ? user.uid        : null,
      name:         user ? (user.displayName || 'Anonymous').slice(0, 100) : 'Anonymous',
      photoURL:     user ? (user.photoURL  || '')            : '',

      // What was played
      word:         safeWord,
      topic:        safeTopic,
      topicName:    safeTopicName,
      isSpecialWord: !!isSpecialWord,

      // Outcome
      won:          !!won,
      score:        won ? safeScore : 0,
      timeUsed:     safeTime,
      attemptsUsed: safeAttempts,
      maxAttempts:  safeMax,
      guessCount:   safeAttempts,

      // Streak at time of game (only meaningful for special word)
      streak: isSpecialWord ? safeStreak : 0,

      // Metadata
      date:      new Date().toISOString().split('T')[0],
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    // Non-critical — don't surface to user
    console.error('submitGameSession failed:', err);
  }
}


// ==========================================
//  PLAYER PROFILES
//
//  player_profiles/{uid}
//    One document per signed-in user.
//    Tracks lifetime aggregate stats across all games.
//    Updated after every game (win or loss).
//
//  Fields:
//    name, photoURL          → display info, refreshed each game
//    gamesPlayed             → total games started and finished
//    gamesWon                → total wins
//    totalScore              → sum of all winning scores
//    bestScore               → highest single-game score ever
//    bestStreak              → highest streak ever reached
//    currentStreak           → current active streak (daily word only)
//    totalTimePlayedSecs     → cumulative seconds spent playing
//    topicsPlayed            → map of topicId → play count
//    lastPlayedAt            → timestamp of most recent game
//    firstPlayedAt           → timestamp of very first game (set once)
// ==========================================

/**
 * Upsert the player profile after every completed game.
 * Uses Firestore increment() so concurrent sessions don't overwrite each other.
 */
export async function updatePlayerProfile({
  won,
  score,
  topic,
  topicName,
  streak,
  timeUsed,
  isSpecialWord,
}) {
  const user = getCurrentUser();
  if (!user) return; // no profile for anonymous users

  const profileRef = doc(db, 'player_profiles', user.uid);
  const existing   = await getDoc(profileRef);

  const now = serverTimestamp();

  if (!existing.exists()) {
    // ── First game ever: create the profile document ──
    await setDoc(profileRef, {
      uid:                user.uid,
      name:               user.displayName || 'Anonymous',
      photoURL:           user.photoURL   || '',
      gamesPlayed:        1,
      gamesWon:           won ? 1 : 0,
      totalScore:         won ? score : 0,
      bestScore:          won ? score : 0,
      bestStreak:         isSpecialWord ? streak : 0,
      currentStreak:      isSpecialWord ? streak : 0,
      totalTimePlayedSecs: timeUsed,
      topicsPlayed:       { [topic]: 1 },
      lastPlayedAt:       now,
      firstPlayedAt:      now,
    });
  } else {
    // ── Subsequent game: increment atomic counters ──
    const data    = existing.data();
    const updates = {
      // Refresh display info in case user changed their Google profile
      name:               user.displayName || 'Anonymous',
      photoURL:           user.photoURL   || '',
      gamesPlayed:        increment(1),
      totalTimePlayedSecs: increment(timeUsed),
      lastPlayedAt:       now,
      // Nested map increment for topics played
      [`topicsPlayed.${topic}`]: increment(1),
    };

    if (won) {
      updates.gamesWon    = increment(1);
      updates.totalScore  = increment(score);
      // bestScore: only update if this game beat the record
      if (score > (data.bestScore || 0)) {
        updates.bestScore = score;
      }
    }

    // Track best streak and current streak (special word only)
    if (isSpecialWord) {
      updates.currentStreak = streak;
      if (streak > (data.bestStreak || 0)) {
        updates.bestStreak = streak;
      }
    }

    await updateDoc(profileRef, updates);
  }
}

/**
 * Fetch the active announcement message from Firestore.
 * Returns the message string, or '' if none is set.
 */
export async function getAnnouncement() {
  try {
    const snap = await getDoc(doc(db, 'config', 'announcement'));
    return snap.exists() ? (snap.data().message || '') : '';
  } catch (err) {
    console.warn('getAnnouncement failed:', err);
    return '';
  }
}
export async function getPlayerProfile(uid) {
  try {
    const snap = await getDoc(doc(db, 'player_profiles', uid));
    return snap.exists() ? snap.data() : null;
  } catch (err) {
    console.error('getPlayerProfile failed:', err);
    return null;
  }
}


// ==========================================
//  STREAK (account-based)
//
//  Stored on player_profiles/{uid}:
//    currentStreak    → active day streak
//    lastPlayedDate   → ISO date of last special-word win (YYYY-MM-DD)
//    bestStreak       → all-time high streak
//
//  For anonymous users we return null so the
//  caller can fall back to localStorage.
// ==========================================

/**
 * Read streak data for the signed-in user from their player profile.
 * Returns { streak, lastPlayedDate } or null if not signed in / no profile.
 */
export async function getStreakFromFirestore() {
  const user = getCurrentUser();
  if (!user) return null;
  try {
    const snap = await getDoc(doc(db, 'player_profiles', user.uid));
    if (!snap.exists()) return { streak: 0, lastPlayedDate: null };
    const d = snap.data();
    return {
      streak:         d.currentStreak  || 0,
      lastPlayedDate: d.lastPlayedDate || null,
    };
  } catch (err) {
    console.error('getStreakFromFirestore failed:', err);
    return null;
  }
}

/**
 * Persist updated streak data to the signed-in user's player profile.
 * No-ops for anonymous users (caller handles localStorage fallback).
 */
export async function saveStreakToFirestore({ streak, lastPlayedDate }) {
  const user = getCurrentUser();
  if (!user) return;
  try {
    const profileRef = doc(db, 'player_profiles', user.uid);
    const existing   = await getDoc(profileRef);
    const now        = serverTimestamp();

    if (!existing.exists()) {
      // Bootstrap a minimal profile if this is the user's very first action
      await setDoc(profileRef, {
        uid:            user.uid,
        name:           user.displayName || 'Anonymous',
        photoURL:       user.photoURL   || '',
        currentStreak:  streak,
        lastPlayedDate,
        bestStreak:     streak,
        gamesPlayed:    0,
        gamesWon:       0,
        totalScore:     0,
        bestScore:      0,
        totalTimePlayedSecs: 0,
        topicsPlayed:   {},
        firstPlayedAt:  now,
        lastPlayedAt:   now,
      });
    } else {
      const updates = { currentStreak: streak, lastPlayedDate };
      const best = existing.data().bestStreak || 0;
      if (streak > best) updates.bestStreak = streak;
      await updateDoc(profileRef, updates);
    }
  } catch (err) {
    console.error('saveStreakToFirestore failed:', err);
  }
}
