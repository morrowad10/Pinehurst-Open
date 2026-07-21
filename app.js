/* Golf Trip Leaderboard — app logic
   Data lives in localStorage while editing. Use Admin → Export to save
   your changes back into data/data.json and commit them to GitHub. */

const LS_KEY = "golfTripState_v1";
const FORMATS = {
  fourball:  { label: "Fourball (Better Ball) Match Play", kind: "match" },
  foursomes: { label: "Foursomes Match Play",              kind: "match" },
  singles:   { label: "Singles Match Play",                kind: "match" },
  scramble:  { label: "Scramble",                           kind: "teamscore" },
  skins:     { label: "Skins",                              kind: "teamscore" },
  stableford_team: { label: "Team Stableford",              kind: "teamscore" }
};

/* Individual side-contests, purely personal — points add to that player's
   spot on the individual leaderboard only, never to team totals. */
const CONTEST_TYPES = [
  { id: "closest_to_pin", label: "Closest to the Pin", defaultPoints: 2 }
];
function contestLabel(id) { return CONTEST_TYPES.find(c => c.id === id)?.label || id; }
function contestDefaultPoints(id) { return CONTEST_TYPES.find(c => c.id === id)?.defaultPoints ?? 2; }

let STATE = null;
let TAB = "overall";

async function loadState() {
  const cached = localStorage.getItem(LS_KEY);
  if (cached) {
    try { STATE = JSON.parse(cached); return; } catch (e) { /* fall through */ }
  }
  const res = await fetch("data/data.json");
  STATE = await res.json();
}

function saveState() {
  localStorage.setItem(LS_KEY, JSON.stringify(STATE));
}

function getPlayer(id) { return STATE.players.find(p => p.id === id); }
function getTeam(id) { return STATE.teams.find(t => t.id === id); }
function playersOfTeam(teamId) { return STATE.players.filter(p => p.teamId === teamId); }
function fmt(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return "\u2013";
  return (Math.round(n * 10) / 10).toString();
}
function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._h);
  toast._h = setTimeout(() => t.classList.remove("show"), 2200);
}

/* ---------------- Computation ---------------- */

function getPointsPerMember() { return Number(STATE.settings?.pointsPerMember ?? 5); }
function getHalvePointsPerMember() { return getPointsPerMember() / 2; }

function teamMemberCount(teamId) { return playersOfTeam(teamId).length; }

/* ---- Auto-computed match play: best ball per hole ----
   For a side with 1 player (singles) or 2 (fourball/foursomes), that side's
   score on a given hole is the lowest of its players' strokes on that hole
   (their teammate's strokes on holes they didn't personally have the low
   ball on simply don't matter, same as real better-ball scoring). A hole
   only counts once BOTH sides have at least one player's strokes entered
   for it, so partial scorecards mid-round don't skew the match. */
function sideHoleScore(r, playerIds, holeIndex) {
  const vals = (playerIds || [])
    .map(id => deriveScore(r, id).holes[holeIndex])
    .filter(v => v !== undefined && v !== null && v !== "")
    .map(Number);
  return vals.length === 0 ? null : Math.min(...vals);
}

function computeMatchWinner(r, m) {
  let wonA = 0, wonB = 0, halved = 0, compared = 0;
  for (let h = 0; h < 18; h++) {
    const a = sideHoleScore(r, m.teamAPlayers, h);
    const b = sideHoleScore(r, m.teamBPlayers, h);
    if (a === null || b === null) continue;
    compared++;
    if (a < b) wonA++;
    else if (b < a) wonB++;
    else halved++;
  }
  if (compared === 0) return null;
  const winner = wonA > wonB ? "A" : wonB > wonA ? "B" : "halve";
  return { wonA, wonB, halved, compared, winner };
}

/* For singles (head-to-head) rounds, a "foursome" of 4 is really 2 separate
   1-on-1 duels happening side by side (paired in roster order: 1st vs 1st,
   2nd vs 2nd) — not one 2v2 best-ball match. Nassau still spans all 4
   players either way. The foursome's own result is decided the same way a
   round is: whichever side wins more of its 2 duels, tied duels halve it. */
function computeFoursomeOutcome(r, m) {
  const isSingles = r.format === "singles" && m.teamAPlayers.length === 2 && m.teamBPlayers.length === 2;
  if (!isSingles) {
    const res = computeMatchWinner(r, m);
    return res ? { winner: res.winner, pairings: null, summary: res } : null;
  }
  const pairings = [0, 1].map(i => ({
    a: m.teamAPlayers[i], b: m.teamBPlayers[i],
    result: computeMatchWinner(r, { teamAPlayers: [m.teamAPlayers[i]], teamBPlayers: [m.teamBPlayers[i]] })
  }));
  const decided = pairings.filter(p => p.result);
  if (decided.length === 0) return null;
  let aScore = 0, bScore = 0;
  decided.forEach(p => {
    if (p.result.winner === "A") aScore += 1;
    else if (p.result.winner === "B") bScore += 1;
    else { aScore += 0.5; bScore += 0.5; }
  });
  const winner = aScore > bScore ? "A" : bScore > aScore ? "B" : "halve";
  return { winner, pairings, summary: null };
}

/* Match-play rounds (2v2 x3, etc.): the winner is whichever team wins the
   majority of that round's individual foursomes (foursomes can themselves be
   win/halve, so majority is by score, not just count). Each foursome's own
   result is derived from hole-by-hole strokes, not picked manually. */
function roundMatchOutcome(r) {
  const [tA, tB] = STATE.teams;
  const matches = r.matches || [];
  if (matches.length === 0) return null;
  let aScore = 0, bScore = 0, anyDecided = false;
  matches.forEach(m => {
    const res = computeFoursomeOutcome(r, m);
    if (!res) return;
    anyDecided = true;
    if (res.winner === "A") aScore += 1;
    else if (res.winner === "B") bScore += 1;
    else { aScore += 0.5; bScore += 0.5; }
  });
  if (!anyDecided) return null;
  const winner = aScore > bScore ? tA.id : bScore > aScore ? tB.id : "halve";
  return { aScore, bScore, winner };
}

/* Non-match rounds (scramble, skins, etc.): the winner is set directly by
   the admin, since there's no natural match-count to derive it from. */
function roundTeamScoreOutcome(r) {
  if (!r.winner) return null;
  return { winner: r.winner };
}

function roundOutcome(r) {
  const fmtDef = FORMATS[r.format] || { kind: "match" };
  return fmtDef.kind === "match" ? roundMatchOutcome(r) : roundTeamScoreOutcome(r);
}

/* Converts a round outcome into actual points: the winning team gets
   getPointsPerMember() for every player on that team; a halve splits
   getHalvePointsPerMember() per member to each team. */
function roundPoints(outcome) {
  const [tA, tB] = STATE.teams;
  if (!outcome) return null;
  const per = getPointsPerMember(), half = getHalvePointsPerMember();
  if (outcome.winner === "halve") {
    return { [tA.id]: half * teamMemberCount(tA.id), [tB.id]: half * teamMemberCount(tB.id) };
  }
  const winner = outcome.winner;
  const loser = winner === tA.id ? tB.id : tA.id;
  return { [winner]: per * teamMemberCount(winner), [loser]: 0 };
}

