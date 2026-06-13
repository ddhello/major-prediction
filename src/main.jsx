import { StrictMode, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const LOGO_BASE_URL = "https://img.majors.im/logos/2606_cs2_cologne";
const makeTeam = (name, short, color, imageName = short.toLowerCase()) => ({ name, short, color, imageName });
const normalizeTeam = team => ({ ...team, imageName: team.imageName || team.short.toLowerCase() });
const defaultStageOneTeams = [
  makeTeam("GamerLegion", "GL", "#ffffff", "gamerlegion"), makeTeam("NRG", "NRG", "#ffffff", "nrg"),
  makeTeam("B8", "B8", "#ffffff", "b8"), makeTeam("TYLOO", "TYL", "#ffffff", "tyloo"),
  makeTeam("HEROIC", "HRC", "#ffffff", "heroic"), makeTeam("Sharks", "SHK", "#ffffff", "sharks"),
  makeTeam("BetBoom", "BB", "#ffffff", "betboom"), makeTeam("Gaimin Gladiators", "GG", "#ffffff", "gaimin-gladiators"),
  makeTeam("BIG", "BIG", "#ffffff", "big"), makeTeam("Liquid", "TL", "#ffffff", "liquid"),
  makeTeam("M80", "M80", "#ffffff", "m80"), makeTeam("Rooster", "ROO", "#ffffff", "rooster"),
  makeTeam("MIBR", "MIBR", "#ffffff", "mibr"), makeTeam("The Huns", "HUNS", "#ffffff", "the-huns"),
  makeTeam("SINNERS", "SIN", "#ffffff", "sinners"), makeTeam("Fluxo", "FLX", "#ffffff", "fluxo"),
];
const STORAGE_KEY = "major-simulator-state-v2";
const predictionGroups = [
  { key: "3:0", label: "3:0 晋级", limit: 2, tone: "qualified" },
  { key: "advance", label: "晋级", limit: 6, tone: "qualified" },
  { key: "0:3", label: "0:3 淘汰", limit: 2, tone: "eliminated" },
];
const emptyPrediction = () => Object.fromEntries(predictionGroups.map(group => [group.key, []]));

function normalizePrediction(prediction = {}) {
  const threeZero = [...new Set(prediction["3:0"] ?? [])].slice(0, 2);
  const advance = [...new Set(prediction.advance ?? [...(prediction["3:1"] ?? []), ...(prediction["3:2"] ?? [])])]
    .filter(name => !threeZero.includes(name)).slice(0, 6);
  return {
    "3:0": threeZero,
    advance,
    "0:3": [...new Set(prediction["0:3"] ?? [])].filter(name => !threeZero.includes(name) && !advance.includes(name)).slice(0, 2),
  };
}

function normalizePredictions(predictions) {
  return Array.from({ length: 3 }, (_, index) => normalizePrediction(predictions?.[index]));
}

function readSavedState() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? {};
  } catch {
    return {};
  }
}
const defaultStageTwoInvites = [
  makeTeam("FUT", "FUT", "#ffffff", "fut"), makeTeam("Spirit", "SPIR", "#ffffff", "spirit"),
  makeTeam("Astralis", "ASTR", "#ffffff", "astralis"), makeTeam("G2", "G2", "#ffffff", "g2"),
  makeTeam("Legacy", "LEGA", "#ffffff", "legacy"), makeTeam("paiN", "PAIN", "#ffffff", "pain"),
  makeTeam("Monte", "MONTE", "#ffffff", "monte"), makeTeam("9z", "9Z", "#ffffff", "9z"),
];
const defaultStageThreeInvites = [
  makeTeam("Vitality", "VIT", "#ffffff", "vitality"), makeTeam("Natus Vincere", "NAVI", "#ffffff", "navi"),
  makeTeam("PARIVISION", "PARI", "#ffffff", "parivision"), makeTeam("Falcons", "FLC", "#ffffff", "falcons"),
  makeTeam("Aurora", "AUR", "#ffffff", "aurora"), makeTeam("MOUZ", "MOUZ", "#ffffff", "mouz"),
  makeTeam("FURIA", "FUR", "#ffffff", "furia"), makeTeam("The MongolZ", "MGLZ", "#ffffff", "the-mongolz"),
];

function toSeedOrderFromFirstRound(teams) {
  return [...teams.filter((_, index) => index % 2 === 0), ...teams.filter((_, index) => index % 2 === 1)];
}
const stageTwoInviteOrder = ["FUT", "Spirit", "Astralis", "G2", "Legacy", "paiN", "Monte", "9z"];

function orderTeams(teams, names) {
  const byName = new Map(teams.map(team => [team.name, team]));
  return names.map(name => byName.get(name)).filter(Boolean).concat(teams.filter(team => !names.includes(team.name)));
}

function migrateStageTwoInvites(teams) {
  const normalized = teams.map(normalizeTeam);
  if (normalized.some(team => team.name === "Team Spirit") && !normalized.some(team => team.name === "Spirit")) {
    return normalized.map(team => team.name === "Team Spirit" ? defaultStageTwoInvites[1] : team);
  }
  if (normalized.some(team => team.name === "PARIVISION") && !normalized.some(team => team.name === "Spirit")) {
    return normalized.map(team => team.name === "PARIVISION" ? defaultStageTwoInvites[1] : team);
  }
  return normalized;
}

const navItems = [
  { id: 0, label: "Stage 1", icon: "◇" },
  { id: 1, label: "Stage 2", icon: "▷" },
  { id: 2, label: "Stage 3", icon: "♜" },
  { id: 3, label: "Champions", icon: "★" },
];

function pairScoreGroup(group, played) {
  function search(available, allowRematches) {
    if (!available.length) return [];
    const first = available[0];
    for (let index = available.length - 1; index >= 1; index--) {
      const rival = available[index];
      const key = [first.team.name, rival.team.name].sort().join("|");
      if (!allowRematches && played.has(key)) continue;
      const remaining = available.slice(1, index).concat(available.slice(index + 1));
      const remainingPairs = search(remaining, allowRematches);
      if (remainingPairs) return [[first, rival], ...remainingPairs];
    }
    return null;
  }
  return search(group, false) ?? search(group, true) ?? [];
}

function buchholz(record, records) {
  return record.opponents.reduce((total, opponentName) => {
    const opponent = records.get(opponentName);
    return total + (opponent ? opponent.wins - opponent.losses : 0);
  }, 0);
}

