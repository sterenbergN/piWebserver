import fs from 'fs/promises';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), '.data');
const PROMPTS_FILE = path.join(DATA_DIR, 'party-prompts.json');

export interface TriviaQuestion {
  question: string;
  choices: [string, string, string, string]; // exactly 4
  answer: number; // 0-indexed correct choice
  category?: string;
}

export interface PromptsData {
  quipClash: string[];
  theFaker: string[];
  triviaQuestions: TriviaQuestion[];
  bracketBattles: string[];
}

const DEFAULT_PROMPTS: PromptsData = {
  quipClash: [
    "A bad name for a pet dog",
    "The worst thing to say at a funeral",
    "A secret weapon nobody knows about",
    "What you wouldn't want to find in your burger",
    "A bad super power",
    "The worst theme for a party",
    "What's actually at the end of the rainbow?",
    "A weird thing to collect",
    "The worst thing to hear from your doctor",
    "What the monster under the bed is actually afraid of",
    "A terrible name for a restaurant",
    "What really killed the dinosaurs?",
    "The worst thing to accidentally text your boss",
    "A new Olympic sport that would be terrible",
    "What aliens actually think of us",
    "A terrible idea for a candle scent",
    "What your dog is actually thinking",
    "The worst thing to find in your hotel room",
    "A bad excuse for being late",
    "What you don't want to see in the rearview mirror"
  ],
  theFaker: [
    "Raise your hand if you have ever broken a bone.",
    "Raise your hand if you have peed in a pool.",
    "Point to the person who is most likely to survive a zombie apocalypse.",
    "Hold up the number of fingers for how many speeding tickets you've had.",
    "Point to the person you think is the smartest in the room.",
    "Make a face that shows how you feel about spicy food.",
    "Raise your hand if you have gone skydiving.",
    "Point to the person who takes the longest to get ready.",
    "Show on your fingers how many cups of coffee you had today.",
    "Raise your hand if you have ever eaten a bug.",
    "Point to the person most likely to get arrested.",
    "Show on your fingers how many siblings you have.",
    "Make a face that shows how you feel about your boss.",
    "Raise your hand if you have a tattoo.",
    "Point to the person who is the worst driver.",
    "Show on your fingers how many days a week you workout.",
    "Raise your hand if you have ever cried at a movie.",
    "Point to the person who is most likely to become internet famous.",
    "Make a face that shows how you feel about waking up early.",
    "Raise your hand if you have ever been on TV."
  ],
  triviaQuestions: [
    { question: "What is the capital of France?", choices: ["London", "Berlin", "Paris", "Madrid"], answer: 2, category: "Geography" },
    { question: "How many sides does a hexagon have?", choices: ["5", "6", "7", "8"], answer: 1, category: "Math" },
    { question: "What planet is known as the Red Planet?", choices: ["Venus", "Jupiter", "Saturn", "Mars"], answer: 3, category: "Science" },
    { question: "Which element has the chemical symbol 'O'?", choices: ["Gold", "Oxygen", "Osmium", "Iron"], answer: 1, category: "Science" },
    { question: "Who painted the Mona Lisa?", choices: ["Van Gogh", "Picasso", "Leonardo da Vinci", "Monet"], answer: 2, category: "Art" },
    { question: "What is the largest ocean on Earth?", choices: ["Atlantic", "Indian", "Arctic", "Pacific"], answer: 3, category: "Geography" },
    { question: "In what year did World War II end?", choices: ["1943", "1944", "1945", "1946"], answer: 2, category: "History" },
    { question: "What is the speed of light (approximately)?", choices: ["150,000 km/s", "200,000 km/s", "300,000 km/s", "400,000 km/s"], answer: 2, category: "Science" },
    { question: "How many strings does a standard guitar have?", choices: ["4", "5", "6", "7"], answer: 2, category: "Music" },
    { question: "What is the smallest prime number?", choices: ["0", "1", "2", "3"], answer: 2, category: "Math" },
    { question: "Which country invented pizza?", choices: ["France", "Italy", "Greece", "Spain"], answer: 1, category: "Food" },
    { question: "What gas do plants absorb from the atmosphere?", choices: ["Oxygen", "Nitrogen", "Carbon Dioxide", "Helium"], answer: 2, category: "Science" },
    { question: "How many bones are in the adult human body?", choices: ["186", "206", "226", "246"], answer: 1, category: "Science" },
    { question: "Who wrote 'Romeo and Juliet'?", choices: ["Charles Dickens", "William Shakespeare", "Jane Austen", "Mark Twain"], answer: 1, category: "Literature" },
    { question: "What is the chemical formula for water?", choices: ["HO", "H2O", "H3O", "HO2"], answer: 1, category: "Science" },
    { question: "Which is the longest river in the world?", choices: ["Amazon", "Yangtze", "Mississippi", "Nile"], answer: 3, category: "Geography" },
    { question: "What year was the iPhone first released?", choices: ["2005", "2006", "2007", "2008"], answer: 2, category: "Technology" },
    { question: "How many players are on a standard football (soccer) team?", choices: ["9", "10", "11", "12"], answer: 2, category: "Sports" },
    { question: "What is the currency of Japan?", choices: ["Yuan", "Won", "Ringgit", "Yen"], answer: 3, category: "Geography" },
    { question: "Who was the first person to walk on the moon?", choices: ["Buzz Aldrin", "Neil Armstrong", "Yuri Gagarin", "John Glenn"], answer: 1, category: "History" },
    { question: "What is the largest mammal?", choices: ["African Elephant", "Blue Whale", "Giraffe", "Hippopotamus"], answer: 1, category: "Science" },
    { question: "Which programming language is Python named after?", choices: ["A snake", "A Greek god", "Monty Python", "A mathematician"], answer: 2, category: "Technology" },
    { question: "How many continents are there on Earth?", choices: ["5", "6", "7", "8"], answer: 2, category: "Geography" },
    { question: "What is the square root of 144?", choices: ["11", "12", "13", "14"], answer: 1, category: "Math" },
    { question: "Which country has the most natural lakes?", choices: ["Russia", "USA", "Brazil", "Canada"], answer: 3, category: "Geography" },
    { question: "What is the hardest natural substance on Earth?", choices: ["Quartz", "Titanium", "Diamond", "Sapphire"], answer: 2, category: "Science" },
    { question: "In what decade was the internet invented?", choices: ["1960s", "1970s", "1980s", "1990s"], answer: 1, category: "Technology" },
    { question: "How many keys does a standard piano have?", choices: ["72", "76", "80", "88"], answer: 3, category: "Music" },
    { question: "What is the national animal of Australia?", choices: ["Koala", "Kangaroo", "Platypus", "Emu"], answer: 1, category: "Geography" },
    { question: "Which gas makes up most of Earth's atmosphere?", choices: ["Oxygen", "Carbon Dioxide", "Nitrogen", "Argon"], answer: 2, category: "Science" },
  ],
  bracketBattles: [
    "The absolute worst thing to say on a first date",
    "A terrible name for a new cryptocurrency",
    "The most useless superpower you could possibly have",
    "A completely inappropriate song to play at a funeral",
    "The worst thing to find under your bed",
    "An awful idea for a new reality TV show",
    "The worst excuse for calling into work sick",
    "A bad name for a retirement home",
    "The worst tattoo to get on your forehead",
    "A terrible thing to yell out during a quiet movie",
    "The worst feature to add to a smartphone",
    "A horrifying flavor of ice cream",
    "The absolute worst mascot for a high school",
    "A terrible catchphrase for an action hero",
    "The worst thing to hear the pilot say mid-flight"
  ]
};