function computeTeamTotals() {
  const totals = {};
  STATE.teams.forEach(t => totals[t.id] = 0);
  STATE.rounds.forEach(r => {
    const pts = roundPoints(roundOutcome(r));
    if (pts) STATE.teams.forEach(t => totals[t.id] += pts[t.id] || 0);
  });
  return totals;
}

/* ---- Nassau (front 9 / back 9 / total gross), one point per category ----
   Foursomes are taken directly from the round's match pairings (each match's
   teamAPlayers + teamBPlayers), so this only applies to matches with exactly
   4 players. Purely individual — never touches team totals. A tie for lowest
   in a category splits that category's point evenly among the tied players. */
/* ---- Hole-by-hole scorecard helpers ----
   Each individualScores entry now stores a raw 18-hole strokes array
   (holes[0..8] = front 9, holes[9..17] = back 9). Front9/Back9/Gross/Net
   are always derived from that array rather than typed in separately. */
function emptyHoles() { return new Array(18).fill(""); }
function sumHoles(holes, start, end) {
  let sum = 0;
  for (let i = start; i < end; i++) {
    const v = holes[i];
    if (v !== undefined && v !== null && v !== "") sum += Number(v);
  }
  return sum;
}
function holesEnteredCount(holes) {
  return (holes || []).filter(v => v !== undefined && v !== null && v !== "").length;
}
function findScoreEntry(r, playerId) {
  return (r.individualScores || []).find(s => s.playerId === playerId);
}
/* Derived score summary for one player in one round. gross/net are null
   until at least one hole has been entered. */
function deriveScore(r, playerId) {
  const entry = findScoreEntry(r, playerId);
  const player = getPlayer(playerId);
  const holes = (entry && entry.holes) || emptyHoles();
  const entered = holesEnteredCount(holes);
  const frontEntered = holesEnteredCount(holes.slice(0, 9));
  const backEntered = holesEnteredCount(holes.slice(9, 18));
  const front9 = frontEntered > 0 ? sumHoles(holes, 0, 9) : null;
  const back9 = backEntered > 0 ? sumHoles(holes, 9, 18) : null;
  const gross = (front9 !== null && back9 !== null) ? front9 + back9 : null;
  const net = gross !== null ? gross - (player?.handicap || 0) : null;
  const stableford = entry && entry.stableford !== undefined && entry.stableford !== "" ? Number(entry.stableford) : null;
  return { holes, entered, front9, back9, gross, net, stableford };
}

function nassauCategoryWinner(values) {
  // values: [{playerId, value}], already filtered to numeric entries
  if (values.length < 2) return null;
  const min = Math.min(...values.map(v => v.value));
  const winners = values.filter(v => v.value === min).map(v => v.playerId);
  return { min, winners, pointsEach: 1 / winners.length };
}

function computeNassauForRound(r) {
  const cats = ["front9", "back9", "gross"];
  return (r.matches || []).map(m => {
    const ids = [...(m.teamAPlayers || []), ...(m.teamBPlayers || [])];
    if (ids.length !== 4) return null;
    const catResults = {};
    cats.forEach(cat => {
      const values = ids
        .map(id => {
          const d = deriveScore(r, id);
          const v = d[cat];
          return (v === null || v === undefined) ? null : { playerId: id, value: v };
        })
        .filter(Boolean);
      catResults[cat] = nassauCategoryWinner(values);
    });
    return { matchId: m.id, playerIds: ids, catResults };
  }).filter(Boolean);
}

function computeNassauPoints() {
  const totals = {};
  STATE.players.forEach(p => totals[p.id] = 0);
  STATE.rounds.forEach(r => {
    computeNassauForRound(r).forEach(res => {
      ["front9", "back9", "gross"].forEach(cat => {
        const cr = res.catResults[cat];
        if (cr) cr.winners.forEach(pid => { totals[pid] = (totals[pid] || 0) + cr.pointsEach; });
      });
    });
  });
  return totals;
}

function computeIndividualTotals() {
  const rows = STATE.players.map(p => ({
    player: p, gross: 0, net: 0, stableford: 0, bonus: 0, nassau: 0, roundsPlayed: 0
  }));
  const byId = Object.fromEntries(rows.map(r => [r.player.id, r]));
  STATE.rounds.forEach(r => {
    STATE.players.forEach(p => {
      const d = deriveScore(r, p.id);
      const row = byId[p.id];
      if (d.entered === 0 && d.stableford === null) return;
      if (d.gross !== null) { row.gross += d.gross; row.net += d.net; row.roundsPlayed += 1; }
      if (d.stableford !== null) { row.stableford += d.stableford; }
    });
    (r.contests || []).forEach(c => {
      const row = byId[c.playerId];
      if (!row) return;
      row.bonus += Number(c.points || 0);
    });
  });
  const nassauTotals = computeNassauPoints();
  rows.forEach(row => { row.nassau = nassauTotals[row.player.id] || 0; });
  return rows;
}

/* Per-contest-type totals, keyed by player then contest type id. */
function computeContestTotalsByType() {
  const result = {};
  STATE.players.forEach(p => {
    result[p.id] = {};
    CONTEST_TYPES.forEach(c => { result[p.id][c.id] = 0; });
  });
  STATE.rounds.forEach(r => {
    (r.contests || []).forEach(c => {
      if (!result[c.playerId]) return;
      result[c.playerId][c.type] = (result[c.playerId][c.type] || 0) + Number(c.points || 0);
    });
  });
  return result;
}

/* Each player's own Team Event points: for every round, if their team won
   that round they personally earn getPointsPerMember() (5 by default) — not
   the team's whole pooled total. A halved round pays getHalvePointsPerMember()
   instead. This is a flat per-person amount, the same for every teammate,
   regardless of how many foursomes any individual personally won. */
function computePlayerTeamEventPoints(playerId) {
  const player = getPlayer(playerId);
  const per = getPointsPerMember(), half = getHalvePointsPerMember();
  let total = 0;
  STATE.rounds.forEach(r => {
    const outcome = roundOutcome(r);
    if (!outcome) return;
    if (outcome.winner === "halve") total += half;
    else if (outcome.winner === player.teamId) total += per;
  });
  return total;
}

/* The master leaderboard row per player: Team Event (their own flat points
   from team round wins), Nassau, one column per contest type, and a grand
   Total across all of them. */
function computeMasterLeaderboard() {
  const nassauTotals = computeNassauPoints();
  const contestTotals = computeContestTotalsByType();
  return STATE.players.map(p => {
    const teamEvent = computePlayerTeamEventPoints(p.id);
    const nassau = nassauTotals[p.id] || 0;
    const contests = contestTotals[p.id] || {};
    const contestSum = CONTEST_TYPES.reduce((sum, c) => sum + (contests[c.id] || 0), 0);
    const total = teamEvent + nassau + contestSum;
    return { player: p, teamEvent, nassau, contests, total };
  });
}

/* ---------------- Render: shell ---------------- */


