// Get UI elements
const speedSlider = document.getElementById("speed-slider");
const speedValue = document.getElementById("speed-value");
const playPauseBtn = document.getElementById("play-pause-btn");
const buttonIcon = playPauseBtn.querySelector(".button-icon");
const buttonText = playPauseBtn.querySelector(".button-text");

let isPlaying = false;
let currentSpeed = 1.0;

// Load saved speed preference
chrome.storage.local.get(["speed"], (result) => {
  if (result.speed !== undefined) {
    currentSpeed = result.speed;
    speedSlider.value = currentSpeed;
    updateSpeedDisplay(currentSpeed);
  }

  // Get actual state from background script (source of truth)
  chrome.runtime.sendMessage({ type: "GET_STATE" }, (response) => {
    if (response) {
      isPlaying = response.isPlaying;
      // Use speed from background if available, otherwise use stored preference
      if (response.speed !== undefined) {
        currentSpeed = response.speed;
        speedSlider.value = currentSpeed;
        updateSpeedDisplay(currentSpeed);
      }
      updateButtonState(isPlaying);
    }
  });
});

// Update speed display
function updateSpeedDisplay(speed) {
  speedValue.textContent = speed.toFixed(1) + "x";
}

// Update button state
function updateButtonState(playing) {
  if (playing) {
    playPauseBtn.classList.add("playing");
    buttonIcon.textContent = "⏸";
    buttonText.textContent = "Pause";
  } else {
    playPauseBtn.classList.remove("playing");
    buttonIcon.textContent = "▶";
    buttonText.textContent = "Start";
  }
}

// Speed slider change handler
speedSlider.addEventListener("input", (e) => {
  const newSpeed = parseFloat(e.target.value);
  currentSpeed = newSpeed;
  updateSpeedDisplay(newSpeed);

  // Save speed preference
  chrome.storage.local.set({ speed: newSpeed });

  // Update speed if currently playing
  if (isPlaying) {
    chrome.runtime.sendMessage({
      type: "UPDATE_SPEED",
      speed: newSpeed,
    });
  }
});

// Play/Pause button click handler
playPauseBtn.addEventListener("click", () => {
  const wasPlaying = isPlaying;
  isPlaying = !isPlaying;
  updateButtonState(isPlaying);

  // Send message to background script (source of truth)
  chrome.runtime.sendMessage({
    type: "TOGGLE_SCROLL",
    speed: currentSpeed,
  });

  // Close popup only when starting (not when pausing)
  if (!wasPlaying && isPlaying) {
    setTimeout(() => {
      window.close();
    }, 100);
  }
});

// Listen for state changes from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "STATE_CHANGED") {
    isPlaying = message.isPlaying;
    updateButtonState(isPlaying);
  }
});
