// Runs before React mounts to prevent flash of wrong theme.
try {
  var t = localStorage.getItem("panda_theme") || "dark";
  document.documentElement.setAttribute("data-theme", t);
} catch (e) {}
