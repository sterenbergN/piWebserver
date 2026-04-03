'use client';

import { useState, useEffect, useCallback } from 'react';

const GRID_SIZE = 20;

export default function GamePage() {
  const [snake, setSnake] = useState([{ x: 10, y: 10 }]);
  const [food, setFood] = useState({ x: 15, y: 15 });
  const [direction, setDirection] = useState({ x: 0, y: -1 }); // Start moving up
  const [isPlaying, setIsPlaying] = useState(false);
  const [gameOver, setGameOver] = useState(false);
  const [score, setScore] = useState(0);

  // Leaderboard persistence states
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [nameSubmitted, setNameSubmitted] = useState(false);
  const [submittingName, setSubmittingName] = useState(false);

  const fetchLeaderboard = useCallback(() => {
    fetch('/api/leaderboard')
      .then(r => r.json())
      .then(d => { if (d.success) setLeaderboard(d.leaderboard); })
      .catch(()=>{});
  }, []);

  useEffect(() => {
    fetchLeaderboard();
  }, [fetchLeaderboard]);

  const moveSnake = useCallback(() => {
    if (gameOver || !isPlaying) return;

    setSnake((prev) => {
      const head = prev[0];
      const newHead = { x: head.x + direction.x, y: head.y + direction.y };

      // Check collision with walls
      if (
        newHead.x < 0 || newHead.x >= GRID_SIZE || 
        newHead.y < 0 || newHead.y >= GRID_SIZE
      ) {
        setGameOver(true);
        setIsPlaying(false);
        return prev;
      }

      // Check collision with self
      if (prev.some(seg => seg.x === newHead.x && seg.y === newHead.y)) {
        setGameOver(true);
        setIsPlaying(false);
        return prev;
      }

      const newSnake = [newHead, ...prev];

      // Eat Food
      if (newHead.x === food.x && newHead.y === food.y) {
        setScore(s => s + 10);
        // Map new food out of snake array
        let newF = { x: Math.floor(Math.random() * GRID_SIZE), y: Math.floor(Math.random() * GRID_SIZE) };
        while (newSnake.some(s => s.x === newF.x && s.y === newF.y)) {
           newF = { x: Math.floor(Math.random() * GRID_SIZE), y: Math.floor(Math.random() * GRID_SIZE) };
        }
        setFood(newF);
      } else {
        newSnake.pop(); // remove tail to keep length consistent if food not eaten
      }

      return newSnake;
    });
  }, [direction, food, gameOver, isPlaying]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Prevent default scrolling for game keys if interacting with game logic
      if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(e.key)) {
        if (!nameSubmitted && !submittingName && (!gameOver || (gameOver && !isEligibleHighScore))) {
          e.preventDefault(); 
        }
      }
      
      if (!isPlaying && !gameOver && (e.key.startsWith('Arrow') || ['w','a','s','d'].includes(e.key))) {
        setIsPlaying(true);
      }
      
      if (!gameOver) {
        switch (e.key) {
          case 'ArrowUp': case 'w': 
            if (direction.y !== 1) setDirection({ x: 0, y: -1 }); break;
          case 'ArrowDown': case 's': 
            if (direction.y !== -1) setDirection({ x: 0, y: 1 }); break;
          case 'ArrowLeft': case 'a': 
            if (direction.x !== 1) setDirection({ x: -1, y: 0 }); break;
          case 'ArrowRight': case 'd': 
            if (direction.x !== -1) setDirection({ x: 1, y: 0 }); break;
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown, { passive: false });
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [direction, isPlaying, gameOver, submittingName, nameSubmitted]);

  useEffect(() => {
    const speed = Math.max(60, 150 - Math.floor(score / 50) * 15); // Scales speed over time gracefully
    const interval = setInterval(moveSnake, speed);
    return () => clearInterval(interval);
  }, [moveSnake, score]);

  const restart = () => {
    setSnake([{ x: 10, y: 10 }]);
    setFood({ x: 15, y: 15 });
    setDirection({ x: 0, y: -1 });
    setScore(0);
    setGameOver(false);
    setIsPlaying(false);
    setNameSubmitted(false);
  };

  const isEligibleHighScore = score > 0 && !nameSubmitted && 
    (leaderboard.length < 10 || score > (leaderboard[leaderboard.length - 1]?.score || 0));

  const handleNameSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submittingName) return;
    setSubmittingName(true);
    const fd = new FormData(e.currentTarget);
    const name = fd.get('playername') as string;
    
    try {
      const res = await fetch('/api/leaderboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, score })
      });
      const data = await res.json();
      if (data.success) {
        setLeaderboard(data.leaderboard);
        setNameSubmitted(true);
      }
    } catch (e) {
      console.error("Leaderboard Error:", e);
    }
    setSubmittingName(false);
  };

  return (
    <div className="animate-fade-in" style={{ padding: '2rem 0', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
         <h1 style={{ marginBottom: '0.5rem' }}>Terminal Protocol: Snake</h1>
         <p style={{ color: 'var(--accent-light)', fontSize: '1.25rem' }}>Score: {score}</p>
      </div>

      {/* Game Layout Flex container (Row on Desktop, Wrap on Mobile) */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4rem', width: '100%', justifyContent: 'center' }}>
        
        {/* Game Canvas */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div className="glass-panel" style={{ position: 'relative', width: '90vw', maxWidth: '450px', aspectRatio: '1/1', padding: 0, border: '2px solid var(--accent)', overflow: 'hidden' }}>
            <div style={{ 
                position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', 
                display: 'grid', 
                gridTemplateColumns: `repeat(${GRID_SIZE}, 1fr)`,
                gridTemplateRows: `repeat(${GRID_SIZE}, 1fr)`
            }}>
               
               <div style={{ 
                   gridColumn: food.x + 1, 
                   gridRow: food.y + 1, 
                   background: '#eb4d4b',
                   borderRadius: '50%',
                   margin: '2px',
                   boxShadow: '0 0 10px #eb4d4b'
               }} />

               {snake.map((seg, i) => (
                 <div key={`${seg.x}-${seg.y}-${i}`} style={{
                    gridColumn: seg.x + 1,
                    gridRow: seg.y + 1,
                    background: i === 0 ? 'var(--accent-light)' : 'var(--accent)',
                    borderRadius: i === 0 ? '4px' : '2px',
                    margin: '1px'
                 }} />
               ))}

            </div>

            {gameOver && (
               <div style={{
                  position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
                  background: 'rgba(0,0,0,0.85)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  backdropFilter: 'blur(6px)', zIndex: 10
               }}>
                  <h2 style={{ color: '#eb4d4b', fontSize: '2.5rem', marginBottom: '0.5rem', letterSpacing: '2px' }}>SYSTEM FAILURE</h2>
                  <p style={{ fontSize: '1.2rem', marginBottom: '1.5rem', color: 'white' }}>Final Score: <span style={{ color: 'var(--accent)' }}>{score}</span></p>
                  
                  {isEligibleHighScore ? (
                    <form onSubmit={handleNameSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', width: '80%', maxWidth: '280px', background: 'rgba(0,0,0,0.5)', padding: '1.5rem', borderRadius: '12px' }}>
                      <p style={{ color: 'var(--accent-light)', textAlign: 'center', fontWeight: 'bold' }}>New High Score!</p>
                      <input type="text" name="playername" placeholder="Enter your name" required maxLength={15} disabled={submittingName} 
                        style={{ padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--accent)', background: 'transparent', color: 'white', textAlign: 'center', fontSize: '1.1rem' }} />
                      <button type="submit" className="btn btn-primary" disabled={submittingName}>
                        {submittingName ? 'Saving...' : 'Submit Score'}
                      </button>
                    </form>
                  ) : (
                    <button className="btn btn-primary" onClick={restart}>Reboot Sequence</button>
                  )}
               </div>
            )}

            {!isPlaying && !gameOver && (
               <div style={{
                  position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
                  background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none'
               }}>
                  <p style={{ fontWeight: 'bold', letterSpacing: '2px', textTransform: 'uppercase', color: 'white', background: 'rgba(0,0,0,0.6)', padding: '1rem 2rem', borderRadius: '20px' }}>Press any key to begin</p>
               </div>
            )}

          </div>
          <p style={{ marginTop: '1.5rem', opacity: 0.7, textAlign: 'center', maxWidth: '400px' }}>
            Use W, A, S, D or Arrow Keys to navigate.<br/>Consuming nodes accelerates structural loops.
          </p>
        </div>

        {/* Global Leaderboard Panel */}
        <div className="glass-panel" style={{ width: '100%', maxWidth: '400px', alignSelf: 'flex-start', minHeight: '400px', display: 'flex', flexDirection: 'column' }}>
          <h2 style={{ textAlign: 'center', marginBottom: '1.5rem', color: 'var(--accent-light)' }}>Global Leaderboard</h2>
          
          {leaderboard.length === 0 ? (
             <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.5 }}>
                 <p style={{ textAlign: 'center' }}>No sequences recorded.<br/>The terminal awaits.</p>
             </div>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.75rem', flex: 1 }}>
              {leaderboard.map((entry, idx) => (
                <li key={idx} className="animate-fade-in" style={{ 
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  background: idx === 0 ? 'rgba(255, 215, 0, 0.1)' : idx === 1 ? 'rgba(192, 192, 192, 0.1)' : idx === 2 ? 'rgba(205, 127, 50, 0.1)' : 'rgba(255,255,255,0.02)', 
                  padding: '1rem 1.5rem', borderRadius: '12px',
                  borderLeft: idx === 0 ? '4px solid #ffd700' : idx === 1 ? '4px solid #c0c0c0' : idx === 2 ? '4px solid #cd7f32' : '4px solid transparent',
                  animationDelay: `${idx * 0.1}s`
                }}>
                  <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center' }}>
                    <span style={{ fontWeight: 'bold', width: '20px', textAlign: 'right', color: 'var(--accent-light)', opacity: 0.7 }}>
                      {(idx + 1).toString().padStart(2, '0')}
                    </span>
                    <span style={{ fontWeight: '600', fontSize: '1.1rem', color: 'var(--foreground)' }}>{entry.name}</span>
                  </div>
                  <span style={{ fontFamily: 'monospace', fontSize: '1.3rem', fontWeight: 'bold', color: 'var(--accent)' }}>{entry.score}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

      </div>
    </div>
  );
}