export async function getPrompts(): Promise<PromptsData> {
  try {
    const data = await fs.readFile(PROMPTS_FILE, 'utf-8');
    const parsed = JSON.parse(data);
    // Back-fill if missing (for existing installs)
    if (!parsed.triviaQuestions) parsed.triviaQuestions = DEFAULT_PROMPTS.triviaQuestions;
    if (!parsed.bracketBattles) parsed.bracketBattles = DEFAULT_PROMPTS.bracketBattles;
    return parsed;
  } catch (err) {
    await savePrompts(DEFAULT_PROMPTS);
    return DEFAULT_PROMPTS;
  }
}

export async function savePrompts(prompts: PromptsData): Promise<void> {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(PROMPTS_FILE, JSON.stringify(prompts, null, 2));
  } catch (err) {
    console.error('Error saving prompts', err);
  }
}

export async function getRandomPrompts(gameType: 'quip-clash' | 'the-faker' | 'bracket-battles', count: number): Promise<string[]> {
  const prompts = await getPrompts();
  let list: string[];
  if (gameType === 'quip-clash') list = prompts.quipClash;
  else if (gameType === 'the-faker') list = prompts.theFaker;
  else list = prompts.bracketBattles;
  
  const shuffled = [...list].sort(() => 0.5 - Math.random());
  const result = [];
  for (let i = 0; i < count; i++) result.push(shuffled[i % shuffled.length]);
  return result;
}

export async function getRandomTriviaQuestions(count: number): Promise<TriviaQuestion[]> {
  const prompts = await getPrompts();
  const shuffled = [...prompts.triviaQuestions].sort(() => 0.5 - Math.random());
  const result: TriviaQuestion[] = [];
  for (let i = 0; i < count; i++) result.push(shuffled[i % shuffled.length]);
  return result;
}
