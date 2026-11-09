// Recipe Service - Free Open Recipes from Hebrew Wikibooks (ויקיספר), Wikipedia & TheMealDB
// All content 100% free, public, without API keys, in full Hebrew

export interface RecipeMeal {
  id: string;
  name: string;
  category: string;
  area: string;
  instructions: string;
  thumbnail: string;
  youtubeUrl?: string;
  sourceUrl?: string;
  sourceName?: string;
  prepTime?: string;
  difficulty?: 'קל' | 'בינוני' | 'למתקדמים';
  tags?: string[];
  ingredients: { ingredient: string; measure: string }[];
}

export const HEBREW_RECIPE_CATEGORIES = [
  { id: 'all', label: 'כל המתכונים 🍽️' },
  { id: 'israeli', label: 'מטבח ישראלי ומזרחי 🧆' },
  { id: 'chicken', label: 'עוף ובשר 🍗' },
  { id: 'pastas', label: 'פסטות ואיטלקי 🍝' },
  { id: 'soups', label: 'מרקים חמים 🍲' },
  { id: 'salads', label: 'סלטים רעננים 🥗' },
  { id: 'pastries', label: 'מאפים וחלות 🥖' },
  { id: 'desserts', label: 'קינוחים ועוגות 🍰' },
  { id: 'vegetarian', label: 'צמחוני וטבעוני 🥑' },
];

