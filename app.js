// ==== FIREBASE SETUP ====
// Assumes firebase-app-compat.js and firebase-database-compat.js are loaded in index.html
// and firebase.initializeApp(firebaseConfig) has already been called there.

const db = firebase.database();

// ==== KEYS & LOCAL STATE ====

let players = [];
let session = { date: null, attendance: {} };
let currentPhotoPlayerId = null;

const TEAM_BIB_MAP = {
  North: 'blue',
  South: 'red',
  East: 'orange',
  West: 'green'
};

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// ==== FIREBASE HELPERS ====

function playersRef() {
  return db.ref('players');
}

function sessionRef() {
  return db.ref('session');
}

// Write full players array to Firebase
function savePlayersToFirebase() {
  playersRef().set(players).catch(console.error);
}

// Write full session object to Firebase
function saveSessionToFirebase() {
  sessionRef().set(session).catch(console.error);
}

// Listen for remote changes (multi-coach real-time)
function initFirebaseListeners() {
  playersRef().on('value', snapshot => {
    const data = snapshot.val() || {};
    // 🔴 CRITICAL FIX: always convert Firebase object → array
    players = Array.isArray(data) ? data : Object.values(data);

    players.forEach(p => {
      if (p.ability == null) p.ability = 3;
      if (!p.attendanceHistory) p.attendanceHistory = {};
    });

    renderPlayers();
    renderSession();
    renderTeams();
    renderAnalytics();
    renderBibOverview();
  });

  sessionRef().on('value', snapshot => {
    const data = snapshot.val();
    if (!data) {
      resetSessionFirebase();
      return;
    }
    // If date mismatch, reset to today
    if (data.date !== todayISO()) {
      resetSessionFirebase();
      return;
    }
    session = data;
    renderSession();
    renderAnalytics();
    renderBibOverview();
  });
}

// ==== SESSION MANAGEMENT (FIREBASE) ====

function resetSessionFirebase() {
  session = { date: todayISO(), attendance: {} };
  saveSessionToFirebase();
}

function getAttendanceFor(id) {
  if (!session || typeof session !== 'object') {
    session = { date: todayISO(), attendance: {} };
  }
  if (!session.attendance || typeof session.attendance !== 'object') {
    session.attendance = {};
  }
  if (!session.attendance[id]) {
    session.attendance[id] = { attended: false, bib: null };
  }
  return session.attendance[id];
}


function ensureTodaySessionExists() {
  const date = todayISO();
  let exists = false;
  for (const p of players) {
    if (p.attendanceHistory && p.attendanceHistory[date]) {
      exists = true;
      break;
    }
  }
  if (!exists) {
    players.forEach(p => {
      if (!p.attendanceHistory) p.attendanceHistory = {};
      p.attendanceHistory[date] = { attended: false, bib: null };
    });
  }
}

function removeTodaySessionIfEmpty() {
  const date = todayISO();
  const someoneAttended = players.some(
    p =>
      p.attendanceHistory &&
      p.attendanceHistory[date] &&
      p.attendanceHistory[date].attended
  );
  if (!someoneAttended) {
    players.forEach(p => {
      if (p.attendanceHistory) delete p.attendanceHistory[date];
    });
  }
}

// ==== DATE FORMATTING ====

function formatUkDate(dateStr) {
  if (!dateStr) return '';
  if (dateStr.includes('-')) {
    const [y, m, d] = dateStr.split('-');
    return `${d}/${m}/${y}`;
  }
  return dateStr;
}

// ==== IMAGE RESIZE (BASE64) ====

function resizeImage(file, cb) {
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const size = 300;
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, size, size);
      cb(canvas.toDataURL('image/jpeg', 0.8));
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

// ==== BIB OVERVIEW ====

