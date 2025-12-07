const mineflayer = require('mineflayer');

let bot = null;

function createAndStartBot() {
  bot = mineflayer.createBot({
    auth: 'microsoft',
    host: 'donutsmp.net',
    port: 25565,
    username: '2018.fpeti@gmail.com',
    version: '1.20.2'
  });

  // Speciális hibakezelés: ha a kliens leválaszt a "client timed out" miatt,
  // akkor leállítjuk a botot, 3 mp múlva újracsatlakozunk (újraindítás-szerű viselkedés).
  bot.on('error', (err) => {
    try {
      const msg = (err && err.message) ? err.message : String(err);
      console.log("bot error:", msg);
      if (msg.includes('client timed out')) {
        console.log("Detected client timed out error — restarting bot after 3s.");
        safeRestartBot();
      }
    } catch (e) {
      console.log("Error in bot 'error' handler:", e);
    }
  });

  bot.on('end', () => {
    console.log("bot connection ended.");
    // Nem indítunk automatikusan mindent újra itt, mert safeRestartBot() kezeli a timeout esetet.
  });

  bot.once('spawn', () => {
    console.log("Bot spawnolva — elindítom a fő logikát.");
    mainLoop().catch(err => {
      console.log("mainLoop hiba:", err);
    });
  });
}

// Restart helper: stop bot, wait 3s, recreate and start.
let restarting = false;
function safeRestartBot() {
  if (restarting) return;
  restarting = true;

  try {
    console.log("Leállítom a botot...");
    try { bot.quit(); } catch (e) { try { bot.end && bot.end(); } catch (e2) {} }
  } catch (e) {
    console.log("hiba bot leállítás közben:", e);
  }

  // Wait 3 seconds, then re-create the bot (this is the timeout you wanted kept).
  setTimeout(() => {
    console.log("Újraindítás: újból csatlakozom a szerverhez...");
    restarting = false;
    // reset state vars that assume a single bot lifetime
    shopFlowInitialized = false;
    shopStep = 0;
    running = true;
    createAndStartBot();
  }, 3000);
}

/* ---------- helpers (kevesebb, szükséges timeoutok visszaállítva) ---------- */

function formatAHPrice(price) {
  const p = Math.round(Number(price) || 0);
  if (p >= 1000) {
    if (p % 1000 === 0) return (p / 1000) + "K";
    return (Math.round((p / 1000) * 100) / 100).toFixed(2) + "K";
  }
  return String(p);
}

function parsePriceLocal(priceStr) {
  if (!priceStr) return null;
  let num = priceStr.replace('$', '').toUpperCase();
  if (num.endsWith('K')) {
      return Math.round(parseFloat(num) * 1000);
  } else if (num.endsWith('M')) {
      return Math.round(parseFloat(num) * 1000000);
  } else if (num.endsWith('B')) {
      return Math.round(parseFloat(num) * 1000000000);
  } else if (num.endsWith('T')) {
      return Math.round(parseFloat(num) * 1000000000000);
  }
  return Math.round(parseFloat(num));
}

/* ---------- AH query and advertise (időkorlátok visszaállítva, hogy ne akadjon meg) ---------- */

function queryAhTotem(timeoutMs = 8000) {
  return new Promise((resolve) => {
    let done = false;

    function cleanup() {
      try { bot.removeListener('windowOpen', windowHandler); } catch (e) {}
      done = true;
    }

    const timeout = setTimeout(() => {
      if (!done) {
        console.log("queryAhTotem: timeout waiting for windowOpen.");
        cleanup();
        resolve({ price: null, seller: null });
      }
    }, timeoutMs);

    function windowHandler(window) {
      try {
        // Iterate over slots and find the first slot that contains lore with Price/Seller.
        let found = false;
        let price = null;
        let seller = null;

        for (let s = 0; s < (window.slots || []).length; s++) {
          const slot = window.slots[s];
          if (!slot) continue;
          const loreRaw = slot.nbt?.value?.display?.value?.Lore?.value?.value;
          if (!loreRaw || !Array.isArray(loreRaw)) continue;

          // Try to extract price/seller
          for (const line of loreRaw) {
            try {
              const obj = JSON.parse(line);
              if (Array.isArray(obj.extra)) {
                for (let i = 0; i < obj.extra.length; i++) {
                  const part = obj.extra[i];
                  if (part && part.text === "Price: " && obj.extra[i + 1]?.text) {
                    price = parsePriceLocal(obj.extra[i + 1].text);
                  }
                  if (part && part.text === "Seller: " && obj.extra[i + 1]?.text) {
                    seller = obj.extra[i + 1].text;
                  }
                }
              }
            } catch (err) {
              // not JSON, skip
            }
          }

          if (price !== null || seller !== null) {
            found = true;
            break;
          }
        }

        clearTimeout(timeout);
        cleanup();
        if (!found) {
          console.log("queryAhTotem: could not find lore with price/seller in any slot.");
          return resolve({ price: null, seller: null });
        }
        console.log(`queryAhTotem: found price=${price}, seller=${seller}`);
        resolve({ price, seller });
      } catch (e) {
        console.log("queryAhTotem: error processing windowOpen:", e);
        clearTimeout(timeout);
        cleanup();
        resolve({ price: null, seller: null });
      }
    }

    bot.once('windowOpen', windowHandler);
    try {
      bot.chat('/ah totem');
      console.log("Lekérdezés: /ah totem");
    } catch (e) {
      console.log("queryAhTotem: failed to send /ah totem:", e);
      clearTimeout(timeout);
      cleanup();
      resolve({ price: null, seller: null });
    }
  });
}



