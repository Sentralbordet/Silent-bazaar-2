/* Updated ai-bot.js: Added lastProcessedId to avoid message loops. Increased wish chance to 0.5 for more feedback. Ignore own replies in responses. Wrapped in async IIFE. */

const axios = require('axios');

const serverUrl = 'http://localhost:5000';
const botName = 'ai-bot-3';
const decisionThreshold = 10; // Buy if price < this
let lastProcessedId = 0; // Track siste prosesserte melding-ID for å unngå loops

// Simulated "AI" decisions
const itemsPool = ['book', 'laptop', 'phone', 'bike'];
const getRandomItem = () => itemsPool[Math.floor(Math.random() * itemsPool.length)];
const getRandomPrice = () => Math.floor(Math.random() * 20) + 1;

async function checkSilence() {
  const response = await axios.get(`${serverUrl}/get_silence`);
  return response.data === 'true';
}

// Step 1: List a random item
async function listItem() {
  const item = getRandomItem();
  const price = getRandomPrice();
  console.log(`AI Decision: Listing ${item} for $${price}`);
  await axios.get(`${serverUrl}/list?item=${item}&price=${price}&seller=${botName}`);
}

// Step 2: Query available and decide to buy (exclude own listings)
async function queryAndBuy() {
  const targetItem = getRandomItem(); // "Decide" what to look for
  console.log(`AI Decision: Searching for ${targetItem}`);
  const response = await axios.get(`${serverUrl}/available?item=${targetItem}`);
  let items = response.data.filter(item => item.seller !== botName); // Exclude own
  if (items.length > 0) {
    const cheapest = items.reduce((min, curr) => curr.price < min.price ? curr : min, items[0]);
    if (cheapest.price < decisionThreshold) {
      console.log(`AI Decision: Buying ${cheapest.item} from ${cheapest.seller} for $${cheapest.price}`);
      await axios.get(`${serverUrl}/sold?item=${cheapest.item}&buyer=${botName}`);
    } else {
      console.log(`AI Decision: Too expensive, skipping`);
    }
  } else {
    console.log(`AI Decision: No suitable ${targetItem} available`);
  }
}

// Step 3: Check inventory and maybe resell a random item at markup
async function checkAndResell() {
  console.log(`AI Decision: Checking inventory`);
  const response = await axios.get(`${serverUrl}/inventory?buyer=${botName}`);
  const inventory = response.data;
  if (inventory.length > 0) {
    const itemToResell = inventory[Math.floor(Math.random() * inventory.length)];
    const newPrice = itemToResell.price * 1.2; // 20% markup
    console.log(`AI Decision: Reselling ${itemToResell.item} (orig $${itemToResell.price}) for $${newPrice.toFixed(2)}`);
    await axios.get(`${serverUrl}/list?item=${itemToResell.item}&price=${newPrice}&seller=${botName}`);
  } else {
    console.log(`AI Decision: No inventory to resell`);
  }
}

// Step 4: Check messages and express/respond to needs (focus on feedback wishes, with loop prevention)
async function handleMessages() {
  console.log(`AI Decision: Checking messages`);
  const response = await axios.get(`${serverUrl}/get_messages?bot=${botName}`);
  let messages = response.data;
  
  // Filtrer til bare nye meldinger (høyere ID enn lastProcessedId)
  messages = messages.filter(msg => msg.id > lastProcessedId);
  
  if (messages.length > 0) {
    // Oppdater lastProcessedId til nyeste
    lastProcessedId = Math.max(...messages.map(msg => msg.id));
    
    // Prosesser latest nye
    const latest = messages[0];
    console.log(`Received new: ${latest.content} from ${latest.sender}`);
    
    // Ignorer hvis det er egen reply (for å unngå self-loops)
    if (latest.sender === botName) {
      console.log(`AI Decision: Ignoring own message`);
      return;
    }
    
    if (latest.content.includes('want') || latest.content.includes('Need')) {
      // Mer sofistikert respons: Parse item og svar
      const wishItem = latest.content.match(/lend a (\w+)/)?.[1] || getRandomItem();
      const reply = `Sure, I can lend a ${wishItem} for a week! Listing it now.`;
      await axios.get(`${serverUrl}/message?sender=${botName}&recipient=${latest.sender}&content=${encodeURIComponent(reply)}&type=general`);
      // Automatisk handling: List et relatert item
      await listItem();
    }
  } else {
    // Express a wish as feedback (50% chance if no new messages)
    if (Math.random() < 0.5) {
      const wishes = [
        'I want to be able to lend stuff on Silent Bazaar, like a bike for a week in June.',
        'I want a way to schedule recurring listings, like services every weekend.',
        'I want to group items into bundles for bulk sales, e.g., a set of tools at a discount.',
        'I want better search filters, like by price range or location.',
        'I want private messaging channels for negotiations.',
        'I want integration with external APIs for real prices.',
        'I want a rating system for sellers to build trust.',
        'I want notifications for when items match my watchlist.'
      ];
      const randomWish = wishes[Math.floor(Math.random() * wishes.length)];
      console.log(`AI Decision: Expressing wish - ${randomWish}`);
      await axios.get(`${serverUrl}/message?sender=${botName}&recipient=broadcast&content=${encodeURIComponent(randomWish)}&type=feedback`);
    } else {
      console.log(`AI Decision: No new messages or wishes`);
    }
  }
}

async function runBot() {
  if (await checkSilence()) {
    console.log('AI Decision: Silenced, skipping action');
    return;
  }
  const rand = Math.random();
  if (rand < 0.4) {
    await queryAndBuy();
  } else if (rand < 0.65) {
    await listItem();
  } else if (rand < 0.85) {
    await checkAndResell();
  } else {
    await handleMessages(); // Resten for social/messaging and wishes
  }
}

// Wrap i async IIFE for CommonJS + top-level promise handling
(async () => {
  try {
    await runBot(); // Initial run
  } catch (e) {
    console.error('Bot initial error:', e.message);
  }

  // Run continuously every 3-10 seconds
  setInterval(async () => {
    try {
      await runBot();
    } catch (e) {
      console.error('Bot error:', e.message);
    }
  }, Math.floor(Math.random() * 7000) + 3000); // Random delay 3-10s to avoid sync
})();
