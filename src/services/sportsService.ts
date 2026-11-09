// TheSportsDB API Service - Free Open Sports Data
// No API key required for v3 endpoints

export interface SportsTeam {
  idTeam: string;
  strTeam: string;
  strTeamShort?: string;
  strAlternate?: string;
  intFormedYear?: string;
  strSport: string;
  strLeague: string;
  strCountry: string;
  strStadium?: string;
  strStadiumLocation?: string;
  intStadiumCapacity?: string;
  strDescriptionEN?: string;
  strBadge: string;
  strJersey?: string;
  strLogo?: string;
  strBanner?: string;
  strWebsite?: string;
  strTwitter?: string;
  strYoutube?: string;
}

export interface SportsPlayer {
  idPlayer: string;
  strPlayer: string;
  strNationality: string;
  strTeam: string;
  strSport: string;
  dateBorn?: string;
  strPosition?: string;
  strCutout?: string;
  strThumb?: string;
  strDescriptionEN?: string;
}

export interface SportLeague {
  idLeague: string;
  strLeague: string;
  strSport: string;
  strLeagueAlternate?: string;
}

export const POPULAR_LEAGUES = [
  { id: '4328', name: 'English Premier League', sport: 'Soccer', heName: 'הפרמייר ליג האנגלית ⚽' },
  { id: '4335', name: 'Spanish La Liga', sport: 'Soccer', heName: 'לה ליגה ספרד ⚽' },
  { id: '4387', name: 'NBA', sport: 'Basketball', heName: 'ליגת ה-NBA 🏀' },
  { id: '4332', name: 'Italian Serie A', sport: 'Soccer', heName: 'סרייה אה איטליה ⚽' },
  { id: '4331', name: 'German Bundesliga', sport: 'Soccer', heName: 'בונדסליגה גרמניה ⚽' },
  { id: '4334', name: 'French Ligue 1', sport: 'Soccer', heName: 'הליגה הצרפתית ⚽' },
  { id: '4391', name: 'NFL', sport: 'American Football', heName: 'ליגת ה-NFL 🏈' },
  { id: '4370', name: 'Formula 1', sport: 'Motorsport', heName: 'פורמולה 1 🏎️' },
];

// Fallback curated popular teams if offline or rate limited
export const CURATED_POPULAR_TEAMS: SportsTeam[] = [
  {
    idTeam: '133612',
    strTeam: 'Manchester United',
    strSport: 'Soccer',
    strLeague: 'English Premier League',
    strCountry: 'England',
    intFormedYear: '1878',
    strStadium: 'Old Trafford',
    strStadiumLocation: 'Manchester',
    strBadge: 'https://www.thesportsdb.com/images/media/team/badge/xzqwws1473504822.png',
    strDescriptionEN: 'Manchester United Football Club is a professional football club based in Old Trafford, Greater Manchester, England.',
  },
  {
    idTeam: '133739',
    strTeam: 'Barcelona',
    strSport: 'Soccer',
    strLeague: 'Spanish La Liga',
    strCountry: 'Spain',
    intFormedYear: '1899',
    strStadium: 'Camp Nou',
    strStadiumLocation: 'Barcelona',
    strBadge: 'https://www.thesportsdb.com/images/media/team/badge/09009k1598797240.png',
    strDescriptionEN: 'Futbol Club Barcelona, commonly referred to as Barcelona and colloquially known as Barça, is a professional football club based in Barcelona, Catalonia, Spain.',
  },
  {
    idTeam: '133738',
    strTeam: 'Real Madrid',
    strSport: 'Soccer',
    strLeague: 'Spanish La Liga',
    strCountry: 'Spain',
    intFormedYear: '1902',
    strStadium: 'Santiago Bernabéu',
    strStadiumLocation: 'Madrid',
    strBadge: 'https://www.thesportsdb.com/images/media/team/badge/71871a1725514668.png',
    strDescriptionEN: 'Real Madrid Club de Fútbol is a Spanish professional football club based in Madrid.',
  },
  {
    idTeam: '133602',
    strTeam: 'Liverpool',
    strSport: 'Soccer',
    strLeague: 'English Premier League',
    strCountry: 'England',
    intFormedYear: '1892',
    strStadium: 'Anfield',
    strStadiumLocation: 'Liverpool',
    strBadge: 'https://www.thesportsdb.com/images/media/team/badge/uvuqrr1473504938.png',
    strDescriptionEN: 'Liverpool Football Club is a professional football club in Liverpool, England, that competes in the Premier League.',
  },
  {
    idTeam: '134865',
    strTeam: 'Los Angeles Lakers',
    strSport: 'Basketball',
    strLeague: 'NBA',
    strCountry: 'United States',
    intFormedYear: '1947',
    strStadium: 'Crypto.com Arena',
    strStadiumLocation: 'Los Angeles',
    strBadge: 'https://www.thesportsdb.com/images/media/team/badge/rqpwwr1511693892.png',
    strDescriptionEN: 'The Los Angeles Lakers are an American professional basketball team based in Los Angeles.',
  },
  {
    idTeam: '134860',
    strTeam: 'Golden State Warriors',
    strSport: 'Basketball',
    strLeague: 'NBA',
    strCountry: 'United States',
    intFormedYear: '1946',
    strStadium: 'Chase Center',
    strStadiumLocation: 'San Francisco',
    strBadge: 'https://www.thesportsdb.com/images/media/team/badge/xpsssx1422042682.png',
    strDescriptionEN: 'The Golden State Warriors are an American professional basketball team based in San Francisco.',
  },
  {
    idTeam: '133613',
    strTeam: 'Manchester City',
    strSport: 'Soccer',
    strLeague: 'English Premier League',
    strCountry: 'England',
    intFormedYear: '1880',
    strStadium: 'Etihad Stadium',
    strStadiumLocation: 'Manchester',
    strBadge: 'https://www.thesportsdb.com/images/media/team/badge/vwpvry1467462651.png',
    strDescriptionEN: 'Manchester City Football Club is an English football club based in Manchester.',
  },
  {
    idTeam: '133714',
    strTeam: 'Paris Saint-Germain',
    strSport: 'Soccer',
    strLeague: 'French Ligue 1',
    strCountry: 'France',
    intFormedYear: '1970',
    strStadium: 'Parc des Princes',
    strStadiumLocation: 'Paris',
    strBadge: 'https://www.thesportsdb.com/images/media/team/badge/rwqrwp1473504808.png',
    strDescriptionEN: 'Paris Saint-Germain Football Club is a French professional football club based in Paris.',
  },
];

