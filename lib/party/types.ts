export type GameType = 'quip-clash' | 'the-faker' | 'trivia-death' | 'bracket-battles' | 'ready-set-bet';

export interface Player {
  id: string;
  name: string;
  score: number;
  connected: boolean;
  avatarColor: string;
}

export interface GameState {
  roomCode: string;
  gameType: GameType;
  phase: string;
  players: Record<string, Player>;
  playerOrder: string[]; // Keep track of join order
  hostId: string;
  // Secret key -> player id. The key is the player's credential (it's in their
  // URL); the id is public (other players vote by it), so the two must differ.
  playerKeys?: Record<string, string>;
  // Game-specific data for the host
  hostData: any;
  // Game-specific data tailored for players (playerId -> data)
  playerData: Record<string, any>;
  // Internal backend game data
  gameData?: any;
  updatedAt: number;
}