function pairTeams(active, played, records, roundIndex) {
  const groupedPairs = [];
  const scoreGroups = new Map();
  active.forEach(record => {
    const score = `${record.wins}:${record.losses}`;
    if (!scoreGroups.has(score)) scoreGroups.set(score, []);
    scoreGroups.get(score).push(record);
  });

  scoreGroups.forEach((group, score) => {
    const sortedGroup = [...group].sort((a, b) =>
      (roundIndex >= 2 ? buchholz(b, records) - buchholz(a, records) : 0) || a.seed - b.seed
    );
    const pairs = pairScoreGroup(sortedGroup, played);
    groupedPairs.push({ score, pairs });
  });

  groupedPairs.sort((a, b) => {
    const [aWins, aLosses] = a.score.split(":").map(Number);
    const [bWins, bLosses] = b.score.split(":").map(Number);
    return bWins - aWins || aLosses - bLosses;
  });

  return groupedPairs.flatMap(({ pairs }) => pairs);
}

function deriveSwiss(participants, picks) {
  const records = new Map(participants.map((team, seed) => [team.name, { team, seed, wins: 0, losses: 0, opponents: [] }]));
  const played = new Set();
  const rounds = [];
  for (let roundIndex = 0; roundIndex < 5; roundIndex++) {
    const active = [...records.values()].filter(record => record.wins < 3 && record.losses < 3);
    if (!active.length) break;
    let pairs;
    if (roundIndex === 0) {
      pairs = Array.from({ length: 8 }, (_, index) => [active[index], active[index + 8]]);
    } else {
      pairs = pairTeams(active, played, records, roundIndex);
    }
    const matches = pairs.map(([a, b], matchIndex) => {
      const winnerName = picks[`${roundIndex}-${matchIndex}`];
      const winner = winnerName === b.team.name ? b.team : a.team;
      return { a: a.team, b: b.team, winner, record: `${a.wins}:${a.losses}`, roundIndex, matchIndex };
    });
    rounds.push(matches);
    if (!matches.every(match => match.winner)) break;
    matches.forEach(match => {
      const winner = records.get(match.winner.name);
      const loserTeam = match.winner.name === match.a.name ? match.b : match.a;
      records.get(loserTeam.name).losses += 1;
      winner.wins += 1;
      records.get(match.a.name).opponents.push(match.b.name);
      records.get(match.b.name).opponents.push(match.a.name);
      played.add([match.a.name, match.b.name].sort().join("|"));
    });
  }
  const finalRecords = [...records.values()];
  const byRecord = (wins, losses) => finalRecords.filter(record => record.wins === wins && record.losses === losses).map(record => record.team);
  const seededQualified = finalRecords.filter(record => record.wins === 3).sort((a, b) =>
    a.losses - b.losses || buchholz(b, records) - buchholz(a, records) || a.seed - b.seed
  ).map(record => record.team);
  return {
    rounds,
    qualified: finalRecords.filter(record => record.wins === 3).map(record => record.team),
    seededQualified,
    eliminated: finalRecords.filter(record => record.losses === 3).map(record => record.team),
    outcomeGroups: {
      "3:0": byRecord(3, 0), "3:1": byRecord(3, 1), "3:2": byRecord(3, 2),
      "2:3": byRecord(2, 3), "1:3": byRecord(1, 3), "0:3": byRecord(0, 3),
    },
    records: finalRecords,
    complete: finalRecords.filter(record => record.wins === 3).length === 8,
  };
}

function predictionScore(records, prediction) {
  const finalByName = new Map(records.map(record => [record.team.name, record]));
  return (prediction["3:0"] ?? []).filter(name => finalByName.get(name)?.wins === 3 && finalByName.get(name)?.losses === 0).length
    + (prediction.advance ?? []).filter(name => finalByName.get(name)?.wins === 3).length
    + (prediction["0:3"] ?? []).filter(name => finalByName.get(name)?.wins === 0 && finalByName.get(name)?.losses === 3).length;
}

async function analyzeSwissPossibilities(participants, simulation, finishedMatches, stageIndex, prediction, onProgress, shouldCancel = () => false) {
  const fixedByPair = new Map();
  simulation.rounds.flat().forEach(match => {
    if (finishedMatches.has(`swiss:${stageIndex}:${match.roundIndex}:${match.matchIndex}`)) {
      fixedByPair.set([match.a.name, match.b.name].sort().join("|"), { winner: match.winner.name, roundIndex: match.roundIndex });
    }
  });
  const preferredByPair = new Map(simulation.rounds.flat().map(match => [
    [match.a.name, match.b.name].sort().join("|"),
    match.winner.name,
  ]));
  const recommendationMatches = simulation.rounds.flat();
  const recommendationByPair = new Map(recommendationMatches
    .filter(match => !finishedMatches.has(`swiss:${stageIndex}:${match.roundIndex}:${match.matchIndex}`))
    .map(match => {
      const pairKey = [match.a.name, match.b.name].sort().join("|");
      return [pairKey, {
        roundIndex: match.roundIndex,
        matchIndex: match.matchIndex,
        a: match.a,
        b: match.b,
        requiredPrefix: simulation.rounds.slice(0, match.roundIndex).flat().map(previous => ({
          pairKey: [previous.a.name, previous.b.name].sort().join("|"),
          winner: previous.winner.name,
        })),
        outcomes: {
          [match.a.name]: { total: 0, passing: 0 },
          [match.b.name]: { total: 0, passing: 0 },
        },
      }];
    }));

  const records = new Map(participants.map((team, seed) => [team.name, { team, seed, wins: 0, losses: 0, opponents: [] }]));
  const played = new Set();
  const usedFixed = new Set();
  const recommendationWinners = new Map();
  const pathWinners = new Map();
  const stats = { total: 0, passing: 0, best: 0, worst: 10, explored: 0, truncated: false };
  const maxLeaves = 2_000_000;

  async function playRound(roundIndex) {
    if (shouldCancel()) return;
    const active = [...records.values()].filter(record => record.wins < 3 && record.losses < 3);
    if (!active.length || roundIndex >= 5) {
      if (usedFixed.size !== fixedByPair.size) return;
      const score = predictionScore([...records.values()], prediction);
      const passed = score >= 5;
      stats.total += 1;
      if (passed) stats.passing += 1;
      stats.best = Math.max(stats.best, score);
      stats.worst = Math.min(stats.worst, score);
      recommendationWinners.forEach((winnerName, pairKey) => {
        const recommendation = recommendationByPair.get(pairKey);
        if (!recommendation?.requiredPrefix.every(required => pathWinners.get(required.pairKey) === required.winner)) return;
        const outcome = recommendation.outcomes[winnerName];
        if (!outcome) return;
        outcome.total += 1;
        if (passed) outcome.passing += 1;
      });
      stats.explored += 1;
      if (stats.explored % 20000 === 0) {
        onProgress({ ...stats });
        await new Promise(resolve => setTimeout(resolve, 0));
        if (shouldCancel()) return;
      }
      if (stats.explored >= maxLeaves) stats.truncated = true;
      return;
    }
    const pairs = roundIndex === 0
      ? Array.from({ length: 8 }, (_, index) => [active[index], active[index + 8]])
      : pairTeams(active, played, records, roundIndex);

    async function playMatch(matchIndex) {
      if (stats.truncated || shouldCancel()) return;
      if (matchIndex >= pairs.length) return playRound(roundIndex + 1);
      const [a, b] = pairs[matchIndex];
      const pairKey = [a.team.name, b.team.name].sort().join("|");
      const fixedResult = fixedByPair.get(pairKey);
      if (fixedResult && fixedResult.roundIndex !== roundIndex) return;
      const fixedWinner = fixedResult?.winner;
      const candidates = fixedWinner
        ? [fixedWinner]
        : [a.team.name, b.team.name].sort((left, right) => Number(right === preferredByPair.get(pairKey)) - Number(left === preferredByPair.get(pairKey)));
      for (const winnerName of candidates) {
        const winner = records.get(winnerName);
        const loser = winnerName === a.team.name ? b : a;
        winner.wins += 1;
        loser.losses += 1;
        a.opponents.push(b.team.name);
        b.opponents.push(a.team.name);
        played.add(pairKey);
        pathWinners.set(pairKey, winnerName);
        if (fixedWinner) usedFixed.add(pairKey);
        if (recommendationByPair.has(pairKey)) recommendationWinners.set(pairKey, winnerName);
        await playMatch(matchIndex + 1);
        if (recommendationByPair.has(pairKey)) recommendationWinners.delete(pairKey);
        if (fixedWinner) usedFixed.delete(pairKey);
        pathWinners.delete(pairKey);
        played.delete(pairKey);
        a.opponents.pop();
        b.opponents.pop();
        winner.wins -= 1;
        loser.losses -= 1;
        if (stats.truncated) break;
      }
    }
    await playMatch(0);
  }

  await playRound(0);
  if (!stats.total) stats.worst = 0;
  return {
    ...stats,
    recommendations: [...recommendationByPair.values()].map(({ requiredPrefix, ...recommendation }) => recommendation),
  };
}

