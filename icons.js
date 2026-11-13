// @ts-check
/** One consistent icon set: 24x24, 1.8 stroke, round caps. Used through data-icon="name" and icon("name"). */
const P = {
  home: '<path d="M3.5 11.2 12 4l8.5 7.2"/><path d="M5.5 9.8V19a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V9.8"/><path d="M10 20v-5h4v5"/>',
  pantry: '<rect x="3.5" y="4" width="17" height="4.5" rx="1.2"/><path d="M5 8.5V19a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8.5"/><path d="M10 12.5h4"/>',
  aspaz: '<path d="M7.2 14.2a3.7 3.7 0 0 1-.7-7.2 4.6 4.6 0 0 1 8.6-1.2 3.9 3.9 0 0 1 1.7 8.4"/><path d="M7.2 14.2V19a1 1 0 0 0 1 1h7.6a1 1 0 0 0 1-1v-4.8"/><path d="M7.2 17h9.6"/>',
  cart: '<circle cx="9.2" cy="19.4" r="1.3"/><circle cx="17" cy="19.4" r="1.3"/><path d="M3 4.2h2.4l2.1 10.8h10.2l1.8-7.6H6.3"/>',
  stats: '<path d="M4 20h16"/><path d="M6.5 20v-6"/><path d="M12 20V5"/><path d="M17.5 20v-9"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  alert: '<path d="M12 4.2 21 19.5H3z"/><path d="M12 10v4.2"/><path d="M12 16.9h.01"/>',
  check: '<path d="m5 12.6 4.4 4.4L19 7.6"/>',
  circleCheck: '<circle cx="12" cy="12" r="8.5"/><path d="m8.4 12.3 2.6 2.6 4.6-5.2"/>',
  x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  dashboard: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  users: '<circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><circle cx="17.2" cy="9.5" r="2.4"/><path d="M16.5 14.2A4.6 4.6 0 0 1 21 18.5"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17"/><path d="M12 3.5c2.4 2.4 3.6 5.2 3.6 8.5s-1.2 6.1-3.6 8.5c-2.4-2.4-3.6-5.2-3.6-8.5S9.6 5.9 12 3.5z"/>',
};
/** @param {string} name */
export const icon = name =>
  `<svg class="ico" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${P[name] || ""}</svg>`;
export const iconNames = Object.keys(P);