function renderBibOverview() {
  const container = document.getElementById('bibOverview');
  if (!container) return;
  container.innerHTML = '';

  const colourMap = {
    red: {
      label: 'Red',
      bg: '#ffd6d6',
      border: '#ff9b9b'
    },
    green: {
      label: 'Green',
      bg: '#d9f5d9',
      border: '#9ed89e'
    },
    yellow: {
      label: 'Yellow',
      bg: '#fff7cc',
      border: '#ffe27a'
    },
    blue: {
      label: 'Blue',
      bg: '#d6e9ff',
      border: '#9bc4ff'
    },
    purple: {
      label: 'Purple',
      bg: '#ead6ff',
      border: '#c3a0ff'
    },
    orange: {
      label: 'Orange',
      bg: '#ffe0c2',
      border: '#ffb47a'
    }
  };

  const usedColours = {};
  players.forEach(p => {
    const att = getAttendanceFor(p.id);
    if (att.attended && att.bib && colourMap[att.bib]) {
      if (!usedColours[att.bib]) usedColours[att.bib] = [];
      usedColours[att.bib].push(p);
    }
  });

  const colourKeys = Object.keys(usedColours);
  if (colourKeys.length === 0) {
    container.innerHTML =
      '<div class="empty">No bibs assigned yet.</div>';
    return;
  }

  colourKeys.forEach(key => {
    const info = colourMap[key];
    const teamPlayers = usedColours[key];
    const div = document.createElement('div');
    div.className = 'bib-box';
    div.style.backgroundColor = info.bg;
    div.style.border = `1px solid ${info.border}`;
    div.style.borderRadius = '8px';
    div.style.padding = '8px 10px';
    div.style.marginBottom = '6px';

    const title = document.createElement('h3');
    title.textContent = `${info.label} (${teamPlayers.length})`;
    title.style.margin = '0 0 4px 0';
    title.style.fontSize = '14px';
    div.appendChild(title);

    teamPlayers.forEach(p => {
      const row = document.createElement('div');
      row.textContent = p.name;
      row.style.fontSize = '13px';
      div.appendChild(row);
    });

    container.appendChild(div);
  });
}

// ==== SESSION RENDERING ====

function renderSession() {
  const list = document.getElementById('sessionList');
  if (!list) return;
  list.innerHTML = '';

  const hideAbsent = document.getElementById('toggleHideAbsent')?.checked;
  const attendingCount = players.filter(
    p => getAttendanceFor(p.id).attended
  ).length;
  document.getElementById('sessionSummary').textContent =
    attendingCount + ' attending';

  players
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach(player => {
      const att = getAttendanceFor(player.id);
      if (hideAbsent && !att.attended) return;

      const item = document.createElement('div');
      item.className = 'list-item';

      const main = document.createElement('div');
      main.className = 'list-main';

      const img = document.createElement('img');
      img.className = 'player-photo';
      img.src = player.photo || '';
      img.onclick = () => openPhotoModal(player.id);

      const checkbox = document.createElement('div');
      checkbox.className = 'checkbox' + (att.attended ? ' checked' : '');
      const textWrap = document.createElement('div');

      const nameEl = document.createElement('div');
      nameEl.className = 'player-name';
      nameEl.textContent = player.name;

      const metaEl = document.createElement('div');
      metaEl.className = 'player-meta';
      const teamLabel = player.permanentTeam
        ? player.permanentTeam + ' Team'
        : 'No team';
      metaEl.textContent = att.attended ? teamLabel : 'Not marked';

      textWrap.appendChild(nameEl);
      textWrap.appendChild(metaEl);
      main.appendChild(img);
      main.appendChild(checkbox);
      main.appendChild(textWrap);

      const right = document.createElement('div');
      const bibSelect = document.createElement('select');

      ['', 'red', 'green', 'yellow', 'blue', 'purple', 'orange'].forEach(
        c => {
          const o = document.createElement('option');
          o.value = c;
          o.textContent = c ? c[0].toUpperCase() + c.slice(1) : 'None';
          bibSelect.appendChild(o);
        }
      );

      bibSelect.value = att.bib || '';
      bibSelect.onchange = () => {
        att.bib = bibSelect.value || null;
        if (att.bib) att.attended = true;

        const date = todayISO();
        if (!player.attendanceHistory) player.attendanceHistory = {};
        ensureTodaySessionExists();
        player.attendanceHistory[date].attended = att.attended;
        player.attendanceHistory[date].bib = att.bib;
        removeTodaySessionIfEmpty();

        savePlayersToFirebase();
        saveSessionToFirebase();
        renderSession();
        renderAnalytics();
        renderBibOverview();
      };

      checkbox.onclick = () => {
        att.attended = !att.attended;

        if (!att.attended) {
          att.bib = null;
          bibSelect.value = '';
        } else {
          if (!att.bib) {
            const team = player.permanentTeam;
            const mapped = team ? TEAM_BIB_MAP[team] : null;
            if (mapped) {
              att.bib = mapped;
              bibSelect.value = mapped;
              bibSelect.style.setProperty('--flash-color', mapped);
              bibSelect.classList.add('bib-flash');
              setTimeout(
                () => bibSelect.classList.remove('bib-flash'),
                500
              );
            }
          }
        }

        const date = todayISO();
        if (!player.attendanceHistory) player.attendanceHistory = {};
        ensureTodaySessionExists();
        player.attendanceHistory[date].attended = att.attended;
        player.attendanceHistory[date].bib = att.bib;
        removeTodaySessionIfEmpty();
        savePlayersToFirebase();
        saveSessionToFirebase();
        renderSession();
        renderAnalytics();
        renderBibOverview();
      };

      right.appendChild(bibSelect);
      item.appendChild(main);
      item.appendChild(right);

      list.appendChild(item);
    });

  if (!list.hasChildNodes()) {
    list.innerHTML =
      '<div class="empty">No players match this view.</div>';
  }

  renderBibOverview();
}