function createBracket(teams) {
  const rounds = [
    Array.from({ length: 4 }, (_, i) => ({ a: teams[i], b: teams[7 - i], winner: null })),
    Array.from({ length: 2 }, () => ({ a: null, b: null, winner: null })),
    [{ a: null, b: null, winner: null }],
  ];
  rounds[0].forEach(match => { match.winner = match.a; });
  for (let roundIndex = 1; roundIndex < rounds.length; roundIndex++) {
    rounds[roundIndex].forEach((match, matchIndex) => {
      match.a = rounds[roundIndex - 1][matchIndex * 2].winner;
      match.b = rounds[roundIndex - 1][matchIndex * 2 + 1].winner;
      match.winner = match.a;
    });
  }
  return rounds;
}

function TeamMark({ team, small = false }) {
  if (!team) return <span className={`team-mark empty-mark ${small ? "small" : ""}`}>?</span>;
  const icon = `${LOGO_BASE_URL}/${encodeURIComponent(team.imageName || team.short.toLowerCase())}.png`;
  return (
    <span className={`team-mark ${small ? "small" : ""}`} title={team.name}>
      <img key={icon} src={icon} alt={`${team.name} icon`} onError={event => { event.currentTarget.hidden = true; }} />
    </span>
  );
}

function SwissMatch({ match, onPick, finished, recommended }) {
  const teamButton = team => (
    <button className={`swiss-team ${match.winner?.name === team.name ? "selected" : ""} ${match.winner?.name !== team.name ? "dimmed" : ""} ${recommended === team.name ? "recommended" : ""}`} onClick={event => onPick(match.roundIndex, match.matchIndex, team, event)}>
      <span className="swiss-team-mark">
        <TeamMark team={team} small />
        {recommended === team.name && <span className="recommendation-star" title="这支队伍获胜更有利于你的预测">★</span>}
      </span>
    </button>
  );
  return (
    <article className={`swiss-match ${match.winner ? "decided" : ""} ${finished ? "finished" : ""}`}>
      {teamButton(match.a)}
      <div className="record-label">{match.record}</div>
      {teamButton(match.b)}
    </article>
  );
}

function ResultGroup({ title, teams, tone, record }) {
  if (!teams.length) return null;
  return (
    <div className={`result-group ${tone}`}>
      <header><span>{title}</span><strong>{record}</strong></header>
      <div>{teams.map(team => <TeamMark key={team.name} team={team} small />)}</div>
    </div>
  );
}

function TeamEditor({ teams, defaults, stageNumber, onSave, onClose }) {
  const [draft, setDraft] = useState(() => teams.map(team => ({ ...team })));
  const [error, setError] = useState("");

  function updateTeam(index, field, value) {
    setDraft(current => current.map((team, teamIndex) => teamIndex === index ? { ...team, [field]: value } : team));
  }

  function save() {
    const cleaned = draft.map(team => ({
      name: team.name.trim(),
      short: team.short.trim().toUpperCase().slice(0, 5),
      color: team.color,
      imageName: team.imageName.trim(),
    }));
    if (cleaned.some(team => !team.name || !team.short || !team.imageName)) return setError("队伍名称、缩写和图片名不能为空。");
    if (new Set(cleaned.map(team => team.name.toLowerCase())).size !== cleaned.length) return setError("队伍名称不能重复。");
    onSave(cleaned);
  }

  return (
    <div className="editor-backdrop" onClick={onClose}>
      <section className="team-editor" onClick={event => event.stopPropagation()}>
        <header>
          <div><span>STAGE {stageNumber} ROSTER</span><h2>编辑 Stage {stageNumber} {stageNumber > 1 ? "直邀" : ""}队伍</h2><p>保存阵容后会重置该阶段及后续比赛预测。</p></div>
          <button className="editor-close" onClick={onClose}>×</button>
        </header>
        <div className="editor-grid">
          {draft.map((team, index) => (
            <article className="editor-team" key={index}>
              <TeamMark team={team} />
              <div>
                <label>队伍名称<input value={team.name} maxLength={32} onChange={event => updateTeam(index, "name", event.target.value)} /></label>
                <label>缩写<input value={team.short} maxLength={5} onChange={event => updateTeam(index, "short", event.target.value)} /></label>
              </div>
              <label className="image-name-field">图片名<input value={team.imageName ?? team.short.toLowerCase()} maxLength={64} onChange={event => updateTeam(index, "imageName", event.target.value)} /></label>
            </article>
          ))}
        </div>
        <footer className="editor-actions">
          <span>{error || "队伍配置会自动持久化到当前浏览器。"}</span>
          <button className="secondary-action" onClick={() => setDraft(defaults.map(team => ({ ...team })))}>恢复默认</button>
          <button className="primary-action" onClick={save}>保存阵容</button>
        </footer>
      </section>
    </div>
  );
}

