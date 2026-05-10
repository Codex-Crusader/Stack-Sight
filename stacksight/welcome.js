// StackSight — welcome page

// Set platform-specific shortcut
const isMac = navigator.platform.toLowerCase().includes('mac');
const shortcutEl = document.getElementById('shortcut');
if (shortcutEl) {
  shortcutEl.textContent = isMac ? '⌘ + Shift + S' : 'Ctrl + Shift + S';
}

// Inline the legal text so it works fully offline within the extension
const LEGAL_HTML = `
<h4>Warranty disclaimer.</h4>
<p>StackSight is provided strictly <strong>"as-is"</strong> and <strong>"as-available"</strong>, without warranty of any kind, express or implied, including warranties of merchantability, fitness for a particular purpose, accuracy, reliability, security, non-infringement, or uninterrupted operation.</p>

<h4>Limitation of liability.</h4>
<p>To the fullest extent permitted by applicable law, the author shall not be liable for any direct, indirect, incidental, consequential, special, or exemplary damages arising from or related to the use of, or inability to use, StackSight — including loss of data, loss of profits, business interruption, or any other damages — even if the author has been advised of the possibility of such damages.</p>

<h4>Privacy.</h4>
<p>StackSight stores all user data exclusively within the local browser profile via <code>chrome.storage.local</code>. No data is transmitted, synchronised, or shared with any external server, third party, or analytics service. Removing the extension or clearing browser storage erases all data permanently and irrecoverably; no backup is retained.</p>

<h4>User responsibility.</h4>
<p>The user is solely responsible for the data they enter. Users are advised <strong>not to store sensitive information</strong> (passwords, financial credentials, personal identifiers) in any field, including the notes field. Local browser storage is not encrypted and is accessible to anyone with access to the user's browser profile.</p>

<h4>Third-party content.</h4>
<p>Display of any URL, name, or cost figure within StackSight does not constitute endorsement, affiliation, partnership, or sponsorship. Trademarks and brand names referenced via user-entered content remain the property of their respective owners.</p>

<h4>Intellectual property & permitted use.</h4>
<p>StackSight is created by <strong>Bhargavaram Krishnapur</strong> as a personal and educational project. The user is granted permission to install, use, and modify StackSight for personal, non-commercial purposes. Redistribution, resale, sublicensing, or commercial deployment, in original or modified form, requires the express written permission of the author.</p>

<h4>No support obligation.</h4>
<p>The author has no obligation to provide updates, security patches, bug fixes, support, or maintenance. Compatibility with future browser versions is not guaranteed.</p>

<h4>Acceptance.</h4>
<p>By installing or using StackSight, the user acknowledges having read and accepted these terms in full.</p>
`;

const legalBody = document.getElementById('legal-body');
if (legalBody) legalBody.innerHTML = LEGAL_HTML;

// CTA closes the welcome tab
const cta = document.getElementById('cta');
if (cta) {
  cta.addEventListener('click', () => {
    window.close();
  });
}