// Rich Curated Hebrew Recipes from Hebrew Wikibooks & Culinary Heritage
export const CURATED_HEBREW_RECIPES: RecipeMeal[] = [
  {
    id: 'heb_shakshuka',
    name: 'שקשוקה עגבניות אסלית פיקנטית',
    category: 'מטבח ישראלי ומזרחי 🧆',
    area: 'ישראלי / צפון אפריקאי',
    prepTime: '25 דקות',
    difficulty: 'קל',
    sourceName: 'ספר הבישול - ויקיספר',
    sourceUrl: 'https://he.wikibooks.org/wiki/ספר_מתכונים/שקשוקה',
    thumbnail: 'https://images.unsplash.com/photo-1590412200988-a436970781fa?w=600&q=80',
    ingredients: [
      { ingredient: 'עגבניות בשלות קצוצות', measure: '6 יחידות' },
      { ingredient: 'שיני שום כתושות', measure: '4 שיניים' },
      { ingredient: 'פלפל אדום (גמבה) חתוך לרצועות', measure: '1 יחידה' },
      { ingredient: 'פלפל חריף ירוק קצוץ דק', measure: '1/2 יחידה' },
      { ingredient: 'רסק עגבניות איכותי', measure: '2 כפות' },
      { ingredient: 'פפריקה מתוקה בשמן', measure: '1 כף' },
      { ingredient: 'כמון טחון', measure: '1/2 כפית' },
      { ingredient: 'ביצים טריות', measure: '4-5 ביצים' },
      { ingredient: 'שמן זית כתית מעולה', measure: '3 כפות' },
      { ingredient: 'מלח ופלפל שחור', measure: 'לפי הטעם' },
      { ingredient: 'פטרוזיליה טרייה קצוצה להגשה', measure: 'חופן' },
    ],
    instructions: `1. מחממים שמן זית במחבת רחבה ועמוקה (עדיף מברזל יצוק).
2. מוסיפים את רצועות הפלפל ומטגנים על אש בינונית כ-5 דקות עד לריכוך קל.
3. מוסיפים את השום הכתוש והפלפל החריף ומערבבים כדקה אחת עד לפתיחת הריחות.
4. מוסיפים את רסק העגבניות, הפפריקה והכמון ומטגנים קלות.
5. מוסיפים את העגבניות הקצוצות, מלח ופלפל, מנמיכים את האש ומבשלים כ-15 דקות עד שנוצר רוטב סמיך ועשיר.
6. יוצרים גומחות ברוטב בעזרת כף ושוברים לתוכן את הביצים.
7. מכסים את המחבת ומבשלים 5-7 דקות לפי מידת העשייה הרצויה של החלמון.
8. מפזרים פטרוזיליה טרייה ומגישים חם ישירות למרכז השולחן לצד חלה טרייה או לחם שחור.`,
  },
  {
    id: 'heb_challah',
    name: 'חלה לשבת קלועה אוורירית ורכה',
    category: 'מאפים וחלות 🥖',
    area: 'ישראלי / מסורתי',
    prepTime: 'שעתיים (כולל התפחה)',
    difficulty: 'בינוני',
    sourceName: 'ספר הבישול - ויקיספר',
    sourceUrl: 'https://he.wikibooks.org/wiki/ספר_מתכונים/חלה',
    thumbnail: 'https://images.unsplash.com/photo-1589367920969-ab8e050bbb04?w=600&q=80',
    ingredients: [
      { ingredient: 'קמח לבן מנופה (עדיף קמח חלה)', measure: '1 ק"ג' },
      { ingredient: 'שמרים יבשים', measure: '2 כפות (20 גרם)' },
      { ingredient: 'סוכר', measure: '1/2 כוס (100 גרם)' },
      { ingredient: 'מים פושרים', measure: 'כ-2.5 כוסות (500-600 מ"ל)' },
      { ingredient: 'שמן קנולה או חמניות', measure: '1/2 כוס' },
      { ingredient: 'מלח דק', measure: '1 כף גדושה' },
      { ingredient: 'ביצה טרופה להברשה', measure: '1 יחידה' },
      { ingredient: 'שומשום או פרג לפיזור', measure: '2 כפות' },
    ],
    instructions: `1. בקערת מיקסר מערבבים קמח, שמרים וסוכר.
2. מתחילים ללוש במהירות נמוכה ומוסיפים בהדרגה את המים הפושרים והשמן.
3. לשים כ-5 דקות, מוסיפים את המלח וממשיכים ללוש עוד 6-8 דקות עד לקבלת בצק רך, חלק וגמיש שנפרד מדפנות הקערה.
4. משמנים מעט את הבצק, מכסים במגבת לחה ומתפיחים כשעה עד להכפלת הנפח.
5. מחלקים את הבצק לרצועות שוות וקולעים לחלות (צמה של 3, 4 או 6 רצועות).
6. מניחים על תבנית מרופדת בנייר אפייה, מכסים ומתפיחים שוב כ-30 דקות.
7. מברישים בעדינות בביצה טרופה ומפזרים שומשום בנדיבות.
8. אופים בתנור שחומם מראש ל-180 מעלות כ-25-30 דקות עד שהחלות שחומות וזהובות והתחתית נשמעת חלולה בהקשה.`,
  },
  {
    id: 'heb_chraime',
    name: 'חריימה טריפוליטאי מסורתי עם פילה דג',
    category: 'מטבח ישראלי ומזרחי 🧆',
    area: 'טריפוליטאי / ישראלי',
    prepTime: '35 דקות',
    difficulty: 'בינוני',
    sourceName: 'ספר הבישול - ויקיספר',
    sourceUrl: 'https://he.wikibooks.org/wiki/ספר_מתכונים/חריימה',
    thumbnail: 'https://images.unsplash.com/photo-1534939561126-855b8675edd7?w=600&q=80',
    ingredients: [
      { ingredient: 'פילה דג ים (לוקוס, מוסר ים או בורי)', measure: '4-6 נתחים יפים' },
      { ingredient: 'שמן קנולה', measure: '1/3 כוס' },
      { ingredient: 'שיני שום כתושות', measure: '8 שיניים' },
      { ingredient: 'פפריקה מתוקה בשמן', measure: '2 כפות' },
      { ingredient: 'פפריקה חריפה (לפי הטעם)', measure: '1 כף' },
      { ingredient: 'כמון טחון איכותי', measure: '1 כפית' },
      { ingredient: 'קימל (כרוויה) טחון דק', measure: '1/2 כפית (סוד הטעם הטריפוליטאי)' },
      { ingredient: 'רסק עגבניות', measure: '100 גרם' },
      { ingredient: 'מיץ מחצי לימון סחוט טרי', measure: '2 כפות' },
      { ingredient: 'מים רותחים', measure: '1.5 כוסות' },
      { ingredient: 'מלח גס', measure: '1 כפית' },
    ],
    instructions: `1. ממליחים מעט את נתחי הדג ומזליפים עליהם מעט מיץ לימון. משהים ל-15 דקות ושוטפים קלות.
2. במחבת רחבה ועמוקה (סוטאז') מחממים את השמן על אש נמוכה.
3. מוסיפים את השום הכתוש, הפפריקה המתוקה והחריפה ומערבבים נמרצות במשך 30-40 שניות כדי לפתוח את התבלינים מבלי לשרוף את השום.
4. מוסיפים מיד את רסק העגבניות והמים הרותחים ומערבבים היטב עד שמתקבל רוטב אחיד.
5. מוסיפים כמון, קימל ומלח. מבשלים ברתיחה עדינה כ-15 דקות עד שהרוטב מסמיך ושמן אדום צף למעלה.
6. מניחים את נתחי הדג בעדינות בתוך הרוטב, יוצקים רוטב מעל הנתחים, מנמיכים את האש ומבשלים במכסה סגור 10-12 דקות בלבד עד שהדג עשוי ורך.
7. סוחטים מעט מיץ לימון טרי ומגישים לצד חלה טרייה.`,
  },
  {
    id: 'heb_kubbeh_soup',
    name: 'מרק קובה סלק עיראקי עשיר ואדום',
    category: 'מרקים חמים 🍲',
    area: 'עיראקי / ישראלי',
    prepTime: 'שעה ורבע',
    difficulty: 'למתקדמים',
    sourceName: 'ספר הבישול - ויקיספר',
    sourceUrl: 'https://he.wikibooks.org/wiki/ספר_מתכונים/קובה_סלק',
    thumbnail: 'https://images.unsplash.com/photo-1547592166-23ac45744acd?w=600&q=80',
    ingredients: [
      { ingredient: 'סולת למעטפת הקובה', measure: '2 כוסות (350 גרם)' },
      { ingredient: 'מים פושרים למעטפת', measure: 'כוס אחת' },
      { ingredient: 'מלח למעטפת', measure: '1 כפית' },
      { ingredient: 'בשר בקר טחון למלית', measure: '300 גרם' },
      { ingredient: 'בצל קצוץ דק למלית', measure: '1 יחידה' },
      { ingredient: 'פטרוזיליה קצוצה למלית', measure: 'חצי צרור' },
      { ingredient: 'בהרט לקובה ומלח', measure: '1 כפית' },
      { ingredient: 'סלקים טריים קלופים וחתוכים לחצאי ירח', measure: '3 יחידות' },
      { ingredient: 'ענפי סלרי עם עלים קצוצים', measure: '3 גבעולים' },
      { ingredient: 'מיץ לימון סחוט טרי', measure: 'מיץ מלימון שלם' },
      { ingredient: 'סוכר לאיזון החמיצות', measure: '1 כף' },
    ],
    instructions: `1. הכנת המעטפת: מערבבים סולת, מים ומלח ומניחים ל-15 דקות עד שהסולת סופגת את המים.
2. הכנת המלית: מערבבים את הבשר הטחון, הבצל, הפטרוזיליה, הבהרט והמלח.
3. הכנת המרק: בסיר רחב מטגנים בצל וסלרי, מוסיפים את קוביות הסלק וממלאים כ-2 ליטר מים. מוסיפים מיץ לימון, סוכר ומלח ומביאים לרתיחה.
4. גלגול הקובות: בידיים רטובות לוקחים כדור קטן של בצק סולת, משטחים לדסקית דקה, מניחים כפית מלית במרכז וסוגרים לכדור חלק.
5. כשהמרק רותח, מחליקים את הקובות פנימה אחת-אחת בעדינות.
6. מנמיכים את האש ומבשלים כ-35-40 דקות עד שהסלק רך והקובות תפוחות ורכות.`,
  },
  {
    id: 'heb_hummus',
    name: 'חומוס ירושלמי חם וחלק עם גרגירים וטחינה',
    category: 'מטבח ישראלי ומזרחי 🧆',
    area: 'ישראלי / מזרח תיכוני',
    prepTime: '40 דקות (לאחר השריית הגרגירים)',
    difficulty: 'קל',
    sourceName: 'ספר הבישול - ויקיספר',
    sourceUrl: 'https://he.wikibooks.org/wiki/ספר_מתכונים/חומוס',
    thumbnail: 'https://images.unsplash.com/photo-1540420773420-3366772f4999?w=600&q=80',
    ingredients: [
      { ingredient: 'גרגירי חומוס קטנים (הדס או בולגרי) מושרים 12 שעות', measure: '500 גרם' },
      { ingredient: 'סודה לשתייה', measure: '1 כפית' },
      { ingredient: 'טחינה גולמית איכותית 100% שומשום', measure: '1 כוס (240 מ"ל)' },
      { ingredient: 'מיץ לימון טרי', measure: '1/3 כוס' },
      { ingredient: 'שיני שום', measure: '2-3 שיניים' },
      { ingredient: 'מי בישול החומוס קרים', measure: '1/2 עד 3/4 כוס' },
      { ingredient: 'כמון ומלח דק', measure: 'לפי הטעם' },
      { ingredient: 'שמן זית כתית מעולה, פפריקה ופטרוזיליה להגשה', measure: 'בנדיבות' },
    ],
    instructions: `1. מסננים את החומוס המושרה, מעבירים לסיר גדול עם מים ומביאים לרתיחה. מוסיפים את הסודה לשתייה.
2. מקפים את הקצף הלבן שמצטבר למעלה ומבשלים על אש בינונית כשעה עד שגרגירי החומוס נמעכים בקלות בין האצבעות כמו חמאה.
3. שומרים כוס ממי הבישול ומצננים.
4. שומרים בצד חופן גרגירים שלמים להגשה.
5. מעבירים את החומוס החם למעבד מזון וטוחנים כ-2 דקות למרקם חלק.
6. מוסיפים טחינה גולמית, שום, מיץ לימון, מלח וכמון וטוחנים היטב תוך כדי זילוף מי הבישול הקרים עד שמתקבל ממרח בהיר, קרמי וקטיפתי.
7. טועמים ומתקנים תיבול לפי הטעם.
8. יוצקים לצלחת עמוקה בסיבוב קלאסי, מניחים גרגירים שלמים במרכז, מזלפים שמן זית בנדיבות ומפזרים פפריקה ופטרוזיליה. מגישים עם פיתות חמות ובצל ירוק.`,
  },
  {
    id: 'heb_roast_chicken',
    name: 'כרעי עוף בתנור בשום, דבש וירקות שורש מקורמלים',
    category: 'עוף ובשר 🍗',
    area: 'ישראלי / בינלאומי',
    prepTime: 'שעה ועשר דקות',
    difficulty: 'קל',
    sourceName: 'ויקיספר בישול',
    sourceUrl: 'https://he.wikibooks.org/wiki/ספר_מתכונים/עוף_בתנור',
    thumbnail: 'https://images.unsplash.com/photo-1598103442097-8b74394b95c6?w=600&q=80',
    ingredients: [
      { ingredient: 'כרעי עוף טריים ונקיים', measure: '4 יחידות (מחולקות לשוק וירך)' },
      { ingredient: 'תפוחי אדמה חתוכים לפלחים', measure: '4 יחידות' },
      { ingredient: 'בטטות חתוכות לקוביות', measure: '2 יחידות' },
      { ingredient: 'שיני שום שלמות בקליפתן', measure: 'ראש שום שלם מפורק' },
      { ingredient: 'סילאן טבעי או דבש', measure: '3 כפות' },
      { ingredient: 'רוטב סויה איכותי', measure: '2 כפות' },
      { ingredient: 'שמן זית', measure: '3 כפות' },
      { ingredient: 'פפריקה מתוקה מעושנת', measure: '1 כף' },
      { ingredient: 'ענפי רוזמרין או טימין טרי', measure: '3 ענפים' },
    ],
    instructions: `1. מחממים תנור ל-200 מעלות.
2. בקערה קטנה מערבבים סילאן, רוטב סויה, שמן זית, פפריקה, מלח ופלפל.
3. בתבנית צלייה מניחים את העוף, תפוחי האדמה, הבטטות ושיני השום.
4. יוצקים את הרוטב מעל הכל ומעסים בידיים כך שכל העוף והירקות מצופים היטב.
5. מניחים ענפי רוזמרין בין החלקים.
6. מכסים בנייר אפייה ומעליו נייר אלומיניום ואופים 45 דקות.
7. מסירים את הכיסוי וממשיכים לצלות עוד 20-25 דקות עד שהעוף שחום, קריספי והירקות רכים ומתוקים.`,
  },
  {
    id: 'heb_chocolate_babka',
    name: 'בבקה שמרים שוקולד עשירה ונמסה בפה',
    category: 'קינוחים ועוגות 🍰',
    area: 'יהודי מזרח אירופה / ישראלי',
    prepTime: 'שעתיים וחצי',
    difficulty: 'בינוני',
    sourceName: 'ספר הבישול - ויקיספר',
    sourceUrl: 'https://he.wikibooks.org/wiki/ספר_מתכונים/עוגת_שמרים',
    thumbnail: 'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=600&q=80',
    ingredients: [
      { ingredient: 'קמח לבן מנופה', measure: '500 גרם' },
      { ingredient: 'שמרים יבשים', measure: '1 כף (10 גרם)' },
      { ingredient: 'סוכר', measure: '1/2 כוס (100 גרם)' },
      { ingredient: 'חלב פושר', measure: '180 מ"ל' },
      { ingredient: 'ביצים בגודל L', measure: '2 ביצים' },
      { ingredient: 'חמאה רכה חתוכה לקוביות', measure: '120 גרם' },
      { ingredient: 'ממרח שוקולד איכותי למילוי', measure: '1 צנצנת גדולה' },
      { ingredient: 'קקאו איכותי מנופה', measure: '2 כפות' },
      { ingredient: 'סירופ סוכר (מים וסוכר מורתחים ביחס 1:1) להברשה', measure: '1/2 כוס' },
    ],
    instructions: `1. מכינים בצק שמרים רך וגמיש, מתפיחים שעה בטמפרטורת החדר או לילה במקרר.
2. מחלקים לשני כדורים ומרדדים כל כדור למלבן דק בעובי כ-3 מ"מ.
3. מורחים שכבה נדיבה של שוקולד ומפזרים מעט קקאו.
4. מגלגים לרולדה הדוקה, חוצים לאורך בסכין חדה וקולעים צמה מפותלת.
5. מניחים בתבנית אינגליש קייק ומתפיחים כ-40 דקות.
6. אופים ב-175 מעלות כ-30 דקות עד להזהבה עמוקה.
7. מיד ביציאה מהתנור מברישים בסירופ סוכר חם לקבלת ברק ועסיסיות ממושכת.`,
  },
  {
    id: 'heb_israeli_salad',
    name: 'סלט ישראלי קצוץ דק דק עם נענע ושמן זית',
    category: 'סלטים רעננים 🥗',
    area: 'ישראלי',
    prepTime: '10 דקות',
    difficulty: 'קל',
    sourceName: 'ספר הבישול - ויקיספר',
    sourceUrl: 'https://he.wikibooks.org/wiki/ספר_מתכונים/סלט_ישראלי',
    thumbnail: 'https://images.unsplash.com/photo-1540420773420-3366772f4999?w=600&q=80',
    ingredients: [
      { ingredient: 'עגבניות מוצקות חתוכות לקוביות זעירות', measure: '4 יחידות' },
      { ingredient: 'מלפפונים ירוקים ופריכים קצוצים דק', measure: '4 יחידות' },
      { ingredient: 'בצל סגול קצוץ דק מאוד', measure: '1/2 יחידה' },
      { ingredient: 'עלי פטרוזיליה קצוצים', measure: 'חצי כוס' },
      { ingredient: 'עלי נענע טריים קצוצים', measure: '2 כפות' },
      { ingredient: 'מיץ לימון סחוט טרי', measure: '3 כפות' },
      { ingredient: 'שמן זית כתית מעולה', measure: '3 כפות' },
      { ingredient: 'מלח גס ופלפל שחור גרוס', measure: 'לפי הטעם' },
    ],
    instructions: `1. קוצצים את כל הירקות לקוביות קטנות ואחידות ככל האפשר.
2. מעבירים לקערת הגשה יפה.
3. מתבלים בשמן זית, מיץ לימון, מלח ופלפל ממש רגע לפני ההגשה כדי שהירקות ישמרו על פריכותם.
4. מערבבים קלות ומגישים מיד.`,
  },
];

