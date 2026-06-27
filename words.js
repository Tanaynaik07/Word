// ==========================================
//  WORDTIDE — WORD DATABASE
//
//  Rules enforced in this file:
//    • No word appears in more than one topic
//    • No word appears twice within the same topic
//    • No topic word also appears in dailyWords
//    • All words are UPPERCASE
// ==========================================

const WORD_DB = {
  topics: [
    {
      id: "nature",
      name: "Nature",
      emoji: "🌿",
      hint: "Found in the natural world",
      words: [
        { word: "RIVER",  hint: "Flows through valleys" },
        { word: "STORM",  hint: "Nature's fury" },
        { word: "BLOOM",  hint: "A flower's moment" },
        { word: "FROST",  hint: "Winter's touch" },
        { word: "GROVE",  hint: "A cluster of trees" },
        { word: "THORN",  hint: "A rose's defense" },
        { word: "CREEK",  hint: "A small flowing water" },
        { word: "CLIFF",  hint: "Edge of stone" },
        { word: "BIRCH",  hint: "White-barked tree" },
        { word: "FUNGI",  hint: "Forest floor dwellers" },
        { word: "DELTA",  hint: "Where a river meets the sea" },
        { word: "ALGAE",  hint: "Ocean's green carpet" },
        { word: "MAGMA",  hint: "Earth's inner fire" },
        { word: "QUARTZ", hint: "A common mineral" },
        { word: "RAPIDS", hint: "A river in a hurry" },
        { word: "CANOPY", hint: "Jungle's roof" },
        { word: "POLLEN", hint: "The dust of flowers" },
        { word: "LICHEN", hint: "Rock and bark dweller" },
        { word: "GEYSER", hint: "Earth's hot spring eruption" },
        { word: "CAVERN", hint: "A large underground cave" },
      ],
    },
    {
      id: "ocean",
      name: "Ocean",
      emoji: "🌊",
      hint: "Life beneath the waves",
      words: [
        { word: "WHALE",  hint: "Ocean's gentle giant" },
        { word: "CORAL",  hint: "Reef builder" },
        { word: "SHARK",  hint: "Apex predator" },
        { word: "SQUID",  hint: "Eight-armed sprinter" },
        { word: "KELP",   hint: "Underwater forest" },
        { word: "PRAWN",  hint: "Pink and curled" },
        { word: "TROUT",  hint: "River's silver flash" },
        { word: "SEALS",  hint: "Playful pinnipeds" },
        { word: "PERCH",  hint: "A fish or a place to sit" },
        { word: "ABYSS",  hint: "The deepest dark" },
        { word: "DEPTHS", hint: "The deep ocean layers" },
        { word: "BUOY",   hint: "It floats to guide you" },
        { word: "SHOAL",  hint: "A gathering of fish" },
        { word: "ANCHOR", hint: "Holds a ship in place" },
        { word: "LAGOON", hint: "A calm coastal pool" },
        { word: "CREST",  hint: "Top of a wave" },
        { word: "TIDAL",  hint: "Relating to the tide" },
        { word: "BRINE",  hint: "Salty water" },
        { word: "SURGE",  hint: "A powerful wave push" },
        { word: "PLANKTON", hint: "The ocean's invisible food source" },
      ],
    },
    {
      id: "food",
      name: "Food",
      emoji: "🍜",
      hint: "What's on the plate",
      words: [
        { word: "MANGO",  hint: "Tropical king" },
        { word: "LEMON",  hint: "Puckering citrus" },
        { word: "BREAD",  hint: "Baked daily" },
        { word: "SPICE",  hint: "Adds the heat" },
        { word: "CURRY",  hint: "South Asian staple" },
        { word: "SUSHI",  hint: "Japanese rice art" },
        { word: "PASTA",  hint: "Italian staple" },
        { word: "TACOS",  hint: "Folded and filled" },
        { word: "PIZZA",  hint: "Round, cheesy, perfect" },
        { word: "OLIVE",  hint: "Mediterranean gem" },
        { word: "BASIL",  hint: "Herb of summer" },
        { word: "CACAO",  hint: "Chocolate's origin" },
        { word: "BROTH",  hint: "A warming liquid base" },
        { word: "DOUGH",  hint: "Before it's baked" },
        { word: "FEAST",  hint: "A grand meal" },
        { word: "GLAZE",  hint: "A shiny sweet coating" },
        { word: "NUTMEG", hint: "Warm baking spice" },
        { word: "SAMBAL", hint: "Chilli condiment" },
        { word: "SORBET", hint: "Frozen fruit dessert" },
        { word: "LENTIL", hint: "Protein-rich pulse" },
      ],
    },
    {
      id: "space",
      name: "Space",
      emoji: "🪐",
      hint: "Beyond our atmosphere",
      words: [
        { word: "ORBIT",   hint: "A path around a star" },
        { word: "LUNAR",   hint: "Relating to the moon" },
        { word: "COMET",   hint: "An icy visitor" },
        { word: "SOLAR",   hint: "Powered by the sun" },
        { word: "DWARF",   hint: "A smaller type of star or planet" },
        { word: "NOVA",    hint: "A star's sudden brightening" },
        { word: "QUASAR",  hint: "Extremely bright galactic core" },
        { word: "NEBULA",  hint: "A cloud of gas in space" },
        { word: "SATURN",  hint: "Planet with rings" },
        { word: "PULSAR",  hint: "A rotating neutron star" },
        { word: "METEOR",  hint: "A shooting star" },
        { word: "COSMOS",  hint: "The whole universe" },
        { word: "ZENITH",  hint: "Highest point in the sky" },
        { word: "VACUUM",  hint: "Empty space has no air" },
        { word: "PHOTON",  hint: "A particle of light" },
        { word: "ECLIPSE", hint: "One body blocking another" },
        { word: "GRAVITY", hint: "What keeps you down" },
        { word: "HORIZON", hint: "Where sky meets ground" },
        { word: "AURORA",  hint: "Lights that dance near the poles" },
        { word: "CRATER",  hint: "A bowl left by an impact" },
      ],
    },
    {
      id: "animals",
      name: "Animals",
      emoji: "🦁",
      hint: "The animal kingdom",
      words: [
        { word: "TIGER",  hint: "Striped big cat" },
        { word: "EAGLE",  hint: "King of the sky" },
        { word: "OTTER",  hint: "Playful river acrobat" },
        { word: "BISON",  hint: "Great Plains giant" },
        { word: "PANDA",  hint: "Black and white muncher" },
        { word: "RAVEN",  hint: "Edgar's favourite bird" },
        { word: "LEMUR",  hint: "Madagascar's primate" },
        { word: "TAPIR",  hint: "Odd-nosed forest dweller" },
        { word: "VIPER",  hint: "Venomous serpent" },
        { word: "FINCH",  hint: "Darwin's muse" },
        { word: "GECKO",  hint: "Wall-climbing lizard" },
        { word: "HIPPO",  hint: "River horse" },
        { word: "MOOSE",  hint: "Antlered lake-wader" },
        { word: "KOALA",  hint: "Eucalyptus enthusiast" },
        { word: "QUAIL",  hint: "Ground-nesting bird" },
        { word: "MANTA",  hint: "Gentle ocean glider" },
        { word: "CRANE",  hint: "Long-legged dancer" },
        { word: "WOMBAT", hint: "Australian burrower" },
        { word: "JAGUAR", hint: "Spotted rainforest cat" },
        { word: "STOAT",  hint: "Small, fast, fearless weasel" },
      ],
    },
    {
      id: "travel",
      name: "Travel",
      emoji: "✈️",
      hint: "Places and journeys",
      words: [
        { word: "COAST",  hint: "Where land meets sea" },
        { word: "PLAZA",  hint: "A town square" },
        { word: "TRAIL",  hint: "A path to follow" },
        { word: "FJORD",  hint: "Norwegian inlet" },
        { word: "OASIS",  hint: "Desert refuge" },
        { word: "VISTA",  hint: "A beautiful view" },
        { word: "ATOLL",  hint: "Circular coral island" },
        { word: "BAZAAR", hint: "An open-air market" },
        { word: "HOSTEL", hint: "Budget traveller's home" },
        { word: "HARBOR", hint: "Where ships rest" },
        { word: "SAFARI", hint: "An African wildlife trip" },
        { word: "TUNDRA", hint: "Arctic landscape" },
        { word: "GORGE",  hint: "A deep canyon" },
        { word: "ROUTE",  hint: "The path you take" },
        { word: "DUNES",  hint: "Rolling sand hills" },
        { word: "TEMPLE", hint: "A place of worship" },
        { word: "VOYAGE", hint: "A long sea journey" },
        { word: "PEAK",   hint: "Summit of a mountain" },
        { word: "COBBLE", hint: "Old-town streets paved with stones" },
        { word: "BORDER", hint: "Where one country ends" },
      ],
    },
  ],

  // ── WORD OF THE DAY ──────────────────────
  // One per calendar day, seeded by date.
  // These words must NOT appear in any topic above.
  dailyWords: [
    { word: "TIDE",    hint: "The ocean breathes in and out" },
    { word: "DRIFT",   hint: "What currents do to lost things" },
    { word: "PEARL",   hint: "Born inside an oyster's pain" },
    { word: "FLOAT",   hint: "To rest on water's surface" },
    { word: "SHORE",   hint: "Where the tide says goodbye" },
    { word: "SWELL",   hint: "A long, gentle wave from afar" },
    { word: "WRACK",   hint: "Seaweed left by the tide" },
    { word: "BASIN",   hint: "Where ocean water collects" },
    { word: "EDDY",    hint: "Water spinning in a circle" },
    { word: "HAVEN",   hint: "A safe harbour from storms" },
    { word: "WAKE",    hint: "The trail a boat leaves behind" },
    { word: "FATHOM",  hint: "A unit of ocean depth" },
    { word: "CURRENT", hint: "The ocean's invisible river" },
    { word: "MARINA",  hint: "A harbour for small boats" },
    { word: "SERAPH",  hint: "An ocean's guardian spirit" },
    { word: "MANTLE",  hint: "The layer under the ocean floor" },
    { word: "GROTTO",  hint: "A sea cave, cool and quiet" },
    { word: "FOSSIL",  hint: "A creature frozen in stone time" },
    { word: "SPIRAL",  hint: "How a nautilus shell grows" },
    { word: "SALINITY",hint: "How salty the sea is" },
    { word: "RIPPLE",  hint: "A small wave spreading outward" },
    { word: "ABYSSAL", hint: "Relating to the deepest ocean zone" },
    { word: "TRAWL",   hint: "A drag-net through the sea" },
    { word: "PLUME",   hint: "A rising column in the ocean" },
    { word: "BILLOW",  hint: "A rolling, swelling wave" },
    { word: "MOORING", hint: "A fixed point to tie a boat" },
    { word: "KNOT",    hint: "A sailor's unit of speed" },
    { word: "ESTUARY", hint: "Where a river widens to meet the sea" },
    { word: "BARNACLE",hint: "It clings to the hull of ships" },
    { word: "ZEPHYR",  hint: "A gentle west wind over the water" },
    { word: "SHOALING",hint: "Waves growing shallower near shore" },
  ],
};

