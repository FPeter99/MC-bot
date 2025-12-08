const mineflayer = require('mineflayer');

const bot = mineflayer.createBot({
  auth: 'microsoft',
  host: 'donutsmp.net',
  port: 25565,
  username: 'email@gmail.com',
  version: '1.20.2'
});

const stoppLoss = "10K"; //set stopploss

function errLog(...parts) {
  try {
    console.error('\x1b[31m%s\x1b[0m', parts.join(' '));
  } catch (e) {
    console.error(parts.join(' '));
  }
}

function blueLog(...parts) {
  try {
    console.log('\x1b[34m%s\x1b[0m', parts.join(' '));
  } catch (e) {
    console.log(parts.join(' '));
  }
}

function greenLog(...parts) {
  try {
    console.log('\x1b[32m%s\x1b[0m', parts.join(' '));
  } catch (e) {
    console.log(parts.join(' '));
  }
}

function delay(ms) { return new Promise(res => setTimeout(res, ms)); }

// Simple global lock so only one "open window and wait" runs at a time
let _windowLock = false;
async function withWindow(command, timeoutMs = 10000) {
  // wait for lock
  while (_windowLock) await delay(50);
  _windowLock = true;
  try {
    return await new Promise((resolve) => {
      let done = false;
      const to = setTimeout(() => {
        if (done) return;
        done = true;
        try { bot.removeListener('windowOpen', onWin); } catch (e) {}
        resolve(null);
      }, timeoutMs);
      function onWin(w) {
        if (done) return;
        done = true;
        clearTimeout(to);
        try { bot.removeListener('windowOpen', onWin); } catch (e) {}
        resolve(w);
      }
      bot.once('windowOpen', onWin);
      try {
        bot.chat(command);
      } catch (e) {
        clearTimeout(to);
        try { bot.removeListener('windowOpen', onWin); } catch (er) {}
        resolve(null);
      }
    });
  } finally {
    _windowLock = false;
  }
}

// Wait for next windowOpen without sending any command (used for chained GUIs)
function waitForWindowOnly(timeoutMs = 10000) {
  return new Promise((resolve) => {
    let done = false;
    const to = setTimeout(() => {
      if (done) return;
      done = true;
      try { bot.removeListener('windowOpen', handler); } catch (e) {}
      resolve(null);
    }, timeoutMs);
    function handler(w) {
      if (done) return;
      done = true;
      clearTimeout(to);
      try { bot.removeListener('windowOpen', handler); } catch (e) {}
      resolve(w);
    }
    bot.once('windowOpen', handler);
  });
}

//retrun int, the number of totems in inventory
function countTotemsInInventory() {
  try {
    if (!bot || !bot.inventory) return 0;
    const items = bot.inventory.items();
    return items.reduce((acc, i) => {
      if (!i) return acc;
      const name = (i.name || '').toString().toLowerCase();
      const disp = (i.displayName && typeof i.displayName === 'string') ? i.displayName.toLowerCase() :
                   (i.displayName && i.displayName.text) ? String(i.displayName.text).toLowerCase() : '';
      if (name.includes('totem') || disp.includes('totem')) return acc + i.count;
      return acc;
    }, 0);
  } catch (e) {
    return 0;
  }
}

function formatAHPrice(rawPrice) {
    const pRaw = Number(rawPrice) || 0;
    const p = Math.round(pRaw);

    if (p >= 1000000000) { // Billions
      if (p % 1000000000 === 0) return (p / 1000000000) + "B";
      return (Math.round((p / 1000000000) * 100) / 100).toFixed(2) + "B";
    }

    if (p >= 1000000) { // Millions
      if (p % 1000000 === 0) return (p / 1000000) + "M";
      return (Math.round((p / 1000000) * 100) / 100).toFixed(2) + "M";
    }

    if (p >= 1000) { // Thousands
      if (p % 1000 === 0) return (p / 1000) + "K";
      return (Math.round((p / 1000) * 100) / 100).toFixed(2) + "K";
    }

    return String(p);
}