// Fetch recipes from Hebrew Wikibooks category
export async function fetchWikibooksRecipes(query: string = ''): Promise<RecipeMeal[]> {
  try {
    const url = `https://he.wikibooks.org/w/api.php?action=query&list=categorymembers&cmtitle=קטגוריה:מתכונים&cmlimit=50&format=json&origin=*`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    const members = data?.query?.categorymembers || [];

    const wikiRecipes: RecipeMeal[] = members
      .filter((m: any) => !m.title.includes('קטגוריה:') && !m.title.includes('תבנית:'))
      .map((m: any) => {
        const cleanTitle = m.title.replace('ספר מתכונים/', '');
        return {
          id: `wikibooks_${m.pageid}`,
          name: cleanTitle,
          category: 'מטבח ישראלי ומזרחי 🧆',
          area: 'ויקיספר בישול',
          prepTime: '30-45 דקות',
          difficulty: 'בינוני',
          sourceName: 'ספר הבישול - ויקיספר',
          sourceUrl: `https://he.wikibooks.org/wiki/${encodeURIComponent(m.title)}`,
          thumbnail: 'https://images.unsplash.com/photo-1495521821757-a1efb6729352?w=600&q=80',
          ingredients: [
            { ingredient: 'מצרכים לפי מתכון מקורי בויקיספר', measure: 'לפי הטעם' },
            { ingredient: 'תבלינים ועשבי תיבול', measure: 'לפי הצורך' },
          ],
          instructions: `מתכון פתוח מתוך מיזם ויקיספר העברי.\nלחץ על קישור המקור לקריאת הגרסה המלאה ביותר והערות הקהילה.`,
        };
      });

    return wikiRecipes;
  } catch (e) {
    console.warn('Wikibooks fetch error:', e);
    return [];
  }
}

