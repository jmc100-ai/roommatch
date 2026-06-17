function escHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escJson(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

module.exports = { escHtml, escJson };