function parsePrice(priceStr) {
    if (!priceStr) return null;
    let num = String(priceStr).replace('$', '').replace(/,/g, '').toUpperCase().trim();
    if (num.endsWith('K')) {
      return Math.round(parseFloat(num) * 1000);
    }else if(num.endsWith('M')){
      return Math.round(parseFloat(num) * 1000000);
    }else if(num.endsWith('B')){
      return Math.round(parseFloat(num) * 1000000000);
    }
    const n = parseFloat(num);
    return Number.isFinite(n) ? Math.round(n) : null;
}


//---------------------------------------
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
        errLog("advertiseTotem: neither confirm nor totem slot found in first window.");
      } catch (e) {
        errLog("advertiseTotem: error processing first windowOpen:", e);
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
      errLog("advertiseTotem: failed to send chat command:", e);
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
            errLog("ensureTotemInHand: Failed to move totem to hotbar:", err);
            return resolve(false);
          }
          try { botInstance.setQuickBarSlot(0); } catch (e) {}
          setTimeout(() => resolve(true), 600);
        });
      } catch (e) {
        errLog("ensureTotemInHand: moveItem exception:", e);
        resolve(false);
      }
    });
  }
}
//---------------------------------------


async function checkCheapestTotemPriceAndSeller() {

  function extractPriceAndSellerFromLore(loreRaw) {
    let price = null;
    let seller = null;
    if (!Array.isArray(loreRaw)) return { price: null, seller: null };

    for (const line of loreRaw) {
      try {
        const obj = JSON.parse(line);
        if (Array.isArray(obj.extra)) {
          for (let i = 0; i < obj.extra.length; i++) {
            const part = obj.extra[i];
            if (part.text === "Price: " && obj.extra[i + 1]?.text) {
              price = parsePrice(obj.extra[i + 1].text);
            }
            if (part.text === "Seller: " && obj.extra[i + 1]?.text) {
              seller = obj.extra[i + 1].text;
            }
          }
        }
      } catch (err) {
        // not JSON: ignore, continue
      }
    }
    return { price, seller };
  }

  try {
    // Use withWindow to send /ah totem and await the window (serialized)
    const window = await withWindow('/ah totem', 8000);
    if (!window) {
      errLog('checkCheapestTotemPriceAndSeller: windowOpen did not arrive in time.');
      return null;
    }

    // original logic used slot 0. Keep that behaviour but guard against missing slot.
    const slot = window.slots && window.slots[0];
    if (!slot || slot.name !== "totem_of_undying") {
      errLog("checkCheapestTotemPriceAndSeller: No totem at the first slot");
      return null;
    }

    const loreRaw = slot.nbt?.value?.display?.value?.Lore?.value?.value;
    if (!loreRaw || !Array.isArray(loreRaw)) {
      errLog("checkCheapestTotemPriceAndSeller: No Lore");
      return null;
    }

    const { price, seller } = extractPriceAndSellerFromLore(loreRaw);
    return { price: price !== null ? price : null, seller: seller !== null ? seller : null };
  } catch (e) {
    errLog('checkCheapestTotemPriceAndSeller: unexpected error:', e && e.stack ? e.stack : e);
    return null;
  }
}

function tpToAFK() {
    let afkNumber = 1;
    let waitingForResponse = false;

    function sendAfkCommand() {
        const cmd = `/afk ${afkNumber}`;
        blueLog(`teleporting to: AFK ${cmd}`);
        bot.chat(cmd);

        waitingForResponse = true;
    }

    function nextAfk() {
        afkNumber++;
        if (afkNumber > 64) {
            blueLog("All servers full, restart from 1");
            afkNumber = 1;
        }
        sendAfkCommand();
    }

    function startListening() {
        bot.on('message', (msg) => {
            const text = msg.toString().toLowerCase();
            if (text.includes("unfortunately")) {
                blueLog(`AFK ${afkNumber} is full!`);
                nextAfk();
                return;
            }
        });

    }

 
    startListening();
    sendAfkCommand();
    
}

