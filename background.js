let scrolling = false;
let currentSpeed = 1.0;
let currentTabId = null;

// Store state per tab
const tabStates = new Map();

// Get or create tab state
function getTabState(tabId) {
  if (!tabStates.has(tabId)) {
    tabStates.set(tabId, { scrolling: false, speed: 1.0 });
  }
  return tabStates.get(tabId);
}

// Clean up tab state when tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  tabStates.delete(tabId);
});

// Handle messages from popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "TOGGLE_SCROLL") {
    handleToggleScroll(msg.speed || currentSpeed);
    sendResponse({ success: true });
  } else if (msg.type === "UPDATE_SPEED") {
    currentSpeed = msg.speed;
    if (scrolling && currentTabId) {
      updateScrollSpeed(currentTabId, currentSpeed);
    }
    sendResponse({ success: true });
  } else if (msg.type === "GET_STATE") {
    sendResponse({
      isPlaying: scrolling,
      speed: currentSpeed,
    });
  } else if (msg.type === "SCROLL_FINISHED" && sender.tab?.id) {
    const tabId = sender.tab.id;
    const state = getTabState(tabId);
    state.scrolling = false;
    if (tabId === currentTabId) {
      scrolling = false;
      chrome.action.setBadgeText({ text: "", tabId: tabId });
      notifyPopupStateChange(false);
    }
  } else if (msg.type === "MANUAL_SCROLL_DETECTED" && sender.tab?.id) {
    const tabId = sender.tab.id;
    const state = getTabState(tabId);
    if (state.scrolling && tabId === currentTabId) {
      scrolling = false;
      state.scrolling = false;
      chrome.action.setBadgeText({ text: "", tabId: tabId });
      notifyPopupStateChange(false);
    }
  }
  return true; // Keep channel open for async response
});

// Check if URL is a restricted page where scripts cannot be injected
function isRestrictedPage(url) {
  if (!url) return true;
  try {
    const urlObj = new URL(url);
    return (
      urlObj.protocol === "chrome:" ||
      urlObj.protocol === "chrome-extension:" ||
      urlObj.protocol === "edge:" ||
      urlObj.protocol === "about:" ||
      urlObj.hostname === "chrome.google.com" ||
      urlObj.hostname === "chromewebstore.google.com"
    );
  } catch (e) {
    return true; // If URL parsing fails, treat as restricted
  }
}

