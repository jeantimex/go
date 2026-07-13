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

const API_URL = 'http://localhost:3001';

export async function analyzePosition(
  boardSize: number,
  moves: KataGoMove[],
  komi: number = 6.5
): Promise<AnalysisResponse> {
  const response = await fetch(`${API_URL}/api/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ boardSize, moves, komi }),
  });

  if (!response.ok) {
    throw new Error('Analysis request failed');
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
