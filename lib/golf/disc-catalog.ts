// Discs and their flight numbers, for filling in the bag by name.
// Rebuilt by scripts/update-disc-list.mjs from discit-api (Marshall Street's flight
// guide); run it again to refresh. Until then this is a short hand-checked list.

export type CatalogDisc = { name: string; brand: string; category: string; speed: number; glide: number; turn: number; fade: number };

export const DISC_CATALOG: CatalogDisc[] = [
  { name: 'Destroyer', brand: 'Innova', category: 'Distance Driver', speed: 12, glide: 5, turn: -1, fade: 3 },
  { name: 'Wraith', brand: 'Innova', category: 'Distance Driver', speed: 11, glide: 5, turn: -1, fade: 3 },
  { name: 'Valkyrie', brand: 'Innova', category: 'Distance Driver', speed: 9, glide: 4, turn: -2, fade: 2 },
  { name: 'Firebird', brand: 'Innova', category: 'Fairway Driver', speed: 9, glide: 3, turn: 0, fade: 4 },
  { name: 'TeeBird', brand: 'Innova', category: 'Fairway Driver', speed: 7, glide: 5, turn: 0, fade: 2 },
  { name: 'Leopard3', brand: 'Innova', category: 'Fairway Driver', speed: 7, glide: 5, turn: -2, fade: 1 },
  { name: 'Roc3', brand: 'Innova', category: 'Midrange', speed: 5, glide: 4, turn: 0, fade: 3 },
  { name: 'Mako3', brand: 'Innova', category: 'Midrange', speed: 5, glide: 5, turn: 0, fade: 0 },
  { name: 'Aviar', brand: 'Innova', category: 'Putter', speed: 2, glide: 3, turn: 0, fade: 1 },
  { name: 'Zeus', brand: 'Discraft', category: 'Distance Driver', speed: 12, glide: 5, turn: -1, fade: 3 },
  { name: 'Undertaker', brand: 'Discraft', category: 'Fairway Driver', speed: 9, glide: 5, turn: -1, fade: 2 },
  { name: 'Raptor', brand: 'Discraft', category: 'Fairway Driver', speed: 9, glide: 4, turn: 0, fade: 3 },
  { name: 'Buzzz', brand: 'Discraft', category: 'Midrange', speed: 5, glide: 4, turn: -1, fade: 1 },
  { name: 'Zone', brand: 'Discraft', category: 'Putter', speed: 4, glide: 3, turn: 0, fade: 3 },
  { name: 'Luna', brand: 'Discraft', category: 'Putter', speed: 3, glide: 3, turn: 0, fade: 3 },
  { name: 'Wave', brand: 'MVP', category: 'Distance Driver', speed: 11, glide: 5, turn: -2, fade: 2 },
  { name: 'Volt', brand: 'MVP', category: 'Fairway Driver', speed: 8, glide: 5, turn: -0.5, fade: 2 },
  { name: 'Crave', brand: 'Axiom', category: 'Fairway Driver', speed: 6.5, glide: 5, turn: -1, fade: 1 },
  { name: 'Reactor', brand: 'MVP', category: 'Midrange', speed: 5, glide: 5, turn: -0.5, fade: 1.5 },
  { name: 'Hex', brand: 'Axiom', category: 'Midrange', speed: 5, glide: 5, turn: -1, fade: 1 },
  { name: 'Envy', brand: 'Axiom', category: 'Putter', speed: 3, glide: 3, turn: 0, fade: 2 },
  { name: 'Grace', brand: 'Latitude 64', category: 'Distance Driver', speed: 11, glide: 6, turn: -1, fade: 2 },
  { name: 'Saint', brand: 'Latitude 64', category: 'Fairway Driver', speed: 9, glide: 7, turn: -1, fade: 2 },
  { name: 'Explorer', brand: 'Latitude 64', category: 'Fairway Driver', speed: 7, glide: 5, turn: 0, fade: 2 },
  { name: 'Pure', brand: 'Latitude 64', category: 'Putter', speed: 3, glide: 3, turn: -1, fade: 1 },
];