function advertiseTotem(price, timeoutMs = 10000) {
  return new Promise(async (resolve) => {
    let handled = false;
    let primaryTimeout;

    function cleanupAll() {
      try { bot.removeListener('windowOpen', firstWindowHandler); } catch (e) {}
      try { bot.removeListener('windowOpen', secondWindowHandler); } catch (e) {}
      handled = true;
      if (primaryTimeout) clearTimeout(primaryTimeout);
    }

    const totem = findTotemInInventory(bot);
    if (!totem) {
      console.log("advertiseTotem: no totem found in inventory.");
      return resolve(false);
    }
    const ensured = await ensureTotemInHand(bot, totem);
    if (!ensured) {
      console.log("advertiseTotem: could not put totem in hand.");
      return resolve(false);
    }

    const priceStr = formatAHPrice(price);
    primaryTimeout = setTimeout(() => {
      if (!handled) {
        console.log("advertiseTotem: timeout waiting for windows.");
        cleanupAll();
        resolve(false);
      }
    }, timeoutMs);

    function firstWindowHandler(window) {
      try {
        try {
          if (window.title) {
            console.log("advertiseTotem: window title:", window.title);
          }
        } catch (e) {}

        const confirmIdx = window.slots.findIndex(item =>
          item &&
          (
            item.name === "lime_stained_glass_pane" ||
            (typeof item.displayName === "string" && item.displayName.toLowerCase().includes("confirm")) ||
            (typeof item.displayName === "object" && item.displayName.text && item.displayName.text.toLowerCase().includes("confirm"))
          )
        );
        if (confirmIdx !== -1) {
          console.log("advertiseTotem: found confirm at slot", confirmIdx, " — clicking.");
          try { bot.clickWindow(confirmIdx, 0, 0); } catch (e) { console.log("advertiseTotem: clickWindow error:", e); }
          cleanupAll();
          setTimeout(() => resolve(true), 400);
          return;
        }

        const totemIdx = window.slots.findIndex(item =>
          item &&
          ( item.name === "totem_of_undying" ||
            (typeof item.displayName === "string" && item.displayName.toLowerCase().includes("totem")) ||
            (typeof item.displayName === "object" && item.displayName.text && item.displayName.text.toLowerCase().includes("totem"))
          )
        );
        if (totemIdx !== -1) {
          console.log("advertiseTotem: found totem in window at slot", totemIdx, "- clicking to proceed.");
          try { bot.clickWindow(totemIdx, 0, 0); } catch (e) { console.log("advertiseTotem: clickWindow error on totem slot:", e); }

          const innerTimeout = setTimeout(() => {
            if (!handled) {
              console.log("advertiseTotem: inner timeout waiting for confirmation window after clicking totem.");
              cleanupAll();
              resolve(false);
            }
          }, 6000);

          function secondWindowHandler(window2) {
            try {
              const confirmIdx2 = window2.slots.findIndex(item =>
                item &&
                (
                  item.name === "lime_stained_glass_pane" ||
                  (typeof item.displayName === "string" && item.displayName.toLowerCase().includes("confirm")) ||
                  (typeof item.displayName === "object" && item.displayName.text && item.displayName.text.toLowerCase().includes("confirm"))
                )
              );
              if (confirmIdx2 !== -1) {
                console.log("advertiseTotem: found confirm in second window at slot", confirmIdx2, " — clicking.");
                try { bot.clickWindow(confirmIdx2, 0, 0); } catch (e) { console.log("advertiseTotem: clickWindow error:", e); }
                clearTimeout(innerTimeout);
                cleanupAll();
                setTimeout(() => resolve(true), 400);
                return;
              }

              console.log("advertiseTotem: Confirm not found in second window.");
            } catch (e) {
              console.log("advertiseTotem: error in secondWindowHandler:", e);
            }

            clearTimeout(innerTimeout);
            cleanupAll();
            resolve(false);
          }

          bot.once('windowOpen', secondWindowHandler);
          return;
        }

        window.slots.forEach((item, i) => {
          if (item) {
            console.log(`advertiseTotem: Slot ${i}:`, item.name, "displayName:", item.displayName);
          }
        });
        console.log("advertiseTotem: neither confirm nor totem slot found in first window.");
      } catch (e) {
        console.log("advertiseTotem: error processing first windowOpen:", e);
      }

      cleanupAll();
      resolve(false);
    }

    let secondWindowHandler = () => {};
    bot.once('windowOpen', firstWindowHandler);

    try {
      bot.chat(`/ah sell ${priceStr}`);
      console.log("/ah sell", priceStr);
    } catch (e) {
      console.log("advertiseTotem: failed to send chat command:", e);
      cleanupAll();
      resolve(false);
    }
  });

    function isSlotInHotbar(slotIndex) {
    return typeof slotIndex === 'number' && slotIndex >= 36 && slotIndex <= 44;
  }
  function findTotemInInventory(botInstance) {
    try {
      if (!botInstance || !botInstance.inventory) return null;
      // Accept by item.name or displayName containing 'totem'
      const found = botInstance.inventory.items().find(i => {
        if (!i) return false;
        const name = (i.name || '').toString().toLowerCase();
        if (name.includes('totem')) return true;
        const disp = (i.displayName && typeof i.displayName === 'string') ? i.displayName.toLowerCase() :
                     (i.displayName && i.displayName.text) ? i.displayName.text.toLowerCase() : '';
        if (disp.includes('totem')) return true;
        return false;
      });
      return found || null;
    } catch (e) {
      return null;
    }
  }
  function ensureTotemInHand(botInstance, totemItem) {
    return new Promise((resolve) => {
      if (!totemItem) return resolve(false);

      const slot = totemItem.slot;
      if (isSlotInHotbar(slot)) {
        const qbIndex = slot - 36;
        try { botInstance.setQuickBarSlot(qbIndex); } catch (e) { /* ignore */ }
        return setTimeout(() => resolve(true), 200);
      }

      try {
        botInstance.moveItem(slot, 36, (err) => {
          if (err) {
            console.log("ensureTotemInHand: Failed to move totem to hotbar:", err);
            return resolve(false);
          }
          try { botInstance.setQuickBarSlot(0); } catch (e) {}
          setTimeout(() => resolve(true), 600);
        });
      } catch (e) {
        console.log("ensureTotemInHand: moveItem exception:", e);
        resolve(false);
      }
    });
  }
}