function render() {
  renderHeader();
  renderTabs();
  const app = document.getElementById("app");
  if (TAB === "overall") app.innerHTML = renderOverall();
  else if (TAB.startsWith("round:")) app.innerHTML = renderRound(TAB.split(":")[1]);
  else if (TAB === "players") app.innerHTML = renderPlayers();
  else if (TAB === "admin") app.innerHTML = renderAdmin();
  bindTabEvents();
}

function renderHeader() {
  document.getElementById("headerBox").innerHTML = `
    <img class="site-logo" src="assets/logo.png" alt="${STATE.trip.name} logo">
    <div class="eyebrow">Trip Leaderboard \u2014 ${STATE.trip.year || ""}</div>
    <h1>${STATE.trip.name}</h1>
    <div class="subtitle">${STATE.trip.subtitle || ""}</div>
  `;
}

function renderTabs() {
  const items = [
    { id: "overall", label: "Overall" },
    ...STATE.rounds.map(r => ({ id: `round:${r.id}`, label: r.name })),
    { id: "players", label: "Players" },
    { id: "admin", label: "Admin" }
  ];
  document.getElementById("tabsBox").innerHTML = items.map(it =>
    `<button class="tab-btn ${TAB === it.id ? "active" : ""}" data-tab="${it.id}">${it.label}</button>`
  ).join("");
}

function bindTabEvents() {
  document.querySelectorAll("[data-tab]").forEach(btn => {
    btn.addEventListener("click", () => { TAB = btn.dataset.tab; render(); window.scrollTo({top:0, behavior:"smooth"}); });
  });
}

/* ---------------- Render: Overall ---------------- */

function renderOverall() {
  const rows = computeMasterLeaderboard()
    .sort((x, y) => y.total - x.total);

  return `
    <div class="card">
      <div class="card-title">Overall Leaderboard</div>
      <div class="card-sub">Team event + Nassau + individual contests \u00b7 ranked by total points \u00b7 gross/net/Stableford live on each round's page</div>
      <div class="table-scroll">
      <table class="led">
        <thead><tr>
          <th>#</th><th>Player</th><th class="num">Total</th><th class="num">Team Event</th><th class="num">Nassau</th>
          ${CONTEST_TYPES.map(c => `<th class="num">${c.label}</th>`).join("")}
        </tr></thead>
        <tbody>
          ${rows.map((r, i) => `
            <tr>
              <td class="rank">${i + 1}</td>
              <td><span class="dot" style="background:${getTeam(r.player.teamId).color}"></span><span class="player-name">${r.player.name}</span></td>
              <td class="num" style="font-weight:700">${fmt(r.total)}</td>
              <td class="num">${fmt(r.teamEvent)}</td>
              <td class="num">${fmt(r.nassau)}</td>
              ${CONTEST_TYPES.map(c => `<td class="num">${fmt(r.contests[c.id])}</td>`).join("")}
            </tr>
          `).join("")}
        </tbody>
      </table>
      </div>
      <div class="score-footnote" style="text-align:left; margin-top:10px">Team Event = your team's round-win points (${getPointsPerMember()} pts \u00d7 members on a win, ${getHalvePointsPerMember()} \u00d7 members on a halve) \u2014 shared equally by every teammate</div>
    </div>
  `;
}

/* ---------------- Render: Round ---------------- */

function outcomeBannerHtml(outcome) {
  if (!outcome) return "";
  const [tA, tB] = STATE.teams;
  const pts = roundPoints(outcome);
  if (outcome.winner === "halve") {
    return `<div class="score-footnote" style="margin:-4px 0 14px; font-size:12px">
      Round halved \u2014 <strong style="color:${tA.color}">${tA.name}</strong> +${fmt(pts[tA.id])} pts,
      <strong style="color:${tB.color}">${tB.name}</strong> +${fmt(pts[tB.id])} pts (${getHalvePointsPerMember()} &times; each team's members)
    </div>`;
  }
  const winTeam = getTeam(outcome.winner);
  return `<div class="score-footnote" style="margin:-4px 0 14px; font-size:12px">
    <strong style="color:${winTeam.color}">${winTeam.name}</strong> wins the round \u2014 +${fmt(pts[outcome.winner])} pts
    (${getPointsPerMember()} &times; ${teamMemberCount(outcome.winner)} members)
  </div>`;
}

function matchStatusHtml(r, m) {
  const [tA, tB] = STATE.teams;
  const outcome = computeFoursomeOutcome(r, m);
  if (!outcome) return `<div class="note" style="margin:8px 0">No holes compared yet \u2014 enter scores below.</div>`;

  if (outcome.pairings) {
    // Singles: show each 1v1 duel plus the overall foursome result
    const pairLines = outcome.pairings.map(p => {
      const aName = getPlayer(p.a)?.name, bName = getPlayer(p.b)?.name;
      if (!p.result) return `<div>${aName} vs ${bName}: no holes compared yet</div>`;
      if (p.result.winner === "halve") return `<div>${aName} vs ${bName}: all square (${p.result.wonA}\u2013${p.result.wonB})</div>`;
      const winnerName = p.result.winner === "A" ? aName : bName;
      const lead = Math.max(p.result.wonA, p.result.wonB), trail = Math.min(p.result.wonA, p.result.wonB);
      return `<div><strong>${winnerName}</strong> leading ${lead}\u2013${trail} (${p.result.compared} holes compared)</div>`;
    }).join("");
    const overall = outcome.winner === "halve"
      ? `Foursome all square`
      : `<strong style="color:${(outcome.winner === "A" ? tA : tB).color}">${(outcome.winner === "A" ? tA : tB).name}</strong> leading this foursome`;
    return `<div class="score-footnote" style="text-align:left; margin:8px 0; font-size:12px">${pairLines}<div style="margin-top:4px">${overall}</div></div>`;
  }

  const res = outcome.summary;
  if (outcome.winner === "halve") {
    return `<div class="score-footnote" style="text-align:left; margin:8px 0; font-size:12px">All square through ${res.compared} holes compared (${res.wonA}\u2013${res.wonB}, ${res.halved} halved)</div>`;
  }
  const leader = outcome.winner === "A" ? tA : tB;
  const lead = Math.max(res.wonA, res.wonB), trail = Math.min(res.wonA, res.wonB);
  return `<div class="score-footnote" style="text-align:left; margin:8px 0; font-size:12px"><strong style="color:${leader.color}">${leader.name}</strong> leading ${lead}\u2013${trail} through ${res.compared} holes compared</div>`;
}