// ==== PLAYERS RENDERING ====

function renderPlayers() {
  const list = document.getElementById('playersList');
  if (!list) return;
  list.innerHTML = '';
  document.getElementById('playersCountLabel').textContent =
    players.length + ' players';

  players
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach(player => {
      const item = document.createElement('div');
      item.className = 'list-item';

      const main = document.createElement('div');
      main.className = 'list-main';

      const img = document.createElement('img');
      img.className = 'player-photo';
      img.src = player.photo || '';
      img.onclick = () => openPhotoModal(player.id);

      const textWrap = document.createElement('div');

      const nameEl = document.createElement('div');
      nameEl.className = 'player-name';
      nameEl.textContent = player.name;

      const teamSelect = document.createElement('select');
      ['', 'North', 'South', 'East', 'West'].forEach(t => {
        const o = document.createElement('option');
        o.value = t;
        o.textContent = t || 'No team';
        teamSelect.appendChild(o);
      });
      teamSelect.value = player.permanentTeam || '';

      teamSelect.onchange = () => {
        player.permanentTeam = teamSelect.value || null;
        savePlayersToFirebase();
        renderSession();
        renderTeams();
        renderAnalytics();
        renderBibOverview();
      };

      const teamLabel = document.createElement('div');
      teamLabel.className = 'player-meta';
      teamLabel.textContent = 'Permanent Team: ';

      const teamRow = document.createElement('div');
      teamRow.style.display = 'flex';
      teamRow.style.alignItems = 'center';
      teamRow.style.gap = '6px';
      teamRow.appendChild(teamLabel);
      teamRow.appendChild(teamSelect);

      const att = getAttendanceFor(player.id);
      const metaEl = document.createElement('div');
      metaEl.className = 'player-meta';
      metaEl.textContent = att.attended
        ? 'Attended today'
        : 'Not marked today';

      const abilityRow = document.createElement('div');
      abilityRow.className = 'player-meta';

      const stars = document.createElement('div');
      stars.className = 'ability-stars';
      stars.dataset.playerId = player.id;
      const abilityValue = player.ability || 3;
      for (let i = 1; i <= 5; i++) {
        const s = document.createElement('span');
        s.className = 'star' + (i <= abilityValue ? ' filled' : '');
        s.textContent = '*';
        s.dataset.value = i;
        s.onclick = () => {
          player.ability = i;
          savePlayersToFirebase();
          renderPlayers();
          renderTeams();
        };
        stars.appendChild(s);
      }
      abilityRow.appendChild(stars);

      textWrap.appendChild(nameEl);
      textWrap.appendChild(teamRow);
      textWrap.appendChild(metaEl);
      textWrap.appendChild(abilityRow);

      main.appendChild(img);
      main.appendChild(textWrap);

      const delBtn = document.createElement('button');
      delBtn.className = 'btn-danger btn-small';
      delBtn.textContent = 'Delete';
      delBtn.onclick = () => {
        if (!confirm('Delete ' + player.name + '?')) return;
        players = players.filter(p => p.id !== player.id);
        delete session.attendance[player.id];
        savePlayersToFirebase();
        saveSessionToFirebase();
        renderPlayers();
        renderSession();
        renderTeams();
        renderAnalytics();
        renderBibOverview();
      };

      item.appendChild(main);
      item.appendChild(delBtn);
      list.appendChild(item);
    });

  if (!list.hasChildNodes()) {
    list.innerHTML = '<div class="empty">No players yet.</div>';
  }
}