function buyTotemFromShop() {
    // Convert the existing event-driven logic into a Promise that resolves true on success, false on fail/timeout
    return new Promise(async (resolve) => {
        let step = 0;
        let cleaned = false;

        function cleanup() {
            if (cleaned) return;
            cleaned = true;
            try { bot.removeListener('windowOpen', onWindowOpen); } catch (e) {}
        }

        async function onWindowOpen(window) {
            // not used - kept for safety if any stray listener exists
        }

        try {
            // 1) open /shop and wait for first window (serialized via withWindow)
            const firstWin = await withWindow('/shop', 20000);
            if (!firstWin) {
                errLog('buyTotemFromShop: initial shop window did not open in time');
                cleanup();
                return resolve(false);
            }
            step = 1;

            // step 1: click gear / category if present
            const gearIdx = (firstWin.slots || []).findIndex(item =>
                item &&
                (
                    item.name === "totem_of_undying" ||
                    (typeof item.displayName === "string" && item.displayName.toUpperCase().includes("GEAR")) ||
                    (typeof item.displayName === "object" && item.displayName.text && item.displayName.text.toUpperCase().includes("GEAR"))
                )
            );
            if (gearIdx !== -1) {
                try { bot.clickWindow(gearIdx, 0, 0); } catch (e) {}
            } else {
                // If the shop UI goes directly to items, we still proceed.
            }

            // wait for next window which should contain the totem button/list
            const secondWin = await waitForWindowOnly(10000);
            if (!secondWin) {
                errLog('buyTotemFromShop: second shop window did not open or timed out');
                cleanup();
                return resolve(false);
            }
            step = 2;

            // find totem in secondWin
            const totemIdx = (secondWin.slots || []).findIndex(item =>
                item &&
                (
                    item.name === "totem_of_undying" ||
                    (typeof item.displayName === "string" && item.displayName.toLowerCase().includes("totem of undying")) ||
                    (typeof item.displayName === "object" && item.displayName.text && item.displayName.text.toLowerCase().includes("totem of undying"))
                )
            );
            if (totemIdx === -1) {
                // debug: show some slots
                (secondWin.slots || []).forEach((item, i) => {
                    if (item) console.log(`Slot ${i}:`, item.name, "displayName:", item.displayName);
                });
                errLog("buyTotemFromShop: Totem of Undying not found in second window");
                cleanup();
                return resolve(false);
            }
            try { bot.clickWindow(totemIdx, 0, 0); } catch (e) {}

            // wait for confirmation window
            const confirmWin = await waitForWindowOnly(10000);
            if (!confirmWin) {
                errLog('buyTotemFromShop: confirm window did not open or timed out');
                cleanup();
                return resolve(false);
            }
            step = 3;

            const confirmIdx = (confirmWin.slots || []).findIndex(item =>
                item &&
                (
                    item.name === "lime_stained_glass_pane" ||
                    (typeof item.displayName === "string" && item.displayName.toLowerCase().includes("confirm")) ||
                    (typeof item.displayName === "object" && item.displayName.text && item.displayName.text.toLowerCase().includes("confirm"))
                )
            );
            if (confirmIdx === -1) {
                errLog('buyTotemFromShop: confirm button not found in confirm window');
                cleanup();
                return resolve(false);
            }
            try {
                bot.clickWindow(confirmIdx, 0, 0);
            } catch (e) {
                errLog('buyTotemFromShop: failed to click confirm', e && e.stack ? e.stack : e);
                cleanup();
                return resolve(false);
            }

            // success
            console.log("Totem bought succesfully");
            cleanup();
            return resolve(true);
        } catch (e) {
            errLog('buyTotemFromShop: unexpected error', e && e.stack ? e.stack : e);
            cleanup();
            return resolve(false);
        }
    });
}

