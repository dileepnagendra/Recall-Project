/* =========================================================
   RecallRocket — Frontend-only flashcard app with SM-2
   ========================================================= */

const STORAGE_KEY = 'recallrocket_data';

// ---------- STATE ----------
let state = loadState();
let currentQueue = [];
let currentIndex = 0;
let sessionReviewed = 0;

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) return JSON.parse(raw);
  return {
    decks: seedDecks(),
    user: { streak: 0, lastStudyDate: null, totalReviews: 0 },
    leaderboard: seedLeaderboard()
  };
}
function saveState() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }

// ---------- SM-2 ALGORITHM ----------
function sm2(card, grade) {
  let { ef = 2.5, interval = 0, reps = 0 } = card;

  if (grade >= 3) {
    if (reps === 0) interval = 1;
    else if (reps === 1) interval = 6;
    else interval = Math.round(interval * ef);
    reps += 1;
  } else {
    reps = 0;
    interval = 1;
  }

  ef = ef + (0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02));
  ef = Math.max(1.3, ef); // floor per SM-2 spec

  const nextReview = addDays(todayISO(), interval);
  return { ef, interval, reps, nextReview };
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ---------- STREAK ----------
function updateStreak() {
  const today = todayISO();
  const last = state.user.lastStudyDate;
  if (last === today) return; // already counted today

  if (last === addDays(today, -1)) {
    state.user.streak += 1;
  } else {
    state.user.streak = 1;
  }
  state.user.lastStudyDate = today;
  saveState();
  renderStreak();
}

function renderStreak() {
  document.getElementById('streakCount').textContent = state.user.streak;
  document.getElementById('streakBig').textContent = '🔥 ' + state.user.streak;
}

// ---------- DUE CARDS ----------
function getDueCards() {
  const today = todayISO();
  const due = [];
  state.decks.forEach(deck => {
    deck.cards.forEach(card => {
      if (!card.nextReview || card.nextReview <= today) {
        due.push({ ...card, deckId: deck.id, deckName: deck.name });
      }
    });
  });
  return due;
}

// ---------- VIEWS ----------
function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-' + name).classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.view === name);
  });
  if (name === 'dashboard') renderDashboard();
  if (name === 'decks') renderDecks();
  if (name === 'leaderboard') renderLeaderboard();
}

function renderDashboard() {
  const due = getDueCards();
  document.getElementById('dueCount').textContent = due.length;
  document.getElementById('totalReviews').textContent = state.user.totalReviews;
  renderStreak();

  // compute my rank
  const all = getUserScores().sort((a, b) => b.score - a.score);
  const myIdx = all.findIndex(u => u.me);
  document.getElementById('myRank').textContent = myIdx >= 0 ? '#' + (myIdx + 1) : '#—';
}

function renderDecks() {
  const grid = document.getElementById('decksGrid');
  grid.innerHTML = '';
  state.decks.forEach(deck => {
    const today = todayISO();
    const due = deck.cards.filter(c => !c.nextReview || c.nextReview <= today).length;
    const card = document.createElement('div');
    card.className = 'deck-card';
    card.innerHTML = `
      <div class="deck-name">${escapeHtml(deck.name)}</div>
      <div class="deck-meta">${deck.cards.length} cards • ${due} due today</div>
      <div class="deck-actions">
        <button class="btn primary" data-start="${deck.id}">Review</button>
        <button class="btn" data-delete="${deck.id}">Delete</button>
      </div>
    `;
    grid.appendChild(card);
  });
  grid.querySelectorAll('[data-start]').forEach(b =>
    b.onclick = () => startReview(b.dataset.start));
  grid.querySelectorAll('[data-delete]').forEach(b =>
    b.onclick = () => {
      if (confirm('Delete this deck?')) {
        state.decks = state.decks.filter(d => d.id !== b.dataset.delete);
        saveState(); renderDecks();
      }
    });
}

