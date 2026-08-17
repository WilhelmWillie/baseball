/**
 * The slice of MLB's GUMBO live feed this app actually reads.
 * Everything is optional-by-default: the feed shape varies with game state,
 * and a missing field must never take the viewer down.
 */

export interface MlbPersonRef {
  id: number;
  fullName: string;
  link?: string;
}

export interface MlbPosition {
  code?: string;
  name?: string;
  type?: string;
  abbreviation?: string;
}

export interface MlbPlayer {
  id: number;
  fullName: string;
  firstName?: string;
  lastName?: string;
  primaryNumber?: string;
  boxscoreName?: string;
  primaryPosition?: MlbPosition;
  batSide?: { code?: string; description?: string };
  pitchHand?: { code?: string; description?: string };
}

export interface MlbTeam {
  id: number;
  name?: string;
  teamName?: string;
  abbreviation?: string;
  clubName?: string;
  shortName?: string;
  locationName?: string;
  record?: { wins?: number; losses?: number };
}

export interface MlbStatus {
  abstractGameState?: string;
  codedGameState?: string;
  detailedState?: string;
  statusCode?: string;
  abstractGameCode?: string;
}

export interface MlbVenue {
  id?: number;
  name?: string;
  location?: { city?: string; stateAbbrev?: string };
}

export interface MlbGameData {
  game?: { pk?: number; type?: string; season?: string };
  datetime?: { dateTime?: string; officialDate?: string; time?: string; ampm?: string };
  status?: MlbStatus;
  teams?: { away?: MlbTeam; home?: MlbTeam };
  players?: Record<string, MlbPlayer>;
  venue?: MlbVenue;
  weather?: { condition?: string; temp?: string; wind?: string };
  probablePitchers?: { away?: MlbPersonRef; home?: MlbPersonRef };
}

export interface MlbCount {
  balls?: number;
  strikes?: number;
  outs?: number;
}

export interface MlbPitchData {
  startSpeed?: number;
  endSpeed?: number;
  strikeZoneTop?: number;
  strikeZoneBottom?: number;
  zone?: number;
  coordinates?: {
    /** Horizontal position over the plate in feet, positive to the catcher's right. */
    pX?: number;
    /** Height over the plate in feet. */
    pZ?: number;
    pfxX?: number;
    pfxZ?: number;
    x0?: number;
    y0?: number;
    z0?: number;
  };
  breaks?: { breakAngle?: number; breakLength?: number; spinRate?: number };
}

export interface MlbHitData {
  launchSpeed?: number;
  launchAngle?: number;
  totalDistance?: number;
  trajectory?: string;
  hardness?: string;
  location?: string;
  coordinates?: { coordX?: number; coordY?: number };
}

export interface MlbPlayEvent {
  index?: number;
  playId?: string;
  pitchNumber?: number;
  startTime?: string;
  endTime?: string;
  isPitch?: boolean;
  type?: string;
  count?: MlbCount;
  pitchData?: MlbPitchData;
  hitData?: MlbHitData;
  player?: MlbPersonRef;
  position?: MlbPosition;
  replacedPlayer?: MlbPersonRef;
  details?: {
    call?: { code?: string; description?: string };
    description?: string;
    event?: string;
    eventType?: string;
    code?: string;
    isInPlay?: boolean;
    isStrike?: boolean;
    isBall?: boolean;
    isOut?: boolean;
    type?: { code?: string; description?: string };
    runnerGoing?: boolean;
  };
}

export interface MlbRunner {
  movement?: {
    originBase?: string | null;
    start?: string | null;
    end?: string | null;
    outBase?: string | null;
    isOut?: boolean | null;
    outNumber?: number | null;
  };
  details?: {
    event?: string;
    eventType?: string;
    movementReason?: string | null;
    runner?: MlbPersonRef;
    isScoringEvent?: boolean;
    rbi?: boolean;
    earned?: boolean;
    playIndex?: number;
  };
  credits?: Array<{ player?: MlbPersonRef; position?: MlbPosition; credit?: string }>;
}

export interface MlbPlay {
  result?: {
    type?: string;
    event?: string;
    eventType?: string;
    description?: string;
    rbi?: number;
    awayScore?: number;
    homeScore?: number;
    isOut?: boolean;
  };
  about?: {
    atBatIndex?: number;
    halfInning?: string;
    isTopInning?: boolean;
    inning?: number;
    startTime?: string;
    endTime?: string;
    isComplete?: boolean;
    isScoringPlay?: boolean;
    hasOut?: boolean;
  };
  count?: MlbCount;
  matchup?: {
    batter?: MlbPersonRef;
    batSide?: { code?: string };
    pitcher?: MlbPersonRef;
    pitchHand?: { code?: string };
    postOnFirst?: MlbPersonRef;
    postOnSecond?: MlbPersonRef;
    postOnThird?: MlbPersonRef;
  };
  pitchIndex?: number[];
  actionIndex?: number[];
  runnerIndex?: number[];
  runners?: MlbRunner[];
  playEvents?: MlbPlayEvent[];
  atBatIndex?: number;
}