// ==== TEAMS RENDERING & DRAG/DROP ====

function renderTeams() {
  const teams = ['Unassigned', 'North', 'South', 'East', 'West'];
  teams.forEach(t => {
    const body = document.querySelector(`[data-team-body="${t}"]`);
    const countEl = document.querySelector(`[data-team-count="${t}"]`);
    if (body) body.innerHTML = '';
    if (countEl) countEl.textContent = '0';
  });

  players
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach(player => {
      const team = player.permanentTeam || 'Unassigned';
      const body = document.querySelector(
        `[data-team-body="${team}"]`
      );
      const countEl = document.querySelector(
        `[data-team-count="${team}"]`
      );
      if (!body || !countEl) return;

      const card = document.createElement('div');
      card.className = 'team-player';
      card.draggable = true;
      card.dataset.playerId = player.id;

      const img = document.createElement('img');
      img.src = player.photo || '';
      img.className = 'team-player-photo';

      const name = document.createElement('div');
      name.className = 'team-player-name';
      name.textContent = player.name;

      const stars = document.createElement('div');
      stars.className = 'team-stars';

      const abilityValue = player.ability || 3;
      for (let i = 1; i <= 5; i++) {
        const s = document.createElement('span');
        s.className = 'star' + (i <= abilityValue ? ' filled' : '');
        s.textContent = '*';
        s.dataset.value = i;
        s.onclick = e => {
          e.stopPropagation();
          player.ability = i;
          savePlayersToFirebase();
          renderTeams();
          renderPlayers();
        };
        stars.appendChild(s);
      }

      card.appendChild(img);
      card.appendChild(name);
      card.appendChild(stars);

      card.addEventListener('dragstart', e => {
        e.dataTransfer.setData('text/plain', String(player.id));
      });

      body.appendChild(card);
      countEl.textContent = String(
        parseInt(countEl.textContent, 10) + 1
      );
    });
}

function initTeamDragAndDrop() {
  document.querySelectorAll('.team-body').forEach(body => {
    body.addEventListener('dragover', e => {
      e.preventDefault();
      body.classList.add('drag-over');
    });
    body.addEventListener('dragleave', () => {
      body.classList.remove('drag-over');
    });

    body.addEventListener('drop', e => {
      e.preventDefault();
      body.classList.remove('drag-over');

      const idStr = e.dataTransfer.getData('text/plain');
      const id = parseInt(idStr, 10);
      const player = players.find(p => p.id === id);
      if (!player) return;

      const team = body.getAttribute('data-team-body');
      player.permanentTeam = team === 'Unassigned' ? null : team;
      savePlayersToFirebase();
      renderTeams();
      renderPlayers();
      renderSession();
      renderAnalytics();
      renderBibOverview();
    });
  });
}

// ==== PHOTO MODAL ====

function openPhotoModal(id) {
  currentPhotoPlayerId = id;
  const p = players.find(p => p.id === id);
  document.getElementById('modalPhoto').src = (p && p.photo) || '';
  document.getElementById('photoModal').style.display = 'flex';
}

function initPhotoModal() {
  const closeBtn = document.getElementById('btnCloseModal');
  const removeBtn = document.getElementById('btnRemovePhoto');
  const changeBtn = document.getElementById('btnChangePhoto');
  const input = document.getElementById('photoInput');

  if (closeBtn) {
    closeBtn.onclick = () => {
      document.getElementById('photoModal').style.display = 'none';
    };
  }

  if (removeBtn) {
    removeBtn.onclick = () => {
      const p = players.find(p => p.id === currentPhotoPlayerId);
      if (!p) return;
      p.photo = null;
      savePlayersToFirebase();
      renderPlayers();
      renderSession();
      renderTeams();
      renderAnalytics();
      renderBibOverview();
      document.getElementById('photoModal').style.display = 'none';
    };
  }

  if (changeBtn && input) {
    changeBtn.onclick = () => {
      input.value = '';
      input.click();
    };

    input.onchange = e => {
      const file = e.target.files[0];
      if (!file) return;
      resizeImage(file, data => {
        const p = players.find(
          p => p.id === currentPhotoPlayerId
        );
        if (!p) return;
        p.photo = data;
        savePlayersToFirebase();
        renderPlayers();
        renderSession();
        renderTeams();
        renderAnalytics();
        renderBibOverview();
        document.getElementById('modalPhoto').src = data;
      });
    };
  }
}

