const mineflayer = require('mineflayer');

if (!process.argv[2]) {
  console.error('Usage: node afk.js <username>');
  process.exit(1);
}

// ===== KONFIGURÁCIÓS PARAMÉTER =====
const itemTarget = 'deepslate_bricks'; 
const delay = 500; //ha túl gyors kibannolják spam miatt, ha túl lassú nem hatékony

/** Példa a használatra:
 * bone
 * blaze_rod
 * iron_ingot
 * deepslate_bricks
 */
// ====================================

const orderTarget = process.argv[2];

const bot = mineflayer.createBot({
  auth: 'microsoft',
  host: 'donutsmp.net',
  port: 25565,
  username: '2018.fpeti@gmail.com',
  version: '1.20.2'
});

const wait = (ms) => new Promise(r => setTimeout(r, ms));

const isTargetItem = (item) => item && (item.name?.includes(itemTarget) || item.displayName?.includes(itemTarget));
const isLimePane = (item) => item && item.name?.includes('lime_stained_glass_pane');

const countTargetItems = () => bot.inventory.items().filter(isTargetItem).reduce((sum, item) => sum + item.count, 0);

const fillOrder = async (target) => {
  let sentItems = 0;
  
  try {
    await wait(200);
    console.log(`filling order: ${target}`);
    bot.chat(`/order ${target}`);
    await wait(200);
    
    let win = bot.currentWindow;
    let itemSlot = win.slots.findIndex(isTargetItem);
    await bot.clickWindow(itemSlot, 0, 0, win);
    await wait(200);
    
    win = bot.currentWindow;
    let targetSlot = 0;
    
    for (let i = 36; i < win.slots.length; i++) {
      if (isTargetItem(win.slots[i])) {
        const itemCount = win.slots[i].count;
        await bot.clickWindow(i, 0, 0, win);
        await wait(80);
        await bot.clickWindow(targetSlot, 0, 0, win);
        await wait(80);
        
        for (let j = 0; j < 20; j++) {
          await wait(100);
          if (isTargetItem(bot.currentWindow.slots[targetSlot])) {
            sentItems += itemCount;
            console.log(`successfully sent: ${itemCount} ${itemTarget}`);
            break;
          }
        }
        
        targetSlot++;
      }
    }
    
    await wait(200);
    bot.closeWindow(bot.currentWindow);
    await wait(200);
    
    for (let s = 0; s <= 26; s++) {
      if (isLimePane(bot.currentWindow?.slots?.[s])) {
        await bot.clickWindow(s, 0, 0, bot.currentWindow);
        break;
      }
    }
    
    await wait(500);
  } catch (err) {
    console.error('Error:', err.message);
  }
  
  return sentItems;
};

bot.once('spawn', async () => {
  try {
    const { x, y, z } = bot.entity.position;
    console.log(`spawn detected, coordinates: [${Math.round(x)}, ${Math.round(y)}, ${Math.round(z)}]`);
    
    let totalSent = 0;
    
    while (countTargetItems() > 0) {
      const sent = await fillOrder(orderTarget);
      totalSent += sent;
      await wait(delay);
    }
    
    console.log('-------------------');
    console.log(`overall sent: ${totalSent} ${itemTarget}`);
    bot.quit();
  } catch (err) {
    console.error('Error:', err.message);
    bot.quit();
  }
});

bot.on('kicked', (r) => console.log('Kicked:', r));
bot.on('error', (e) => console.error('Error:', e));
