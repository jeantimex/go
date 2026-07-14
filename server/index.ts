import express from 'express';
import cors from 'cors';
import { KataGoEngine } from './katago.js';

const app = express();
const port = Number(process.env.PORT) || 3001;

app.use(cors());
app.use(express.json());

const katago = new KataGoEngine();

let requestId = 0;

app.post('/api/analyze', async (req, res) => {
  try {
    const { boardSize, moves, komi = 6.5, maxVisits = 200, includeOwnership = true } = req.body;
    const visits = Math.max(1, Math.min(Number(maxVisits) || 200, 1000));

    const id = `req-${++requestId}`;
    const result = await katago.analyze(id, boardSize, moves, komi, visits, Boolean(includeOwnership));

    res.json({
      winrate: result.rootInfo.winrate,
      scoreLead: result.rootInfo.scoreLead,
      visits: result.rootInfo.visits,
      topMoves: result.moveInfos.slice(0, 5).map((m) => ({
        move: m.move,
        winrate: m.winrate,
        scoreLead: m.scoreLead,
        visits: m.visits,
      })),
      ownership: result.ownership,
    });
  } catch (error) {
    console.error('Analysis error:', error);
    res.status(500).json({ error: 'Analysis failed' });
  }
});

app.post('/api/analyze-game', async (req, res) => {
  try {
    const { boardSize, moves, komi = 6.5, maxVisits = 1 } = req.body;
    const visits = Math.max(1, Math.min(Number(maxVisits) || 1, 200));
    const id = `game-${++requestId}`;
    const results = await katago.analyzeGame(id, boardSize, moves, komi, visits);

    res.json(results.map((result) => ({
      moveNumber: result.turnNumber,
      winrate: result.rootInfo.winrate,
      scoreLead: result.rootInfo.scoreLead,
      visits: result.rootInfo.visits,
    })));
  } catch (error) {
    console.error('Game analysis error:', error);
    res.status(500).json({ error: 'Game analysis failed' });
  }
});

app.get('/api/health', (_, res) => {
  res.json({ status: 'ok' });
});

async function main() {
  console.log('Starting KataGo engine...');
  await katago.start();

  app.listen(port, () => {
    console.log(`Analysis server running at http://localhost:${port}`);
  });

  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    katago.stop();
    process.exit(0);
  });
}

main();
