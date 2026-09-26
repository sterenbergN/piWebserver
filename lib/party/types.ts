export type GameType = 'quip-clash' | 'the-faker' | 'trivia-death' | 'bracket-battles' | 'ready-set-bet';

export interface Player {
  id: string;
  name: string;
  score: number;
  connected: boolean;
  avatarColor: string;
  /** Character emoji picked on joining (see AVATARS). */
  avatar?: string;
}

/** An emoji a phone threw at the TV. */
export interface Reaction { id: number; from: string; emoji: string; at: number }

export interface AudienceMember {
  id: string;
  name: string;
  connected: boolean;
  /** Play-along points (e.g. correct trivia answers). */
  score: number;
}

/** A vote the audience can take part in during the current phase. */
export interface AudienceVote {
  key: string;
  phase: string;
  prompt: string;
  choices: { id: string; label: string }[];
  votes: Record<string, string>; // audienceId -> choice id
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
  // Spectators beyond the player limit (or who arrive mid-game). They vote in
  // an audience poll that the games open and read; they never act as players.
  audience?: Record<string, AudienceMember>;
  audienceKeys?: Record<string, string>;
  audienceVote?: AudienceVote | null;
  /** Recent reactions for the TV to animate (newest last, capped). */
  reactions?: Reaction[];
  /** Host choices that survive between games in the room. */
  settings?: { packs?: string[] };
  // Game-specific data for the host
  hostData: any;
  // Game-specific data tailored for players (playerId -> data)
  playerData: Record<string, any>;
  // Internal backend game data
  gameData?: any;
  updatedAt: number;
}
