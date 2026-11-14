// Rounds and money. First to 5, at most 9 rounds. Freeze 5 s to buy, live
// 100 s, 4 s to breathe between rounds. Win $3,250, loss $1,900 rising with
// a losing streak, kill $300, plant $300. The machine only counts; main.js
// decides wins from eliminations, the bomb and the clock.
export const FIRST_TO = 5;
export const MAX_ROUNDS = 9;
export const FREEZE_SECONDS = 5;
export const ROUND_SECONDS = 100;
export const END_SECONDS = 4;

export function createRounds(callbacks) {
  const rounds = {
    phase: 'menu', // menu | freeze | live | roundEnd | matchEnd
    round: 1,
    score: { atk: 0, def: 0 },
    money: 800,
    phaseLeft: 0,
    lossStreak: 0,
    matchWinner: null,
  };

  function startMatch() {
    rounds.phase = 'freeze';
    rounds.round = 1;
    rounds.score.atk = 0;
    rounds.score.def = 0;
    rounds.money = 800;
    rounds.phaseLeft = FREEZE_SECONDS;
    rounds.lossStreak = 0;
    rounds.matchWinner = null;
    callbacks.onPhase('freeze');
  }

  function endRound(winner, reason) {
    if (rounds.phase !== 'live') return;
    rounds.score[winner] += 1;
    if (winner === 'atk') {
      rounds.money += 3250;
      rounds.lossStreak = 0;
    } else {
      rounds.money += 1900 + Math.min(2, rounds.lossStreak) * 500;
      rounds.lossStreak += 1;
    }
    rounds.phase = 'roundEnd';
    rounds.phaseLeft = END_SECONDS;
    callbacks.onRoundEnd(winner, reason, { ...rounds.score });
    if (rounds.score[winner] >= FIRST_TO || rounds.round >= MAX_ROUNDS) {
      rounds.matchWinner = rounds.score.atk > rounds.score.def ? 'atk' : 'def';
    }
  }

  // bombPlanted: while the bomb ticks, the round clock no longer ends the
  // round — only detonation or defusal does.
  function update(dt, bombPlanted = false) {
    if (rounds.phase === 'freeze' || rounds.phase === 'live' || rounds.phase === 'roundEnd') {
      rounds.phaseLeft -= dt;
      if (rounds.phaseLeft > 0) return;
      if (rounds.phase === 'freeze') {
        rounds.phase = 'live';
        rounds.phaseLeft = ROUND_SECONDS;
        callbacks.onPhase('live');
      } else if (rounds.phase === 'live') {
        if (!bombPlanted) endRound('def', 'Time expired — the bomb was never planted.');
        else rounds.phaseLeft = 0.01;
      } else if (rounds.phase === 'roundEnd') {
        if (rounds.matchWinner) {
          rounds.phase = 'matchEnd';
          callbacks.onMatchEnd(rounds.matchWinner, { ...rounds.score });
        } else {
          rounds.round += 1;
          rounds.phase = 'freeze';
          rounds.phaseLeft = FREEZE_SECONDS;
          callbacks.onPhase('freeze');
          callbacks.onRoundStart(rounds.round);
        }
      }
    }
  }

  return {
    state: rounds,
    startMatch,
    endRound,
    update,
    addKill() {
      rounds.money += 300;
    },
    addPlant() {
      rounds.money += 300;
    },
    spend(amount) {
      if (rounds.money < amount) return false;
      rounds.money -= amount;
      return true;
    },
  };
}
