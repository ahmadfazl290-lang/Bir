const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const modulePath = path.resolve(__dirname, '../text-import.js');
const sandbox = { window: {}, TextEncoder };
vm.runInNewContext(fs.readFileSync(modulePath, 'utf8'), sandbox);
const importer = sandbox.window.BIR_TEXT_IMPORT;
const parse = (text, options) => JSON.parse(JSON.stringify(importer.parse(text, options)));
function throwsCode(input, code, options) {
  assert.throws(() => parse(input, options), error => error.code === code);
}

test('UTF-8 Sorani, Arabic, BOM and CRLF', () => {
  const parsed = parse('\uFEFFEnglish\tMeaning\tDefinition\r\nHeart\tدڵ / قلب\tA muscular organ.\r\nCell\tخانە / خلية\tThe smallest living unit.\r\n');
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[0][1], 'دڵ / قلب');
  assert.equal(parsed.metadata.separator, '\t');
  assert.equal(parsed.metadata.header, 'row');
  assert.deepEqual(parsed.suggested, { front: 0, back: 1, definition: 2, deck: -1, guid: -1, tags: -1 });
});
test('quoted multiline comma fields and escaped quotes', () => {
  const parsed = parse('Front,Back\n"Heart, organ","دڵ\r\nA \"\"muscular\"\" organ"\n', { filename: 'my-deck.csv' });
  assert.equal(parsed.rows.length, 1);
  assert.deepEqual(parsed.rows[0], ['Heart, organ', 'دڵ\nA "muscular" organ']);
});
test('quoted tabs are not separators', () => {
  const parsed = parse('"English\tphrase"\t"کوردی\tعربي"\n', { separator: 'tab', header: false });
  assert.deepEqual(parsed.rows[0], ['English\tphrase', 'کوردی\tعربي']);
});
test('semicolon auto detection', () => {
  const parsed = parse('Front;Back;Definition\rWord;وشە;A unit of language.\r', { filename: 'vocab.csv' });
  assert.equal(parsed.metadata.separator, ';');
  assert.equal(parsed.rows.length, 1);
});
test('tab files remain tab-separated when prose has repeated commas', () => {
  const parsed = parse('Cell\tA small, living, basic unit\nHeart\tA large, muscular, hollow organ\n', { filename: 'vocabulary.tsv' });
  assert.equal(parsed.metadata.separator, '\t');
  assert.equal(parsed.rows[0][1], 'A small, living, basic unit');
});
test('Anki directives are metadata and have 1-based indices', () => {
  const parsed = parse('#separator:Tab\n#html:true\n#notetype:Basic\n#deck:Stage 1::Medical\n#deck column:3\n#tags column:4\n#guid column:5\n#columns:Front\tBack\tDeck\tTags\tGUID\nCell\t<b>خانە</b>\tStage 1::Biology\tbiology cell\tabc123\n');
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0][0], 'Cell');
  assert.equal(parsed.metadata.html, true);
  assert.equal(parsed.metadata.header, 'metadata');
  assert.equal(parsed.metadata.deckColumn, 2);
  assert.equal(parsed.metadata.tagsColumn, 3);
  assert.equal(parsed.metadata.guidColumn, 4);
  assert.equal(parsed.metadata.notetype, 'Basic');
  assert.equal(parsed.metadata.deck, 'Stage 1::Medical');
  assert.deepEqual(parsed.suggested, { front: 0, back: 1, definition: -1, deck: 2, guid: 4, tags: 3 });
});
test('Anki unspaced column directives and metadata without columns', () => {
  const parsed = parse('#separator:Comma\n#deckcolumn:1\n#tagscolumn:4\n#guidcolumn:5\nMy Deck,Cell,خانە,tag,123\n');
  assert.equal(parsed.metadata.deckColumn, 0);
  assert.equal(parsed.suggested.front, 1);
  assert.equal(parsed.suggested.back, 2);
});
test('explicit no-header preserves apparent column names', () => {
  const parsed = parse('Front\tBack\nCell\tخانە', { header: 'none' });
  assert.equal(parsed.rows.length, 2);
  assert.deepEqual(parsed.columns, ['Column 1', 'Column 2']);
});
test('explicit header supports custom labels', () => {
  const parsed = parse('Original,Translated\nCell,خانە', { separator: ',', header: true });
  assert.deepEqual(parsed.columns, ['Original', 'Translated']);
  assert.equal(parsed.rows.length, 1);
});
test('trailing empty values and irregular rows are padded', () => {
  const parsed = parse('Word\tMeaning\tDefinition\nCell\tخانە\t\nHeart\tدڵ\n');
  assert.deepEqual(parsed.rows[0], ['Cell', 'خانە', '']);
  assert.deepEqual(parsed.rows[1], ['Heart', 'دڵ', '']);
  assert.equal(parsed.warnings.length, 1);
});
test('ordinary comment prefix survives after card data begins', () => {
  const parsed = parse('# Anki export\nCell\tخانە\n#hashtag\tتاگ\n');
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[1][0], '#hashtag');
});
test('invalid metadata column is safely ignored', () => {
  const parsed = parse('#guid column:20\nWord\tMeaning\nCell\tخانە');
  assert.equal(parsed.metadata.guidColumn, -1);
  assert.match(parsed.warnings[0], /outside/);
});
test('separator override is explicit', () => {
  const parsed = parse('#separator:Tab\nWord,Meaning\nCell,خانە', { separator: 'comma' });
  assert.equal(parsed.rows.length, 1);
  assert.match(parsed.warnings[0], /overrides/);
});
test('single column preview is allowed and warned', () => {
  const parsed = parse('Cell\nHeart');
  assert.equal(parsed.suggested.front, 0);
  assert.equal(parsed.suggested.back, -1);
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.warnings.length, 1);
});
test('empty files and header-only files rejected', () => {
  ['', '\uFEFF\r\n ', '#separator:Tab\n#html:true', 'Front,Back'].forEach(input => throwsCode(input, 'EMPTY_FILE'));
});
test('malformed CSV quotes rejected', () => {
  ['"unclosed,back', 'front,"unclosed', '"front"bad,back', 'fr"ont,back', '"front""\tback'].forEach(input => throwsCode(input, 'INVALID_QUOTES', { separator: ',' }));
});
test('unknown separators rejected', () => {
  throwsCode('a|b', 'INVALID_SEPARATOR', { separator: 'pipe' });
  throwsCode('#separator:Pipe\na|b', 'INVALID_SEPARATOR');
});
test('100 columns accepted and 101 rejected', () => {
  assert.equal(parse(Array(100).fill('x').join('\t')).columns.length, 100);
  throwsCode(Array(101).fill('x').join('\t'), 'TOO_MANY_COLUMNS', { separator: 'tab' });
});
test('100,000 rows accepted; 100,001 data rows rejected', () => {
  assert.equal(parse('a\tb\n'.repeat(100000)).rows.length, 100000);
  assert.equal(parse('Front\tBack\n' + 'a\tb\n'.repeat(100000)).rows.length, 100000);
  throwsCode('a\tb\n'.repeat(100001), 'TOO_MANY_ROWS');
});
test('20 MB enforced as UTF-8 bytes', () => {
  throwsCode('ک'.repeat(11 * 1024 * 1024), 'FILE_TOO_LARGE');
});
test('plain text mode preserves literal HTML and line breaks', () => {
  assert.equal(importer.plainText('<b>Cell</b>\r\nخانە', false), '<b>Cell</b>\nخانە');
});

test('Anki HTML stays raw until explicit browser conversion', () => {
  const html = '<div dir="rtl">Cell &amp; unit<br><img src="cell.png" alt="Cell diagram"></div>';
  const quotedHtml = '"' + html.replace(/"/g, '""') + '"';
  const parsed = parse('#separator:Tab\n#html:true\nCell\t' + quotedHtml + '\n');
  assert.equal(parsed.metadata.html, true);
  assert.equal(parsed.rows[0][1], html);
  assert.equal(importer.plainText(parsed.rows[0][1], false), html);
});