export interface MlbLinescoreTeam {
  runs?: number;
  hits?: number;
  errors?: number;
  leftOnBase?: number;
}

export interface MlbLinescore {
  currentInning?: number;
  currentInningOrdinal?: string;
  inningState?: string;
  inningHalf?: string;
  isTopInning?: boolean;
  scheduledInnings?: number;
  innings?: Array<{
    num?: number;
    ordinalNum?: string;
    home?: MlbLinescoreTeam;
    away?: MlbLinescoreTeam;
  }>;
  teams?: { home?: MlbLinescoreTeam; away?: MlbLinescoreTeam };
  defense?: {
    pitcher?: MlbPersonRef;
    catcher?: MlbPersonRef;
    first?: MlbPersonRef;
    second?: MlbPersonRef;
    third?: MlbPersonRef;
    shortstop?: MlbPersonRef;
    left?: MlbPersonRef;
    center?: MlbPersonRef;
    right?: MlbPersonRef;
    batter?: MlbPersonRef;
    onDeck?: MlbPersonRef;
    inHole?: MlbPersonRef;
    team?: MlbTeam;
  };
  offense?: {
    batter?: MlbPersonRef;
    onDeck?: MlbPersonRef;
    inHole?: MlbPersonRef;
    first?: MlbPersonRef;
    second?: MlbPersonRef;
    third?: MlbPersonRef;
    pitcher?: MlbPersonRef;
    team?: MlbTeam;
  };
  balls?: number;
  strikes?: number;
  outs?: number;
}

export interface MlbBattingStats {
  atBats?: number;
  runs?: number;
  hits?: number;
  rbi?: number;
  baseOnBalls?: number;
  strikeOuts?: number;
  doubles?: number;
  triples?: number;
  homeRuns?: number;
}

export interface MlbPitchingStats {
  inningsPitched?: string;
  hits?: number;
  runs?: number;
  earnedRuns?: number;
  baseOnBalls?: number;
  strikeOuts?: number;
  homeRuns?: number;
  /** GUMBO reports the pitch count under both names depending on the feed. */
  pitchesThrown?: number;
  numberOfPitches?: number;
}

export interface MlbBoxscorePlayer {
  person?: MlbPersonRef;
  jerseyNumber?: string;
  position?: MlbPosition;
  allPositions?: MlbPosition[];
  status?: { code?: string; description?: string };
  stats?: { batting?: MlbBattingStats; pitching?: MlbPitchingStats };
  seasonStats?: {
    batting?: { avg?: string; homeRuns?: number; rbi?: number; ops?: string };
    pitching?: { era?: string; strikeOuts?: number; wins?: number; losses?: number };
  };
  battingOrder?: string;
}

export interface MlbBoxscoreTeam {
  team?: MlbTeam;
  players?: Record<string, MlbBoxscorePlayer>;
  batters?: number[];
  pitchers?: number[];
  bench?: number[];
  bullpen?: number[];
  battingOrder?: number[];
}

export interface MlbBoxscore {
  teams?: { away?: MlbBoxscoreTeam; home?: MlbBoxscoreTeam };
}

export interface MlbLiveData {
  plays?: {
    allPlays?: MlbPlay[];
    currentPlay?: MlbPlay;
    scoringPlays?: number[];
  };
  linescore?: MlbLinescore;
  boxscore?: MlbBoxscore;
  decisions?: {
    winner?: MlbPersonRef;
    loser?: MlbPersonRef;
    save?: MlbPersonRef;
  };
}

export interface MlbLiveFeed {
  gamePk?: number;
  metaData?: { timeStamp?: string; wait?: number };
  gameData?: MlbGameData;
  liveData?: MlbLiveData;
}

/**
 * The play-by-play endpoint: `liveData.plays` on its own.
 *
 * The same plays the live feed carries, without the boxscore, the player
 * dictionary or the linescore - a fraction of the bytes, which is what a share
 * card wants when a scraper is waiting on it.
 */
export interface MlbPlayByPlay {
  allPlays?: MlbPlay[];
  currentPlay?: MlbPlay;
  scoringPlays?: number[];
}

export interface MlbScheduleGame {
  gamePk: number;
  gameDate?: string;
  officialDate?: string;
  status?: MlbStatus;
  teams?: {
    away?: { team?: MlbTeam; score?: number; leagueRecord?: { wins?: number; losses?: number } };
    home?: { team?: MlbTeam; score?: number; leagueRecord?: { wins?: number; losses?: number } };
  };
  venue?: MlbVenue;
  linescore?: MlbLinescore;
  seriesDescription?: string;
  doubleHeader?: string;
  gameNumber?: number;
}

export interface MlbSchedule {
  dates?: Array<{ date?: string; games?: MlbScheduleGame[] }>;
}