async function buyTotemFromAH() {
  // returns true if purchased, false otherwise
  try {
    // Preconditions
    const currentTotems = countTotemsInInventory();
    if (currentTotems >= 20) {
      errLog('buyTotemFromAH: inventory already has 20 or more totems');
      return false;
    }

    // 1) Check cheapest totem price via existing helper
    const info = await checkCheapestTotemPriceAndSeller();
    if (!info) {
      errLog('buyTotemFromAH: could not get cheapest totem info');
      return false;
    }
    if (info.price === null) {
      errLog('buyTotemFromAH: price not found in AH lore');
      return false;
    }
    if (info.price >= 1500) {
      // too expensive
      console.log(`buyTotemFromAH: cheapest totem is ${info.price} (>=1500), not buying`);
      return false;
    }

    // At this point price < 1500 and we should attempt to buy.
    // We'll open AH again and click the slot whose lore contains that price (best effort).
    // Helper to find slot matching the numeric price inside the window
    function findSlotIndexByPrice(window, targetPrice) {
      const slots = window.slots || [];
      for (let i = 0; i < slots.length; i++) {
        const s = slots[i];
        if (!s) continue;
        // try to extract lore array (same path used elsewhere)
        const loreRaw = s.nbt?.value?.display?.value?.Lore?.value?.value ||
                        s.nbt?.value?.display?.value?.Lore?.value ||
                        null;
        if (!loreRaw) continue;
        // loreRaw might be array of JSON strings; try to parse each and look for "Price: " pattern
        for (const line of loreRaw) {
          if (!line) continue;
          try {
            const obj = JSON.parse(line);
            if (Array.isArray(obj.extra)) {
              for (let j = 0; j < obj.extra.length; j++) {
                const part = obj.extra[j];
                if (part.text === "Price: " && obj.extra[j + 1]?.text) {
                  const p = parsePrice(obj.extra[j + 1].text);
                  if (p === targetPrice) return i;
                }
              }
            }
          } catch (e) {
            // ignore parse errors
            // try simple textual match as fallback
            const txt = String(line).toLowerCase();
            if (txt.includes('price') && txt.includes(String(targetPrice))) return i;
          }
        }
      }
      return -1;
    }

    // Open AH and wait for the window to appear, then click the found slot
    const firstWindow = await withWindow('/ah totem', 8000);
    if (!firstWindow) return false;

    // find slot by matching price; fallback to slot 0 if not found
    let slotIdx = findSlotIndexByPrice(firstWindow, info.price);
    if (slotIdx === -1) {
      // fallback: try slot 0 if it looks like a totem
      if (firstWindow.slots && firstWindow.slots[0] && firstWindow.slots[0].name === 'totem_of_undying') {
        slotIdx = 0;
      } else {
        errLog('buyTotemFromAH: could not find slot with matching price and slot0 is not totem');
        return false;
      }
    }

    // Click the slot to attempt purchase (left click, window button 0)
    try {
      bot.clickWindow(slotIdx, 0, 0);
    } catch (e) {
      errLog('buyTotemFromAH: clickWindow error on item slot:', (e && e.stack) ? e.stack : e);
      return false;
    }

    // After clicking, wait for the confirmation window (open again) and click confirm
    const waitForConfirm = () => new Promise((resolve) => {
      let finished = false;
      const timeout = setTimeout(() => {
        if (finished) return;
        finished = true;
        try { bot.removeListener('windowOpen', onConfirmWin); } catch (e) {}
        errLog('buyTotemFromAH: confirm window did not appear in time');
        resolve(false);
      }, 8000);

      async function onConfirmWin(window) {
        if (finished) return;
        // find confirm slot
        try {
          const confirmIdx = window.slots.findIndex(item =>
            item &&
            (
              item.name === "lime_stained_glass_pane" ||
              (typeof item.displayName === "string" && item.displayName.toLowerCase().includes("confirm")) ||
              (typeof item.displayName === "object" && item.displayName.text && item.displayName.text.toLowerCase().includes("confirm"))
            )
          );

          if (confirmIdx === -1) {
            // debug: show some slots in error
            const few = [];
            window.slots.forEach((it, i) => {
              if (it && few.length < 8) {
                const dn = (typeof it.displayName === 'string') ? it.displayName :
                           (it.displayName && it.displayName.text) ? String(it.displayName.text) : '';
                few.push(`Slot${i}:${it.name}(${dn})`);
              }
            });
            errLog('buyTotemFromAH: Confirm pane not found in confirm window. slots:', few.join(' | '));
            clearTimeout(timeout);
            finished = true;
            try { bot.removeListener('windowOpen', onConfirmWin); } catch (e) {}
            return resolve(false);
          }

          // click confirm
          try {
            bot.clickWindow(confirmIdx, 0, 0);
          } catch (e) {
            errLog('buyTotemFromAH: clickWindow error on confirm:', (e && e.stack) ? e.stack : e);
            clearTimeout(timeout);
            finished = true;
            try { bot.removeListener('windowOpen', onConfirmWin); } catch (e) {}
            return resolve(false);
          }

          clearTimeout(timeout);
          finished = true;
          try { bot.removeListener('windowOpen', onConfirmWin); } catch (e) {}
          // small delay for server processing
          await delay(400);
          // success
          resolve(true);
        } catch (e) {
          errLog('buyTotemFromAH: error processing confirm window:', (e && e.stack) ? e.stack : e);
          clearTimeout(timeout);
          finished = true;
          try { bot.removeListener('windowOpen', onConfirmWin); } catch (e) {}
          resolve(false);
        }
      }

      bot.once('windowOpen', onConfirmWin);
    });

    const bought = await waitForConfirm();
    if (!bought) {
      errLog('buyTotemFromAH: purchase sequence failed');
      return false;
    }

    // Optionally verify inventory increased by 1 (not strictly required)
    await delay(300);
    return true;

  } catch (e) {
    errLog('buyTotemFromAH: unexpected error:', (e && e.stack) ? e.stack : e);
    return false;
  }
}