function renderLeaderboard() {
  const all = getUserScores().sort((a, b) => b.score - a.score);
  const body = document.getElementById('leaderboardBody');
  body.innerHTML = all.map((u, i) => `
    <tr class="${u.me ? 'me' : ''}">
      <td>${i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '#' + (i + 1)}</td>
      <td>${escapeHtml(u.name)} ${u.me ? '(you)' : ''}</td>
      <td>🔥 ${u.streak}</td>
      <td>${u.reviews}</td>
      <td><strong>${u.score}</strong></td>
    </tr>
  `).join('');
}

function getUserScores() {
  const me = {
    name: 'You',
    streak: state.user.streak,
    reviews: state.user.totalReviews,
    score: state.user.streak * 10 + state.user.totalReviews,
    me: true
  };
  return [me, ...state.leaderboard];
}

// ---------- REVIEW SESSION ----------
function startReview(deckId = null) {
  const today = todayISO();
  let pool;
  if (deckId) {
    const deck = state.decks.find(d => d.id === deckId);
    pool = deck.cards.filter(c => !c.nextReview || c.nextReview <= today)
      .map(c => ({ ...c, deckId: deck.id, deckName: deck.name }));
  } else {
    pool = getDueCards();
  }

  if (pool.length === 0) {
    alert('No cards due today! 🎉');
    return;
  }

  currentQueue = shuffle(pool);
  currentIndex = 0;
  sessionReviewed = 0;
  showView('review');
  showCard();
}

function showCard() {
  if (currentIndex >= currentQueue.length) {
    finishSession();
    return;
  }
  const card = currentQueue[currentIndex];
  document.getElementById('cardFront').innerHTML = escapeHtml(card.q);
  document.getElementById('cardBack').innerHTML = escapeHtml(card.a);
  document.getElementById('flashcard').classList.remove('flipped');
  document.getElementById('reviewCounter').textContent =
    `${currentIndex + 1} / ${currentQueue.length}`;
  const pct = (currentIndex / currentQueue.length) * 100;
  document.getElementById('progressFill').style.width = pct + '%';
}

function flipCard() {
  document.getElementById('flashcard').classList.toggle('flipped');
}

function rateCard(grade) {
  const card = currentQueue[currentIndex];
  const updated = sm2(card, grade);

  // persist back into state
  const deck = state.decks.find(d => d.id === card.deckId);
  const orig = deck.cards.find(c => c.id === card.id);
  Object.assign(orig, updated);

  state.user.totalReviews += 1;
  sessionReviewed += 1;
  saveState();

  currentIndex += 1;
  showCard();
}

function finishSession() {
  updateStreak();
  document.getElementById('completeMessage').textContent =
    `You reviewed ${sessionReviewed} card${sessionReviewed !== 1 ? 's' : ''}.`;
  document.getElementById('streakBadge').textContent =
    `🔥 ${state.user.streak}-day streak`;
  document.getElementById('completeModal').classList.add('active');
}

// ---------- DECK MANAGEMENT ----------
function openDeckModal() {
  document.getElementById('deckNameInput').value = '';
  document.getElementById('deckCardsInput').value = '';
  document.getElementById('modalTitle').textContent = 'New Deck';
  document.getElementById('deckModal').classList.add('active');
}

function saveDeck() {
  const name = document.getElementById('deckNameInput').value.trim();
  const raw = document.getElementById('deckCardsInput').value.trim();
  if (!name) return alert('Deck name required');
  if (!raw) return alert('Add at least one card (Q | A)');

  const cards = raw.split('\n').filter(l => l.includes('|')).map((line, i) => {
    const [q, a] = line.split('|').map(s => s.trim());
    return {
      id: 'c_' + Date.now() + '_' + i,
      q, a,
      ef: 2.5, interval: 0, reps: 0, nextReview: todayISO()
    };
  });

  state.decks.push({
    id: 'd_' + Date.now(),
    name, cards
  });
  saveState();
  document.getElementById('deckModal').classList.remove('active');
  renderDecks();
}