function AdminPanel({ status, onPublish, onClose }) {
  const [token, setToken] = useState(() => sessionStorage.getItem("major-admin-token") ?? "");

  async function publish() {
    sessionStorage.setItem("major-admin-token", token);
    await onPublish(token);
  }

  return (
    <div className="editor-backdrop" onClick={onClose}>
      <section className="admin-panel" onClick={event => event.stopPropagation()}>
        <header><div><span>ADMIN PUBLISH</span><h2>发布比赛状态</h2><p>Ctrl + 左键点击比赛可标记为已结束。访客只会强制同步已结束比赛，其他预测保留本地记录。</p></div><button className="editor-close" onClick={onClose}>×</button></header>
        <label>管理员 Token<input type="password" value={token} onChange={event => setToken(event.target.value)} placeholder="Cloudflare ADMIN_TOKEN" /></label>
        <div className={`admin-status ${status.type}`}>{status.message}</div>
        <button className="primary-action" disabled={!token || status.type === "loading"} onClick={publish}>{status.type === "loading" ? "正在发布..." : "发布为网站默认状态"}</button>
      </section>
    </div>
  );
}

function DataPanel({ status, onExport, onImport, onClose }) {
  return (
    <div className="editor-backdrop" onClick={onClose}>
      <section className="admin-panel data-panel" onClick={event => event.stopPropagation()}>
        <header><div><span>LOCAL DATA</span><h2>导入 / 导出 JSON</h2><p>导出当前队伍和比赛结果，或从本地 JSON 恢复完整状态。</p></div><button className="editor-close" onClick={onClose}>×</button></header>
        <div className={`admin-status ${status.type}`}>{status.message}</div>
        <div className="data-actions">
          <button className="secondary-action" onClick={onExport}>导出当前状态</button>
          <label className="primary-action">导入 JSON<input type="file" accept="application/json,.json" onChange={event => onImport(event.target.files?.[0])} /></label>
        </div>
      </section>
    </div>
  );
}

function PredictionPanel({ stageNumber, teams, value, onSave, onAnalyze, analysis, onClose }) {
  const teamNames = new Set(teams.map(team => team.name));
  const normalizedValue = normalizePrediction(value);
  const [draft, setDraft] = useState(() => Object.fromEntries(predictionGroups.map(group => [
    group.key,
    (normalizedValue[group.key] ?? []).filter(name => teamNames.has(name)).slice(0, group.limit),
  ])));
  const assigned = new Set(Object.values(draft).flat());

  function moveTeam(teamName, groupKey = null) {
    setDraft(current => {
      const next = Object.fromEntries(predictionGroups.map(group => [group.key, (current[group.key] ?? []).filter(name => name !== teamName)]));
      if (groupKey) {
        const group = predictionGroups.find(item => item.key === groupKey);
        if (next[groupKey].length < group.limit) next[groupKey].push(teamName);
      }
      return next;
    });
  }

  function drop(event, groupKey) {
    event.preventDefault();
    moveTeam(event.dataTransfer.getData("text/team"), groupKey);
  }

  const complete = predictionGroups.every(group => (draft[group.key] ?? []).length === group.limit);
  return (
    <div className="editor-backdrop" onClick={onClose}>
      <section className="prediction-panel" onClick={event => event.stopPropagation()}>
        <header>
          <div><span>STAGE {stageNumber} PICK'EM</span><h2>选择十支队伍</h2><p>拖动队标到比分区域。中间六支只需晋级，不区分 3:1 或 3:2；命中至少 5 支即通过。</p></div>
          <button className="editor-close" onClick={onClose}>×</button>
        </header>
        <div className="prediction-workspace">
          <section className="prediction-pool" onDragOver={event => event.preventDefault()} onDrop={event => drop(event, null)}>
            <header><span>本阶段队伍</span><small>{16 - assigned.size} 支未选择</small></header>
            <div>{teams.filter(team => !assigned.has(team.name)).map(team => <button draggable onDragStart={event => event.dataTransfer.setData("text/team", team.name)} onClick={() => moveTeam(team.name, predictionGroups.find(group => (draft[group.key] ?? []).length < group.limit)?.key)} key={team.name} title={team.name}><TeamMark team={team} /></button>)}</div>
          </section>
          <div className="prediction-groups">
            {predictionGroups.map(group => (
              <section className={`prediction-drop ${group.tone} ${group.key}`} key={group.key} onDragOver={event => event.preventDefault()} onDrop={event => drop(event, group.key)}>
                <header><strong>{group.label}</strong><span>{(draft[group.key] ?? []).length} / {group.limit}</span></header>
                <div>{(draft[group.key] ?? []).map(name => {
                  const team = teams.find(item => item.name === name);
                  return <button draggable onDragStart={event => event.dataTransfer.setData("text/team", name)} onDoubleClick={() => moveTeam(name)} key={name} title={`${name}，双击移除`}><TeamMark team={team} /></button>;
                })}</div>
              </section>
            ))}
          </div>
        </div>
        <section className="prediction-analysis">
          <div><span>可通过的赛果组合</span><strong>{analysis ? `${analysis.truncated ? "至少 " : ""}${analysis.passing.toLocaleString()} / ${analysis.total.toLocaleString()}` : "尚未分析"}</strong></div>
          <div><span>最好情况</span><strong>{analysis ? `${analysis.best} / 10` : "－"}</strong></div>
          <div><span>最坏情况</span><strong>{analysis ? `${analysis.worst} / 10` : "－"}</strong></div>
          {analysis?.running && <p>正在遍历，已检查 {analysis.total.toLocaleString()} 种赛果...</p>}
          {analysis?.truncated && <p>未结束比赛过多，已达到 2,000,000 种安全上限；当前数字为已验证下界。</p>}
        </section>
        <footer className="editor-actions">
          <span>{complete ? "选择完整，可以保存并分析。" : "请填满 3:0、晋级和 0:3 的所有位置。"}</span>
          <button className="secondary-action" onClick={() => setDraft(emptyPrediction())}>清空</button>
          <button className="secondary-action" disabled={!complete || analysis?.running} onClick={() => onAnalyze(draft)}>遍历可能性</button>
          <button className="primary-action" disabled={!complete} onClick={() => onSave(draft)}>保存选择</button>
        </footer>
      </section>
    </div>
  );
}