async function deletTotemsFromAh() {
  function getDisplayNameText(item) {
    try {
      if (!item) return '';
      if (typeof item.displayName === 'string') return item.displayName;
      if (item.displayName && typeof item.displayName.text === 'string') return item.displayName.text;
      return '';
    } catch (e) { return ''; }
  }

  function isTotemItem(item) {
    if (!item) return false;
    const name = (item.name || '').toString().toLowerCase();
    const disp = getDisplayNameText(item).toLowerCase();
    return name === 'minecraft:totem_of_undying' || name === 'totem_of_undying' || disp.includes('totem');
  }

  try {
    // 1) open AH (use withWindow to serialize)
    const win = await withWindow('/ah', 12000);
    if (!win) {
      errLog('deletTotemsFromAh: AH window did not open in time');
      return;
    }
    let window = bot.currentWindow || win || null;
    if (!window) {
      errLog('deletTotemsFromAh: no window object after /ah');
      return;
    }

    // 2) click chest / Your Items if needed
    const title = String(window.title || '').toLowerCase();
    const isYourItemsTitle = title.includes('your items') || title.includes('youritems');
    if (!isYourItemsTitle) {
      const chestIdx = (window.slots || []).findIndex((item) => {
        if (!item) return false;
        const name = (item.name || '').toString().toLowerCase();
        const disp = getDisplayNameText(item).toLowerCase();
        return name === 'minecraft:chest' || name === 'chest' ||
               disp.includes('your items') || disp.includes('youritems') || disp.includes('your items:');
      });
      if (chestIdx === -1) {
        errLog('deletTotemsFromAh: no chest/your items button found in AH window');
        return;
      }
      try { bot.clickWindow(chestIdx, 0, 0); } catch (e) {
        errLog('deletTotemsFromAh: click chest button failed', e && e.stack ? e.stack : e);
        return;
      }
      const winRes2 = await waitForWindowOnly(10000);
      if (!winRes2) {
        errLog('deletTotemsFromAh: your items window did not open in time');
        return;
      }
      window = bot.currentWindow || winRes2 || null;
      if (!window) {
        errLog('deletTotemsFromAh: no window object after opening Your Items');
        return;
      }
    }

    // 3) main loop: click slot 0, then wait exactly 300ms, then check slot 0 / confirm
    const overallTimeoutMs = 2 * 60 * 1000; // safety cap
    const startTime = Date.now();

    while (Date.now() - startTime < overallTimeoutMs) {
      const cw = bot.currentWindow;
      if (!cw) break;

      const slot0 = (cw.slots && cw.slots[0]) || null;
      if (!isTotemItem(slot0)) break; // done

      // click slot 0 (left preferred, fallback to right)
      try {
        bot.clickWindow(0, 0, 0);
      } catch (e) {
        try { bot.clickWindow(0, 1, 0); } catch (e2) {
          errLog('deletTotemsFromAh: click failed on slot 0:', e2 && e2.stack ? e2.stack : e2);
          // still respect the single delay requested
          await delay(300);
          continue;
        }
      }

      // single delay point as requested
      await delay(300);

      // after the 300ms pause: re-check current window/slot0
      const curWin = bot.currentWindow;
      // if a confirm pane exists, click it (confirm index detection)
      const confirmIdx = (curWin && curWin.slots) ? curWin.slots.findIndex(it => {
        if (!it) return false;
        const name = (it.name || '').toString().toLowerCase();
        const dn = getDisplayNameText(it).toLowerCase();
        return name === 'lime_stained_glass_pane' || dn.includes('confirm');
      }) : -1;
      if (confirmIdx !== -1) {
        try {
          bot.clickWindow(confirmIdx, 0, 0);
        } catch (e) {
          errLog('deletTotemsFromAh: confirm click failed', e && e.stack ? e.stack : e);
        }
        // after pressing confirm immediately continue the loop (the single delay was already consumed)
        continue;
      }

      // otherwise loop will re-evaluate slot0 and click again if still a totem
    }

    // final cleanup: close window if open
    try { if (bot.currentWindow) bot.closeWindow(bot.currentWindow); } catch (e) {}
    return;
  } catch (err) {
    errLog('deletTotemsFromAh: unexpected error:', err && err.stack ? err.stack : err);
    return;
  }
}

