import { StrictMode, useEffect, useMemo, useState } from "react";
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

function SwissMatch({ match, onPick }) {
  return (
    <article className={`swiss-match ${match.winner ? "decided" : ""}`}>
      <button className={`swiss-team ${match.winner?.name === match.a.name ? "selected" : ""} ${match.winner?.name === match.b.name ? "dimmed" : ""}`} onClick={() => onPick(match.roundIndex, match.matchIndex, match.a)}><TeamMark team={match.a} small /></button>
      <div className="record-label">{match.record}</div>
      <button className={`swiss-team ${match.winner?.name === match.b.name ? "selected" : ""} ${match.winner?.name === match.a.name ? "dimmed" : ""}`} onClick={() => onPick(match.roundIndex, match.matchIndex, match.b)}><TeamMark team={match.b} small /></button>
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
        <header><div><span>ADMIN PUBLISH</span><h2>发布网站默认状态</h2><p>其他访客进入网站时将自动同步你当前的队伍和比赛选择。</p></div><button className="editor-close" onClick={onClose}>×</button></header>
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

function SwissStage({ number, simulation, onPick, locked, onNavigate, onEditTeams }) {
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
                <div className="round-matches">{round.map(match => <SwissMatch key={match.matchIndex} match={match} onPick={onPick} />)}</div>
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

function PlayoffMatch({ match, roundIndex, matchIndex, onPick }) {
  return (
    <article className="match-card">
      <div className="match-topline"><span>MATCH {matchIndex + 1}</span><span>BO3</span></div>
      {[match.a, match.b].map((team, index) => {
        const selected = match.winner?.name === team?.name;
        return <button disabled={!match.a || !match.b} key={team?.name ?? index} className={`team-row ${selected ? "selected" : ""} ${match.winner && !selected ? "dimmed" : ""}`} onClick={() => onPick(roundIndex, matchIndex, team)}><TeamMark team={team} small /><span className="team-name">{team?.name ?? "等待胜者"}</span><span className="pick-indicator">{selected ? "✓" : "选择"}</span></button>;
      })}
    </article>
  );
}

function Champions({ rounds, onPick, locked, onNavigate }) {
  if (locked) return <section className="locked-panel"><span>CHAMPIONS STAGE LOCKED</span><h2>先完成 Stage 3</h2><p>Stage 3 的 8 支晋级队伍将进入淘汰赛。</p><button onClick={() => onNavigate(2)}>返回 Stage 3</button></section>;
  const champion = rounds[2][0].winner;
  return (
    <>
      <section className="stage-intro"><div><span>COLOGNE 2026 · PLAYOFFS</span><h1>冠军之路，<em>最后七场</em></h1><p>保留原有淘汰赛，Stage 3 的晋级队伍已经自动进入八强。</p></div></section>
      <section className="bracket-scroll"><div className="bracket playoff-bracket">
        {rounds.map((round, roundIndex) => <section className={`stage stage-${roundIndex}`} key={roundIndex}><header className="stage-header"><span>{["QUARTERFINALS", "SEMIFINALS", "GRAND FINAL"][roundIndex]}</span><h2>{["四分之一决赛", "半决赛", "总决赛"][roundIndex]}</h2></header><div className="match-list">{round.map((match, matchIndex) => <PlayoffMatch key={matchIndex} match={match} roundIndex={roundIndex} matchIndex={matchIndex} onPick={onPick} />)}</div></section>)}
      </div></section>
      <section className={`champion-panel ${champion ? "revealed" : ""}`}><div className="trophy">✦</div><div className="champion-copy"><span>YOUR COLOGNE 2026 CHAMPION</span><h2>{champion?.name ?? "冠军等待你的预测"}</h2><p>{champion ? `你预测 ${champion.name} 将在科隆捧杯。` : "完成淘汰赛，冠军将在这里揭晓。"}</p></div><TeamMark team={champion} /></section>
    </>
  );
}

function App() {
  const savedState = useMemo(readSavedState, []);
  const [activePage, setActivePage] = useState(savedState.activePage ?? 0);
  const [stageOneTeams, setStageOneTeams] = useState(() => (savedState.stageOneTeams?.length === 16 ? savedState.stageOneTeams : defaultStageOneTeams).map(normalizeTeam));
  const [stageTwoInvites, setStageTwoInvites] = useState(() => migrateStageTwoInvites(savedState.stageTwoInvites?.length === 8 ? savedState.stageTwoInvites : defaultStageTwoInvites));
  const [stageThreeInvites, setStageThreeInvites] = useState(() => (savedState.stageThreeInvites?.length === 8 ? savedState.stageThreeInvites : defaultStageThreeInvites).map(normalizeTeam));
  const [stagePicks, setStagePicks] = useState(() => savedState.stagePicks?.length === 3 ? savedState.stagePicks : [{}, {}, {}]);
  const [playoffRounds, setPlayoffRounds] = useState(() => savedState.playoffRounds ?? []);
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
  useEffect(() => {
    fetch("/api/state", { cache: "no-store" })
      .then(response => response.ok ? response.json() : Promise.reject())
      .then(({ state }) => {
        if (!state) return;
        if (state.stageOneTeams?.length === 16) setStageOneTeams(state.stageOneTeams.map(normalizeTeam));
        if (state.stageTwoInvites?.length === 8) setStageTwoInvites(state.stageTwoInvites.map(normalizeTeam));
        if (state.stageThreeInvites?.length === 8) setStageThreeInvites(state.stageThreeInvites.map(normalizeTeam));
        if (state.stagePicks?.length === 3) setStagePicks(state.stagePicks);
        if (Array.isArray(state.playoffRounds)) setPlayoffRounds(state.playoffRounds);
        setActivePage(state.activePage ?? 0);
      })
      .catch(() => {})
      .finally(() => setRemoteLoaded(true));
  }, []);
  useEffect(() => {
    if (!remoteLoaded) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ activePage, stageOneTeams, stageTwoInvites, stageThreeInvites, stagePicks, playoffRounds }));
    } catch {
      // Large uploaded icons can exceed the browser storage quota.
    }
  }, [activePage, stageOneTeams, stageTwoInvites, stageThreeInvites, stagePicks, playoffRounds, remoteLoaded]);

  function navigate(page) {
    if (page === 3 && stage3.complete && !playoffRounds.length) setPlayoffRounds(createBracket(stage3.qualified));
    setActivePage(page);
  }
  function pickSwiss(stageIndex, roundIndex, matchIndex, team) {
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
  function pickPlayoff(roundIndex, matchIndex, team) {
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
  function reset() { setStagePicks([{}, {}, {}]); setPlayoffRounds([]); setActivePage(0); }
  function saveStageOneTeams(teams) {
    setStageOneTeams(teams);
    setStagePicks([{}, {}, {}]);
    setPlayoffRounds([]);
    setActivePage(0);
    setEditorStage(null);
  }
  function saveStageTwoInvites(teams) {
    setStageTwoInvites(teams);
    setStagePicks(current => [current[0], {}, {}]);
    setPlayoffRounds([]);
    setActivePage(1);
    setEditorStage(null);
  }
  function saveStageThreeInvites(teams) {
    setStageThreeInvites(teams);
    setStagePicks(current => [current[0], current[1], {}]);
    setPlayoffRounds([]);
    setActivePage(2);
    setEditorStage(null);
  }
  async function publishDefaultState(token) {
    setAdminStatus({ type: "loading", message: "正在发布当前状态..." });
    try {
      const response = await fetch("/api/state", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ activePage, stageOneTeams, stageTwoInvites, stageThreeInvites, stagePicks, playoffRounds }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "发布失败。");
      setAdminStatus({ type: "success", message: `发布成功：${new Date(result.publishedAt).toLocaleString()}` });
    } catch (error) {
      setAdminStatus({ type: "error", message: error.message || "发布失败，请检查 Cloudflare 配置。" });
    }
  }
  function currentState() {
    return { version: 1, exportedAt: new Date().toISOString(), activePage, stageOneTeams, stageTwoInvites, stageThreeInvites, stagePicks, playoffRounds };
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
      setActivePage(Number.isInteger(state.activePage) ? Math.min(3, Math.max(0, state.activePage)) : 0);
      setDataStatus({ type: "success", message: `导入成功：${file.name}` });
    } catch (error) {
      setDataStatus({ type: "error", message: error.message || "无法读取 JSON 文件。" });
    }
  }

  const simulations = [stage1, stage2, stage3];
  return (
    <div className="app-shell">
      <header className="site-header"><a className="brand" href="#" onClick={event => { event.preventDefault(); navigate(0); }}><span className="brand-icon">M</span><span><strong>MAJOR</strong><small>SIMULATOR</small></span></a><div className="event-pill"><span className="live-dot" /> COLOGNE 2026</div><div className="header-actions"><button className="admin-btn" onClick={() => setDataOpen(true)}>导入 / 导出</button><button className="admin-btn" onClick={() => setAdminOpen(true)}>管理员发布</button><button className="reset-btn" onClick={reset}>重新开始 ↺</button></div></header>
      <main>
        <nav className="stage-nav">{navItems.map(item => <button key={item.id} className={activePage === item.id ? "active" : ""} onClick={() => navigate(item.id)}><span>{item.icon}</span>{item.label}{item.id > 0 && !simulations[item.id - 1]?.complete && <i>LOCKED</i>}</button>)}</nav>
        {activePage < 3 ? <SwissStage number={activePage + 1} simulation={simulations[activePage]} locked={activePage > 0 && !simulations[activePage - 1].complete} onPick={(r, m, team) => pickSwiss(activePage, r, m, team)} onNavigate={navigate} onEditTeams={() => setEditorStage(activePage + 1)} /> : <Champions rounds={playoffRounds} onPick={pickPlayoff} locked={!stage3.complete} onNavigate={navigate} />}
      </main>
      <footer><span>MAJOR SIMULATOR / 2026</span><span>三胜晋级 · 三负淘汰 · 最终进入淘汰赛</span></footer>
      {editorStage === 1 && <TeamEditor teams={stageOneTeams} defaults={defaultStageOneTeams} stageNumber={1} onSave={saveStageOneTeams} onClose={() => setEditorStage(null)} />}
      {editorStage === 2 && <TeamEditor teams={stageTwoInvites} defaults={defaultStageTwoInvites} stageNumber={2} onSave={saveStageTwoInvites} onClose={() => setEditorStage(null)} />}
      {editorStage === 3 && <TeamEditor teams={stageThreeInvites} defaults={defaultStageThreeInvites} stageNumber={3} onSave={saveStageThreeInvites} onClose={() => setEditorStage(null)} />}
      {adminOpen && <AdminPanel status={adminStatus} onPublish={publishDefaultState} onClose={() => setAdminOpen(false)} />}
      {dataOpen && <DataPanel status={dataStatus} onExport={exportState} onImport={importState} onClose={() => setDataOpen(false)} />}
    </div>
  );
}

createRoot(document.getElementById("root")).render(<StrictMode><App /></StrictMode>);