function SwissStage({ number, simulation, onPick, locked, onNavigate, onEditTeams, onOpenPrediction, finishedMatches, recommendations }) {
  const recommendedByMatch = new Map((recommendations ?? []).map(match => {
    const aOutcome = match.outcomes[match.a.name];
    const bOutcome = match.outcomes[match.b.name];
    const aRate = aOutcome?.total ? aOutcome.passing / aOutcome.total : 0;
    const bRate = bOutcome?.total ? bOutcome.passing / bOutcome.total : 0;
    return [`${match.roundIndex}-${match.matchIndex}`, aRate === bRate ? null : aRate > bRate ? match.a.name : match.b.name];
  }));
  if (locked) {
    return (
      <section className="locked-panel">
        <span>STAGE {number} LOCKED</span><h2>先完成上一阶段</h2>
        <p>上一阶段产生 8 支晋级队伍后，这里会自动生成新的瑞士轮对阵。</p>
        <button onClick={() => onNavigate(number - 2)}>返回上一阶段</button>
      </section>
    );
  }
  return (
    <>
      <section className="stage-intro">
        <div><span>SWISS SYSTEM · STAGE {number}</span><h1>三胜晋级，<em>三负淘汰</em></h1><p>点击每场比赛的获胜队伍。系统会按战绩自动生成下一轮同战绩对阵。</p></div>
        <div className="stage-side">
          <div className="stage-numbers"><div><b>{simulation.qualified.length}</b><span>已晋级</span></div><div><b>{simulation.eliminated.length}</b><span>已淘汰</span></div><div><b>{16 - simulation.qualified.length - simulation.eliminated.length}</b><span>竞争中</span></div></div>
          <button className="edit-teams-btn prediction-open-btn" onClick={onOpenPrediction}>我的十支预测</button>
          <button className="edit-teams-btn" onClick={onEditTeams}>编辑 Stage {number} {number > 1 ? "直邀" : ""}队伍</button>
        </div>
      </section>
      <section className="swiss-scroll">
        <div className="swiss-board">
          {simulation.rounds.map((round, roundIndex) => (
            <section className="swiss-round" key={roundIndex}>
              <header><span>ROUND {roundIndex + 1}</span><small>{round.length} 场比赛</small></header>
              <div className="swiss-round-content">
                {roundIndex === 3 && <ResultGroup title="晋级" teams={simulation.outcomeGroups["3:0"]} tone="qualified" record="3:0" />}
                {roundIndex === 4 && <ResultGroup title="晋级" teams={simulation.outcomeGroups["3:1"]} tone="qualified" record="3:1" />}
                <div className="round-matches">{round.map(match => <SwissMatch key={match.matchIndex} match={match} onPick={onPick} finished={finishedMatches.has(`swiss:${number - 1}:${match.roundIndex}:${match.matchIndex}`)} recommended={recommendedByMatch.get(`${match.roundIndex}-${match.matchIndex}`)} />)}</div>
                {roundIndex === 3 && <ResultGroup title="淘汰" teams={simulation.outcomeGroups["0:3"]} tone="eliminated" record="0:3" />}
                {roundIndex === 4 && <ResultGroup title="淘汰" teams={simulation.outcomeGroups["1:3"]} tone="eliminated" record="1:3" />}
              </div>
            </section>
          ))}
          <section className="results-column">
            <header><span>最终结果</span><small>晋级 / 淘汰</small></header>
            <div className="final-result-content">
              <ResultGroup title="晋级" teams={simulation.outcomeGroups["3:2"]} tone="qualified" record="3:2" />
              <ResultGroup title="淘汰" teams={simulation.outcomeGroups["2:3"]} tone="eliminated" record="2:3" />
            </div>
            {!simulation.complete && <div className="result-placeholder">完成当前轮次<br />生成后续对阵</div>}
          </section>
        </div>
      </section>
    </>
  );
}

function PlayoffMatch({ match, roundIndex, matchIndex, onPick, finished }) {
  return (
    <article className={`match-card ${finished ? "finished" : ""}`}>
      <div className="match-topline"><span>MATCH {matchIndex + 1}</span><span>BO3</span></div>
      {[match.a, match.b].map((team, index) => {
        const selected = match.winner?.name === team?.name;
        return <button disabled={!match.a || !match.b} key={team?.name ?? index} className={`team-row ${selected ? "selected" : ""} ${match.winner && !selected ? "dimmed" : ""}`} onClick={event => onPick(roundIndex, matchIndex, team, event)}><TeamMark team={team} small /><span className="team-name">{team?.name ?? "等待胜者"}</span><span className="pick-indicator">{selected ? "✓" : "选择"}</span></button>;
      })}
    </article>
  );
}

function Champions({ rounds, onPick, locked, onNavigate, finishedMatches }) {
  if (locked) return <section className="locked-panel"><span>CHAMPIONS STAGE LOCKED</span><h2>先完成 Stage 3</h2><p>Stage 3 的 8 支晋级队伍将进入淘汰赛。</p><button onClick={() => onNavigate(2)}>返回 Stage 3</button></section>;
  if (!rounds?.[0]?.length) return <section className="locked-panel"><span>GENERATING PLAYOFFS</span><h2>正在生成淘汰赛</h2><p>淘汰赛对阵将在 Stage 3 完成后自动生成。</p><button onClick={() => onNavigate(2)}>返回 Stage 3</button></section>;
  const champion = rounds?.[2]?.[0]?.winner;
  return (
    <>
      <section className="stage-intro"><div><span>COLOGNE 2026 · PLAYOFFS</span><h1>冠军之路，<em>最后七场</em></h1><p>保留原有淘汰赛，Stage 3 的晋级队伍已经自动进入八强。</p></div></section>
      <section className="bracket-scroll"><div className="bracket playoff-bracket">
        {rounds.map((round, roundIndex) => <section className={`stage stage-${roundIndex}`} key={roundIndex}><header className="stage-header"><span>{["QUARTERFINALS", "SEMIFINALS", "GRAND FINAL"][roundIndex]}</span><h2>{["四分之一决赛", "半决赛", "总决赛"][roundIndex]}</h2></header><div className="match-list">{round.map((match, matchIndex) => <PlayoffMatch key={matchIndex} match={match} roundIndex={roundIndex} matchIndex={matchIndex} onPick={onPick} finished={finishedMatches.has(`playoff:${roundIndex}:${matchIndex}`)} />)}</div></section>)}
      </div></section>
      <section className={`champion-panel ${champion ? "revealed" : ""}`}><div className="trophy">✦</div><div className="champion-copy"><span>YOUR COLOGNE 2026 CHAMPION</span><h2>{champion?.name ?? "冠军等待你的预测"}</h2><p>{champion ? `你预测 ${champion.name} 将在科隆捧杯。` : "完成淘汰赛，冠军将在这里揭晓。"}</p></div><TeamMark team={champion} /></section>
    </>
  );
}