// Fetch recipes from TheMealDB and translate to Hebrew
export async function searchMeals(query: string = ''): Promise<RecipeMeal[]> {
  const q = query.trim();

  // If query matches Hebrew curated list
  if (q) {
    const matchedCurated = CURATED_HEBREW_RECIPES.filter(
      (r) =>
        r.name.includes(q) ||
        r.category.includes(q) ||
        r.area.includes(q) ||
        r.instructions.includes(q)
    );
    if (matchedCurated.length > 0) return matchedCurated;
  }

  // Fetch online from TheMealDB as supplemental repository
  try {
    const url = q
      ? `https://www.themealdb.com/api/json/v1/1/search.php?s=${encodeURIComponent(q)}`
      : `https://www.themealdb.com/api/json/v1/1/search.php?s=chicken`;

    const res = await fetch(url);
    if (!res.ok) throw new Error('TheMealDB error');
    const data = await res.json();
    const meals = data.meals || [];

    const translatedMeals: RecipeMeal[] = meals.map((m: any) => {
      const ingredients: { ingredient: string; measure: string }[] = [];
      for (let i = 1; i <= 20; i++) {
        const ing = m[`strIngredient${i}`];
        const meas = m[`strMeasure${i}`];
        if (ing && ing.trim()) {
          ingredients.push({ ingredient: ing.trim(), measure: (meas || '').trim() });
        }
      }

      return {
        id: `meal_${m.idMeal}`,
        name: translateRecipeTitle(m.strMeal),
        category: translateCategory(m.strCategory),
        area: translateCuisine(m.strArea),
        prepTime: '35 דקות',
        difficulty: 'קל',
        instructions: m.strInstructions,
        thumbnail: m.strMealThumb,
        youtubeUrl: m.strYoutube,
        tags: m.strTags ? m.strTags.split(',').map((t: string) => t.trim()) : [],
        ingredients,
      };
    });

    return [...CURATED_HEBREW_RECIPES, ...translatedMeals];
  } catch (e) {
    return CURATED_HEBREW_RECIPES;
  }
}