/* ---------- shop buy flow: FIXED (watchdog vissza) ---------- */

let shopFlowInitialized = false;
let shopStep = 0; // 0 = idle, 1 = waiting for initial shop window -> click GEAR, 2 = waiting for totem slot, 3 = waiting for confirm

function shopBuyTotemFlow(botInstance) {
  if (shopFlowInitialized) return;
  shopFlowInitialized = true;

  // safety timer to reset step if something goes wrong
  let lastActionTimestamp = Date.now();

  function resetShopStep() {
    shopStep = 0;
  }

  // watch window opens and act based on current shopStep
  botInstance.on('windowOpen', (window) => {
    // update timestamp to avoid resetting mid-flow
    lastActionTimestamp = Date.now();

    try {

      // Step 1: open shop, click GEAR button/category
      if (shopStep === 1) {
        // Many shops show a "GEAR" item or button — prefer displayName detection
        const gearIdx = window.slots.findIndex(item =>
          item &&
          (
            (typeof item.displayName === "string" && item.displayName.toUpperCase().includes("GEAR")) ||
            (typeof item.displayName === "object" && item.displayName.text && item.displayName.text.toUpperCase().includes("GEAR")) ||
            // fallback guesses: some GUIs use a chest, anvil, or other icons
            item.name === "chest" || item.name === "anvil"
          )
        );

        if (gearIdx !== -1) {
          console.log("GEAR slot:", gearIdx);
          try { botInstance.clickWindow(gearIdx, 0, 0); } catch (e) { console.log("shopBuyTotemFlow: click error on GEAR:", e); }
          shopStep = 2;
          return;
        }

        return;
      }

      // Step 2: after clicking GEAR, click the Totem of Undying item
      if (shopStep === 2) {
        const totemIdx = window.slots.findIndex(item =>
          item &&
          (
            item.name === "totem_of_undying" ||
            (typeof item.displayName === "string" && item.displayName.toLowerCase().includes("totem")) ||
            (typeof item.displayName === "object" && item.displayName.text && item.displayName.text.toLowerCase().includes("totem"))
          )
        );

        if (totemIdx !== -1) {
          console.log("Totem of Undying slot:", totemIdx);
          try { botInstance.clickWindow(totemIdx, 0, 0); } catch (e) { console.log("shopBuyTotemFlow: click error on Totem:", e); }
          shopStep = 3;
          return;
        }
        return;
      }

      // Step 3: confirmation pane (click to buy)
      if (shopStep === 3) {
        const confirmIdx = window.slots.findIndex(item =>
          item &&
          (
            item.name === "lime_stained_glass_pane" ||
            (typeof item.displayName === "string" && item.displayName.toLowerCase().includes("confirm")) ||
            (typeof item.displayName === "object" && item.displayName.text && item.displayName.text.toLowerCase().includes("confirm"))
          )
        );

        if (confirmIdx !== -1) {
          console.log("Confirm pane slot:", confirmIdx);
          try { botInstance.clickWindow(confirmIdx, 0, 0); } catch (e) { console.log("shopBuyTotemFlow: click error on Confirm:", e); }
          // assume purchase attempted; reset step to idle to allow future purchases
          shopStep = 0;
          console.log("Totem vásárlás próbálva!");
          console.log("Sikeres vásárlás (feltételezve)!");
          return;
        }

        return;
      }

      // If shopStep is 0 or unknown, ignore the shop window (we start flows by setting shopStep = 1 before /shop)
    } catch (e) {
      console.log("shopBuyTotemFlow: error in windowOpen handler:", e);
      shopStep = 0;
    }
  });

  // watchdog: if shopStep remains in-progress for too long, reset it
  setInterval(() => {
    if (shopStep !== 0 && Date.now() - lastActionTimestamp > 15000) {
      console.log("shopBuyTotemFlow: timeout: resetting shopStep to 0 due to inactivity.");
      shopStep = 0;
    }
  }, 3000);
}