async function getBalance(timeoutMs = 8000) {
  function parsePrice(priceStr) {
    if (!priceStr) return null;
    let num = String(priceStr).replace('$', '').replace(/,/g, '').toUpperCase().trim();
    if (num.endsWith('K')) {
      return Math.round(parseFloat(num) * 1000);
    } else if (num.endsWith('M')) {
      return Math.round(parseFloat(num) * 1000000);
    } else if (num.endsWith('B')) {
      return Math.round(parseFloat(num) * 1000000000);
    }
    const n = parseFloat(num);
    return Number.isFinite(n) ? Math.round(n) : null;
  }

  return new Promise((resolve) => {
    let finished = false;

    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      try { bot.removeListener('message', onMessage); } catch (e) {}
      resolve(null);
    }, timeoutMs);

    const onMessage = (msg) => {
      if (finished) return;
      try {
        const text = (msg && msg.toString) ? msg.toString() : String(msg);
        // Primary pattern: "You have $4.3M."
        const m = text.match(/you have\s+\$?([0-9.,]+(?:[kKmMbB])?)/i);
        if (m && m[1]) {
          const parsed = parsePrice(m[1]);
          finished = true;
          clearTimeout(timer);
          try { bot.removeListener('message', onMessage); } catch (e) {}
          return resolve(parsed);
        }
        // Fallback: any "$..." with nearby "you have"
        const m2 = text.match(/\$([0-9.,]+(?:[kKmMbB])?)/);
        if (m2 && m2[1] && text.toLowerCase().includes('you have')) {
          const parsed = parsePrice(m2[1]);
          finished = true;
          clearTimeout(timer);
          try { bot.removeListener('message', onMessage); } catch (e) {}
          return resolve(parsed);
        }
      } catch (e) {
        // ignore and continue until timeout
      }
    };

    try {
      bot.on('message', onMessage);
    } catch (e) {
      clearTimeout(timer);
      return resolve(null);
    }

    try {
      bot.chat('/money');
    } catch (e) {
      clearTimeout(timer);
      try { bot.removeListener('message', onMessage); } catch (er) {}
      return resolve(null);
    }
  });
}





