const fs = require('fs');
const raw = fs.readFileSync('answers.txt', 'utf-8').replace(/\r/g, '');
const answers = raw.split(/\n\s*\n/).map(block =>
  block.split('\n').map(l => l.trim()).filter(l => l.length > 0 && l[0] !== '#')
  .map(l => { const comma = l.indexOf(','); return { idx: l.slice(0,comma).trim(), text: l.slice(comma+1).trim() }; })
).filter(g => g.length > 0);
console.log('total quiz:', answers.length);
console.log('quiz 0, Q1:', JSON.stringify(answers[0][0]));