async function handleToggleScroll(speed) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  // Check if the page is restricted
  if (isRestrictedPage(tab.url)) {
    scrolling = false;
    chrome.action.setBadgeText({ text: "", tabId: tab.id });
    notifyPopupStateChange(false);
    return;
  }

  currentTabId = tab.id;
  const state = getTabState(tab.id);
  currentSpeed = speed;

  if (!scrolling) {
    // Start scrolling
    scrolling = true;
    state.scrolling = true;
    state.speed = speed;

    // Add delay before starting animation (allows popup to close first)
    setTimeout(async () => {
      // Double-check tab is still valid and not restricted
      try {
        const currentTab = await chrome.tabs.get(tab.id);
        if (!currentTab || isRestrictedPage(currentTab.url)) {
          scrolling = false;
          state.scrolling = false;
          chrome.action.setBadgeText({ text: "", tabId: tab.id });
          notifyPopupStateChange(false);
          return;
        }
      } catch (error) {
        // Tab might have been closed
        scrolling = false;
        state.scrolling = false;
        chrome.action.setBadgeText({ text: "", tabId: tab.id });
        notifyPopupStateChange(false);
        return;
      }

      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: (initialSpeedMultiplier) => {
            window.__autoScrollRunning = true;
            window.__autoScrollSpeed = initialSpeedMultiplier;

            let speed = 0; // current speed
            const baseMaxSpeed = 2.5; // base maximum px per frame
            let currentMultiplier = initialSpeedMultiplier;
            let maxSpeed = baseMaxSpeed * currentMultiplier; // scaled max speed
            let accel = 0.05 * currentMultiplier; // acceleration per frame
            let decel = 0.1 * currentMultiplier; // deceleration per frame
            let decelerating = false;
            let lastAutoScrollY = window.scrollY || 0;
            let isProgrammaticScroll = false;
            let userInteractionDetected = false;

            // Stop auto-scroll on user interaction
            function stopAutoScroll() {
              if (window.__autoScrollRunning) {
                window.__autoScrollRunning = false;
                window.removeEventListener("wheel", stopAutoScroll, true);
                window.removeEventListener("touchstart", stopAutoScroll, true);
                window.removeEventListener("touchmove", stopAutoScroll, true);
                window.removeEventListener("keydown", handleKeyDown, true);
                document.removeEventListener("wheel", stopAutoScroll, true);
                document.removeEventListener(
                  "touchstart",
                  stopAutoScroll,
                  true
                );
                document.removeEventListener("touchmove", stopAutoScroll, true);
                document.removeEventListener("keydown", handleKeyDown, true);
                chrome.runtime.sendMessage({ type: "MANUAL_SCROLL_DETECTED" });
              }
            }

            // Handle keyboard scroll keys
            function handleKeyDown(e) {
              // Arrow keys, Page Up/Down, Home/End, Space
              if (
                [
                  "ArrowUp",
                  "ArrowDown",
                  "PageUp",
                  "PageDown",
                  "Home",
                  "End",
                  " ",
                ].includes(e.key) ||
                (e.key === " " && !e.target.isContentEditable)
              ) {
                stopAutoScroll();
              }
            }

            // Listen for user interaction events
            window.addEventListener("wheel", stopAutoScroll, true);
            window.addEventListener("touchstart", stopAutoScroll, true);
            window.addEventListener("touchmove", stopAutoScroll, true);
            window.addEventListener("keydown", handleKeyDown, true);
            document.addEventListener("wheel", stopAutoScroll, true);
            document.addEventListener("touchstart", stopAutoScroll, true);
            document.addEventListener("touchmove", stopAutoScroll, true);
            document.addEventListener("keydown", handleKeyDown, true);

            // Also detect scrollbar dragging
            let lastScrollY = window.scrollY || 0;
            let scrollCheckInterval = setInterval(() => {
              if (!window.__autoScrollRunning) {
                clearInterval(scrollCheckInterval);
                return;
              }

              const currentY = window.scrollY || 0;
              const expectedY = lastAutoScrollY;
              const tolerance = 5; // Allow some tolerance

              // If scroll position changed significantly and it wasn't programmatic, user scrolled
              if (
                Math.abs(currentY - expectedY) > tolerance &&
                !isProgrammaticScroll
              ) {
                // Check if scroll actually changed (not just a measurement delay)
                if (Math.abs(currentY - lastScrollY) > 1) {
                  stopAutoScroll();
                  clearInterval(scrollCheckInterval);
                }
              }

              lastScrollY = currentY;
            }, 50);

            function step() {
              if (!window.__autoScrollRunning) {
                return;
              }

              // Update speed multiplier if changed
              const newMultiplier = window.__autoScrollSpeed;
              if (newMultiplier !== currentMultiplier) {
                const oldMaxSpeed = maxSpeed;
                currentMultiplier = newMultiplier;
                maxSpeed = baseMaxSpeed * currentMultiplier;
                accel = 0.05 * currentMultiplier;
                decel = 0.1 * currentMultiplier;

                // Adjust current speed proportionally
                if (oldMaxSpeed > 0) {
                  speed = (speed / oldMaxSpeed) * maxSpeed;
                }
              }

              const maxY =
                document.documentElement.scrollHeight - window.innerHeight;
              const y = window.scrollY || 0;
              const remaining = maxY - y;

              if (!decelerating) {
                if (speed < maxSpeed) {
                  speed = Math.min(maxSpeed, speed + accel);
                }

                const brakingDistance = (speed * speed) / (2 * decel);
                if (remaining <= brakingDistance + 2) {
                  decelerating = true;
                }
              } else {
                if (speed > 0) {
                  speed = Math.max(0, speed - decel);
                }
              }

              if (remaining <= 1 && speed <= 0.1) {
                window.scrollTo(0, maxY);
                window.__autoScrollRunning = false;
                chrome.runtime.sendMessage({ type: "SCROLL_FINISHED" });
                return;
              }

              // Mark as programmatic scroll before scrolling
              isProgrammaticScroll = true;
              window.scrollBy(0, speed);

              // Update expected position after scroll
              lastAutoScrollY = window.scrollY || 0;

              // Reset flag after a short delay
              setTimeout(() => {
                isProgrammaticScroll = false;
              }, 30);

              requestAnimationFrame(step);
            }

            step();
          },
          args: [speed],
        });
      } catch (error) {
        // Handle errors (e.g., page became restricted, tab closed, etc.)
        scrolling = false;
        state.scrolling = false;
        chrome.action.setBadgeText({ text: "", tabId: tab.id });
        notifyPopupStateChange(false);
      }
    }, 500); // 500ms delay to allow popup to close

    chrome.action.setBadgeText({ text: "▶", tabId: tab.id });
    notifyPopupStateChange(true);
  } else {
    // Stop scrolling
    scrolling = false;
    state.scrolling = false;

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        window.__autoScrollRunning = false;
      },
    });
    chrome.action.setBadgeText({ text: "", tabId: tab.id });
    notifyPopupStateChange(false);
  }
}

async function updateScrollSpeed(tabId, speed) {
  currentSpeed = speed;
  const state = getTabState(tabId);
  state.speed = speed;

  await chrome.scripting.executeScript({
    target: { tabId: tabId },
    func: (newSpeed) => {
      if (window.__autoScrollRunning) {
        window.__autoScrollSpeed = newSpeed;
      }
    },
    args: [speed],
  });
}

function notifyPopupStateChange(isPlaying) {
  // Try to notify any open popup windows
  chrome.runtime
    .sendMessage({
      type: "STATE_CHANGED",
      isPlaying: isPlaying,
      speed: currentSpeed,
    })
    .catch(() => {
      // Popup might not be open, ignore error
    });
}
