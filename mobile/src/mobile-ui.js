'use strict';

// The mobile shell: an app bar with a burger menu, a slide-in drawer for the
// sidebar, and Android's back button wired to close things.
//
// None of this touches renderer.js — that file is shared verbatim with the
// desktop app, and it re-renders #root wholesale on every state change, so
// anything injected inside #root would be wiped. Everything here is either
// appended to <body> (outside the re-render) or handled by delegated events
// and CSS keyed off classes on <body>.

const { App } = require('@capacitor/app');

const BURGER = '☰';   // ☰
const CLOSE = '✕';    // ✕
const GEAR = '⚙';     // ⚙

function isOpen(selector) {
  return !!document.querySelector(selector);
}

function settingsOpen() { return isOpen('#settings-panel'); }
function previewOpen() { return isOpen('#preview-overlay'); }
function promptOpen() { return isOpen('#prompt-overlay'); }
function drawerOpen() { return document.body.classList.contains('nav-open'); }

function setDrawer(open) {
  document.body.classList.toggle('nav-open', !!open);
  const burger = document.getElementById('m-burger');
  if (burger) burger.textContent = open ? CLOSE : BURGER;
}

// The renderer owns these panels, so the honest way to close them is to click
// the control it already wired rather than to reach into its state.
function clickIfPresent(selector) {
  const el = document.querySelector(selector);
  if (el) { el.click(); return true; }
  return false;
}

function closeTopmost() {
  if (previewOpen()) return clickIfPresent('#preview-close');
  if (promptOpen()) return clickIfPresent('#prompt-cancel');
  if (settingsOpen()) return clickIfPresent('#settings-esc');
  if (drawerOpen()) { setDrawer(false); return true; }
  return false;
}

function buildAppBar() {
  if (document.getElementById('m-appbar')) return;

  const bar = document.createElement('div');
  bar.id = 'm-appbar';
  bar.innerHTML = `
    <button type="button" id="m-burger" aria-label="Menu">${BURGER}</button>
    <span id="m-title">BeanyDrive</span>
    <button type="button" id="m-settings" aria-label="Settings">${GEAR}</button>`;
  document.body.appendChild(bar);

  // Tapping the dimmed area outside the open drawer closes it, which is what
  // every Android drawer does.
  const scrim = document.createElement('div');
  scrim.id = 'm-scrim';
  scrim.addEventListener('click', () => setDrawer(false));
  document.body.appendChild(scrim);

  document.getElementById('m-burger').addEventListener('click', () => setDrawer(!drawerOpen()));
  document.getElementById('m-settings').addEventListener('click', () => {
    if (settingsOpen()) clickIfPresent('#settings-esc');
    else { setDrawer(false); clickIfPresent('#settings-toggle'); }
  });
}

function wireDelegates() {
  // Picking a folder or view should dismiss the drawer — otherwise it covers
  // the list you just navigated to.
  document.addEventListener('click', (e) => {
    if (!drawerOpen()) return;
    const navItem = e.target.closest('[data-nav]');
    if (navItem && navItem.closest('.sidebar')) setDrawer(false);
  });

  // The renderer's own Escape handling is keyboard-only; on a phone the back
  // button is the equivalent, and it must not exit the app while something is
  // open on top.
  App.addListener('backButton', ({ canGoBack }) => {
    if (closeTopmost()) return;
    if (canGoBack) window.history.back();
    else App.exitApp();
  }).catch(() => { /* not running under Capacitor */ });
}

function start() {
  buildAppBar();
  wireDelegates();
  // Opening settings while the drawer is out leaves both stacked.
  const observer = new MutationObserver(() => {
    if (settingsOpen() && drawerOpen()) setDrawer(false);
  });
  observer.observe(document.getElementById('root'), { childList: true, subtree: false });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start);
} else {
  start();
}

module.exports = {};
