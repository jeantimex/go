import { KataGoMove } from './game';

export interface AnalysisResponse {
  winrate: number;
  scoreLead: number;
  visits: number;
  topMoves: {
    move: string;
    winrate: number;
    scoreLead: number;
    visits: number;
  }[];
  ownership?: number[];
}

export interface WinratePoint {
  moveNumber: number;
  winrate: number;
  scoreLead: number;
  visits: number;
}

// Use the page's current origin by default so the app works on any Vite or
// production port. VITE_API_URL remains available for split-origin deploys.
const API_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

export async function analyzePosition(
  boardSize: number,
  moves: KataGoMove[],
  komi: number = 6.5,
  maxVisits: number = 200,
  includeOwnership: boolean = true
): Promise<AnalysisResponse> {
  const response = await fetch(`${API_URL}/api/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ boardSize, moves, komi, maxVisits, includeOwnership }),
  });

  if (!response.ok) {
    throw new Error(`Analysis request failed (${response.status} ${response.statusText})`);
  }

  return response.json();
}

export async function analyzeGameWinrates(
  boardSize: number,
  moves: KataGoMove[],
  komi: number = 6.5,
  maxVisits: number = 1
): Promise<WinratePoint[]> {
  const response = await fetch(`${API_URL}/api/analyze-game`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ boardSize, moves, komi, maxVisits }),
  });

  if (!response.ok) {
    throw new Error(`Game analysis request failed (${response.status} ${response.statusText})`);
  }

  return response.json();
}

export async function checkServerHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${API_URL}/api/health`);
    return response.ok;
  } catch {
    return false;
  }
}
