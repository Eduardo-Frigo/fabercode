const HEROICONS_SOURCE_URL = 'https://heroicons.com/';

const ICONS = {
  scale: {
    label: 'Scale',
    path: 'M12 3v18m0-18 6 4m-6-4-6 4m12 0-3 8h6l-3-8Zm-12 0-3 8h6l-3-8Zm-4 8h8m8 0h8',
  },
  shieldCheck: {
    label: 'Shield check',
    path: 'M12 3 5 6v5c0 4.4 2.8 8.3 7 9.8 4.2-1.5 7-5.4 7-9.8V6l-7-3Zm-3 9 2 2 4-5',
  },
  documentText: {
    label: 'Document text',
    path: 'M7 3h7l5 5v13H7V3Zm7 0v5h5M9 12h6M9 16h6M9 8h3',
  },
  briefcase: {
    label: 'Briefcase',
    path: 'M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M4 7h16v12H4V7Zm0 5h16M10 12v2h4v-2',
  },
  homeModern: {
    label: 'Home modern',
    path: 'M4 11 12 4l8 7v9H6v-8h12v8M9 20v-5h6v5',
  },
  mapPin: {
    label: 'Map pin',
    path: 'M12 21s7-5.2 7-12a7 7 0 0 0-14 0c0 6.8 7 12 7 12Zm0-9a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  },
  sparkles: {
    label: 'Sparkles',
    path: 'M12 3 9.8 8.8 4 11l5.8 2.2L12 19l2.2-5.8L20 11l-5.8-2.2L12 3ZM5 4v4M3 6h4m12 10v4m-2-2h4',
  },
  gift: {
    label: 'Gift',
    path: 'M20 12v8H4v-8m16 0H4m16 0V8H4v4m8-4v12M8.5 8C7.1 8 6 6.9 6 5.5S7.1 3 8.5 3C11 3 12 8 12 8s1-5 3.5-5C16.9 3 18 4.1 18 5.5S16.9 8 15.5 8',
  },
  heartPulse: {
    label: 'Heart pulse',
    path: 'M20 8.5c0 5.5-8 10.5-8 10.5S4 14 4 8.5A4.5 4.5 0 0 1 12 6a4.5 4.5 0 0 1 8 2.5ZM7 12h2l1.2-3 2.4 6L14 12h3',
  },
  camera: {
    label: 'Camera',
    path: 'M4 8h4l1.5-2h5L16 8h4v11H4V8Zm8 8a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z',
  },
  buildingOffice: {
    label: 'Building office',
    path: 'M5 21V4h10v17M15 9h4v12M8 8h2m2 0h2M8 12h2m2 0h2M8 16h2m2 0h2',
  },
  chatBubble: {
    label: 'Chat bubble',
    path: 'M5 6h14v10H9l-4 4V6Zm4 4h6m-6 3h4',
  },
  chartBar: {
    label: 'Chart bar',
    path: 'M5 20V9m5 11V4m5 16v-7m5 7H3',
  },
  users: {
    label: 'Users',
    path: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm6 9a6 6 0 0 0-12 0m12-8a3 3 0 1 0 0-6m3 14a5 5 0 0 0-4-4.9',
  },
  waves: {
    label: 'Waves',
    path: 'M3 16c2 0 2-1 4-1s2 1 4 1 2-1 4-1 2 1 4 1 2-1 2-1M3 11c2 0 2-1 4-1s2 1 4 1 2-1 4-1 2 1 4 1 2-1 2-1M4 20c2 0 2-1 4-1s2 1 4 1 2-1 4-1 2 1 4 1',
  },
  compass: {
    label: 'Compass',
    path: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm3.5-12.5-2 5-5 2 2-5 5-2Z',
  },
  globeAlt: {
    label: 'Globe alt',
    path: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0 0c2.5-2.2 3.7-5.2 3.7-9S14.5 5.2 12 3m0 18c-2.5-2.2-3.7-5.2-3.7-9S9.5 5.2 12 3M3.6 9h16.8M3.6 15h16.8',
  },
  leaf: {
    label: 'Leaf',
    path: 'M5 21c8 0 14-6 14-14V4h-3C8 4 4 8 4 16c0 2 1 4 1 5Zm0 0c2.5-6 6-9.5 11-11',
  },
  droplet: {
    label: 'Droplet',
    path: 'M12 21a6.5 6.5 0 0 0 6.5-6.5C18.5 10 12 3 12 3s-6.5 7-6.5 11.5A6.5 6.5 0 0 0 12 21Z',
  },
};

function normalizeIconDomain(contract = {}) {
  return String(contract && contract.domain ? contract.domain : '').trim().toLowerCase();
}

function normalizeIconIntentName(value = '') {
  const normalized = String(value || '')
    .trim()
    .replace(/[_\s]+/g, '-')
    .toLowerCase();
  const aliases = {
    'building': 'buildingOffice',
    'building-office': 'buildingOffice',
    'briefcase': 'briefcase',
    'calendar-check': 'shieldCheck',
    'check-circle': 'shieldCheck',
    'chart-bar': 'chartBar',
    'document-text': 'documentText',
    'globe-alt': 'globeAlt',
    'gift': 'gift',
    'present': 'gift',
    'heart-pulse': 'heartPulse',
    'home': 'homeModern',
    'home-modern': 'homeModern',
    'leaf': 'leaf',
    'droplet': 'droplet',
    'water': 'droplet',
    'key-round': 'mapPin',
    'layout-template': 'chartBar',
    'map-pin': 'mapPin',
    'shield-check': 'shieldCheck',
  };
  if (aliases[normalized]) return aliases[normalized];
  const camel = normalized.replace(/-([a-z0-9])/g, (_, char) => char.toUpperCase());
  return ICONS[camel] ? camel : '';
}

function resolveIconIntentNames(iconIntent = []) {
  if (!Array.isArray(iconIntent)) return [];
  const names = [];
  iconIntent.forEach((entry) => {
    const semanticName = entry && typeof entry === 'object'
      ? entry.semanticName || entry.name || entry.icon || ''
      : entry;
    const normalized = normalizeIconIntentName(semanticName);
    if (normalized && !names.includes(normalized)) names.push(normalized);
  });
  return names;
}

function resolveBlueprintIconNames({ contract = {}, iconIntent = [] } = {}) {
  const intentNames = resolveIconIntentNames(iconIntent);
  if (intentNames.length >= 3) return intentNames.slice(0, 3);

  const domain = normalizeIconDomain(contract);
  if (domain === 'legal') return ['scale', 'documentText', 'shieldCheck'];
  if (domain === 'chocolate') return ['sparkles', 'gift', 'heartPulse'];
  if (domain === 'gardening') return ['leaf', 'droplet', 'sparkles'];
  if (domain === 'wood-sculpture') return ['sparkles', 'leaf', 'shieldCheck'];
  if (domain === 'leather-goods') return ['briefcase', 'sparkles', 'shieldCheck'];
  if (domain === 'architecture') return ['homeModern', 'buildingOffice', 'sparkles'];
  if (domain === 'import-services') return ['globeAlt', 'documentText', 'briefcase'];
  if (domain === 'premium-wine-landing') return ['sparkles', 'gift', 'mapPin'];
  if (domain === 'construction-materials-site') return ['buildingOffice', 'briefcase', 'documentText'];
  if (domain === 'real-estate') return ['homeModern', 'mapPin', 'buildingOffice'];
  if (domain === 'dental' || domain === 'veterinary') return ['heartPulse', 'shieldCheck', 'chatBubble'];
  if (domain === 'photo-lab') return ['camera', 'documentText', 'sparkles'];
  if (domain === 'photography') return ['camera', 'sparkles', 'users'];
  if (domain === 'technology') return ['chartBar', 'shieldCheck', 'users'];
  if (domain === 'saas-tool') return ['chartBar', 'shieldCheck', 'users'];
  if (domain === 'editorial-content') return ['documentText', 'sparkles', 'users'];
  if (domain === 'institutional-education') return ['documentText', 'users', 'sparkles'];
  if (domain === 'general-institutional-site') return ['documentText', 'sparkles', 'users'];
  if (domain === 'humpback-whales') return ['waves', 'compass', 'globeAlt'];
  if (domain === 'aquarium') return ['waves', 'mapPin', 'compass'];
  if (domain === 'greenhouses') return ['leaf', 'shieldCheck', 'droplet'];
  return ['sparkles', 'chartBar', 'chatBubble'];
}

function getIconDefinition(name = '') {
  const key = String(name || '').trim();
  return ICONS[key] || ICONS.sparkles;
}

function buildBlueprintIconSet(options = {}) {
  const names = resolveBlueprintIconNames(options);
  return names.map((name) => ({
    name,
    ...getIconDefinition(name),
  }));
}

function renderInlineSvgIcon(name = '', className = 'service-icon') {
  const icon = getIconDefinition(name);
  return `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${icon.path}"></path></svg>`;
}

module.exports = {
  HEROICONS_SOURCE_URL,
  buildBlueprintIconSet,
  getIconDefinition,
  renderInlineSvgIcon,
  resolveBlueprintIconNames,
};