// Fetch teams in a league
export async function fetchTeamsByLeague(leagueName: string): Promise<SportsTeam[]> {
  const url = `https://www.thesportsdb.com/api/v1/json/3/search_all_teams.php?l=${encodeURIComponent(leagueName)}`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Network error');
    const data = await res.json();
    if (data && data.teams && data.teams.length > 0) {
      return data.teams.map((t: any) => ({
        idTeam: t.idTeam,
        strTeam: t.strTeam,
        strTeamShort: t.strTeamShort,
        strAlternate: t.strAlternate,
        intFormedYear: t.intFormedYear,
        strSport: t.strSport,
        strLeague: t.strLeague,
        strCountry: t.strCountry,
        strStadium: t.strStadium,
        strStadiumLocation: t.strStadiumLocation,
        intStadiumCapacity: t.intStadiumCapacity,
        strDescriptionEN: t.strDescriptionEN,
        strBadge: t.strBadge || 'https://images.unsplash.com/photo-1508098682722-e99c43a406b2?w=300&q=80',
        strJersey: t.strEquipment,
        strLogo: t.strLogo,
        strBanner: t.strBanner,
        strWebsite: t.strWebsite,
        strTwitter: t.strTwitter,
        strYoutube: t.strYoutube,
      }));
    }
  } catch (e) {
    console.warn('TheSportsDB fetch error:', e);
  }
  return CURATED_POPULAR_TEAMS.filter((t) => t.strLeague.toLowerCase().includes(leagueName.toLowerCase()));
}

// Search team by name
export async function searchTeams(query: string): Promise<SportsTeam[]> {
  if (!query.trim()) return CURATED_POPULAR_TEAMS;
  const url = `https://www.thesportsdb.com/api/v1/json/3/searchteams.php?t=${encodeURIComponent(query)}`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Search network error');
    const data = await res.json();
    if (data && data.teams) {
      return data.teams.map((t: any) => ({
        idTeam: t.idTeam,
        strTeam: t.strTeam,
        strTeamShort: t.strTeamShort,
        strAlternate: t.strAlternate,
        intFormedYear: t.intFormedYear,
        strSport: t.strSport,
        strLeague: t.strLeague,
        strCountry: t.strCountry,
        strStadium: t.strStadium,
        strStadiumLocation: t.strStadiumLocation,
        intStadiumCapacity: t.intStadiumCapacity,
        strDescriptionEN: t.strDescriptionEN,
        strBadge: t.strBadge || 'https://images.unsplash.com/photo-1508098682722-e99c43a406b2?w=300&q=80',
        strJersey: t.strEquipment,
        strLogo: t.strLogo,
        strBanner: t.strBanner,
        strWebsite: t.strWebsite,
        strTwitter: t.strTwitter,
        strYoutube: t.strYoutube,
      }));
    }
  } catch (e) {
    console.warn('Search teams error:', e);
  }
  return CURATED_POPULAR_TEAMS.filter((t) =>
    t.strTeam.toLowerCase().includes(query.toLowerCase()) ||
    t.strLeague.toLowerCase().includes(query.toLowerCase())
  );
}

// Search player by name
export async function searchPlayers(playerName: string): Promise<SportsPlayer[]> {
  if (!playerName.trim()) return [];
  const url = `https://www.thesportsdb.com/api/v1/json/3/searchplayers.php?p=${encodeURIComponent(playerName)}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    if (data && data.player) {
      return data.player.map((p: any) => ({
        idPlayer: p.idPlayer,
        strPlayer: p.strPlayer,
        strNationality: p.strNationality,
        strTeam: p.strTeam,
        strSport: p.strSport,
        dateBorn: p.dateBorn,
        strPosition: p.strPosition,
        strCutout: p.strCutout,
        strThumb: p.strThumb,
        strDescriptionEN: p.strDescriptionEN,
      }));
    }
  } catch (e) {
    console.error('searchPlayers error:', e);
  }
  return [];
}