function App() {
  const savedState = useMemo(readSavedState, []);
  const [activePage, setActivePage] = useState(() => Number.isInteger(savedState.activePage) ? Math.min(3, Math.max(0, savedState.activePage)) : 0);
  const [stageOneTeams, setStageOneTeams] = useState(() => (savedState.stageOneTeams?.length === 16 ? savedState.stageOneTeams : defaultStageOneTeams).map(normalizeTeam));
  const [stageTwoInvites, setStageTwoInvites] = useState(() => migrateStageTwoInvites(savedState.stageTwoInvites?.length === 8 ? savedState.stageTwoInvites : defaultStageTwoInvites));
  const [stageThreeInvites, setStageThreeInvites] = useState(() => (savedState.stageThreeInvites?.length === 8 ? savedState.stageThreeInvites : defaultStageThreeInvites).map(normalizeTeam));
  const [stagePicks, setStagePicks] = useState(() => savedState.stagePicks?.length === 3 ? savedState.stagePicks : [{}, {}, {}]);
  const [playoffRounds, setPlayoffRounds] = useState(() => savedState.playoffRounds ?? []);
  const [finishedMatches, setFinishedMatches] = useState(() => new Set(savedState.finishedMatches ?? []));
  const [outcomePredictions, setOutcomePredictions] = useState(() => normalizePredictions(savedState.outcomePredictions));
  const [predictionStage, setPredictionStage] = useState(null);
  const [predictionAnalysis, setPredictionAnalysis] = useState([null, null, null]);
  const analysisRuns = useRef([0, 0, 0]);
  const [editorStage, setEditorStage] = useState(null);
  const [adminOpen, setAdminOpen] = useState(false);
  const [adminStatus, setAdminStatus] = useState({ type: "idle", message: "当前全部赛事状态将作为网站默认状态发布。" });
  const [dataOpen, setDataOpen] = useState(false);
  const [dataStatus, setDataStatus] = useState({ type: "idle", message: "JSON 文件仅保存在本地，不会自动上传。" });
  const [remoteLoaded, setRemoteLoaded] = useState(false);
  const stage1 = useMemo(() => deriveSwiss(toSeedOrderFromFirstRound(stageOneTeams), stagePicks[0]), [stageOneTeams, stagePicks]);
  const stage2Participants = useMemo(() => stage1.complete ? [...orderTeams(stageTwoInvites, stageTwoInviteOrder), ...stage1.seededQualified] : [], [stage1, stageTwoInvites]);
  const stage2 = useMemo(() => deriveSwiss(stage2Participants, stagePicks[1]), [stage2Participants, stagePicks]);
  const stage3Participants = useMemo(() => stage2.complete ? [...stageThreeInvites, ...stage2.seededQualified] : [], [stage2, stageThreeInvites]);
  const stage3 = useMemo(() => deriveSwiss(stage3Participants, stagePicks[2]), [stage3Participants, stagePicks]);
  const stageParticipants = [toSeedOrderFromFirstRound(stageOneTeams), stage2Participants, stage3Participants];
  useEffect(() => {
    if (activePage === 3 && stage3.complete && !playoffRounds.length) setPlayoffRounds(createBracket(stage3.qualified));
  }, [activePage, stage3, playoffRounds.length]);
  useEffect(() => {
    const simulations = [stage1, stage2, stage3];
    setStagePicks(current => {
      const cleaned = current.map((picks, stageIndex) => {
        const validMatches = new Map(simulations[stageIndex].rounds.flatMap(round => round.map(match => [`${match.roundIndex}-${match.matchIndex}`, [match.a.name, match.b.name]])));
        return Object.fromEntries(Object.entries(picks).filter(([key, winner]) => validMatches.get(key)?.includes(winner)));
      });
      return JSON.stringify(cleaned) === JSON.stringify(current) ? current : cleaned;
    });
    setFinishedMatches(current => {
      const valid = new Set([...current].filter(id => {
        if (!id.startsWith("swiss:")) return true;
        const [, stage, round, match] = id.split(":");
        const matchData = simulations[Number(stage)]?.rounds?.[Number(round)]?.[Number(match)];
        return matchData && stagePicks[Number(stage)]?.[`${round}-${match}`] && [matchData.a.name, matchData.b.name].includes(stagePicks[Number(stage)][`${round}-${match}`]);
      }));
      return valid.size === current.size ? current : valid;
    });
  }, [stage1, stage2, stage3]);
  useEffect(() => {
    fetch("/api/state", { cache: "no-store" })
      .then(response => response.ok ? response.json() : Promise.reject())
      .then(({ state }) => {
        if (!state) return;
        if (state.stageOneTeams?.length === 16) setStageOneTeams(state.stageOneTeams.map(normalizeTeam));
        if (state.stageTwoInvites?.length === 8) setStageTwoInvites(state.stageTwoInvites.map(normalizeTeam));
        if (state.stageThreeInvites?.length === 8) setStageThreeInvites(state.stageThreeInvites.map(normalizeTeam));
        const publishedFinished = new Set(state.finishedMatches ?? []);
        if (state.stagePicks?.length === 3) {
          setStagePicks(local => local.map((picks, stageIndex) => {
            const merged = { ...picks };
            publishedFinished.forEach(id => {
              const [type, stage, round, match] = id.split(":");
              if (type === "swiss" && Number(stage) === stageIndex) {
                const key = `${round}-${match}`;
                if (state.stagePicks[stageIndex]?.[key]) merged[key] = state.stagePicks[stageIndex][key];
              }
            });
            return merged;
          }));
        }
        if (Array.isArray(state.playoffRounds)) {
          setPlayoffRounds(local => state.playoffRounds.map((round, roundIndex) => round.map((remoteMatch, matchIndex) => {
            const id = `playoff:${roundIndex}:${matchIndex}`;
            const localMatch = local?.[roundIndex]?.[matchIndex];
            if (publishedFinished.has(id) || !localMatch) return { ...remoteMatch };
            const sameTeams = localMatch.a?.name === remoteMatch.a?.name && localMatch.b?.name === remoteMatch.b?.name;
            return sameTeams ? { ...remoteMatch, winner: localMatch.winner } : { ...remoteMatch, winner: null };
          })));
        }
        setFinishedMatches(publishedFinished);
      })
      .catch(() => {})
      .finally(() => setRemoteLoaded(true));
  }, []);
  useEffect(() => {
    if (!remoteLoaded) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ activePage, stageOneTeams, stageTwoInvites, stageThreeInvites, stagePicks, playoffRounds, finishedMatches: [...finishedMatches], outcomePredictions }));
    } catch {
      // Large uploaded icons can exceed the browser storage quota.
    }
  }, [activePage, stageOneTeams, stageTwoInvites, stageThreeInvites, stagePicks, playoffRounds, finishedMatches, outcomePredictions, remoteLoaded]);

  function navigate(page) {
    if (page === 3 && stage3.complete && !playoffRounds.length) setPlayoffRounds(createBracket(stage3.qualified));
    setActivePage(page);
  }
  function toggleFinished(id) {
    analysisRuns.current = analysisRuns.current.map(run => run + 1);
    setPredictionAnalysis([null, null, null]);
    setFinishedMatches(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function pickSwiss(stageIndex, roundIndex, matchIndex, team, event) {
    const id = `swiss:${stageIndex}:${roundIndex}:${matchIndex}`;
    if (finishedMatches.has(id) && !event.ctrlKey) return;
    if (event.ctrlKey) toggleFinished(id);
    analysisRuns.current[stageIndex] += 1;
    setPredictionAnalysis(current => current.map((value, index) => index === stageIndex ? null : value));
    setStagePicks(current => current.map((picks, index) => {
      if (index < stageIndex) return picks;
      if (index > stageIndex) return {};
      const next = {};
      Object.entries(picks).forEach(([key, value]) => { if (Number(key.split("-")[0]) < roundIndex) next[key] = value; });
      next[`${roundIndex}-${matchIndex}`] = team.name;
      Object.entries(picks).forEach(([key, value]) => { if (Number(key.split("-")[0]) === roundIndex && key !== `${roundIndex}-${matchIndex}`) next[key] = value; });
      return next;
    }));
    setPlayoffRounds([]);
  }
  function pickPlayoff(roundIndex, matchIndex, team, event) {
    const id = `playoff:${roundIndex}:${matchIndex}`;
    if (finishedMatches.has(id) && !event.ctrlKey) return;
    if (event.ctrlKey) toggleFinished(id);
    setPlayoffRounds(current => {
      const next = current.map(round => round.map(match => ({ ...match })));
      next[roundIndex][matchIndex].winner = team;
      for (let r = roundIndex + 1; r < next.length; r++) next[r].forEach((match, i) => {
        const a = next[r - 1][i * 2]?.winner ?? null; const b = next[r - 1][i * 2 + 1]?.winner ?? null;
        if (match.a?.name !== a?.name || match.b?.name !== b?.name) match.winner = a;
        match.a = a; match.b = b;
      });
      return next;
    });
  }
  function reset() { setStagePicks([{}, {}, {}]); setPlayoffRounds([]); setFinishedMatches(new Set()); setOutcomePredictions([emptyPrediction(), emptyPrediction(), emptyPrediction()]); setPredictionAnalysis([null, null, null]); setActivePage(0); }
  function saveStageOneTeams(teams) {
    setStageOneTeams(teams);
    setStagePicks([{}, {}, {}]);
    setPlayoffRounds([]);
    setFinishedMatches(new Set());
    setOutcomePredictions([emptyPrediction(), emptyPrediction(), emptyPrediction()]);
    setPredictionAnalysis([null, null, null]);
    setActivePage(0);
    setEditorStage(null);
  }
  function saveStageTwoInvites(teams) {
    setStageTwoInvites(teams);
    setStagePicks(current => [current[0], {}, {}]);
    setPlayoffRounds([]);
    setFinishedMatches(current => new Set([...current].filter(id => id.startsWith("swiss:0:"))));
    setOutcomePredictions(current => [current[0], emptyPrediction(), emptyPrediction()]);
    setPredictionAnalysis([null, null, null]);
    setActivePage(1);
    setEditorStage(null);
  }
  function saveStageThreeInvites(teams) {
    setStageThreeInvites(teams);
    setStagePicks(current => [current[0], current[1], {}]);
    setPlayoffRounds([]);
    setFinishedMatches(current => new Set([...current].filter(id => id.startsWith("swiss:0:") || id.startsWith("swiss:1:"))));
    setOutcomePredictions(current => [current[0], current[1], emptyPrediction()]);
    setPredictionAnalysis([null, null, null]);
    setActivePage(2);
    setEditorStage(null);
  }
  async function publishDefaultState(token) {
    setAdminStatus({ type: "loading", message: "正在发布当前状态..." });
    try {
      const response = await fetch("/api/state", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ activePage, stageOneTeams, stageTwoInvites, stageThreeInvites, stagePicks, playoffRounds, finishedMatches: [...finishedMatches] }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "发布失败。");
      setAdminStatus({ type: "success", message: `发布成功：${new Date(result.publishedAt).toLocaleString()}` });
    } catch (error) {
      setAdminStatus({ type: "error", message: error.message || "发布失败，请检查 Cloudflare 配置。" });
    }
  }
  function currentState() {
    return { version: 3, exportedAt: new Date().toISOString(), activePage, stageOneTeams, stageTwoInvites, stageThreeInvites, stagePicks, playoffRounds, finishedMatches: [...finishedMatches], outcomePredictions };
  }
  function exportState() {
    const blob = new Blob([JSON.stringify(currentState(), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `major-simulator-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setDataStatus({ type: "success", message: "当前队伍和比赛结果已导出。" });
  }
  async function importState(file) {
    if (!file) return;
    try {
      const state = JSON.parse(await file.text());
      if (state.stageOneTeams?.length !== 16 || state.stageTwoInvites?.length !== 8 || state.stageThreeInvites?.length !== 8 || state.stagePicks?.length !== 3 || !Array.isArray(state.playoffRounds)) {
        throw new Error("JSON 文件不是有效的模拟器状态。");
      }
      setStageOneTeams(state.stageOneTeams.map(normalizeTeam));
      setStageTwoInvites(state.stageTwoInvites.map(normalizeTeam));
      setStageThreeInvites(state.stageThreeInvites.map(normalizeTeam));
      setStagePicks(state.stagePicks);
      setPlayoffRounds(state.playoffRounds);
      setFinishedMatches(new Set(state.finishedMatches ?? []));
      if (state.outcomePredictions?.length === 3) setOutcomePredictions(normalizePredictions(state.outcomePredictions));
      setActivePage(Number.isInteger(state.activePage) ? Math.min(3, Math.max(0, state.activePage)) : 0);
      setDataStatus({ type: "success", message: `导入成功：${file.name}` });
    } catch (error) {
      setDataStatus({ type: "error", message: error.message || "无法读取 JSON 文件。" });
    }
  }

  function saveOutcomePrediction(stageIndex, prediction) {
    setOutcomePredictions(current => current.map((value, index) => index === stageIndex ? normalizePrediction(prediction) : value));
    setPredictionAnalysis(current => current.map((value, index) => index === stageIndex ? null : value));
  }

  async function analyzeOutcomePrediction(stageIndex, prediction, save = true) {
    const participants = stageParticipants[stageIndex];
    if (participants.length !== 16) return;
    const normalized = normalizePrediction(prediction);
    if (save) setOutcomePredictions(current => current.map((value, index) => index === stageIndex ? normalized : value));
    const runId = analysisRuns.current[stageIndex] + 1;
    analysisRuns.current[stageIndex] = runId;
    setPredictionAnalysis(current => current.map((value, index) => index === stageIndex ? { total: 0, passing: 0, best: 0, worst: 10, running: true, truncated: false } : value));
    const result = await analyzeSwissPossibilities(participants, [stage1, stage2, stage3][stageIndex], finishedMatches, stageIndex, normalized, progress => {
      if (analysisRuns.current[stageIndex] !== runId) return;
      setPredictionAnalysis(current => current.map((value, index) => index === stageIndex ? { ...progress, running: true } : value));
    }, () => analysisRuns.current[stageIndex] !== runId);
    if (analysisRuns.current[stageIndex] !== runId) return;
    setPredictionAnalysis(current => current.map((value, index) => index === stageIndex ? { ...result, running: false } : value));
  }

  useEffect(() => {
    if (!remoteLoaded || activePage > 2) return;
    const prediction = normalizePrediction(outcomePredictions[activePage]);
    const complete = predictionGroups.every(group => prediction[group.key].length === group.limit);
    if (!complete || stageParticipants[activePage].length !== 16) return;
    const timer = setTimeout(() => analyzeOutcomePrediction(activePage, prediction, false), 350);
    return () => {
      clearTimeout(timer);
      analysisRuns.current[activePage] += 1;
    };
  }, [activePage, stagePicks, finishedMatches, remoteLoaded]);

  const simulations = [stage1, stage2, stage3];
  return (
    <div className="app-shell">
      <header className="site-header"><a className="brand" href="#" onClick={event => { event.preventDefault(); navigate(0); }}><span className="brand-icon">M</span><span><strong>MAJOR</strong><small>SIMULATOR</small></span></a><div className="event-pill"><span className="live-dot" /> COLOGNE 2026</div><div className="header-actions"><button className="admin-btn" onClick={() => setDataOpen(true)}>导入 / 导出</button><button className="admin-btn" onClick={() => setAdminOpen(true)}>管理员发布</button><button className="reset-btn" onClick={reset}>重新开始 ↺</button></div></header>
      <main>
        <nav className="stage-nav">{navItems.map(item => <button key={item.id} className={activePage === item.id ? "active" : ""} onClick={() => navigate(item.id)}><span>{item.icon}</span>{item.label}{item.id > 0 && !simulations[item.id - 1]?.complete && <i>LOCKED</i>}</button>)}</nav>
        {activePage < 3 ? <SwissStage number={activePage + 1} simulation={simulations[activePage]} locked={activePage > 0 && !simulations[activePage - 1].complete} onPick={(r, m, team, event) => pickSwiss(activePage, r, m, team, event)} onNavigate={navigate} onEditTeams={() => setEditorStage(activePage + 1)} onOpenPrediction={() => setPredictionStage(activePage)} finishedMatches={finishedMatches} recommendations={predictionAnalysis[activePage]?.recommendations} /> : <Champions rounds={playoffRounds} onPick={pickPlayoff} locked={!stage3.complete} onNavigate={navigate} finishedMatches={finishedMatches} />}
      </main>
      <footer><span>MAJOR SIMULATOR / 2026</span><span>三胜晋级 · 三负淘汰 · 最终进入淘汰赛</span></footer>
      {editorStage === 1 && <TeamEditor teams={stageOneTeams} defaults={defaultStageOneTeams} stageNumber={1} onSave={saveStageOneTeams} onClose={() => setEditorStage(null)} />}
      {editorStage === 2 && <TeamEditor teams={stageTwoInvites} defaults={defaultStageTwoInvites} stageNumber={2} onSave={saveStageTwoInvites} onClose={() => setEditorStage(null)} />}
      {editorStage === 3 && <TeamEditor teams={stageThreeInvites} defaults={defaultStageThreeInvites} stageNumber={3} onSave={saveStageThreeInvites} onClose={() => setEditorStage(null)} />}
      {adminOpen && <AdminPanel status={adminStatus} onPublish={publishDefaultState} onClose={() => setAdminOpen(false)} />}
      {dataOpen && <DataPanel status={dataStatus} onExport={exportState} onImport={importState} onClose={() => setDataOpen(false)} />}
      {predictionStage !== null && stageParticipants[predictionStage].length === 16 && <PredictionPanel stageNumber={predictionStage + 1} teams={stageParticipants[predictionStage]} value={outcomePredictions[predictionStage]} analysis={predictionAnalysis[predictionStage]} onSave={prediction => saveOutcomePrediction(predictionStage, prediction)} onAnalyze={prediction => analyzeOutcomePrediction(predictionStage, prediction)} onClose={() => setPredictionStage(null)} />}
    </div>
  );
}

createRoot(document.getElementById("root")).render(<StrictMode><App /></StrictMode>);