// ── UTILITY: Get today's Word of the Day ──
// Index is determined by days elapsed since 2026-01-01, wrapping the list.
function getDailyWord() {
  const now      = new Date();
  const dayIndex = Math.floor(
    (Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - Date.UTC(2026, 0, 1)) / 86400000
  ) % WORD_DB.dailyWords.length;

  return {
    ...WORD_DB.dailyWords[Math.abs(dayIndex)],
    topic:     "special",
    topicName: "Word of the Day",
  };
}

// ── UTILITY: Get a random word for a specific topic ──
// Fully random each time so replaying a topic always gives a fresh word.
// The Word of the Day (getDailyWord) remains date-seeded and consistent.
function getWordFromTopic(topicId) {
  const topic = WORD_DB.topics.find(t => t.id === topicId);
  if (!topic) return null;

  const idx = Math.floor(Math.random() * topic.words.length);

  return {
    ...topic.words[idx],
    topic:     topicId,
    topicName: topic.name,
  };
}

// ── UTILITY: Quick-lookup set for valid game words ──
// Used by game.js to reject nonsense guesses without a full dictionary.
// Built lazily on first access.
let _validWordSet = null;

function getValidWordSet() {
  if (_validWordSet) return _validWordSet;

  _validWordSet = new Set();

  // Add all topic words
  WORD_DB.topics.forEach(topic => {
    topic.words.forEach(w => _validWordSet.add(w.word.toUpperCase()));
  });

  // Add all daily words
  WORD_DB.dailyWords.forEach(w => _validWordSet.add(w.word.toUpperCase()));

  return _validWordSet;
}