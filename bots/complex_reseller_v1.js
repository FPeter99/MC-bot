/* my_complex_reseller.js — updated shopBuyTotemFlow to fix "no totem found in inventory" issue

Problem found:
- shopBuyTotemFlow used an internal `step` variable that was set to a finished state after the first purchase.
- Subsequent calls that only did `bot.chat('/shop')` (from buyTotem) did NOT reset that internal `step`, so the windowOpen handler ignored later shop openings and no purchase attempts happened — hence "no totem found in inventory".

Fix:
- Promote `step` to a module-level `shopStep` so buyTotem can set shopStep = 1 before sending '/shop'.
- shopBuyTotemFlow only installs the window handler once and uses shopStep for control flow; after a purchase attempt the handler resets shopStep to 0 so future purchases can start fresh.
- Added some defensive timeouts and extra debug logs.

Other small improvements:
- Slightly improved detection heuristics and ensured step resets on errors/timeouts.
*/

const mineflayer = require('mineflayer');

const bot = mineflayer.createBot({
  auth: 'microsoft',
  host: 'donutsmp.net',
  port: 25565,
  username: '2018.fpeti@gmail.com',
  version: '1.20.2'
});

/* ---------- helpers (unchanged) ---------- */

function formatAHPrice(price) {
  const p = Math.round(Number(price) || 0);
  if (p >= 1000) {
    if (p % 1000 === 0) return (p / 1000) + "K";
    return (Math.round((p / 1000) * 100) / 100).toFixed(2) + "K";
  }
  return String(p);
}

function isSlotInHotbar(slotIndex) {
  return typeof slotIndex === 'number' && slotIndex >= 36 && slotIndex <= 44;
}
function findTotemInInventory(botInstance) {
  return botInstance.inventory.items().find(i => i.name === 'totem_of_undying') || null;
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

/* price parsing used by queryAhTotem */
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

/* ---------- AH query and advertise (unchanged from last iteration) ---------- */

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
        const slot = window.slots[0];
        if (!slot) {
          console.log("queryAhTotem: slot 0 missing in AH window.");
          clearTimeout(timeout);
          cleanup();
          resolve({ price: null, seller: null });
          return;
        }

        const loreRaw = slot.nbt?.value?.display?.value?.Lore?.value?.value;
        if (!loreRaw || !Array.isArray(loreRaw)) {
          console.log("queryAhTotem: Lore empty or not available.");
          clearTimeout(timeout);
          cleanup();
          resolve({ price: null, seller: null });
          return;
        }

        let price = null;
        let seller = null;
        for (const line of loreRaw) {
          try {
            const obj = JSON.parse(line);
            if (Array.isArray(obj.extra)) {
              for (let i = 0; i < obj.extra.length; i++) {
                const part = obj.extra[i];
                if (part.text === "Price: " && obj.extra[i + 1]?.text) {
                  price = parsePriceLocal(obj.extra[i + 1].text);
                }
                if (part.text === "Seller: " && obj.extra[i + 1]?.text) {
                  seller = obj.extra[i + 1].text;
                }
              }
            }
          } catch (err) {
            // not JSON, skip
          }
        }

        clearTimeout(timeout);
        cleanup();
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
            (typeof item.displayName === "string" && item.displayName.toLowerCase().includes("totem of undying")) ||
            (typeof item.displayName === "object" && item.displayName.text && item.displayName.text.toLowerCase().includes("totem of undying"))
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

              window2.slots.forEach((item, i) => {
                if (item) {
                  console.log(`advertiseTotem: SecondWindow Slot ${i}:`, item.name, "displayName:", item.displayName);
                }
              });
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

    // we need named secondWindowHandler for cleanupAll to reference; declare a no-op and override later as needed
    let secondWindowHandler = () => {};
    bot.once('windowOpen', firstWindowHandler);

    try {
      bot.chat(`/ah sell ${priceStr}`);
      console.log("Parancs elküldve: /ah sell", priceStr);
    } catch (e) {
      console.log("advertiseTotem: failed to send chat command:", e);
      cleanupAll();
      resolve(false);
    }
  });
}

/* ---------- shop buy flow: FIXED ---------- */

/*
  Previous bug: local `step` persisted after first successful buy which made later
  calls to bot.chat('/shop') ineffective because the windowOpen handler ignored them.
  Fix: move `step` to module-level `shopStep`, provide buyTotem to set shopStep = 1
  immediately before sending /shop. Reset shopStep on completion/error.
*/

let shopFlowInitialized = false;
let shopStep = 0; // 0 = idle, 1 = waiting for initial shop window -> click GEAR, 2 = waiting for totem slot, 3 = waiting for confirm

