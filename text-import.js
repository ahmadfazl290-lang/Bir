(function (global) {
  'use strict';

  const LIMITS = Object.freeze({ bytes: 20 * 1024 * 1024, rows: 100000, columns: 100 });
  const ALIASES = {
    front: ['front', 'question', 'term', 'word', 'english', 'prompt', 'پێشەوە', 'وشە', 'پرسیار', 'الوجه', 'الأمام', 'السؤال', 'المصطلح'],
    back: ['back', 'answer', 'meaning', 'translation', 'sorani', 'kurdish', 'پشتەوە', 'وەڵام', 'واتا', 'وەرگێڕان', 'الظهر', 'الخلف', 'الإجابة', 'الجواب', 'المعنى', 'الترجمة'],
    definition: ['definition', 'english definition', 'description', 'پێناسە', 'تعريف', 'التعريف'],
    deck: ['deck', 'deck name', 'دێک', 'دەک', 'حزمة', 'الحزمة'],
    guid: ['guid', 'unique id', 'note guid'],
    tags: ['tags', 'tag', 'تاگ', 'وسوم', 'الوسوم']
  };

  function fail(code, message) {
    const error = new Error(message);
    error.code = code;
    throw error;
  }

  function normalLabel(value) {
    return String(value).normalize('NFKC').trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
  }

  function separatorValue(value) {
    const key = String(value).toLowerCase().trim();
    if (value === '\t' || key === 'tab' || key === '\\t') return '\t';
    if (key === 'comma' || value === ',') return ',';
    if (key === 'semicolon' || value === ';') return ';';
    fail('INVALID_SEPARATOR', 'Choose a tab, comma, or semicolon separator.');
  }

  function parseRecords(text, separator, stopAfter) {
    const rows = [];
    let row = [], field = '', quoted = false, closedQuote = false, recordCount = 0;

    function endField() {
      row.push(field);
      if (row.length > LIMITS.columns) fail('TOO_MANY_COLUMNS', 'The file has more than 100 columns.');
      field = '';
      closedQuote = false;
    }

    function endRow() {
      endField();
      recordCount += 1;
      if (row.some(value => value.trim() !== '')) rows.push(row);
      row = [];
      // One extra record allows an ordinary column header before 100,000 cards.
      if (rows.length > LIMITS.rows + 1) fail('TOO_MANY_ROWS', 'The file has more than 100,000 rows.');
      return stopAfter && recordCount >= stopAfter;
    }

    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      if (quoted) {
        if (char === '"') {
          if (text[index + 1] === '"') {
            field += '"';
            index += 1;
          } else {
            quoted = false;
            closedQuote = true;
          }
        } else if (char === '\r') {
          field += '\n';
          if (text[index + 1] === '\n') index += 1;
        } else {
          field += char;
        }
        continue;
      }
      if (char === separator) {
        endField();
      } else if (char === '\n' || char === '\r') {
        if (char === '\r' && text[index + 1] === '\n') index += 1;
        if (endRow()) return rows;
      } else if (char === '"' && !field.length && !closedQuote) {
        quoted = true;
      } else if (char === '"' || closedQuote) {
        fail('INVALID_QUOTES', 'A quoted field is not closed correctly.');
      } else {
        field += char;
      }
    }
    if (quoted) fail('INVALID_QUOTES', 'A quoted field is not closed correctly.');
    if (field.length || row.length || closedQuote) endRow();
    return rows;
  }

  function inferSeparator(text, filename) {
    const preferred = /\.csv$/i.test(filename) ? ',' : '\t';
    const candidates = ['\t', ',', ';'].map(separator => {
      try {
        const rows = parseRecords(text, separator, 40);
        const widths = new Map();
        rows.forEach(row => widths.set(row.length, (widths.get(row.length) || 0) + 1));
        let width = 1, frequency = 0;
        widths.forEach((count, size) => {
          if (count > frequency || (count === frequency && size > width)) {
            frequency = count;
            width = size;
          }
        });
        const labeled = rows[0] && findColumn(rows[0], 'front') >= 0 && findColumn(rows[0], 'back') >= 0;
        return {
          separator,
          // Prose often contains repeated commas. A consistent tab file should
          // not become CSV merely because its definitions contain more commas.
          score: width > 1 ? 1000 * frequency / Math.max(1, rows.length) + (labeled ? 500 : 0) + (separator === preferred ? 100 : 0) + Math.min(width, 100) : 0
        };
      } catch (_) {
        return { separator, score: -1 };
      }
    });
    candidates.sort((a, b) => b.score - a.score || (a.separator === preferred ? -1 : b.separator === preferred ? 1 : 0));
    return candidates[0].score <= 0 ? preferred : candidates[0].separator;
  }

  function headerMode(value) {
    if (value === undefined || value === 'auto') return 'auto';
    if (value === true || ['yes', 'true', 'present'].includes(String(value).toLowerCase())) return 'present';
    if (value === false || ['no', 'false', 'none'].includes(String(value).toLowerCase())) return 'none';
    fail('INVALID_HEADER', 'Choose automatic, present, or no column header.');
  }

  function findColumn(columns, type) {
    return columns.findIndex(value => ALIASES[type].includes(normalLabel(value)));
  }

  function parse(input, options = {}) {
    let text = String(input == null ? '' : input);
    if (text.length > LIMITS.bytes || new TextEncoder().encode(text).length > LIMITS.bytes) {
      fail('FILE_TOO_LARGE', 'The text file is larger than 20 MB.');
    }
    text = text.replace(/^\uFEFF/, '');
    if (!text.trim()) fail('EMPTY_FILE', 'The file contains no flashcard rows.');

    const warnings = [];
    const directives = Object.create(null);
    const comments = [];
    let offset = 0;
    // Anki metadata and comments occur before card records, never inside quoted cells.
    while (offset < text.length) {
      const match = /([^\r\n]*)(\r\n|\n|\r|$)/.exec(text.slice(offset));
      const line = match[1];
      if (line.trim() && !line.startsWith('#')) break;
      offset += match[0].length;
      if (line.startsWith('#')) {
        const directive = /^#([^:]+):(.*)$/.exec(line);
        if (directive) directives[directive[1].toLowerCase().replace(/[ _-]/g, '')] = directive[2].trim();
        else comments.push(line.slice(1).trim());
      }
      if (!match[2]) break;
    }
    text = text.slice(offset);
    if (!text.trim()) fail('EMPTY_FILE', 'The file contains no flashcard rows.');

    const requestedSeparator = options.separator == null ? 'auto' : options.separator;
    const separator = requestedSeparator === 'auto'
      ? directives.separator !== undefined ? separatorValue(directives.separator) : inferSeparator(text, options.filename || '')
      : separatorValue(requestedSeparator);
    if (requestedSeparator !== 'auto' && directives.separator !== undefined && separatorValue(directives.separator) !== separator) {
      warnings.push('The chosen separator overrides the separator in the file.');
    }
    let rows = parseRecords(text, separator);
    if (!rows.length) fail('EMPTY_FILE', 'The file contains no flashcard rows.');

    const mode = headerMode(options.header);
    let columns = [];
    let header = 'none';
    if (directives.columns !== undefined) {
      // Anki's #columns metadata uses the file's separator and is not a card row.
      columns = parseRecords(directives.columns, separator)[0] || [];
      header = 'metadata';
    } else {
      const first = rows[0];
      const hasRecognizedHeader = findColumn(first, 'front') >= 0 && findColumn(first, 'back') >= 0;
      if (mode === 'present' || (mode === 'auto' && hasRecognizedHeader)) {
        columns = rows.shift().map(value => value.trim());
        header = 'row';
      }
    }
    if (!rows.length) fail('EMPTY_FILE', 'The file has a header but no flashcard rows.');
    if (rows.length > LIMITS.rows) fail('TOO_MANY_ROWS', 'The file has more than 100,000 rows.');

    const width = rows.reduce((maximum, row) => Math.max(maximum, row.length), columns.length);
    if (width > LIMITS.columns) fail('TOO_MANY_COLUMNS', 'The file has more than 100 columns.');
    for (let index = 0; index < width; index += 1) {
      if (!columns[index]) columns[index] = 'Column ' + (index + 1);
    }
    const irregular = rows.filter(row => row.length !== width).length;
    if (irregular) warnings.push(irregular + ' row(s) have fewer columns; missing values are empty.');
    rows = rows.map(row => Array.from({ length: width }, (_, index) => row[index] || ''));

    function directiveColumn(name) {
      if (directives[name] === undefined) return -1;
      if (!/^\d+$/.test(directives[name])) {
        warnings.push('The ' + name + ' column setting is invalid and was ignored.');
        return -1;
      }
      const index = Number(directives[name]) - 1;
      if (index < 0 || index >= width) {
        warnings.push('The ' + name + ' column setting is outside the file and was ignored.');
        return -1;
      }
      return index;
    }
    const metadata = {
      separator,
      html: /^(true|yes|1)$/i.test(directives.html || ''),
      header,
      columns: columns.slice(),
      deck: directives.deck || '',
      tags: directives.tags || '',
      notetype: directives.notetype || '',
      deckColumn: directiveColumn('deckcolumn'),
      tagsColumn: directiveColumn('tagscolumn'),
      guidColumn: directiveColumn('guidcolumn'),
      notetypeColumn: directiveColumn('notetypecolumn'),
      directives: Object.assign({}, directives),
      comments,
      rowCount: rows.length,
      columnCount: width
    };
    const suggested = {};
    Object.keys(ALIASES).forEach(key => { suggested[key] = findColumn(columns, key); });
    ['deck', 'tags', 'guid'].forEach(key => {
      if (metadata[key + 'Column'] >= 0) suggested[key] = metadata[key + 'Column'];
    });
    const reserved = new Set([suggested.deck, suggested.tags, suggested.guid, metadata.notetypeColumn].filter(index => index >= 0));
    const regular = columns.map((_, index) => index).filter(index => !reserved.has(index));
    if (suggested.front < 0) suggested.front = regular[0] === undefined ? -1 : regular[0];
    if (suggested.back < 0) suggested.back = regular.find(index => index !== suggested.front) ?? -1;
    if (width === 1) warnings.push('Only one column was found. Choose the correct separator to import both sides.');
    return { rows, columns, suggested, metadata, warnings };
  }

  function plainText(value, allowHtml) {
    const text = String(value == null ? '' : value).replace(/\r\n?/g, '\n');
    if (!allowHtml) return text;
    const document = new DOMParser().parseFromString(text, 'text/html');
    document.querySelectorAll('script,style,template,noscript,iframe,object,embed').forEach(element => element.remove());
    document.querySelectorAll('br').forEach(element => element.replaceWith(document.createTextNode('\n')));
    document.querySelectorAll('img').forEach(element => element.replaceWith(document.createTextNode(element.getAttribute('alt') || '')));
    document.querySelectorAll('td,th').forEach(element => element.append(document.createTextNode('\t')));
    document.querySelectorAll('p,div,section,article,header,footer,li,ul,ol,table,tr,blockquote,h1,h2,h3,h4,h5,h6,pre,details,summary')
      .forEach(element => { element.prepend(document.createTextNode('\n')); element.append(document.createTextNode('\n')); });
    return (document.body.textContent || '').replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  global.BIR_TEXT_IMPORT = Object.freeze({ parse, plainText, limits: LIMITS });
})(typeof window === 'undefined' ? globalThis : window);