// ==== RANDOM BIBS ====

function randomiseBibs(teamCount) {
  const attending = players.filter(
    p => getAttendanceFor(p.id).attended
  );
  if (attending.length === 0) {
    alert('No attending players.');
    return;
  }
  const colours = ['red', 'green', 'yellow', 'blue', 'purple', 'orange'].slice(
    0,
    teamCount
  );
  const shuffled = attending.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  ensureTodaySessionExists();

  shuffled.forEach((p, i) => {
    const att = getAttendanceFor(p.id);
    att.attended = true;
    att.bib = colours[i % colours.length];
    const date = todayISO();
    if (!p.attendanceHistory) p.attendanceHistory = {};
    p.attendanceHistory[date].attended = true;
    p.attendanceHistory[date].bib = att.bib;
  });

  savePlayersToFirebase();
  saveSessionToFirebase();
  renderSession();
  renderAnalytics();
  renderBibOverview();
}

// ==== ANALYTICS ====

function renderAnalytics() {
  const tbody = document.querySelector('#analyticsTable tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  players
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach(player => {
      const history = player.attendanceHistory || {};
      const dates = Object.keys(history).sort();

      const total = dates.length;
      const attended = dates.filter(d => history[d].attended).length;
      const percent = total
        ? Math.round((attended / total) * 100)
        : 0;
      const lastAttendedDate =
        dates.filter(d => history[d].attended).slice(-1)[0] || '';
      let streak = 0;
      let prev = null;

      dates.forEach(d => {
        if (history[d].attended) {
          if (prev) {
            const diff =
              (new Date(d) - new Date(prev)) /
              (1000 * 60 * 60 * 24);
            streak = diff <= 2 ? streak + 1 : 1;
          } else {
            streak = 1;
          }
          prev = d;
        }
      });

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${player.name}</td>
        <td>${total}</td>
        <td>${attended}</td>
        <td>${percent}%</td>
        <td>${formatUkDate(lastAttendedDate)}</td>
        <td>${streak}</td>
      `;
      tbody.appendChild(tr);
    });
}

function exportAnalyticsCSV() {
  let csv = 'Name,Sessions,Attended,Percent,Last Attended,Streak\n';
  players.forEach(player => {
    const history = player.attendanceHistory || {};
    const dates = Object.keys(history).sort();
    const total = dates.length;
    const attended = dates.filter(d => history[d].attended).length;
    const percent = total
      ? Math.round((attended / total) * 100)
      : 0;
    const lastAttendedDate =
      dates.filter(d => history[d].attended).slice(-1)[0] || '';
    let streak = 0;
    let prev = null;

    dates.forEach(d => {
      if (history[d].attended) {
        if (prev) {
          const diff =
            (new Date(d) - new Date(prev)) /
            (1000 * 60 * 60 * 24);
          streak = diff <= 2 ? streak + 1 : 1;
        } else {
          streak = 1;
        }
        prev = d;
      }
    });

    csv += `${player.name},${total},${attended},${percent},${formatUkDate(
      lastAttendedDate
    )},${streak}\n`;
  });

  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'attendance_analytics.csv';
  a.click();
  URL.revokeObjectURL(url);
}

// ==== TABS & CONTROLS ====

function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.onclick = () => {
      document
        .querySelectorAll('.tab-btn')
        .forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const tab = btn.dataset.tab;
      document
        .querySelectorAll('.section')
        .forEach(s => s.classList.remove('active'));
      const section = document.getElementById('section-' + tab);
      if (section) section.classList.add('active');

      if (tab === 'analytics') renderAnalytics();
      if (tab === 'session') renderSession();
    };
  });
}

function initControls() {
  const addBtn = document.getElementById('btnAddPlayer');
  const nameInput = document.getElementById('newPlayerName');
  if (addBtn && nameInput) {
    addBtn.onclick = () => {
      const name = nameInput.value.trim();
      if (!name) return;

      if (
        players.some(
          p => p.name.toLowerCase() === name.toLowerCase()
        )
      ) {
        alert('Player already exists.');
        return;
      }
      const id = Date.now() + Math.floor(Math.random() * 100000);
      players.push({
        id,
        name,
        photo: null,
        permanentTeam: null,
        ability: 3,
        attendanceHistory: {}
      });
      savePlayersToFirebase();
      nameInput.value = '';
      // Firebase listener will re-render
    };
    nameInput.onkeyup = e => {
      if (e.key === 'Enter') addBtn.click();
    };
  }

  const toggleHideAbsent = document.getElementById(
    'toggleHideAbsent'
  );
  if (toggleHideAbsent) {
    toggleHideAbsent.onchange = renderSession;
  }

  const btnClearSession = document.getElementById('btnClearSession');
  if (btnClearSession) {
    btnClearSession.onclick = () => {
      if (!confirm("Clear today's attendance and bibs?")) return;
      resetSessionFirebase();
      renderSession();
      renderAnalytics();
      renderBibOverview();
    };
  }

  const btnRandomTeams = document.getElementById('btnRandomTeams');
  const teamCountSelect = document.getElementById('teamCountSelect');
  if (btnRandomTeams && teamCountSelect) {
    btnRandomTeams.onclick = () => {
      const teamCount =
        parseInt(teamCountSelect.value, 10) || 2;
      randomiseBibs(teamCount);
    };
  }

  const btnExport = document.getElementById('btnExport');
  if (btnExport) {
    btnExport.onclick = () => {
      if (players.length === 0) {
        alert('No players.');
        return;
      }
      const names = players.map(p => p.name).join('\n');
      prompt('Copy names:', names);
    };
  }

  const btnImport = document.getElementById('btnImport');
  if (btnImport) {
    btnImport.onclick = () => {
      const text = prompt('Paste names (one per line):');
      if (!text) return;
      const lines = text
        .split('\n')
        .map(l => l.trim())
        .filter(l => l);
      if (!lines.length) return;

      const existing = new Set(
        players.map(p => p.name.toLowerCase())
      );
      let added = 0;

      lines.forEach(name => {
        if (!existing.has(name.toLowerCase())) {
          const id =
            Date.now() + Math.floor(Math.random() * 100000);
          players.push({
            id,
            name,
            photo: null,
            permanentTeam: null,
            ability: 3,
            attendanceHistory: {}
          });
          existing.add(name.toLowerCase());
          added++;
        }
      });

      if (added) {
        savePlayersToFirebase();
        renderPlayers();
        renderSession();
        renderTeams();
        renderAnalytics();
        renderBibOverview();
        alert('Imported ' + added + ' players.');
      } else {
        alert('No new names.');
      }
    };
  }

  const btnDeleteAll = document.getElementById('btnDeleteAll');
  if (btnDeleteAll) {
    btnDeleteAll.onclick = () => {
      if (!confirm('Delete ALL players and session?')) return;
      players = [];
      savePlayersToFirebase();
      resetSessionFirebase();
      renderPlayers();
      renderSession();
      renderTeams();
      renderAnalytics();
      renderBibOverview();
    };
  }

  const btnExportAnalytics =
    document.getElementById('btnExportAnalytics');
  if (btnExportAnalytics) {
    btnExportAnalytics.onclick = exportAnalyticsCSV;
  }
}

// ==== TODAY LABEL ====

function initTodayLabel() {
  const d = new Date();
  const opts = { weekday: 'short', day: 'numeric', month: 'short' };
  const label = document.getElementById('todayLabel');
  if (label) {
    label.textContent = d.toLocaleDateString(undefined, opts);
  }
}

// ==== INIT ====

function init() {
  initFirebaseListeners();
  initTodayLabel();
  initTabs();
  initControls();
  initTeamDragAndDrop();
  initPhotoModal();
}

document.addEventListener('DOMContentLoaded', init);