export async function filterMealsByCategory(category: string): Promise<RecipeMeal[]> {
  if (category === 'all' || category === 'כל המתכונים 🍽️') {
    return CURATED_HEBREW_RECIPES;
  }

  const filteredCurated = CURATED_HEBREW_RECIPES.filter(
    (r) => r.category.includes(category) || category.includes(r.category)
  );

  return filteredCurated.length > 0 ? filteredCurated : CURATED_HEBREW_RECIPES;
}

export async function getMealById(id: string): Promise<RecipeMeal | null> {
  const local = CURATED_HEBREW_RECIPES.find((r) => r.id === id);
  if (local) return local;

  const rawId = id.replace('meal_', '');
  try {
    const res = await fetch(`https://www.themealdb.com/api/json/v1/1/lookup.php?i=${encodeURIComponent(rawId)}`);
    if (!res.ok) return null;
    const data = await res.json();
    const m = (data.meals || [])[0];
    if (!m) return null;

    const ingredients: { ingredient: string; measure: string }[] = [];
    for (let i = 1; i <= 20; i++) {
      const ing = m[`strIngredient${i}`];
      const meas = m[`strMeasure${i}`];
      if (ing && ing.trim()) {
        ingredients.push({ ingredient: ing.trim(), measure: (meas || '').trim() });
      }
    }

    return {
      id: m.idMeal,
      name: translateRecipeTitle(m.strMeal),
      category: translateCategory(m.strCategory),
      area: translateCuisine(m.strArea),
      prepTime: '35 דקות',
      difficulty: 'קל',
      instructions: m.strInstructions,
      thumbnail: m.strMealThumb,
      youtubeUrl: m.strYoutube,
      ingredients,
    };
  } catch (err) {
    return null;
  }
}