/* wrapper used by main loop to start the shop flow reliably */
async function buyTotem() {
  if (!shopFlowInitialized) {
    try {
      shopBuyTotemFlow(bot);
      shopFlowInitialized = true;
    } catch (e) {
      console.log("buyTotem: error initializing shopBuyTotemFlow:", e);
    }
  }

  // trigger a new purchase attempt: set step to 1 then send /shop
  shopStep = 1;
  try {
    bot.chat('/shop');
    console.log("Parancs elküldve (újravásárlás): /shop");
  } catch (e) {
    console.log("buyTotem: failed to send /shop:", e);
  }

  // wait a reasonable amount of time for the GUI flow to finish
  await new Promise(resolve => setTimeout(resolve, 3500));
  console.log("buyTotem: várakozás befejezve (feltételezve, hogy vásárlás megpróbálva).");
}

/* remove the totem from ah and return an int which is how many totem were removed (or 0) */
async function deletItemsFromAH() {
  return new Promise((resolve, reject) => {
    let finished = false;
    // Megnövelt timeout, a 1s túl rövid volt (timeout hibákat okozott)
    const globalTimer = setTimeout(() => {
      if (!finished) {
        finished = true;
        reject(new Error('timeout'));
      }
    }, 5000);

    // Wait for the AH window (initial) after sending /ah
    bot.once('windowOpen', function initialWindowHandler(window) {
      (async () => {
        try {
          const title = (window.title || '').toString().toLowerCase();
          const isChestType =
            typeof window.type === 'string' &&
            (window.type.toLowerCase().includes('chest') || window.type === 'minecraft:chest');
          const isYourItemsTitle = title.includes('your items');

          if (isChestType || isYourItemsTitle) {
            // Already the Your Items window (or chest), process directly
            try {
              const count = await processYourItemsWindow(window);
              clearTimeout(globalTimer);
              finished = true;
              return resolve(count);
            } catch (e) {
              clearTimeout(globalTimer);
              finished = true;
              return reject(e);
            }
          }

          // Otherwise find the chest / Your Items button and click it
          const chestIdx = window.slots.findIndex((item) => {
            if (!item) return false;
            const name = (item.name || '').toString().toLowerCase();
            const disp = getDisplayNameText(item).toLowerCase();
            return (
              name === 'minecraft:chest' ||
              name === 'chest' ||
              disp.includes('your items') ||
              disp.includes('youritems') ||
              disp.includes('your items:')
            );
          });

          if (chestIdx === -1) {
            clearTimeout(globalTimer);
            finished = true;
            return reject(new Error('no chest/your items button found'));
          }

          // Next windowOpen should be the Your Items window
          bot.once('windowOpen', async function itemsWindowHandler(window2) {
            try {
              const count = await processYourItemsWindow(window2);
              clearTimeout(globalTimer);
              finished = true;
              return resolve(count);
            } catch (e) {
              clearTimeout(globalTimer);
              finished = true;
              return reject(e);
            }
          });

          try {
            bot.clickWindow(chestIdx, 0, 0);
          } catch (e) {
            clearTimeout(globalTimer);
            finished = true;
            return reject(new Error('click chest button failed'));
          }
        } catch (err) {
          clearTimeout(globalTimer);
          finished = true;
          return reject(err);
        }
      })();
    });

    // send /ah to open Auction House
    try {
      bot.chat('/ah');
    } catch (e) {
      clearTimeout(globalTimer);
      finished = true;
      return reject(new Error('failed to send /ah'));
    }
  });

  function processYourItemsWindow(window) {
    return new Promise(async (resolve, reject) => {
        try {
        const totemSlots = [];
        window.slots.forEach((item, idx) => {
            if (!item) return;
            const name = (item.name || '').toString().toLowerCase();
            // Only match exact totem item name or display name containing 'totem'
            const disp = getDisplayNameText(item).toLowerCase();
            if (name === 'minecraft:totem_of_undying' || name === 'totem_of_undying' || disp.includes('totem')) {
            totemSlots.push(idx);
            }
        });

        if (totemSlots.length === 0) {
            return resolve(0);
        }

        let deleted = 0;
        // Click every totem slot directly, do NOT handle confirm windows
        for (let i = 0; i < totemSlots.length; i++) {
            const slot = totemSlots[i];
            try {
            bot.clickWindow(slot, 0, 0);
            deleted++;
            } catch (e) {
            // ignore individual click errors and continue
            console.log("processYourItemsWindow: click error on slot", slot, e);
            }
            await sleep(150);
        }

        return resolve(deleted);
        } catch (e) {
        return reject(e);
        }
    });
    }

    function sleep(ms) {
        return new Promise((res) => setTimeout(res, ms));
    }

    function getDisplayNameText(item) {
        try {
            if (!item) return '';
            if (typeof item.displayName === 'string') return item.displayName;
            if (item.displayName && typeof item.displayName.text === 'string') return item.displayName.text;
            return '';
        } catch (e) {
            return '';
        }
    }
}