async function main(){

    /*setup*/

  await delay(500);

  blueLog(`${bot.username} enter the server`);


  //  to to afk
  setTimeout(() => {tpToAFK();}, 1000);
  await delay(6000);
  blueLog(`teleport finished`)

  //  get balacne and print out it
  var balance = await getBalance();
  //await delay(100);
  await delay(1000);
  greenLog("starter balance: ", (formatAHPrice(balance)));

  // starter balance
  const starterBalance = balance;

  //  stopp when balance is <= than stopplossLine
  const stopplossLine = balance - parsePrice(stoppLoss);

  blueLog("stoploss exit at: ", formatAHPrice(stopplossLine));

  //  remove totems from ah
  await deletTotemsFromAh();
  //await delay(100);
  await delay(1000);
  blueLog("totems removed from AH");


  
 
  /*loop*/

  
  greenLog("main loop started");
  // for the stopploss
  var run = true;
  while(run){
    // If disconnected, stop the main loop to avoid spamming operations after kick
    if (!bot.entity) {
      errLog('main loop: bot not connected, exiting loop');
      break;
    }

    // wait 0.5 sec for the next round
    await delay(1000);

    // check the seller and the price of the cheapest totem in AH
    const result = await checkCheapestTotemPriceAndSeller();
    //await delay(300);
    await delay(1000);
    if(result == null){
      // cant get the info
      continue;
    }
    let price = result.price;
    let seller = result.seller;


    // the main if statement
    if (seller === bot.username) {
      // if we selling the cheapes totem, do nothing
      //most of the time this will run
      //console.log(`We are the sellers for: ${bot.username}`);
      continue;
    }
    else if(price !== null && price >= 1520 && seller !== bot.username){
      // if not we selling the cheapest totem and it worth it to bus one for 1.5K sell more
      await deletTotemsFromAh();
      //await delay(100);
      await delay(1000);
      console.log(`the cheapest totem is not ours`);
      console.log("totems removed from AH");

      // count how many totems do we have
      var totemCount = countTotemsInInventory();
      //await delay(100);
      await delay(1000);
      // if iwe have 0 totem
      if (totemCount == 0){
      // buy one from AH
        // buys totem from shop
        const bought = await buyTotemFromShop();
        if (!bought) { errLog('main: buy attempt failed'); await delay(150); continue; }
        //await delay(100);
        await delay(1000);
        console.log("we had 0 totem so I bought 1");
      }
      //now we have totem
      
      // sell one
      var sellOk = await advertiseTotem(price - 10);
      if (!sellOk) {
        // selling err
        errLog('sellOneTotem: failed during sell attempt; stopping further attempts.');
        break;
      }else{
        //await delay(100);
        await delay(1000);
        // succesfull selling
        greenLog("totem succesfully advertised on AH");
        greenLog(`our totem is the cheapest for: ${formatAHPrice(price-10)}`);
      }
      //balance here to dont print it in every 0.5 sec
      balance = await getBalance();
      //await delay(100);
      await delay(1000);
      greenLog(`balance: ${formatAHPrice(balance)}`);
      greenLog(`profit: ${formatAHPrice(balance-starterBalance)}`);
    }/*
    else if(price !== null && price <= 1500 && seller !== bot.username){
      //if there is a totem for less than 1.5K, buy it
      var ok = await buyTotemFromAH();
      if(ok){
        //await delay(100);
        await delay(1000);
        console.log(`totem bought succesfully from ah for: ${price}`);
      }
      //if not succesful
      else{errLog("Did not buy the totem");}
    }*/


    // check price after the main IF
    if(balance <= stopplossLine){
      run = false;
      errLog("stoploss line got hit");

      // stopp the code
    }
  }
}





  //---------------------



// Eventes
bot.on('spawn', () => {
  main().catch(e => errLog('main error:', (e && e.stack) ? e.stack : e));
});

bot.on('error', (err) => {
  errLog(`Bot error: ${err && err.stack ? err.stack : err}`);
});

bot.on('kicked', (reason) => {
  errLog(`Bot was kicked: ${reason}`);
});

bot.on('end', () => {
  errLog('Bot connection ended.');
});

process.on('SIGINT', () => {
  try { bot.quit(); } catch (e) { /* ignore */ }
  process.exit();

});
