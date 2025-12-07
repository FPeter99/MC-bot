# Previous Versions (Short Summary)

This document provides a concise summary of earlier iterations and their main limitations.

## v1 — complex_reseller_v1.js
**Description:**  
The first implementation with basic helper functions (price formatting, totem handling), Auction House queries, and simple advertisement logic.

**Why it wasn't perfect:**
- `windowOpen` event handling was conditional and prone to race conditions. After a single use, the `step` variable could get stuck, causing later `/shop` commands to stop responding correctly.
- Timeout handling was incomplete, which made some GUI cycles freeze.
- Limited debug and fallback output, making troubleshooting more difficult.

---

## v2 — complex_reseller_v2.js
**Description:**  
Improved reconnect/restart logic, automatic reconnection on "client timed out," expanded helper functions, and better inventory-handling heuristics.

**Why it wasn't perfect:**
- Even with the safe restart mechanism, window-locking and sequential window-handling were not yet as robust as in v3. Some race conditions with `windowOpen` events still occurred.
- Several timeout and timing values were under-tuned (too short), causing issues on slower servers.
- Some redundancy and less-refined helper functions increased overall complexity.

---

## Summary
v1 was a rapid prototype.  
v2 introduced substantial stability improvements (reconnects, better state detection), but retained race conditions and incomplete synchronization.  
v3 directly addresses these issues with sequential window-handling, better timeouts, locking mechanisms, and clearer process separation.

> *The “not perfect” phrasing reflects relative comparison between iterations — each version contributed meaningfully to the development process.*