/* ---------- main loop and AH logic (visszaállított delay-ek) ---------- */

let running = true;
function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

// helper: count totems in player inventory (immediate, faster than checking AH)
function countTotemsInInventory() {
  try {
    if (!bot || !bot.inventory) return 0;
    const items = bot.inventory.items();
    return items.reduce((acc, i) => {
      if (!i) return acc;
      const name = (i.name || '').toString().toLowerCase();
      const disp = (i.displayName && typeof i.displayName === 'string') ? i.displayName.toLowerCase() :
                   (i.displayName && i.displayName.text) ? i.displayName.text.toLowerCase() : '';
      if (name.includes('totem') || disp.includes('totem')) return acc + i.count;
      return acc;
    }, 0);
  } catch (e) {
    return 0;
  }
}

async function mainLoop() {
  console.log("Main loop inicializálása...");

  await delay(1000);
  try {
    console.log("Indítom: tpToAFK()");
    tpToAFK();
  } catch (e) {
    console.log("Hiba a tpToAFK meghívásakor:", e);
  }

  await delay(10000);

  let totem_in_inventory_before = 0;
  try {
    totem_in_inventory_before = await deletItemsFromAH().catch(e => {
      console.log("Kézdeti deletItemsFromAH hiba:", e && e.message);
      return 0;
    });
  } catch (e) {
    totem_in_inventory_before = 0;
  }

  let sold_totem = 0;

  while (running) {
    console.log("Wait 1 sec...");
    await delay(1000);

    console.log("Check totem price...");
    const result = await queryAhTotem();
    let price = result.price;
    let seller = result.seller;

    if (price === null || (typeof price === 'undefined')) {
      console.log("queryAhTotem nem adott vissza érvényes árat.");
      continue;
    }

    if (seller === bot.username) {
      console.log(`\x1b[32mWe are the sellers for: ${bot.username}\x1b[0m`);
      continue;
    }

    console.log("We are not the seller of the cheapest totem so let's buy one from the shop and sell it if profitable.");

    if (price !== null && price >= 1520 && seller !== bot.username) {
      // First attempt to clear any AH-listed totems we might have, and count
      let currentAHTotems = 0;
      try {
        currentAHTotems = await deletItemsFromAH().catch(e => {
          console.log("Hiba deletItemsFromAH közben (kétséges):", e && e.message);
          return 0;
        });
      } catch (e) {
        currentAHTotems = 0;
      }

      // If we have none in AH/processable, try to buy from shop
      if (currentAHTotems === 0) {
        await buyTotem();
        // Wait a bit for the item to reach inventory (server may need time)
        await delay(2000);
      }

      // Count the actual totems in inventory now
      const invTotems = countTotemsInInventory();
      console.log("Totemek a bot inventárjában:", invTotems);

      if (invTotems === 0) {
        console.log("Nincs totem az inventárban a vásárlás után sem, kihagyom az hirdetést.");
      } else {
        const sellPrice = Math.max(0, price - 10);
        console.log(`Eladási ár beállítva: ${sellPrice}`);

        const advOk = await advertiseTotem(sellPrice);
        if (advOk) {
          sold_totem += 1;
          // update local counters
          totem_in_inventory_before = Math.max(0, invTotems - 1);
          console.log("Hirdetés sikeres, növeltem az eladott számlálót.");
        } else {
          console.log("Hirdetés sikertelen, nem növelem az eladott számlálót.");
        }

        console.log(`eladott összesen: ${sold_totem}`);
        console.log(`inventoryban (becsült): ${totem_in_inventory_before}`);
        console.log("Hirdetés eredménye:", advOk);
      }
    } else {
      console.log("Nem kaptam érvényes vagy elég magas árat a lekérdezésből, nem hirdetek.");
    }
  }
}