function scorecardTableHtml(r, playerIds, keySuffix) {
  const inputRow = (pid) => {
    const player = getPlayer(pid);
    const d = deriveScore(r, pid);
    return `
      <tr>
        <td><span class="dot" style="background:${getTeam(player.teamId).color}"></span><span class="player-name">${player.name}</span></td>
        ${Array.from({length:9}, (_,i) => `<td><input type="number" min="1" class="sc-hole tc-hole" data-hole-round="${r.id}${keySuffix}" data-hole-player="${pid}" data-hole="${i}" value="${d.holes[i] ?? ""}"></td>`).join("")}
        <td class="num sc-out" id="scOut_${r.id}${keySuffix}_${pid}">${d.front9 ?? 0}</td>
        ${Array.from({length:9}, (_,i) => `<td><input type="number" min="1" class="sc-hole tc-hole" data-hole-round="${r.id}${keySuffix}" data-hole-player="${pid}" data-hole="${i+9}" value="${d.holes[i+9] ?? ""}"></td>`).join("")}
        <td class="num sc-out" id="scIn_${r.id}${keySuffix}_${pid}">${d.back9 ?? 0}</td>
        <td class="num" id="scTotal_${r.id}${keySuffix}_${pid}" style="font-weight:700">${d.gross ?? 0}</td>
        <td class="num" id="scNet_${r.id}${keySuffix}_${pid}">${d.net ?? 0}</td>
        <td><input type="number" step="1" class="tc-stbf" data-stbf-round="${r.id}${keySuffix}" data-stbf-player="${pid}" value="${d.stableford ?? ""}" style="width:56px"></td>
      </tr>
    `;
  };
  return `
    <div class="table-scroll">
    <table class="led scorecard-table">
      <thead><tr>
        <th>Player</th>${Array.from({length:9},(_,i)=>`<th class="num">${i+1}</th>`).join("")}<th class="num">Out</th>
        ${Array.from({length:9},(_,i)=>`<th class="num">${i+10}</th>`).join("")}<th class="num">In</th><th class="num">Tot</th><th class="num">Net</th><th class="num">Stbf</th>
      </tr></thead>
      <tbody>${playerIds.map(inputRow).join("")}</tbody>
    </table>
    </div>
  `;
}