function shopBuyTotemFlow(bot) {
  if (shopFlowInitialized) return;
  shopFlowInitialized = true;

  // safety timer to reset step if something goes wrong
  let lastActionTimestamp = Date.now();

  function resetShopStep() {
    shopStep = 0;
  }

  // watch window opens and act based on current shopStep
  bot.on('windowOpen', (window) => {
    // update timestamp to avoid resetting mid-flow
    lastActionTimestamp = Date.now();

    try {
      // DEBUG: print small summary of window title if available
      try {
        if (window.title) {
          console.log("shopBuyTotemFlow: window title:", window.title);
        }
      } catch (e) {}

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
          try { bot.clickWindow(gearIdx, 0, 0); } catch (e) { console.log("shopBuyTotemFlow: click error on GEAR:", e); }
          shopStep = 2;
          return;
        }

        // fallback debug + leave step unchanged so next shop open can try again
        window.slots.forEach((item, i) => {
          if (item) console.log(`Slot ${i}:`, item.name, "displayName:", item.displayName);
        });
        console.log("shopBuyTotemFlow: GEAR slot not found in step 1.");
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
          try { bot.clickWindow(totemIdx, 0, 0); } catch (e) { console.log("shopBuyTotemFlow: click error on Totem:", e); }
          shopStep = 3;
          return;
        }

        window.slots.forEach((item, i) => {
          if (item) console.log(`Slot ${i}:`, item.name, "displayName:", item.displayName);
        });
        console.log("shopBuyTotemFlow: Totem of Undying not found in step 2.");
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
          try { bot.clickWindow(confirmIdx, 0, 0); } catch (e) { console.log("shopBuyTotemFlow: click error on Confirm:", e); }
          // assume purchase attempted; reset step to idle to allow future purchases
          shopStep = 0;
          console.log("Totem vásárlás próbálva!");
          console.log("Sikeres vásárlás (feltételezve)!");
          return;
        }

        window.slots.forEach((item, i) => {
          if (item) console.log(`Slot ${i}:`, item.name, "displayName:", item.displayName);
        });
        console.log("shopBuyTotemFlow: Confirm pane not found in step 3.");
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

/* ---------- main loop and AH logic (unchanged) ---------- */

let running = true;
function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function mainLoop() {
  console.log("Main loop inicializálása...");

  await delay(1000);
  try {
    console.log("Indítom: tpToAFK()");
    tpToAFK();
  } catch (e) {
    console.log("Hiba a tpToAFK meghívásakor:", e);
  }

  await delay(2000);
  console.log("Megpróbálok venni egy totemet a shopból...");
  await buyTotem();

  console.log("Első AH lekérdezés (totem)...");
  let { price, seller } = await queryAhTotem();

  if (price !== null && price >= 1520 && seller !== bot.username) {
    console.log(`Feltétel teljesül (price=${price} >= 1520 és seller=${seller} != ${bot.username}), hirdetem a totemet.`);
    await advertiseTotem(price);
  } else {
    console.log(`Nem hirdetek: price=${price}, seller=${seller}, bot=${bot.username}`);
  }

  while (running) {
    console.log("Várakozás 5 mp előtt...");
    await delay(5000);

    console.log("Új AH lekérdezés (totem)...");
    const result = await queryAhTotem();
    price = result.price;
    seller = result.seller;

    if (seller === bot.username) {
      console.log(`A totem jelenlegi eladója te vagy (seller == ${bot.username}). Nem csinálok semmit további 5 mp-ig.`);
      await delay(5000);
      continue;
    }

    console.log(`A totem eladója nem te vagy (seller=${seller}), újraindítom a folyamatot: veszek egy totemet és hirdetem a megadott price (${price}).`);
    await buyTotem();

    if (price !== null) {
      console.log(`Hirdetés indítása a lekérdezett árral: ${price}`);
      const advOk = await advertiseTotem(price);
      console.log("Hirdetés eredménye:", advOk);
    } else {
      console.log("Nem kaptam érvényes árat a lekérdezésből, nem hirdetek.");
    }
  }
}

/* tpToAFK (unchanged) */
function tpToAFK() {
    let afkNumber = 1;
    let waitingForResponse = false;

    function sendAfkCommand() {
        const cmd = `/afk ${afkNumber}`;
        console.log(`${bot.username}: ${cmd}`);
        bot.chat(cmd);

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
                    const pos = bot.entity.position;
                    console.log(`Location: X=${pos.x.toFixed(2)}, Y=${pos.y.toFixed(2)}, Z=${pos.z.toFixed(2)}`);
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

bot.once('spawn', () => {
  console.log("Bot spawnolva — elindítom a fő logikát.");
  mainLoop().catch(err => {
    console.log("mainLoop hiba:", err);
  });
});