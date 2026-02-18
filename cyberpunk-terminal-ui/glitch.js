/**
 * Cyberpunk Glitch Text Effect
 * Periodically applies a chromatic aberration glitch to elements
 * with the class "glitch-target".
 */
(function () {
  var INTERVAL_BASE = 8000;
  var INTERVAL_JITTER = 2000;
  var GLITCH_DURATION = 200;

  function triggerGlitch(el) {
    var text = el.getAttribute("data-text") || el.textContent;

    var cyan = document.createElement("span");
    cyan.className = "glitch-layer glitch-cyan";
    cyan.textContent = text;
    cyan.setAttribute("aria-hidden", "true");

    var magenta = document.createElement("span");
    magenta.className = "glitch-layer glitch-magenta";
    magenta.textContent = text;
    magenta.setAttribute("aria-hidden", "true");

    el.appendChild(cyan);
    el.appendChild(magenta);

    setTimeout(function () {
      cyan.remove();
      magenta.remove();
    }, GLITCH_DURATION);
  }

  function scheduleGlitch(el) {
    var delay = INTERVAL_BASE + Math.random() * INTERVAL_JITTER;
    setTimeout(function () {
      triggerGlitch(el);
      scheduleGlitch(el);
    }, delay);
  }

  document.querySelectorAll(".glitch-target").forEach(function (el) {
    scheduleGlitch(el);
  });
})();
