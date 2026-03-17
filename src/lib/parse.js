export const OCC = {
  birthday: ['birthday', 'bday', 'celebration', 'party'],
  'date night': ['date', 'couple', 'couples', 'romantic', 'anniversary'],
  'girls night': ['girls', 'galentine', 'ladies'],
  bachelorette: ['bach', 'bachelorette', 'bridal', 'bride'],
  'team building': ['team', 'corporate', 'outing', 'office'],
  'same-day': ['sameday', 'walkin', 'lastminute'],
  'weekday session': ['tuesday', 'wednesday', 'thursday', 'weekday'],
  'friday evening': ['friday', 'afterwork'],
}

export const PROD = {
  perfume: ['perfume', 'fragrance', 'scent'],
  cologne: ['cologne'],
  candle: ['candle'],
  'sugar scrub': ['scrub'],
  soap: ['soap'],
  'nail polish': ['nail', 'polish'],
  'shimmer gel': ['shimmer', 'gel'],
  'beard oil': ['beard'],
}

export const MOM = {
  'reveal reaction': ['reveal', 'reaction'],
  'mixing process': ['mix', 'blend', 'pour'],
  'choosing scents': ['choose', 'choosing', 'picking'],
  'group laughing': ['laugh', 'laughing', 'funny'],
  'finished product': ['finished', 'holding', 'done'],
  'overhead shot': ['overhead', 'flatlay'],
}

export const TONE_DESC = {
  warm: 'Write with warmth and genuine care, like a friend recommending something they love.',
  funny: 'Use light humor and wit. Playful, never try-hard.',
  upbeat: 'High energy and enthusiastic.',
  inviting: 'Make the reader feel welcome and included.',
  engaging: 'Spark curiosity and invite response.',
  informal: 'Casual and conversational, like a text from a friend.',
  formal: 'Professional and polished. Clear and confident.',
}

export function parse(s) {
  s = s.toLowerCase().replace(/[_\-.]/g, ' ')
  const r = { occasions: [], products: [], moments: [] }
  Object.keys(OCC).forEach(k => { if (OCC[k].some(v => s.includes(v))) r.occasions.push(k) })
  Object.keys(PROD).forEach(k => { if (PROD[k].some(v => s.includes(v))) r.products.push(k) })
  Object.keys(MOM).forEach(k => { if (MOM[k].some(v => s.includes(v))) r.moments.push(k) })
  return r
}

export function allTags(p) {
  return [...p.occasions, ...p.products, ...p.moments]
}