/* tpToAFK (unchanged) */
function tpToAFK() {
    let afkNumber = 1;
    let waitingForResponse = false;

    function sendAfkCommand() {
        const cmd = `/afk ${afkNumber}`;
        if (bot && bot.username) console.log(`${bot.username}: ${cmd}`);
        else console.log(cmd);
        try { bot.chat(cmd); } catch (e) { /* ignore chat failure */ }

        waitingForResponse = true;
    }

    function nextAfk() {
        afkNumber++;
        if (afkNumber > 64) {
            console.log("All servers full, restart from 1");
            afkNumber = 1;
        }
        sendAfkCommand();
    }

    function startListening() {
        bot.on('message', (msg) => {
            const text = msg.toString().toLowerCase();

            if (text.includes("unfortunately")) {
                console.log(`AFK ${afkNumber} is full!`);
                nextAfk();
                return;
            }
        });

        setInterval(() => {
            if (waitingForResponse) {
                console.log(`Teleport request sent to: afk ${afkNumber}`);

                waitingForResponse = false;

                setTimeout(() => {
                    try {
                      const pos = bot.entity && bot.entity.position;
                      if (pos) {
                        console.log(`Location: X=${pos.x.toFixed(2)}, Y=${pos.y.toFixed(2)}, Z=${pos.z.toFixed(2)}`);
                      } else {
                        console.log("No entity position available yet.");
                      }
                    } catch (e) {
                      console.log("tpToAFK: error getting position:", e);
                    }
                }, 10000);
            }
        }, 300);
    }

    startListening();
    sendAfkCommand();
}

/* cleanup and start */
process.on('SIGINT', () => {
  console.log("SIGINT fogva: leállítom a main loop-ot és kilépek.");
  running = false;
  try { bot.quit(); } catch (e) {}
  process.exit();
});

// Start the first bot instance
createAndStartBot();