function renderRound(roundId) {
  const r = STATE.rounds.find(x => x.id === roundId);
  const fmtDef = FORMATS[r.format] || { label: r.format, kind: "match" };
  const [tA, tB] = STATE.teams;

  let body = "";
  let scorecardSection = "";

  if (fmtDef.kind === "match") {
    const matches = r.matches || [];
    const outcome = roundMatchOutcome(r);
    body = matches.length === 0 ? `<div class="empty-state">No foursomes assigned yet \u2014 set them up in Admin.</div>` : `
      ${outcomeBannerHtml(outcome)}
      <div class="note" style="margin-bottom:4px">The round's point is decided by majority of the foursomes below, not foursome-by-foursome.</div>
    `;
    scorecardSection = matches.map((m, i) => {
      const ids = [...m.teamAPlayers, ...m.teamBPlayers];
      const isSingles = r.format === "singles";
      const titleText = isSingles
        ? m.teamAPlayers.map((aid, idx) => `${getPlayer(aid)?.name} vs ${getPlayer(m.teamBPlayers[idx])?.name}`).join("  \u00b7  ")
        : `${m.teamAPlayers.map(id => getPlayer(id)?.name).filter(Boolean).join(" & ")} vs ${m.teamBPlayers.map(id => getPlayer(id)?.name).filter(Boolean).join(" & ")}`;
      const subText = isSingles
        ? "Enter all 4 scorecards below \u2014 each pairing is head-to-head, and the foursome goes to whichever pairing wins more duels"
        : "Enter all 4 scorecards below \u2014 the match result calculates automatically from best-ball on each hole";
      return `
        <div class="card">
          <div class="card-title">Foursome ${i+1}: ${titleText}</div>
          <div class="card-sub">${subText}</div>
          ${matchStatusHtml(r, m)}
          ${scorecardTableHtml(r, ids, "_m" + m.id)}
          <button class="brass" style="margin-top:10px" data-action="saveFoursome" data-round="${r.id}" data-match="${m.id}">Save this foursome's scores</button>
        </div>
      `;
    }).join("");
  } else {
    const outcome = roundTeamScoreOutcome(r);
    const results = r.teamResults || [];
    body = `
      ${outcomeBannerHtml(outcome)}
      ${results.length === 0 ? `<div class="empty-state">No team result entered yet.</div>` : `
      <table class="led">
        <thead><tr><th>Team</th><th class="num">Score / Skins</th><th>Notes</th></tr></thead>
        <tbody>
          ${results.map(tr => `
            <tr>
              <td><span class="dot" style="background:${getTeam(tr.teamId).color}"></span>${getTeam(tr.teamId).name}</td>
              <td class="num">${tr.score !== undefined && tr.score !== "" ? tr.score : "\u2013"}</td>
              <td>${tr.note || ""}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>`}
      ${!outcome ? `<div class="note" style="margin-top:8px">Round winner not set yet \u2014 no points awarded until it is.</div>` : ""}
    `;
    scorecardSection = `
      <div class="card">
        <div class="card-title">Enter Your Score</div>
        <div class="card-sub">Pick your name and fill in each hole \u2014 front 9 / back 9 / total add up automatically</div>
        <div class="field-row">
          <div><label>Player</label>
            <select id="scPlayer_${r.id}" data-scorecard-player="${r.id}">
              <option value="">\u2014 select \u2014</option>
              ${STATE.players.map(p => `<option value="${p.id}">${p.name}</option>`).join("")}
            </select>
          </div>
          <div><label>Stableford (optional)</label><input type="number" id="scStableford_${r.id}" style="width:90px"></div>
        </div>
        <div class="scorecard-grid">
          <div class="sc-row sc-head">
            <span class="sc-label">Hole</span>
            ${Array.from({length:9}, (_,i) => `<span>${i+1}</span>`).join("")}
            <span class="sc-out">OUT</span>
          </div>
          <div class="sc-row">
            <span class="sc-label">Strokes</span>
            ${Array.from({length:9}, (_,i) => `<input type="number" min="1" class="sc-hole" data-hole-round="${r.id}" data-hole="${i}">`).join("")}
            <span class="sc-out" id="scOut_${r.id}">0</span>
          </div>
          <div class="sc-row sc-head">
            <span class="sc-label">Hole</span>
            ${Array.from({length:9}, (_,i) => `<span>${i+10}</span>`).join("")}
            <span class="sc-out">IN</span>
          </div>
          <div class="sc-row">
            <span class="sc-label">Strokes</span>
            ${Array.from({length:9}, (_,i) => `<input type="number" min="1" class="sc-hole" data-hole-round="${r.id}" data-hole="${i+9}">`).join("")}
            <span class="sc-out" id="scIn_${r.id}">0</span>
          </div>
        </div>
        <div class="sc-total">Total: <strong id="scTotal_${r.id}">0</strong></div>
        <button class="brass" data-action="saveScorecard" data-round="${r.id}">Save my score</button>
      </div>
    `;
  }

  const nassauGroups = computeNassauForRound(r);
  const contests = r.contests || [];
  const closestToPinWinnerId = (contests.find(c => c.type === "closest_to_pin") || {}).playerId || "";
  const playersWithEntries = STATE.players
    .map(p => ({ player: p, d: deriveScore(r, p.id) }))
    .filter(x => x.d.entered > 0 || x.d.stableford !== null)
    .sort((a,b) => (a.d.net ?? 999) - (b.d.net ?? 999));

  return `
    <div class="card">
      <div class="card-title">${r.name} \u2014 ${fmtDef.label}</div>
      <div class="card-sub">${r.course || "Course TBD"}${r.date ? " \u00b7 " + r.date : ""}</div>
      ${body}
    </div>

    <div class="card">
      <div class="card-title">Closest to the Pin</div>
      <div class="card-sub">Individual bonus points only \u2014 doesn't affect team standings</div>
      <div class="field-row" style="margin-bottom:0">
        <div><label>Winner</label>
          <select id="ctpWinner_${r.id}" data-action-select="saveContestWinner" data-round="${r.id}">
            <option value="">\u2014 none yet \u2014</option>
            ${STATE.players.map(p => `<option value="${p.id}" ${closestToPinWinnerId===p.id?"selected":""}>${p.name}</option>`).join("")}
          </select>
        </div>
      </div>
    </div>

    ${scorecardSection}

    <div class="card">
      <div class="card-title">Scorecards</div>
      <div class="card-sub">This round only \u00b7 net uses each player's handicap</div>
      ${playersWithEntries.length === 0 ? `<div class="empty-state">No scores entered for this round yet.</div>` : `
      <table class="led">
        <thead><tr><th>Player</th><th class="num">Out</th><th class="num">In</th><th class="num">Gross</th><th class="num">Net</th><th class="num">Stableford</th></tr></thead>
        <tbody>
          ${playersWithEntries.map(({player, d}) => `
            <tr>
              <td><span class="dot" style="background:${getTeam(player.teamId).color}"></span><span class="player-name">${player.name}</span></td>
              <td class="num">${d.front9 ?? "\u2013"}</td>
              <td class="num">${d.back9 ?? "\u2013"}</td>
              <td class="num">${d.gross ?? "\u2013"}</td>
              <td class="num">${d.net ?? "\u2013"}</td>
              <td class="num">${d.stableford ?? "\u2013"}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>`}
    </div>
    <div class="card">
      <div class="card-title">Nassau</div>
      <div class="card-sub">1 point each for lowest front 9, back 9, and total gross \u2014 within each foursome only, ties split the point, doesn't affect team standings</div>
      ${nassauGroups.length === 0 ? `<div class="empty-state">Nassau needs a foursome (a match with 4 players) and front 9 / back 9 scores entered.</div>` : nassauGroups.map(g => `
        <table class="led" style="margin-bottom:14px">
          <thead><tr><th>Foursome</th><th class="num">Front 9</th><th class="num">Back 9</th><th class="num">Total</th></tr></thead>
          <tbody>
            ${g.playerIds.map(pid => {
              const d = deriveScore(r, pid);
              const cellClass = (cat) => g.catResults[cat] && g.catResults[cat].winners.includes(pid) ? "style=\"font-weight:600\"" : "";
              return `
                <tr>
                  <td><span class="dot" style="background:${getTeam(getPlayer(pid).teamId).color}"></span><span class="player-name">${getPlayer(pid).name}</span></td>
                  <td class="num" ${cellClass("front9")}>${d.front9 ?? "\u2013"}</td>
                  <td class="num" ${cellClass("back9")}>${d.back9 ?? "\u2013"}</td>
                  <td class="num" ${cellClass("gross")}>${d.gross ?? "\u2013"}</td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      `).join("")}
    </div>
  `;
}

/* ---------------- Render: Players ---------------- */

function renderPlayers() {
  return STATE.teams.map(t => `
    <div class="card">
      <div class="card-title" style="color:${t.color}">${t.name}</div>
      <div class="card-sub">${playersOfTeam(t.id).length} players</div>
      <table class="led">
        <thead><tr><th>Player</th><th class="num">Handicap</th></tr></thead>
        <tbody>
          ${playersOfTeam(t.id).map(p => `
            <tr><td><span class="dot" style="background:${t.color}"></span><span class="player-name">${p.name}</span></td><td class="num">${p.handicap ?? "\u2013"}</td></tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `).join("");
}

/* ---------------- Render: Admin ---------------- */

function renderAdmin() {
  return `
    <div class="card admin-section">
      <div class="card-title">Trip Settings</div>
      <div class="field-row">
        <div><label>Trip name</label><input type="text" id="tripName" value="${STATE.trip.name}"></div>
        <div><label>Subtitle</label><input type="text" id="tripSubtitle" value="${STATE.trip.subtitle || ""}"></div>
        <div><label>Year</label><input type="text" id="tripYear" value="${STATE.trip.year || ""}" style="width:80px"></div>
      </div>
      <button data-action="saveTrip">Save trip settings</button>
    </div>

    <div class="card admin-section">
      <div class="card-title">Scoring Points</div>
      <div class="note" style="margin-bottom:8px">Controls the Team Event points formula used everywhere on the site.</div>
      <div class="field-row">
        <div><label>Points per member on a round win</label><input type="number" step="0.5" id="pointsPerMember" value="${getPointsPerMember()}" style="width:90px"></div>
        <div class="note" style="align-self:center">Halved rounds automatically pay half this (currently ${getHalvePointsPerMember()} per member).</div>
      </div>
      <button data-action="saveSettings">Save scoring points</button>
    </div>

    <div class="card admin-section">
      <div class="card-title">Teams</div>
      ${STATE.teams.map(t => `
        <div class="field-row">
          <div><label>Name</label><input type="text" data-team="${t.id}" data-field="name" value="${t.name}"></div>
          <div><label>Color</label><input type="text" data-team="${t.id}" data-field="color" value="${t.color}" style="width:100px"></div>
        </div>
      `).join("")}
      <button data-action="saveTeams">Save teams</button>
    </div>

    <div class="card admin-section">
      <div class="card-title">Players</div>
      ${STATE.players.map(p => `
        <div class="admin-item">
          <div class="field-row" style="margin-bottom:0">
            <div><label>Name</label><input type="text" data-player="${p.id}" data-field="name" value="${p.name}"></div>
            <div><label>Handicap</label><input type="number" data-player="${p.id}" data-field="handicap" value="${p.handicap ?? ""}" style="width:80px"></div>
            <div><label>Team</label>
              <select data-player="${p.id}" data-field="teamId">
                ${STATE.teams.map(t => `<option value="${t.id}" ${p.teamId===t.id?"selected":""}>${t.name}</option>`).join("")}
              </select>
            </div>
            <button class="danger small" data-action="removePlayer" data-id="${p.id}">Remove</button>
          </div>
        </div>
      `).join("")}
      <div class="io-buttons">
        <button data-action="addPlayer">+ Add player</button>
        <button class="brass" data-action="savePlayers">Save players</button>
      </div>
    </div>

    <div class="card admin-section">
      <div class="card-title">Rounds</div>
      ${STATE.rounds.map(r => renderAdminRound(r)).join('<hr class="rule">')}
    </div>

    <div class="card admin-section">
      <div class="card-title">Data</div>
      <div class="note">
        Changes save to this browser automatically. To share updates with the group, click <strong>Export data.json</strong>,
        then replace <code>data/data.json</code> in the repo and push (or upload the file on github.com and commit).
        Anyone who then loads the page fresh (no local edits) will see the update.
      </div>
      <div class="io-buttons">
        <button class="brass" data-action="exportJson">Export data.json</button>
        <button class="ghost" data-action="importJsonTrigger">Import JSON</button>
        <input type="file" id="importFile" accept="application/json" style="display:none">
        <button class="danger" data-action="resetData">Reset to committed data.json</button>
      </div>
    </div>
  `;
}

function renderAdminRound(r) {
  const fmtDef = FORMATS[r.format] || { label: r.format, kind: "match" };
  const [tA, tB] = STATE.teams;
  const teamAPlayers = playersOfTeam(tA.id);
  const teamBPlayers = playersOfTeam(tB.id);

  const isSingles = r.format === "singles";

  const addFoursomeForm = isSingles ? `
    <div class="admin-item">
      <div class="admin-item-head"><strong>Add foursome (2 head-to-head pairings)</strong></div>
      <div class="note" style="margin-bottom:8px">Pick who plays whom \u2014 these 2 duels happen side by side as one foursome, and Nassau compares all 4 of these players together.</div>
      <div class="field-row">
        <div><label>Pairing 1 \u2014 ${tA.name}</label>
          <select data-singlepick="${r.id}" data-slot="a1">
            <option value="">\u2014 select \u2014</option>
            ${teamAPlayers.map(p => `<option value="${p.id}">${p.name}</option>`).join("")}
          </select>
        </div>
        <div><label>vs ${tB.name}</label>
          <select data-singlepick="${r.id}" data-slot="b1">
            <option value="">\u2014 select \u2014</option>
            ${teamBPlayers.map(p => `<option value="${p.id}">${p.name}</option>`).join("")}
          </select>
        </div>
      </div>
      <div class="field-row">
        <div><label>Pairing 2 \u2014 ${tA.name}</label>
          <select data-singlepick="${r.id}" data-slot="a2">
            <option value="">\u2014 select \u2014</option>
            ${teamAPlayers.map(p => `<option value="${p.id}">${p.name}</option>`).join("")}
          </select>
        </div>
        <div><label>vs ${tB.name}</label>
          <select data-singlepick="${r.id}" data-slot="b2">
            <option value="">\u2014 select \u2014</option>
            ${teamBPlayers.map(p => `<option value="${p.id}">${p.name}</option>`).join("")}
          </select>
        </div>
      </div>
      <button class="small" data-action="addSinglesFoursome" data-round="${r.id}">+ Add foursome</button>
    </div>
  ` : `
    <div class="admin-item">
      <div class="admin-item-head"><strong>Add foursome</strong></div>
      <div class="field-row">
        <div><label>${tA.name} players</label>
          <select multiple data-newmatch="${r.id}" data-side="A" size="4">
            ${teamAPlayers.map(p => `<option value="${p.id}">${p.name}</option>`).join("")}
          </select>
        </div>
        <div><label>${tB.name} players</label>
          <select multiple data-newmatch="${r.id}" data-side="B" size="4">
            ${teamBPlayers.map(p => `<option value="${p.id}">${p.name}</option>`).join("")}
          </select>
        </div>
      </div>
      <button class="small" data-action="addMatch" data-round="${r.id}">+ Add foursome</button>
    </div>
  `;

  const matchKindBlock = fmtDef.kind === "match" ? `
    <div class="note" style="margin-bottom:8px">${isSingles
      ? "Pick 2 head-to-head pairings per foursome below. No need to pick a winner \u2014 once scores are entered on this round's page, each pairing's duel is calculated automatically, and whichever side wins more of the 2 duels wins the foursome."
      : "Assign each foursome (2 players per side). No need to pick a winner \u2014 once scores are entered on this round's page, the result is calculated automatically from best-ball on each hole."}
      The round's point goes to whichever team wins the majority of foursomes (ties halve the round). Nassau still compares all 4 players in the foursome either way.</div>
    ${addFoursomeForm}
    ${(r.matches||[]).map((m,i) => {
      const outcome = computeFoursomeOutcome(r, m);
      let statusText;
      if (!outcome) statusText = "No scores entered yet";
      else if (outcome.pairings) {
        statusText = outcome.pairings.map(p => {
          const aName = getPlayer(p.a)?.name, bName = getPlayer(p.b)?.name;
          if (!p.result) return `${aName} vs ${bName}: no scores yet`;
          if (p.result.winner === "halve") return `${aName} vs ${bName}: all square`;
          return `${p.result.winner === "A" ? aName : bName} leading ${aName} vs ${bName}`;
        }).join(" \u2014 ") + ` (foursome: ${outcome.winner === "halve" ? "all square" : (outcome.winner === "A" ? tA.name : tB.name) + " leading"})`;
      } else {
        const res = outcome.summary;
        statusText = outcome.winner === "halve"
          ? `Tied through ${res.compared} holes compared (${res.wonA}\u2013${res.wonB}, ${res.halved} halved)`
          : `${outcome.winner === "A" ? tA.name : tB.name} leading ${Math.max(res.wonA,res.wonB)}\u2013${Math.min(res.wonA,res.wonB)} through ${res.compared} holes compared`;
      }
      const headerText = isSingles
        ? m.teamAPlayers.map((aid, idx) => `${getPlayer(aid)?.name} vs ${getPlayer(m.teamBPlayers[idx])?.name}`).join("  \u00b7  ")
        : `${m.teamAPlayers.map(id=>getPlayer(id)?.name).join(" & ")} vs ${m.teamBPlayers.map(id=>getPlayer(id)?.name).join(" & ")}`;
      return `
      <div class="admin-item">
        <div class="admin-item-head">
          <strong>${headerText}</strong>
          <button class="danger small" data-action="removeMatch" data-round="${r.id}" data-index="${i}">Remove</button>
        </div>
        <div class="note">${statusText}</div>
      </div>
    `;
    }).join("")}
  ` : `
    <div class="note" style="margin-bottom:8px">Enter each team's score/skins as a record, then set who won the round below \u2014 points are calculated automatically (${getPointsPerMember()} \u00d7 members, or ${getHalvePointsPerMember()} \u00d7 members each if halved).</div>
    <div class="admin-item">
      <div class="admin-item-head"><strong>Team score / notes</strong></div>
      <div class="field-row">
        <div><label>Team</label>
          <select id="trTeam_${r.id}">
            ${STATE.teams.map(t => `<option value="${t.id}">${t.name}</option>`).join("")}
          </select>
        </div>
        <div><label>Score / Skins</label><input type="text" id="trScore_${r.id}" style="width:100px"></div>
        <div><label>Notes</label><input type="text" id="trNote_${r.id}" style="width:160px"></div>
      </div>
      <button class="small" data-action="addTeamResult" data-round="${r.id}">+ Add / update</button>
    </div>
    ${(r.teamResults||[]).map((tr,i) => `
      <div class="admin-item">
        <div class="admin-item-head">
          <strong>${getTeam(tr.teamId).name}: ${tr.score || "\u2013"}${tr.note ? " \u2014 " + tr.note : ""}</strong>
          <button class="danger small" data-action="removeTeamResult" data-round="${r.id}" data-index="${i}">Remove</button>
        </div>
      </div>
    `).join("")}
    <div class="admin-item">
      <div class="admin-item-head"><strong>Round winner</strong></div>
      <div class="field-row">
        <div><label>Winner</label>
          <select id="winner_${r.id}">
            <option value="" ${!r.winner ? "selected":""}>\u2014 not set \u2014</option>
            ${STATE.teams.map(t => `<option value="${t.id}" ${r.winner===t.id?"selected":""}>${t.name}</option>`).join("")}
            <option value="halve" ${r.winner==="halve"?"selected":""}>Halved</option>
          </select>
        </div>
      </div>
      <button class="small" data-action="setRoundWinner" data-round="${r.id}">Save round winner</button>
    </div>
  `;

  return `
    <div class="admin-item" style="background:transparent; border:none; padding:0">
      <div class="admin-item-head"><strong>${r.name}</strong></div>
      <div class="field-row">
        <div><label>Course</label><input type="text" data-round="${r.id}" data-field="course" value="${r.course || ""}"></div>
        <div><label>Date</label><input type="date" data-round="${r.id}" data-field="date" value="${r.date || ""}"></div>
        <div><label>Format</label>
          <select data-round="${r.id}" data-field="format">
            ${Object.entries(FORMATS).map(([k,v]) => `<option value="${k}" ${r.format===k?"selected":""}>${v.label}</option>`).join("")}
          </select>
        </div>
      </div>
      <button class="small" data-action="saveRoundMeta" data-round="${r.id}">Save round details</button>

      ${matchKindBlock}

      <div class="note" style="margin:10px 0">Scores are now entered directly on this round's page (open the round from the top tabs) rather than here in Admin \u2014 each player can enter their own hole-by-hole scorecard. Closest to the Pin is set at the top of that page too.</div>
    </div>
  `;
}

/* ---------------- Admin actions ---------------- */

function bindActionEvents() {
  document.querySelectorAll("[data-action]").forEach(el => {
    el.addEventListener("click", handleAction);
  });
  document.getElementById("importFile")?.addEventListener("change", handleImportFile);
  bindScorecardLiveEvents();
}

function recalcScorecardTotals(roundId) {
  const holeInputs = document.querySelectorAll(`.sc-hole[data-hole-round="${roundId}"]:not([data-hole-player])`);
  const holes = emptyHoles();
  holeInputs.forEach(inp => {
    const idx = Number(inp.dataset.hole);
    holes[idx] = inp.value === "" ? "" : Number(inp.value);
  });
  const out = sumHoles(holes, 0, 9), inn = sumHoles(holes, 9, 18);
  const outEl = document.getElementById(`scOut_${roundId}`);
  const inEl = document.getElementById(`scIn_${roundId}`);
  const totalEl = document.getElementById(`scTotal_${roundId}`);
  if (outEl) outEl.textContent = out;
  if (inEl) inEl.textContent = inn;
  if (totalEl) totalEl.textContent = out + inn;
}

function recalcFoursomeRow(roundKey, playerId) {
  const holeInputs = document.querySelectorAll(`.sc-hole[data-hole-round="${roundKey}"][data-hole-player="${playerId}"]`);
  const holes = emptyHoles();
  holeInputs.forEach(inp => {
    holes[Number(inp.dataset.hole)] = inp.value === "" ? "" : Number(inp.value);
  });
  const out = sumHoles(holes, 0, 9), inn = sumHoles(holes, 9, 18);
  const total = out + inn;
  const player = getPlayer(playerId);
  const net = total - (player?.handicap || 0);
  const outEl = document.getElementById(`scOut_${roundKey}_${playerId}`);
  const inEl = document.getElementById(`scIn_${roundKey}_${playerId}`);
  const totalEl = document.getElementById(`scTotal_${roundKey}_${playerId}`);
  const netEl = document.getElementById(`scNet_${roundKey}_${playerId}`);
  if (outEl) outEl.textContent = out;
  if (inEl) inEl.textContent = inn;
  if (totalEl) totalEl.textContent = total;
  if (netEl) netEl.textContent = net;
}

function bindScorecardLiveEvents() {
  document.querySelectorAll(".sc-hole").forEach(inp => {
    inp.addEventListener("input", () => {
      if (inp.dataset.holePlayer) recalcFoursomeRow(inp.dataset.holeRound, inp.dataset.holePlayer);
      else recalcScorecardTotals(inp.dataset.holeRound);
    });
  });
  document.querySelectorAll("[data-scorecard-player]").forEach(sel => {
    sel.addEventListener("change", () => {
      const roundId = sel.dataset.scorecardPlayer;
      const r = STATE.rounds.find(x => x.id === roundId);
      const entry = findScoreEntry(r, sel.value);
      const holes = (entry && entry.holes) || emptyHoles();
      document.querySelectorAll(`.sc-hole[data-hole-round="${roundId}"]:not([data-hole-player])`).forEach(inp => {
        inp.value = holes[Number(inp.dataset.hole)] ?? "";
      });
      const stblEl = document.getElementById(`scStableford_${roundId}`);
      if (stblEl) stblEl.value = entry && entry.stableford !== undefined ? entry.stableford : "";
      recalcScorecardTotals(roundId);
    });
  });
  document.querySelectorAll('[data-action-select="saveContestWinner"]').forEach(sel => {
    sel.addEventListener("change", () => {
      const rid = sel.dataset.round;
      const r = STATE.rounds.find(x => x.id === rid);
      r.contests = (r.contests || []).filter(c => c.type !== "closest_to_pin");
      if (sel.value) {
        r.contests.push({ id: "c" + Date.now(), type: "closest_to_pin", playerId: sel.value, points: contestDefaultPoints("closest_to_pin") });
      }
      saveState(); render(); toast(sel.value ? "Closest to the pin saved" : "Cleared");
    });
  });
}

function handleAction(e) {
  const action = e.currentTarget.dataset.action;
  const actions = {
    saveTrip() {
      STATE.trip.name = val("tripName");
      STATE.trip.subtitle = val("tripSubtitle");
      STATE.trip.year = val("tripYear");
      saveState(); toast("Trip settings saved"); render();
    },
    saveSettings() {
      STATE.settings = STATE.settings || {};
      STATE.settings.pointsPerMember = Number(val("pointsPerMember") || 5);
      saveState(); toast("Scoring points saved"); render();
    },
    saveTeams() {
      document.querySelectorAll("[data-team]").forEach(inp => {
        const t = getTeam(inp.dataset.team);
        t[inp.dataset.field] = inp.value;
      });
      saveState(); toast("Teams saved"); render();
    },
    addPlayer() {
      const id = "p" + Date.now();
      STATE.players.push({ id, name: "New Player", handicap: 0, teamId: STATE.teams[0].id });
      saveState(); render();
    },
    removePlayer() {
      const id = e.currentTarget.dataset.id;
      STATE.players = STATE.players.filter(p => p.id !== id);
      saveState(); render(); toast("Player removed");
    },
    savePlayers() {
      document.querySelectorAll("[data-player]").forEach(inp => {
        const p = getPlayer(inp.dataset.player);
        const field = inp.dataset.field;
        p[field] = field === "handicap" ? Number(inp.value) : inp.value;
      });
      saveState(); toast("Players saved"); render();
    },
    saveRoundMeta() {
      const rid = e.currentTarget.dataset.round;
      const r = STATE.rounds.find(x => x.id === rid);
      document.querySelectorAll(`[data-round="${rid}"][data-field]`).forEach(inp => {
        const field = inp.dataset.field;
        r[field] = inp.value;
        if (field === "format") r.formatLabel = FORMATS[inp.value]?.label || inp.value;
      });
      saveState(); toast("Round saved"); render();
    },
    addMatch() {
      const rid = e.currentTarget.dataset.round;
      const r = STATE.rounds.find(x => x.id === rid);
      const aSel = document.querySelector(`select[data-newmatch="${rid}"][data-side="A"]`);
      const bSel = document.querySelector(`select[data-newmatch="${rid}"][data-side="B"]`);
      const teamAPlayers = Array.from(aSel.selectedOptions).map(o => o.value);
      const teamBPlayers = Array.from(bSel.selectedOptions).map(o => o.value);
      if (teamAPlayers.length === 0 || teamBPlayers.length === 0) { toast("Pick players for both sides"); return; }
      r.matches = r.matches || [];
      r.matches.push({ id: "m" + Date.now(), teamAPlayers, teamBPlayers });
      saveState(); render(); toast("Foursome added");
    },
    addSinglesFoursome() {
      const rid = e.currentTarget.dataset.round;
      const r = STATE.rounds.find(x => x.id === rid);
      const get = (slot) => document.querySelector(`[data-singlepick="${rid}"][data-slot="${slot}"]`).value;
      const a1 = get("a1"), b1 = get("b1"), a2 = get("a2"), b2 = get("b2");
      if (!a1 || !b1 || !a2 || !b2) { toast("Pick all 4 players for both pairings"); return; }
      if (new Set([a1, a2]).size < 2 || new Set([b1, b2]).size < 2) { toast("Each pairing slot needs a different player"); return; }
      r.matches = r.matches || [];
      // Order matters: teamAPlayers[0] pairs with teamBPlayers[0], [1] with [1].
      r.matches.push({ id: "m" + Date.now(), teamAPlayers: [a1, a2], teamBPlayers: [b1, b2] });
      saveState(); render(); toast("Foursome added");
    },
    removeMatch() {
      const rid = e.currentTarget.dataset.round;
      const idx = Number(e.currentTarget.dataset.index);
      const r = STATE.rounds.find(x => x.id === rid);
      r.matches.splice(idx, 1);
      saveState(); render();
    },
    addTeamResult() {
      const rid = e.currentTarget.dataset.round;
      const r = STATE.rounds.find(x => x.id === rid);
      const teamId = document.getElementById(`trTeam_${rid}`).value;
      const score = document.getElementById(`trScore_${rid}`).value;
      const note = document.getElementById(`trNote_${rid}`).value;
      r.teamResults = r.teamResults || [];
      const existingIdx = r.teamResults.findIndex(t => t.teamId === teamId);
      const entry = { teamId, score, note };
      if (existingIdx >= 0) r.teamResults[existingIdx] = entry; else r.teamResults.push(entry);
      saveState(); render(); toast("Team result saved");
    },
    removeTeamResult() {
      const rid = e.currentTarget.dataset.round;
      const idx = Number(e.currentTarget.dataset.index);
      const r = STATE.rounds.find(x => x.id === rid);
      r.teamResults.splice(idx, 1);
      saveState(); render();
    },
    setRoundWinner() {
      const rid = e.currentTarget.dataset.round;
      const r = STATE.rounds.find(x => x.id === rid);
      const val = document.getElementById(`winner_${rid}`).value;
      r.winner = val === "" ? null : val;
      saveState(); render(); toast("Round winner saved");
    },
    saveScorecard() {
      const rid = e.currentTarget.dataset.round;
      const r = STATE.rounds.find(x => x.id === rid);
      const playerId = document.getElementById(`scPlayer_${rid}`).value;
      if (!playerId) { toast("Pick your name first"); return; }
      const holeInputs = document.querySelectorAll(`.sc-hole[data-hole-round="${rid}"]:not([data-hole-player])`);
      const holes = emptyHoles();
      holeInputs.forEach(inp => {
        const idx = Number(inp.dataset.hole);
        holes[idx] = inp.value === "" ? "" : Number(inp.value);
      });
      if (holesEnteredCount(holes) === 0) { toast("Enter at least one hole"); return; }
      const stableford = document.getElementById(`scStableford_${rid}`).value;
      r.individualScores = r.individualScores || [];
      const idx = r.individualScores.findIndex(s => s.playerId === playerId);
      const entry = { playerId, holes, stableford: stableford === "" ? "" : Number(stableford) };
      if (idx >= 0) r.individualScores[idx] = entry; else r.individualScores.push(entry);
      saveState(); render(); toast("Score saved");
    },
    saveFoursome() {
      const rid = e.currentTarget.dataset.round;
      const matchId = e.currentTarget.dataset.match;
      const r = STATE.rounds.find(x => x.id === rid);
      const m = (r.matches || []).find(x => x.id === matchId);
      if (!m) return;
      const roundKey = rid + "_m" + matchId;
      const ids = [...m.teamAPlayers, ...m.teamBPlayers];
      r.individualScores = r.individualScores || [];
      let savedAny = false;
      ids.forEach(playerId => {
        const holeInputs = document.querySelectorAll(`.sc-hole[data-hole-round="${roundKey}"][data-hole-player="${playerId}"]`);
        const holes = emptyHoles();
        holeInputs.forEach(inp => { holes[Number(inp.dataset.hole)] = inp.value === "" ? "" : Number(inp.value); });
        const stbfInput = document.querySelector(`.tc-stbf[data-stbf-round="${roundKey}"][data-stbf-player="${playerId}"]`);
        const stableford = stbfInput && stbfInput.value !== "" ? Number(stbfInput.value) : "";
        if (holesEnteredCount(holes) === 0 && stableford === "") return;
        savedAny = true;
        const idx = r.individualScores.findIndex(s => s.playerId === playerId);
        const entry = { playerId, holes, stableford };
        if (idx >= 0) r.individualScores[idx] = entry; else r.individualScores.push(entry);
      });
      if (!savedAny) { toast("Enter at least one score first"); return; }
      saveState(); render(); toast("Foursome scores saved");
    },
    exportJson() {
      const blob = new Blob([JSON.stringify(STATE, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "data.json";
      a.click();
      URL.revokeObjectURL(url);
      toast("Downloaded data.json");
    },
    importJsonTrigger() { document.getElementById("importFile").click(); },
    resetData() {
      if (!confirm("Discard local edits and reload the committed data.json?")) return;
      localStorage.removeItem(LS_KEY);
      loadState().then(render);
    }
  };
  actions[action] && actions[action]();
}

function handleImportFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      STATE = JSON.parse(reader.result);
      saveState();
      toast("Imported successfully");
      render();
    } catch (err) {
      toast("Invalid JSON file");
    }
  };
  reader.readAsText(file);
}

function val(id) { return document.getElementById(id).value; }

/* ---------------- Init ---------------- */

const origRender = render;
render = function () {
  origRender();
  bindActionEvents();
};

(async function init() {
  await loadState();
  render();
})();