// ---------- SEED DATA ----------
function seedDecks() {
  const csCards = [
    ['What is Big-O notation?', 'A mathematical notation describing the upper bound of an algorithm\'s growth rate.'],
    ['Time complexity of QuickSort (average)?', 'O(n log n)'],
    ['Time complexity of QuickSort (worst)?', 'O(n²) — occurs with poor pivot choices.'],
    ['What is a hash table?', 'A data structure mapping keys to values using a hash function for O(1) average lookup.'],
    ['What is a binary search tree?', 'A tree where left children < parent < right children, enabling O(log n) search.'],
    ['What is dynamic programming?', 'Solving complex problems by breaking them into overlapping subproblems and caching results.'],
    ['What is Dijkstra\'s algorithm?', 'Finds the shortest path from a source node to all other nodes in a weighted graph.'],
    ['What is the difference between stack and queue?', 'Stack is LIFO (last in, first out); Queue is FIFO (first in, first out).'],
    ['What is a deadlock?', 'A situation where two or more processes wait indefinitely for each other\'s resources.'],
    ['What is TCP vs UDP?', 'TCP is connection-oriented and reliable; UDP is connectionless and faster but unreliable.'],
    ['What is REST?', 'Representational State Transfer — an architectural style for designing networked applications using HTTP verbs.'],
    ['What is a closure?', 'A function that retains access to its lexical scope even when executed outside that scope.'],
    ['What is the difference between == and === in JS?', '== does type coercion; === checks both value and type (strict equality).'],
    ['What is the time complexity of binary search?', 'O(log n)'],
    ['What is memoization?', 'Caching the results of expensive function calls and returning the cached result for repeated inputs.']
  ];

  return [{
    id: 'd_cs_interview',
    name: 'CS Interview Prep',
    cards: csCards.map((c, i) => ({
      id: 'c_cs_' + i,
      q: c[0], a: c[1],
      ef: 2.5, interval: 0, reps: 0, nextReview: todayISO()
    }))
  }];
}

function seedLeaderboard() {
  return [
    { name: 'Aarav S.', streak: 14, reviews: 312, score: 14 * 10 + 312 },
    { name: 'Priya M.', streak: 9, reviews: 245, score: 9 * 10 + 245 },
    { name: 'Liam K.', streak: 7, reviews: 180, score: 7 * 10 + 180 },
    { name: 'Sofia R.', streak: 5, reviews: 120, score: 5 * 10 + 120 },
    { name: 'Noah T.', streak: 3, reviews: 80, score: 3 * 10 + 80 },
    { name: 'Emma L.', streak: 2, reviews: 45, score: 2 * 10 + 45 }
  ];
}

// ---------- UTILS ----------
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// ---------- EVENT BINDINGS ----------
document.querySelectorAll('.nav-btn').forEach(b =>
  b.onclick = () => showView(b.dataset.view));

document.getElementById('startReviewBtn').onclick = () => startReview();
document.getElementById('goToDecksBtn').onclick = () => showView('decks');
document.getElementById('newDeckBtn').onclick = openDeckModal;
document.getElementById('cancelDeckBtn').onclick = () =>
  document.getElementById('deckModal').classList.remove('active');
document.getElementById('saveDeckBtn').onclick = saveDeck;
document.getElementById('exitReviewBtn').onclick = () => showView('dashboard');
document.getElementById('closeCompleteBtn').onclick = () => {
  document.getElementById('completeModal').classList.remove('active');
  showView('dashboard');
};

document.getElementById('flashcard').onclick = flipCard;
document.querySelectorAll('.btn.rate').forEach(b =>
  b.onclick = () => rateCard(parseInt(b.dataset.grade)));

// Keyboard shortcuts
document.addEventListener('keydown', e => {
  if (!document.getElementById('view-review').classList.contains('active')) return;
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  if (e.code === 'Space') { e.preventDefault(); flipCard(); }
  else if (/^[1-5]$/.test(e.key)) rateCard(parseInt(e.key));
});

// ---------- INIT ----------
renderDashboard();