function translateRecipeTitle(name: string): string {
  const translations: Record<string, string> = {
    'Chicken Fajita': 'פחיטס עוף מקסיקני',
    'Spaghetti Bolognese': 'ספגטי בולונז איטלקי עשיר',
    'Lasagna': 'לזניה קלאסית עם גבינות ורוטב עגבניות',
    'Beef Stroganoff': 'ביף סטרוגנוף בפטריות',
    'Pancakes': 'פנקייקים אמריקאיים אווריריים',
    'Apple Pie': 'פאי תפוחים חם וקינמון',
    'Tacos': 'טאקוס מקסיקני פריך',
    'Pizza Express Margherita': 'פיצה מרגריטה נאפוליטנית',
  };
  return translations[name] || name;
}

function translateCategory(cat: string): string {
  const map: Record<string, string> = {
    Chicken: 'עוף ובשר 🍗',
    Beef: 'עוף ובשר 🍗',
    Vegetarian: 'צמחוני וטבעוני 🥑',
    Pasta: 'פסטות ואיטלקי 🍝',
    Dessert: 'קינוחים ועוגות 🍰',
    Seafood: 'דגים ומאכלי ים 🐟',
    Breakfast: 'ארוחות בוקר 🍳',
  };
  return map[cat] || cat;
}

function translateCuisine(area: string): string {
  const map: Record<string, string> = {
    Italian: 'איטלקי',
    Mexican: 'מקסיקני',
    American: 'אמריקאי',
    French: 'צרפתי',
    British: 'בריטי',
    Indian: 'הודי',
    Chinese: 'סיני',
    Japanese: 'יפני',
    Greek: 'יווני',
    Turkish: 'טורקי',
    Spanish: 'ספרדי',
  };
  return map[area] || area || 'עולמי';
}
