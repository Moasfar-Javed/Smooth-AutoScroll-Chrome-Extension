let scrolling = false;

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;

  if (!scrolling) {
    // Start scrolling
    scrolling = true;
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        window.__autoScrollRunning = true;

        let speed = 0; // current speed
        const maxSpeed = 2.5; // maximum px per frame
        const accel = 0.05; // acceleration per frame
        const decel = 0.1; // deceleration per frame
        let decelerating = false;

        function step() {
          if (!window.__autoScrollRunning) return;

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

          window.scrollBy(0, speed);
          requestAnimationFrame(step);
        }

        step();
      },
    });
    chrome.action.setBadgeText({ text: "▶", tabId: tab.id });
  } else {
    // Manual stop
    scrolling = false;
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        window.__autoScrollRunning = false;
      },
    });
    chrome.action.setBadgeText({ text: "", tabId: tab.id });
  }
});

// Listen for "scroll finished" from content script
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === "SCROLL_FINISHED" && sender.tab?.id) {
    scrolling = false;
    chrome.action.setBadgeText({ text: "", tabId: sender.tab.id });
  }
});
