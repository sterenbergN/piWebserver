// Shared by the restaurant search API and its form.

/** Cuisine choices → the OSM cuisine values they cover. */
export const CUISINES: Record<string, string> = {
  pizza: 'pizza',
  burger: 'burger',
  mexican: 'mexican|tex-mex|tacos?|burrito',
  italian: 'italian|pasta',
  asian: 'asian|chinese|japanese|sushi|ramen|thai|vietnamese|korean|pho|noodle',
  indian: 'indian|pakistani|nepalese',
  american: 'american|diner|burger|steak_house',
  bbq: 'bbq|barbecue|steak_house',
  seafood: 'seafood|fish|fish_and_chips|sushi',
  breakfast: 'breakfast|brunch|pancake|bagel|coffee_shop',
  sandwich: 'sandwich|deli|sub',
  mediterranean: 'mediterranean|greek|lebanese|turkish|kebab|middle_eastern|falafel',
};


export const CUISINE_LABELS: Record<keyof typeof CUISINES | '', string> = {
  '': 'Anything',
  pizza: '🍕 Pizza',
  burger: '🍔 Burgers',
  mexican: '🌮 Mexican',
  italian: '🍝 Italian',
  asian: '🍜 Asian',
  indian: '🍛 Indian',
  american: '🇺🇸 American',
  bbq: '🍖 BBQ',
  seafood: '🦐 Seafood',
  breakfast: '🥞 Breakfast',
  sandwich: '🥪 Sandwiches',
  mediterranean: '🥙 Mediterranean',
};
